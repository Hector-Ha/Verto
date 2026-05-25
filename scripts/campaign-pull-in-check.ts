import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { requestEmployeeClarification, type ClarificationEmailProvider } from "../src/server/clarifications/service";
import {
  getCampaignPullInWorkspaceView,
  runCampaignIdeaPullIn,
  REUSED_IDEA_CLARIFICATION_WINDOW_DAYS
} from "../src/server/campaign-pull-in/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import {
  auditEvents,
  clarificationRequests,
  ideaCampaignAssociations,
  ideaStateHistory,
  ideas,
  users
} from "../src/server/db/schema";
import { submitIdea } from "../src/server/employee-intake/service";
import { reclassifyInactiveGeneralIdea } from "../src/server/general-campaign/service";
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
                  readinessBasis: input.readinessBasis ?? "General Campaign packet information gate is satisfied.",
                  reviewPacketStatus: input.reviewPacketStatus ?? "ready",
                  routingDecision: input.decision,
                  routingReason: input.reason
                }),
                name: "record_pre_rd_routing_decision"
              },
              id: "tool-call-pull-in-routing",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-pull-in-routing-test",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function pullInProvider(
  decisions: Record<
    string,
    {
      fitEstablished: boolean;
      hasCriticalClarity: boolean;
      needsReusedClarification?: boolean;
      reason: string;
      shouldPull: boolean;
    }
  >,
  seenIdeaIds: string[]
): LlmProvider {
  return async (request) => {
    const payload = JSON.parse(request.messages.at(-1)?.content ?? "{}") as { idea?: { ideaId?: string } };
    const ideaId = payload.idea?.ideaId;
    assert(ideaId, "pull-in prompt includes idea id");
    seenIdeaIds.push(ideaId);
    const decision = decisions[ideaId];
    assert(decision, `test decision exists for ${ideaId}`);

    return {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  arguments: JSON.stringify({
                    fitBasis: decision.reason,
                    fitEstablished: decision.fitEstablished,
                    hasCriticalClarity: decision.hasCriticalClarity,
                    needsReusedClarification: decision.needsReusedClarification ?? false,
                    routingBasis: decision.hasCriticalClarity
                      ? "Existing General Campaign source is enough for specific campaign routing."
                      : "A campaign-specific packet gap remains.",
                    shouldPull: decision.shouldPull
                  }),
                  name: "record_campaign_pull_in_decision"
                },
                id: `tool-call-pull-in-${ideaId}`,
                type: "function"
              }
            ]
          }
        }
      ],
      id: "chatcmpl-campaign-pull-in-test",
      model: "moonshotai/kimi-k2.6",
      object: "chat.completion"
    };
  };
}

function pullInProviderMissingFitBasis(ideaId: string): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  fitEstablished: false,
                  hasCriticalClarity: false,
                  needsReusedClarification: false,
                  routingBasis: "No specific campaign routing path is established.",
                  shouldPull: false
                }),
                name: "record_campaign_pull_in_decision"
              },
              id: `tool-call-pull-in-missing-fit-basis-${ideaId}`,
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-campaign-pull-in-missing-fit-basis-test",
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
                  rationale: "R&D needs one campaign-specific detail before review."
                }),
                name: "record_employee_clarification_question"
              },
              id: "tool-call-pull-in-clarification",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-pull-in-clarification-test",
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

async function association(ideaId: string, campaignId: string) {
  const [row] = await db
    .select()
    .from(ideaCampaignAssociations)
    .where(and(eq(ideaCampaignAssociations.ideaId, ideaId), eq(ideaCampaignAssociations.campaignId, campaignId)))
    .limit(1);

  return row ?? null;
}

async function main() {
  try {
    console.log("campaign-pull-in-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();
    assert.equal(REUSED_IDEA_CLARIFICATION_WINDOW_DAYS, 183);

    const employee = await sessionFor("employee");
    const generalOwner = await sessionFor("general-campaign-owner");
    const specificOwner = await sessionFor("specific-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");
    await db
      .update(ideaStateHistory)
      .set({ workflowState: "potential_idea" })
      .where(eq(ideaStateHistory.ideaId, "idea-general-material-exchange"));

    console.log("campaign-pull-in-check: pull-in searches Future Opportunities before General Ideas and reuses records");
    const future = await submitIdea(employee, {
      campaignId: "general-campaign",
      expectedBenefit: "Cuts material ordering delay.",
      originalText: "Reuse lab fixture offcuts for battery module spacers.",
      problemOpportunity: "Prototype teams need spacer material fast.",
      title: "Fixture offcuts for module spacers"
    });
    await routeIdeaBeforeRdReview(generalOwner, future.ideaId, {
      provider: routingProvider({
        decision: "future_opportunity",
        readinessBasis: "Useful later but not ready for direct General Campaign review.",
        reason: "Relevant reuse idea saved for a later specific campaign.",
        reviewPacketStatus: "not_applicable"
      })
    });
    const general = await submitIdea(employee, {
      campaignId: "general-campaign",
      expectedBenefit: "Reduces test bench setup time.",
      originalText: "Share a calibration checklist for battery reuse handoffs.",
      title: "Battery reuse checklist"
    });
    const inactive = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Add more snacks near battery test benches.",
      title: "Battery test snacks"
    });
    await routeIdeaBeforeRdReview(generalOwner, inactive.ideaId, {
      provider: routingProvider({
        decision: "inactive_idea",
        readinessBasis: "No campaign-fit signal for battery reuse.",
        reason: "Office amenity does not fit R&D reuse work.",
        reviewPacketStatus: "not_applicable"
      })
    });

    const seenIdeaIds: string[] = [];
    const result = await runCampaignIdeaPullIn(specificOwner, "specific-campaign", {
      provider: pullInProvider(
        {
          [future.ideaId]: {
            fitEstablished: true,
            hasCriticalClarity: true,
            reason: "Future opportunity directly describes battery module reuse.",
            shouldPull: true
          },
          [general.ideaId]: {
            fitEstablished: true,
            hasCriticalClarity: true,
            reason: "General idea has enough battery reuse fit for campaign routing.",
            shouldPull: true
          }
        },
        seenIdeaIds
      )
    });

    assert.deepEqual(seenIdeaIds, [future.ideaId, general.ideaId]);
    assert.equal(result.pulledCount, 2);
    assert.equal(result.skippedInactiveCount, 1);
    assert.equal(await association(future.ideaId, "specific-campaign").then(Boolean), true);
    assert.equal(await association(general.ideaId, "specific-campaign").then(Boolean), true);
    assert.equal(await association(inactive.ideaId, "specific-campaign").then(Boolean), false);
    assert.equal((await db.select().from(ideas).where(eq(ideas.id, future.ideaId))).length, 1);
    assert.equal((await currentState(future.ideaId)).workflowState, "future_opportunity");

    console.log("campaign-pull-in-check: inactive idea can be pulled only after recheck moves it out of inactive");
    await reclassifyInactiveGeneralIdea(generalOwner, inactive.ideaId, {
      nextState: "future_opportunity",
      reason: "Owner corrected AI: test-bench context can fit battery reuse setup."
    });
    const rechecked = await runCampaignIdeaPullIn(specificOwner, "specific-campaign", {
      provider: pullInProvider(
        {
          [inactive.ideaId]: {
            fitEstablished: true,
            hasCriticalClarity: true,
            reason: "Rechecked future opportunity now has campaign fit.",
            shouldPull: true
          }
        },
        []
      )
    });
    assert.equal(rechecked.pulledCount, 1);
    assert.equal(await association(inactive.ideaId, "specific-campaign").then(Boolean), true);

    console.log("campaign-pull-in-check: missing fit and blocked clarity stay in General Campaign with audit");
    const weakFit = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Create a rotating art wall near the lab.",
      title: "Lab art wall"
    });
    const oldIdea = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Maybe save old battery labels, unclear reuse path.",
      title: "Old battery labels"
    });
    await db.update(ideas).set({ submittedAt: new Date("2025-01-01T00:00:00.000Z") }).where(eq(ideas.id, oldIdea.ideaId));
    const skipped = await runCampaignIdeaPullIn(specificOwner, "specific-campaign", {
      now: new Date("2026-01-15T09:00:00.000Z"),
      provider: pullInProvider(
        {
          [weakFit.ideaId]: {
            fitEstablished: false,
            hasCriticalClarity: false,
            reason: "No battery reuse fit is established.",
            shouldPull: false
          },
          [oldIdea.ideaId]: {
            fitEstablished: true,
            hasCriticalClarity: false,
            needsReusedClarification: true,
            reason: "Fit is plausible but critical campaign clarity is missing.",
            shouldPull: true
          }
        },
        []
      )
    });
    assert.equal(skipped.skippedMissingFitCount, 1);
    assert.equal(skipped.skippedMissingCriticalClarityCount, 1);
    assert.equal(await association(weakFit.ideaId, "specific-campaign").then(Boolean), false);
    assert.equal(await association(oldIdea.ideaId, "specific-campaign").then(Boolean), false);
    const clarityAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, "campaign_pull_in.skipped_missing_critical_clarity"));
    assert.equal(clarityAudits.length >= 1, true);
    await db
      .update(ideaStateHistory)
      .set({ workflowState: "potential_idea" })
      .where(eq(ideaStateHistory.ideaId, weakFit.ideaId));
    await db
      .update(ideaStateHistory)
      .set({ workflowState: "potential_idea" })
      .where(eq(ideaStateHistory.ideaId, oldIdea.ideaId));

    console.log("campaign-pull-in-check: malformed missing fit basis skips instead of crashing");
    const missingFitBasis = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Move the lobby plant closer to the lab entrance.",
      title: "Lobby plant move"
    });
    const missingFitBasisResult = await runCampaignIdeaPullIn(specificOwner, "specific-campaign", {
      provider: pullInProviderMissingFitBasis(missingFitBasis.ideaId)
    });
    assert.equal(missingFitBasisResult.skippedMissingFitCount, 1);
    assert.equal(await association(missingFitBasis.ideaId, "specific-campaign").then(Boolean), false);
    await db
      .update(ideaStateHistory)
      .set({ workflowState: "potential_idea" })
      .where(eq(ideaStateHistory.ideaId, missingFitBasis.ideaId));

    console.log("campaign-pull-in-check: reused clarification uses campaign context, 30-day expiry, and active employee window");
    const clarificationIdea = await submitIdea(employee, {
      campaignId: "general-campaign",
      expectedBenefit: "May reduce fixture purchases.",
      originalText: "Reuse battery test carriers for a new fixture process, but exact owner team is unclear.",
      title: "Reusable battery test carriers"
    });
    const sentSubjects: string[] = [];
    const emailProvider: ClarificationEmailProvider = async (message) => {
      sentSubjects.push(message.subject);
      return { messages: ["queued"], trackingId: "pull-in-reused-clarification-email" };
    };
    const clarificationResult = await runCampaignIdeaPullIn(specificOwner, "specific-campaign", {
      emailProvider,
      now: new Date("2026-01-15T09:00:00.000Z"),
      provider: pullInProvider(
        {
          [clarificationIdea.ideaId]: {
            fitEstablished: true,
            hasCriticalClarity: false,
            needsReusedClarification: true,
            reason: "Fit is established, but owner team is missing for the campaign packet.",
            shouldPull: true
          }
        },
        []
      ),
      clarificationProvider: clarificationQuestionProvider("Which team would own the carrier reuse trial?")
    });
    assert.equal(clarificationResult.pulledCount, 1);
    assert.equal(clarificationResult.reusedClarificationSentCount, 1);
    assert.equal(sentSubjects.length, 1);
    const [request] = await db
      .select()
      .from(clarificationRequests)
      .where(eq(clarificationRequests.ideaId, clarificationIdea.ideaId))
      .limit(1);
    assert(request, "reused clarification request exists");
    assert.equal(request.campaignContextId, "specific-campaign");
    assert.equal(request.expiresAt.toISOString(), "2026-02-14T09:00:00.000Z");
    const pulledAssociation = await association(clarificationIdea.ideaId, "specific-campaign");
    assert.equal(pulledAssociation?.clarificationRequestId, request.id);

    console.log("campaign-pull-in-check: inactive submitter blocks reused clarification when critical clarity is missing");
    const inactiveEmployeeIdea = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Reuse battery staging carts, but ownership is unclear.",
      title: "Battery staging carts"
    });
    await db.update(users).set({ isActive: false }).where(eq(users.id, "employee"));
    const inactiveEmployee = await runCampaignIdeaPullIn(specificOwner, "specific-campaign", {
      now: new Date("2026-01-15T09:00:00.000Z"),
      provider: pullInProvider(
        {
          [inactiveEmployeeIdea.ideaId]: {
            fitEstablished: true,
            hasCriticalClarity: false,
            needsReusedClarification: true,
            reason: "Critical owner-team clarity is missing and submitter cannot be asked.",
            shouldPull: true
          }
        },
        []
      )
    });
    assert.equal(inactiveEmployee.skippedMissingCriticalClarityCount, 1);
    assert.equal(await association(inactiveEmployeeIdea.ideaId, "specific-campaign").then(Boolean), false);
    await db.update(users).set({ isActive: true }).where(eq(users.id, "employee"));

    console.log("campaign-pull-in-check: team members can inspect but cannot run pull-in");
    const workspace = await getCampaignPullInWorkspaceView(teamMember, "specific-campaign");
    assert.equal(workspace.associations.some((row) => row.ideaId === future.ideaId), true);
    await assert.rejects(
      () => runCampaignIdeaPullIn(teamMember, "specific-campaign", { provider: pullInProvider({}, []) }),
      /Only the R&D Manager or Campaign Owner/
    );
    await assert.rejects(
      () =>
        requestEmployeeClarification(specificOwner, clarificationIdea.ideaId, {
          campaignContextId: "specific-campaign",
          provider: clarificationQuestionProvider("Duplicate context question?")
        }),
      /Clarification batch already exists for this idea in this campaign context/
    );

    console.log("campaign-pull-in-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
