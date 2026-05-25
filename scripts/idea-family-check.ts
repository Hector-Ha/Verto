import assert from "node:assert/strict";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import {
  requestEmployeeClarification,
  submitClarificationAnswer,
  type ClarificationEmailProvider
} from "../src/server/clarifications/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { userRoles, users, type IdeaSummarySourceTrace } from "../src/server/db/schema";
import { submitIdea } from "../src/server/employee-intake/service";
import {
  analyzeIdeaFamilyForIdea,
  getAccessibleIdeaFamilyReviewView,
  getIdeaFamilySummaryHistory,
  regenerateIdeaFamilySummary
} from "../src/server/idea-families/service";
import type { LlmProvider } from "../src/server/llm/adapter";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

function summaryProvider(
  summaryText: string,
  sourceTrace: IdeaSummarySourceTrace = [
    {
      clarificationRequestId: null,
      excerpt: "Shared exchange could make leftovers visible before new orders go out.",
      ideaId: "idea-general-material-exchange",
      sourceType: "original_submission"
    }
  ]
): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  aiReason: "Summary combines duplicate source submissions into one review packet.",
                  sourceTrace,
                  summaryText
                }),
                name: "record_idea_review_summary"
              },
              id: "tool-call-summary",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-idea-summary-test",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function clarificationQuestionProvider(questionText: string): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  questionText,
                  rationale: "R&D needs one employee detail for summary source trace."
                }),
                name: "record_employee_clarification_question"
              },
              id: "tool-call-clarification",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-clarification-for-family-test",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function relationshipProvider(capturedRequests: string[]): LlmProvider {
  return async (request) => {
    capturedRequests.push(JSON.stringify(request));

    return {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  arguments: JSON.stringify({
                    reason: "Both submissions describe reducing waste through a shared material exchange.",
                    relatedIdeaId: "idea-general-material-exchange",
                    relationship: "variant",
                    variantDifference: "The newer submission adds barcode tracking and ownership workflow detail."
                  }),
                  name: "record_idea_family_relationship"
                },
                id: "tool-call-relationship",
                type: "function"
              }
            ]
          }
        }
      ],
      id: "chatcmpl-idea-family-test",
      model: "moonshotai/kimi-k2.6",
      object: "chat.completion"
    };
  };
}

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function employeeSessionFor(userId: string) {
  const token = createSessionToken({ roleId: "employee", userId });
  const session = await getSessionFromToken(token);
  assert(session, `${userId} employee session resolves`);
  return session;
}

async function main() {
  try {
    console.log("idea-family-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const employee = await sessionFor("employee");
    const generalOwner = await sessionFor("general-campaign-owner");

    console.log("idea-family-check: exact duplicate shares one family review packet");
    const duplicate = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText:
        "We throw away usable lab materials when teams finish experiments. A shared exchange could make leftovers visible before new orders go out.",
      title: "Reusable lab material exchange"
    });

    const result = await analyzeIdeaFamilyForIdea(generalOwner, duplicate.ideaId, {
      summaryProvider: summaryProvider("Reusable lab material exchange submitted twice by the same employee.")
    });
    assert.equal(result.relationshipType, "exact_duplicate");
    assert.equal(result.reviewPacketCount, 1);
    assert.deepEqual(result.memberIdeaIds.toSorted(), ["idea-general-material-exchange", duplicate.ideaId].toSorted());

    const view = await getAccessibleIdeaFamilyReviewView(generalOwner);
    const family = view.find((candidate) => candidate.familyId === result.familyId);
    assert(family, "family appears in R&D review view");
    assert.equal(family.members.length, 2);
    assert.equal(family.members.filter((member) => member.relationshipType === "exact_duplicate").length, 1);
    assert.equal(family.currentSummary?.version, 1);
    assert.match(family.currentSummary?.summaryText ?? "", /submitted twice/i);
    assert.equal(family.currentSummary?.sourceTrace[0]?.sourceType, "original_submission");

    console.log("idea-family-check: different employee similar submission becomes variant without identity in AI prompt");
    await db.insert(users).values({
      createdAt: new Date("2026-01-15T09:00:00.000Z"),
      department: "Manufacturing",
      displayName: "Taylor Ng",
      email: "line.operator@verto.demo",
      id: "employee-two",
      updatedAt: new Date("2026-01-15T09:00:00.000Z")
    });
    await db.insert(userRoles).values({
      createdAt: new Date("2026-01-15T09:00:00.000Z"),
      roleId: "employee",
      userId: "employee-two"
    });
    const secondEmployee = await employeeSessionFor("employee-two");
    const similar = await submitIdea(secondEmployee, {
      campaignId: "general-campaign",
      originalText:
        "Add barcode tracking to a shared leftover materials exchange so teams can claim useful lab stock before reordering.",
      problemOpportunity: "Teams reorder items while leftovers sit unused nearby.",
      title: "Barcode tracked material exchange"
    });
    const capturedRequests: string[] = [];
    const variantResult = await analyzeIdeaFamilyForIdea(generalOwner, similar.ideaId, {
      relationshipProvider: relationshipProvider(capturedRequests),
      summaryProvider: summaryProvider("Shared material exchange family with duplicate signal and barcode tracking variant.")
    });
    assert.equal(variantResult.relationshipType, "variant");
    assert.equal(variantResult.familyId, result.familyId);
    assert.equal(variantResult.memberIdeaIds.length, 3);
    const relationshipPrompt = capturedRequests.join("\n");
    assert.equal(relationshipPrompt.includes("employee@verto.demo"), false);
    assert.equal(relationshipPrompt.includes("line.operator@verto.demo"), false);
    assert.equal(relationshipPrompt.includes("Jordan Kim"), false);
    assert.equal(relationshipPrompt.includes("Taylor Ng"), false);
    assert.equal(relationshipPrompt.includes("employee-two"), false);

    const updatedView = await getAccessibleIdeaFamilyReviewView(generalOwner);
    const updatedFamily = updatedView.find((candidate) => candidate.familyId === result.familyId);
    assert(updatedFamily, "updated family appears in R&D review view");
    const variantMember = updatedFamily.members.find((member) => member.ideaId === similar.ideaId);
    assert(variantMember, "variant member is preserved");
    assert.equal(variantMember.relationshipType, "variant");
    assert.match(variantMember.variantDifference ?? "", /barcode/i);
    assert.equal(variantMember.email, "line.operator@verto.demo");
    assert.equal(updatedFamily.currentSummary?.version, 2);

    console.log("idea-family-check: summary regeneration cites clarification and keeps history");
    const sentEmails: string[] = [];
    const emailProvider: ClarificationEmailProvider = async (message) => {
      sentEmails.push(message.html);

      return {
        messages: ["queued"],
        trackingId: "family-summary-email"
      };
    };
    const clarification = await requestEmployeeClarification(generalOwner, "idea-general-material-exchange", {
      appBaseUrl: "http://localhost:3000",
      emailProvider,
      now: new Date("2026-01-16T12:00:00.000Z"),
      provider: clarificationQuestionProvider("Which team would use the material exchange first?")
    });
    assert.equal(clarification.status, "sent");
    await submitClarificationAnswer(clarification.token, {
      answerText: "Maintenance would use it first because they track leftover materials already.",
      now: new Date("2026-01-17T12:00:00.000Z")
    });
    const regenerated = await regenerateIdeaFamilySummary(generalOwner, result.familyId, {
      now: new Date("2026-01-18T12:00:00.000Z"),
      summaryProvider: summaryProvider("Maintenance-first material exchange family with duplicate and variant signal.", [
        {
          clarificationRequestId: null,
          excerpt: "Shared exchange could make leftovers visible before new orders go out.",
          ideaId: "idea-general-material-exchange",
          sourceType: "original_submission"
        },
        {
          clarificationRequestId: clarification.requestId,
          excerpt: "Maintenance would use it first.",
          ideaId: "idea-general-material-exchange",
          sourceType: "clarification_answer"
        }
      ])
    });
    assert.equal(regenerated.version, 3);
    assert(regenerated.sourceTrace.some((source) => source.sourceType === "clarification_answer"));
    const history = await getIdeaFamilySummaryHistory(generalOwner, result.familyId);
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((summary) => summary.version),
      [3, 2, 1]
    );
    assert.equal(history[0].requestedByUserId, generalOwner.user.id);
    assert.equal(history[0].createdAt.toISOString(), "2026-01-18T12:00:00.000Z");
    assert.match(history[0].aiReason, /duplicate source|summary combines/i);
    assert.equal(history.filter((summary) => summary.isCurrent).length, 1);

    console.log("idea-family-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
