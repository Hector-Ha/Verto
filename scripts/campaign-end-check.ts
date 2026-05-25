import assert from "node:assert/strict";

import { and, desc, eq, ne } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { changeCampaignLifecycle, recordIdeaReviewOutcome } from "../src/server/campaigns/service";
import {
  getEndedCampaignHistoryView,
  completeCampaignRetrospective,
  endCampaignWithSweep,
  startCampaignRetrospective
} from "../src/server/campaign-end/service";
import {
  requestEmployeeClarification,
  submitClarificationAnswer,
  type ClarificationEmailProvider
} from "../src/server/clarifications/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import {
  campaigns,
  clarificationRequests,
  retrospectiveGlobalContextProposals,
  ideaRoutingDecisions,
  ideaStateHistory,
  ideas,
  returnedIdeaLineage
} from "../src/server/db/schema";
import { submitIdea } from "../src/server/employee-intake/service";
import { applyAnsweredGeneralClarificationRouting } from "../src/server/general-campaign/service";
import type { LlmProvider } from "../src/server/llm/adapter";
import { routeIdeaBeforeRdReview } from "../src/server/pre-rd-routing/service";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

type RoutingDecision = "ready_for_rd_review" | "needs_employee_clarification" | "future_opportunity" | "inactive_idea";

function routingProvider(input: {
  decision: RoutingDecision;
  readinessBasis?: string;
  reason: string;
  reviewPacketStatus?: "ready" | "missing_critical_info" | "not_applicable";
}): LlmProvider {
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
                  readinessBasis: input.readinessBasis ?? "Minimum review packet information gate is satisfied.",
                  reviewPacketStatus: input.reviewPacketStatus ?? "ready",
                  routingDecision: input.decision,
                  routingReason: input.reason
                }),
                name: "record_pre_rd_routing_decision"
              },
              id: "tool-call-campaign-end-routing",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-campaign-end-routing",
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
                  questionText: "Which production team would use this after the campaign ends?",
                  rationale: "R&D needs the first-use team before review."
                }),
                name: "record_employee_clarification_question"
              },
              id: "tool-call-campaign-end-clarification",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-campaign-end-clarification",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function retrospectiveProvider(): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  campaignLearning:
                    "Fixture reuse ideas need clearer first-use ownership before they become review-ready.",
                  evidenceSummary:
                    "The ended campaign returned one clarification-dependent idea and one unreviewed ready idea.",
                  proposalText:
                    "Global Innovation Context should ask future reuse campaigns to name first-use ownership before ranking.",
                  proposalTitle: "Require first-use ownership for reuse campaigns",
                  targetContext: "global_innovation_context"
                }),
                name: "record_campaign_retrospective_learning"
              },
              id: "tool-call-campaign-retrospective",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-campaign-retrospective",
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
  assert(state, `${ideaId} has current state`);
  return state;
}

async function ideaCampaignId(ideaId: string) {
  const [idea] = await db.select({ campaignId: ideas.campaignId }).from(ideas).where(eq(ideas.id, ideaId)).limit(1);
  assert(idea, `${ideaId} exists`);
  return idea.campaignId;
}

async function submitSpecificIdea(title: string) {
  const employee = await sessionFor("employee");

  return submitIdea(employee, {
    campaignId: "specific-campaign",
    originalText: `${title} source material for campaign-end behavior.`,
    title
  });
}

async function main() {
  try {
    console.log("campaign-end-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const owner = await sessionFor("specific-campaign-owner");
    const generalOwner = await sessionFor("general-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");
    const employee = await sessionFor("employee");
    const endAt = new Date("2026-02-20T17:00:00Z");
    const emailProvider: ClarificationEmailProvider = async () => ({
      messages: ["campaign-end-clarification-email"],
      trackingId: "campaign-end-clarification-email"
    });

    console.log("campaign-end-check: create specific-campaign ideas in every end-state bucket");
    const readyDefault = await submitSpecificIdea("Unreviewed ready default return");
    await routeIdeaBeforeRdReview(owner, readyDefault.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({ decision: "ready_for_rd_review", reason: "Ready but not reviewed before end." })
    });

    const readyInactive = await submitSpecificIdea("Unreviewed ready inactive return");
    await routeIdeaBeforeRdReview(owner, readyInactive.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({ decision: "ready_for_rd_review", reason: "Ready but owner will return inactive." })
    });

    const reviewedFuture = await submitSpecificIdea("Reviewed future return");
    await routeIdeaBeforeRdReview(owner, reviewedFuture.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({ decision: "ready_for_rd_review", reason: "Ready then reviewed." })
    });
    await recordIdeaReviewOutcome(owner, reviewedFuture.ideaId, {
      nextState: "future_opportunity",
      reasonNote: "Reviewed but not selected before campaign end.",
      reasonTag: "not_now"
    });

    const potential = await submitSpecificIdea("Potential idea stays with ended campaign");
    await routeIdeaBeforeRdReview(owner, potential.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({ decision: "ready_for_rd_review", reason: "Ready and selected." })
    });
    await recordIdeaReviewOutcome(owner, potential.ideaId, {
      nextState: "potential_idea",
      reasonNote: "Owner selected this as potential.",
      reasonTag: "high_value"
    });

    const submittedOnly = await submitSpecificIdea("Submitted unfinished return");
    const clarifying = await submitSpecificIdea("Late clarification return");
    const clarification = await requestEmployeeClarification(owner, clarifying.ideaId, {
      appBaseUrl: "http://localhost:3000",
      emailProvider,
      expiresAt: new Date("2026-03-01T12:00:00Z"),
      now: new Date("2026-02-01T12:00:00Z"),
      provider: clarificationQuestionProvider()
    });
    assert.equal(clarification.status, "sent");
    const [beforeClarification] = await db
      .select()
      .from(clarificationRequests)
      .where(eq(clarificationRequests.ideaId, clarifying.ideaId))
      .limit(1);
    assert(beforeClarification, "clarification request exists before campaign end");

    await changeCampaignLifecycle(owner, "specific-campaign", { nextStatus: "intake_closed" });
    await changeCampaignLifecycle(owner, "specific-campaign", { nextStatus: "review_in_progress" });

    console.log("campaign-end-check: end sweep returns every non-potential idea to General Campaign");
    const sweep = await endCampaignWithSweep(owner, "specific-campaign", {
      inactiveIdeaIds: [readyInactive.ideaId],
      now: endAt
    });
    assert.equal(sweep.returnedCount, 5);
    assert.equal(sweep.skippedPotentialCount, 1);

    const [endedCampaign] = await db.select().from(campaigns).where(eq(campaigns.id, "specific-campaign")).limit(1);
    assert.equal(endedCampaign?.lifecycleStatus, "ended");
    assert.equal(await ideaCampaignId(readyDefault.ideaId), "general-campaign");
    assert.equal((await currentState(readyDefault.ideaId)).workflowState, "future_opportunity");
    assert.equal(await ideaCampaignId(readyInactive.ideaId), "general-campaign");
    assert.equal((await currentState(readyInactive.ideaId)).workflowState, "inactive_idea");
    assert.equal(await ideaCampaignId(reviewedFuture.ideaId), "general-campaign");
    assert.equal((await currentState(reviewedFuture.ideaId)).workflowState, "future_opportunity");
    assert.equal(await ideaCampaignId(submittedOnly.ideaId), "general-campaign");
    assert.equal((await currentState(submittedOnly.ideaId)).workflowState, "general_idea");
    assert.equal(await ideaCampaignId(clarifying.ideaId), "general-campaign");
    assert.equal((await currentState(clarifying.ideaId)).workflowState, "needs_employee_clarification");
    assert.equal(await ideaCampaignId(potential.ideaId), "specific-campaign");
    assert.equal((await currentState(potential.ideaId)).workflowState, "potential_idea");

    const orphanedRows = await db
      .select({ ideaId: ideas.id })
      .from(ideas)
      .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
      .where(
        and(
          eq(ideas.campaignId, "specific-campaign"),
          ne(ideaStateHistory.workflowState, "potential_idea")
        )
      );
    assert.equal(orphanedRows.length, 0);

    const lineageRows = await db
      .select()
      .from(returnedIdeaLineage)
      .where(eq(returnedIdeaLineage.fromCampaignId, "specific-campaign"));
    assert.equal(lineageRows.length, 5);
    assert(lineageRows.some((lineage) => lineage.ideaId === readyDefault.ideaId && lineage.returnedWorkflowState === "future_opportunity"));
    assert(lineageRows.some((lineage) => lineage.ideaId === readyInactive.ideaId && lineage.returnedWorkflowState === "inactive_idea"));

    const [afterClarification] = await db
      .select()
      .from(clarificationRequests)
      .where(eq(clarificationRequests.ideaId, clarifying.ideaId))
      .limit(1);
    assert.equal(afterClarification?.status, "pending");
    assert.equal(afterClarification?.expiresAt.toISOString(), beforeClarification.expiresAt.toISOString());

    console.log("campaign-end-check: late answer routes through General Campaign rules only");
    await submitClarificationAnswer(clarification.token, {
      answerText: "Maintenance would use it first after the campaign has ended.",
      now: new Date("2026-02-21T12:00:00Z")
    });
    const applied = await applyAnsweredGeneralClarificationRouting(generalOwner, afterClarification.id, {
      now: new Date("2026-02-21T12:05:00Z"),
      provider: routingProvider({
        decision: "ready_for_rd_review",
        readinessBasis: "General Campaign packet is satisfied by the late answer.",
        reason: "Late answer makes this General Campaign idea ready."
      })
    });
    assert.equal(applied.status, "routed");
    const [lateRouting] = await db
      .select()
      .from(ideaRoutingDecisions)
      .where(eq(ideaRoutingDecisions.ideaId, clarifying.ideaId))
      .orderBy(desc(ideaRoutingDecisions.createdAt))
      .limit(1);
    assert.equal(lateRouting?.campaignId, "general-campaign");
    assert.equal(lateRouting?.contextVersion, "general-packet-baseline");

    console.log("campaign-end-check: ended campaign history is searchable and immutable");
    const history = await getEndedCampaignHistoryView(teamMember, { query: "Battery" });
    const historyCampaign = history.campaigns.find((campaign) => campaign.campaignId === "specific-campaign");
    assert(historyCampaign, "ended campaign appears in history search");
    assert.equal(historyCampaign.returnedIdeas.length, 5);
    assert.equal(historyCampaign.potentialIdeas.some((idea) => idea.ideaId === potential.ideaId), true);
    assert.equal(historyCampaign.retrospectiveStatus, "skipped");

    await assert.rejects(
      () =>
        recordIdeaReviewOutcome(owner, potential.ideaId, {
          nextState: "inactive_idea",
          reasonTag: "poor_fit"
        }),
      /ended/
    );
    await assert.rejects(
      () =>
        submitIdea(employee, {
          campaignId: "specific-campaign",
          originalText: "Should not enter ended campaign.",
          title: "Ended campaign submission"
        }),
      /not open/
    );

    console.log("campaign-end-check: retrospective can start after skip and create manager-approved proposal");
    await assert.rejects(
      () => startCampaignRetrospective(teamMember, "specific-campaign", { now: new Date("2026-02-22T09:00:00Z") }),
      /Campaign Owner/
    );
    const retrospective = await startCampaignRetrospective(owner, "specific-campaign", {
      now: new Date("2026-02-22T09:00:00Z")
    });
    assert.equal(retrospective.status, "started");
    assert.match(retrospective.questionText, /learning/i);

    const completed = await completeCampaignRetrospective(owner, retrospective.retrospectiveId, {
      learningText: "Future reuse campaigns should ask for first-use ownership before ranking.",
      now: new Date("2026-02-22T09:05:00Z"),
      provider: retrospectiveProvider()
    });
    assert.equal(completed.status, "completed");
    assert(completed.proposalId, "global context proposal was created");

    const [proposal] = await db
      .select()
      .from(retrospectiveGlobalContextProposals)
      .where(eq(retrospectiveGlobalContextProposals.id, completed.proposalId))
      .limit(1);
    assert.equal(proposal?.status, "pending_manager_approval");
    assert.equal(proposal?.targetContext, "global_innovation_context");
    assert.equal(proposal?.sourceCampaignId, "specific-campaign");

    const completedHistory = await getEndedCampaignHistoryView(owner, { query: "Battery" });
    const completedCampaign = completedHistory.campaigns.find((campaign) => campaign.campaignId === "specific-campaign");
    assert.equal(completedCampaign?.retrospectiveStatus, "completed");

    console.log("campaign-end-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
