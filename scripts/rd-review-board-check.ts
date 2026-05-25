import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { auditEvents, ideaReviewOutcomes, ideaStateHistory } from "../src/server/db/schema";
import { submitIdea } from "../src/server/employee-intake/service";
import { analyzeIdeaFamilyForIdea } from "../src/server/idea-families/service";
import type { LlmProvider } from "../src/server/llm/adapter";
import { routeIdeaBeforeRdReview } from "../src/server/pre-rd-routing/service";
import {
  assignIdeaRanking,
  getAccessibleRdReviewBoard,
  getCampaignContextReviewOutcome,
  ideaIsGloballyRemovedFromReviewQueues,
  recordReviewOutcome,
  recommendReviewOutcome
} from "../src/server/rd-review/service";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

type RoutingDecision = "ready_for_rd_review" | "needs_employee_clarification" | "future_opportunity" | "inactive_idea";

function routingProvider(decision: RoutingDecision, reason: string): LlmProvider {
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
              id: "tool-call-rd-review-board",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-rd-review-board-test",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function relationshipProvider(): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  reason: "Standalone review-ready idea.",
                  relatedIdeaId: null,
                  relationship: "unrelated",
                  variantDifference: null
                }),
                name: "record_idea_family_relationship"
              },
              id: "tool-call-relationship-board",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-rd-review-board-relationship",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function summaryProvider(summaryText: string): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  aiReason: "Summary for R&D review board packet.",
                  sourceTrace: [
                    {
                      clarificationRequestId: null,
                      excerpt: "Shared exchange could make leftovers visible before new orders go out.",
                      ideaId: "idea-general-material-exchange",
                      sourceType: "original_submission"
                    }
                  ],
                  summaryText
                }),
                name: "record_idea_review_summary"
              },
              id: "tool-call-summary-board",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-rd-review-board-summary",
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

async function currentState(ideaId: string) {
  const [state] = await db
    .select()
    .from(ideaStateHistory)
    .where(and(eq(ideaStateHistory.ideaId, ideaId), eq(ideaStateHistory.isCurrent, true)))
    .limit(1);
  assert(state, `${ideaId} has current workflow state`);
  return state;
}

async function main() {
  try {
    console.log("rd-review-board-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const employee = await sessionFor("employee");
    const generalOwner = await sessionFor("general-campaign-owner");
    const specificOwner = await sessionFor("specific-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");

    console.log("rd-review-board-check: ready ideas appear on review board with packet details");
    await routeIdeaBeforeRdReview(generalOwner, "idea-general-material-exchange", {
      contextVersion: "general-packet-v1",
      provider: routingProvider("ready_for_rd_review", "General idea is ready for low-priority review.")
    });
    await analyzeIdeaFamilyForIdea(generalOwner, "idea-general-material-exchange", {
      relationshipProvider: relationshipProvider(),
      summaryProvider: summaryProvider("Reusable lab material exchange ready for General Campaign review.")
    });
    await assignIdeaRanking(generalOwner, "idea-general-material-exchange", {
      rankPosition: 1,
      rankReasons: ["Strong company fit", "Repeated waste signal", "Low implementation risk"]
    });

    const clarificationIdea = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Need more detail before review.",
      title: "Awaiting clarification idea"
    });
    await routeIdeaBeforeRdReview(specificOwner, clarificationIdea.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider("needs_employee_clarification", "Missing production owner detail.")
    });

    let board = await getAccessibleRdReviewBoard(teamMember);
    assert.equal(board.readyPackets.some((packet) => packet.ideaId === "idea-general-material-exchange"), true);
    assert(board.awaitingClarificationCount >= 1);
    const packet = board.readyPackets.find((candidate) => candidate.ideaId === "idea-general-material-exchange");
    assert(packet, "review packet exists");
    assert(packet.summary, "review packet includes R&D summary");
    assert(packet.sourceTrace, "review packet includes source trace");
    assert.equal(packet.ranking?.rankReasons.length, 3);
    assert(packet.members.length >= 1);
    assert.equal(packet.submitterDisplayName, "Jordan Kim");

    console.log("rd-review-board-check: team member can recommend but cannot approve");
    await recommendReviewOutcome(teamMember, "idea-general-material-exchange", {
      nextState: "potential_idea",
      reasonNote: "Looks worth prototyping.",
      reasonTag: "high_value"
    });
    await assert.rejects(
      () =>
        recordReviewOutcome(teamMember, "idea-general-material-exchange", {
          nextState: "potential_idea",
          reasonTag: "high_value"
        }),
      /Only the relevant campaign owner/
    );
    board = await getAccessibleRdReviewBoard(generalOwner);
    assert.equal(board.readyPackets[0]?.recommendations.length, 1);

    console.log("rd-review-board-check: owner marks Potential Idea and idea leaves review queues globally");
    await recordReviewOutcome(generalOwner, "idea-general-material-exchange", {
      nextState: "potential_idea",
      reasonNote: "Selected for prototype work.",
      reasonTag: "quick_prototype"
    });
    assert.equal((await currentState("idea-general-material-exchange")).workflowState, "potential_idea");
    assert.equal(await ideaIsGloballyRemovedFromReviewQueues("idea-general-material-exchange"), true);
    board = await getAccessibleRdReviewBoard(generalOwner);
    assert.equal(
      board.readyPackets.some((candidate) => candidate.ideaId === "idea-general-material-exchange"),
      false
    );

    console.log("rd-review-board-check: campaign-context return keeps shared idea reviewable elsewhere");
    const sharedReady = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Shared idea that may appear in multiple campaign reviews.",
      title: "Shared campaign-context idea"
    });
    await routeIdeaBeforeRdReview(generalOwner, sharedReady.ideaId, {
      contextVersion: "general-packet-v2",
      provider: routingProvider("ready_for_rd_review", "Shared idea ready for review.")
    });
    await recordReviewOutcome(specificOwner, sharedReady.ideaId, {
      campaignContextId: "specific-campaign",
      nextState: "future_opportunity",
      reasonNote: "Not a fit for Battery Reuse right now.",
      reasonTag: "not_now"
    });
    assert.equal((await currentState(sharedReady.ideaId)).workflowState, "ready_for_rd_review");
    const specificOutcome = await getCampaignContextReviewOutcome("specific-campaign", sharedReady.ideaId);
    assert(specificOutcome, "specific campaign outcome stored");
    assert.equal(specificOutcome.reasonTag, "not_now");
    assert.match(specificOutcome.reasonNote ?? "", /Battery Reuse/i);
    board = await getAccessibleRdReviewBoard(generalOwner);
    assert.equal(board.readyPackets.some((packet) => packet.ideaId === sharedReady.ideaId), true);

    console.log("rd-review-board-check: fixed reason tags are enforced");
    await assert.rejects(
      () =>
        recordReviewOutcome(generalOwner, sharedReady.ideaId, {
          nextState: "future_opportunity",
          reasonTag: "made_up_tag"
        }),
      /Invalid reason tag/
    );

    await recordReviewOutcome(generalOwner, sharedReady.ideaId, {
      nextState: "inactive_idea",
      reasonNote: "Too weak under current company context.",
      reasonTag: "insufficient_value"
    });
    assert.equal((await currentState(sharedReady.ideaId)).workflowState, "inactive_idea");
    const generalOutcome = await getCampaignContextReviewOutcome("general-campaign", sharedReady.ideaId);
    assert(generalOutcome, "home campaign outcome stored");
    assert.equal(generalOutcome.reasonTag, "insufficient_value");

    console.log("rd-review-board-check: audit events recorded");
    const auditRows = await db
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, "idea-general-material-exchange"), eq(auditEvents.entityType, "idea")));
    const eventTypes = new Set(auditRows.map((row) => row.eventType));
    assert(eventTypes.has("idea.review_outcome.recommended"));
    assert(eventTypes.has("idea.review_outcome.approved"));

    const outcomeRows = await db
      .select({ campaignId: ideaReviewOutcomes.campaignId })
      .from(ideaReviewOutcomes)
      .where(eq(ideaReviewOutcomes.ideaId, sharedReady.ideaId));
    assert.equal(outcomeRows.length, 2);

    console.log("rd-review-board-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
