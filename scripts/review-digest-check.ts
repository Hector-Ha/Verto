import assert from "node:assert/strict";

import { and, eq, inArray } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { requestEmployeeClarification, type ClarificationEmailProvider } from "../src/server/clarifications/service";
import {
  classifyIdeaIntoGroups,
  rankSpecificCampaignGroups
} from "../src/server/classification-groups/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { auditEvents, reviewDigests } from "../src/server/db/schema";
import { submitIdea } from "../src/server/employee-intake/service";
import type { LlmProvider } from "../src/server/llm/adapter";
import { routeIdeaBeforeRdReview } from "../src/server/pre-rd-routing/service";
import { recordReviewOutcome } from "../src/server/rd-review/service";
import {
  getAccessibleReviewDigests,
  runGeneralCampaignWeeklyDigestJob,
  runSpecificCampaignDailyDigestJob
} from "../src/server/review-digests/service";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

function routingProvider(): LlmProvider {
  return routingDecisionProvider("ready_for_rd_review", "Digest candidate became review-ready.");
}

function routingDecisionProvider(
  decision: "ready_for_rd_review" | "needs_employee_clarification" | "future_opportunity" | "inactive_idea",
  reason: string
): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  outOfScopeMatched: false,
                  outOfScopeReason: null,
                  readinessBasis: "Minimum review packet information gate is satisfied.",
                  reviewPacketStatus: decision === "ready_for_rd_review" ? "ready" : "missing_critical_info",
                  routingDecision: decision,
                  routingReason: reason
                }),
                name: "record_pre_rd_routing_decision"
              },
              id: "tool-call-review-digest",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-review-digest-test",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function clarificationQuestionProvider(): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  questionText: "Which production cell would use this idea first?",
                  rationale: "R&D needs the first-use cell before review."
                }),
                name: "record_employee_clarification_question"
              },
              id: "tool-call-review-digest-clarification",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-review-digest-clarification",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function classificationProvider(): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  groups: [
                    {
                      groupType: "standard",
                      isPrimary: true,
                      name: "Fixture Reuse",
                      placementReason: "Idea focuses on reusable battery tray fixtures.",
                      summaryText: "Reusable tooling and fixture ideas for battery workflows."
                    }
                  ]
                }),
                name: "record_idea_classification"
              },
              id: "tool-call-review-digest-classification",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-review-digest-classification",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function rankingProvider(): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  rankings: [{ groupName: "Fixture Reuse", rankPosition: 1 }]
                }),
                name: "record_idea_group_ranking"
              },
              id: "tool-call-review-digest-ranking",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-review-digest-ranking",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function main() {
  try {
    console.log("review-digest-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const employee = await sessionFor("employee");
    const generalOwner = await sessionFor("general-campaign-owner");
    const specificOwner = await sessionFor("specific-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");
    const readyAt = new Date("2026-02-01T10:00:00Z");
    const rerankedAt = new Date("2026-02-02T09:00:00Z");
    const generatedAt = new Date("2026-02-02T10:00:00Z");
    const emailProvider: ClarificationEmailProvider = async () => ({
      messages: ["digest-clarification-email"],
      trackingId: "digest-clarification-email"
    });

    console.log("review-digest-check: daily specific digest captures compact review updates");
    const idea = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Reuse stable battery tray fixtures after validation.",
      title: "Reusable battery tray fixtures"
    });
    await routeIdeaBeforeRdReview(specificOwner, idea.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      now: readyAt,
      provider: routingProvider()
    });
    await classifyIdeaIntoGroups(specificOwner, idea.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      now: rerankedAt,
      provider: classificationProvider()
    });
    await rankSpecificCampaignGroups(specificOwner, "specific-campaign", {
      contextVersion: "knowledge-report-specific-approved",
      now: rerankedAt,
      provider: rankingProvider()
    });
    const clarificationIdea = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Need one production detail before R&D can review this.",
      title: "Clarification nearing expiry"
    });
    const clarification = await requestEmployeeClarification(specificOwner, clarificationIdea.ideaId, {
      emailProvider,
      expiresAt: new Date("2026-02-04T10:00:00Z"),
      now: readyAt,
      provider: clarificationQuestionProvider()
    });
    assert.equal(clarification.status, "sent");
    const routingChangeIdea = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Context recheck now shows enough packet detail.",
      title: "Routing change candidate"
    });
    await routeIdeaBeforeRdReview(specificOwner, routingChangeIdea.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      now: readyAt,
      provider: routingDecisionProvider("future_opportunity", "Not enough current campaign fit.")
    });
    await routeIdeaBeforeRdReview(specificOwner, routingChangeIdea.ideaId, {
      contextVersion: "knowledge-report-specific-approved:v2",
      now: rerankedAt,
      provider: routingDecisionProvider("ready_for_rd_review", "Context recheck made this review-ready."),
      trigger: "campaign_context_recheck"
    });

    const job = await runSpecificCampaignDailyDigestJob({ now: generatedAt });
    assert.equal(job.generatedCount, 1);

    const digests = await getAccessibleReviewDigests(teamMember);
    const digest = digests.find((candidate) => candidate.campaignId === "specific-campaign");
    assert(digest, "team member with campaign access can read digest");
    assert.equal(digest.cadence, "daily");
    assert(digest.items.some((item) => item.itemType === "new_review_ready" && item.ideaId === idea.ideaId));
    assert(digest.items.some((item) => item.itemType === "clarification_expiring" && item.ideaId === clarificationIdea.ideaId));
    assert(digest.items.some((item) => item.itemType === "major_routing_change" && item.ideaId === routingChangeIdea.ideaId));
    assert(digest.items.some((item) => item.itemType === "rerank_summary" && item.ideaId === null));
    assert(digest.items.every((item) => item.title.length <= 96 && item.body.length <= 180));
    assert(digest.items.every((item) => item.linkHref.startsWith("#") && item.linkLabel.length > 0));

    console.log("review-digest-check: digest read access does not grant owner-only actions");
    await assert.rejects(
      () =>
        recordReviewOutcome(teamMember, idea.ideaId, {
          nextState: "potential_idea",
          reasonTag: "high_value"
        }),
      /Only the relevant campaign owner/
    );

    console.log("review-digest-check: weekly General Campaign digest runs separately");
    await routeIdeaBeforeRdReview(generalOwner, "idea-general-material-exchange", {
      contextVersion: "general-packet-baseline",
      now: readyAt,
      provider: routingProvider()
    });
    const generalJob = await runGeneralCampaignWeeklyDigestJob({ now: new Date("2026-02-08T10:00:00Z") });
    assert.equal(generalJob.generatedCount, 1);
    const generalDigests = await getAccessibleReviewDigests(teamMember);
    const generalDigest = generalDigests.find((candidate) => candidate.campaignId === "general-campaign");
    assert(generalDigest, "team member with General Campaign access can read General digest");
    assert.equal(generalDigest.cadence, "weekly");
    assert(generalDigest.items.some((item) => item.itemType === "new_review_ready"));

    console.log("review-digest-check: latest digest replaces prior digest");
    await runSpecificCampaignDailyDigestJob({ now: new Date("2026-02-12T10:00:00Z") });
    const digestRows = await db
      .select({ digestId: reviewDigests.id, itemCount: reviewDigests.itemCount })
      .from(reviewDigests)
      .where(eq(reviewDigests.campaignId, "specific-campaign"));
    assert.equal(digestRows.length, 1);
    assert.equal(digestRows[0].itemCount, 0);

    console.log("review-digest-check: digest delivery stays in-app only");
    const notificationRows = await db
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(inArray(auditEvents.eventType, ["review_digest.email.sent", "review_digest.push.sent"]));
    assert.equal(notificationRows.length, 0);
    const digestAuditRows = await db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.eventType, "review_digest.generated"), eq(auditEvents.entityId, "specific-campaign")));
    assert(digestAuditRows.some((row) => row.metadata?.delivery === "in_app"));

    const employeeDigests = await getAccessibleReviewDigests(employee);
    assert.equal(employeeDigests.length, 0);

    console.log("review-digest-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
