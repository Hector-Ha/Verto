import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { requestEmployeeClarification, submitClarificationAnswer, type ClarificationEmailProvider } from "../src/server/clarifications/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { auditEvents, clarificationRequests, ideaRankings, ideaStateHistory } from "../src/server/db/schema";
import { submitIdea } from "../src/server/employee-intake/service";
import type { LlmProvider } from "../src/server/llm/adapter";
import { routeIdeaBeforeRdReview } from "../src/server/pre-rd-routing/service";
import { assignIdeaRanking, recordReviewOutcome } from "../src/server/rd-review/service";
import { resetAndSeedDemoData } from "../src/server/seed/reset";
import {
  applyAnsweredGeneralClarificationRouting,
  getGeneralCampaignWorkspaceView,
  reclassifyInactiveGeneralIdea,
  updateGeneralCampaignReviewPacket
} from "../src/server/general-campaign/service";

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
              id: "tool-call-general-campaign",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-general-campaign-test",
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
                  rationale: "R&D needs one General Campaign detail before review."
                }),
                name: "record_employee_clarification_question"
              },
              id: "tool-call-general-clarification",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-general-clarification-test",
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
    console.log("general-campaign-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const employee = await sessionFor("employee");
    const manager = await sessionFor("rd-manager");
    const generalOwner = await sessionFor("general-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");

    console.log("general-campaign-check: packet changes recheck unreviewed General Campaign ideas");
    const reviewed = await submitIdea(employee, {
      campaignId: "general-campaign",
      evidenceExample: "Existing collection bins show repeated waste.",
      expectedBenefit: "Lower material spend.",
      originalText: "Create a local exchange for unused lab material.",
      problemOpportunity: "Teams discard usable material after experiments.",
      title: "Reviewed general material reuse"
    });
    await routeIdeaBeforeRdReview(generalOwner, reviewed.ideaId, {
      contextVersion: "general-packet-v1",
      provider: routingProvider({ decision: "ready_for_rd_review", reason: "Ready under old General Campaign packet." })
    });
    await recordReviewOutcome(generalOwner, reviewed.ideaId, {
      nextState: "future_opportunity",
      reasonNote: "Reviewed and saved for later.",
      reasonTag: "not_now"
    });

    const unreviewed = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Use leftover fixture foam as protective inserts for internal transfers.",
      title: "Fixture foam reuse"
    });
    await routeIdeaBeforeRdReview(generalOwner, unreviewed.ideaId, {
      contextVersion: "general-packet-v1",
      provider: routingProvider({
        decision: "future_opportunity",
        readinessBasis: "Needs broader packet fields before direct review.",
        reason: "Old packet kept this as a future opportunity.",
        reviewPacketStatus: "not_applicable"
      })
    });

    const packetUpdate = await updateGeneralCampaignReviewPacket(generalOwner, {
      packetText: "Require problem, expected reuse path, rough benefit, and any evidence signal.",
      provider: routingProvider({
        decision: "ready_for_rd_review",
        reason: "Updated General Campaign packet makes unreviewed ideas review-ready."
      })
    });
    assert.equal(packetUpdate.recheck.routedCount, 2);
    assert.equal(packetUpdate.recheck.skippedReviewedCount, 1);
    assert.equal((await currentState(reviewed.ideaId)).workflowState, "future_opportunity");
    assert.equal((await currentState(unreviewed.ideaId)).workflowState, "ready_for_rd_review");

    console.log("general-campaign-check: views split General Ideas, Future Opportunities, and Inactive Ideas");
    const inactive = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Install a snack subscription in every meeting room.",
      title: "Meeting snack subscription"
    });
    await routeIdeaBeforeRdReview(generalOwner, inactive.ideaId, {
      contextVersion: "general-packet-v2",
      provider: routingProvider({
        decision: "inactive_idea",
        readinessBasis: "No R&D review packet applies to this out-of-scope office amenity.",
        reason: "Office amenity request is not useful under current innovation context.",
        reviewPacketStatus: "not_applicable"
      })
    });

    let workspace = await getGeneralCampaignWorkspaceView(generalOwner);
    assert(workspace.currentPacket, "current General Campaign packet exists");
    const teamWorkspace = await getGeneralCampaignWorkspaceView(teamMember);
    assert.equal(teamWorkspace.canManage, false);
    assert(workspace.readyReviewIdeas.some((idea) => idea.ideaId === unreviewed.ideaId));
    assert(workspace.futureOpportunities.some((idea) => idea.ideaId === reviewed.ideaId));
    assert(workspace.inactiveGroups.some((group) => group.reason.includes("Office amenity")));
    assert.equal(workspace.inactiveGroups.flatMap((group) => group.ideas).some((idea) => idea.ideaId === inactive.ideaId), true);

    console.log("general-campaign-check: inactive ideas can be reclassified when AI is wrong");
    await reclassifyInactiveGeneralIdea(generalOwner, inactive.ideaId, {
      nextState: "future_opportunity",
      reason: "Owner corrected AI: meeting-room supply loop could fit future materials reuse."
    });
    assert.equal((await currentState(inactive.ideaId)).workflowState, "future_opportunity");
    workspace = await getGeneralCampaignWorkspaceView(generalOwner);
    assert.equal(workspace.inactiveGroups.flatMap((group) => group.ideas).some((idea) => idea.ideaId === inactive.ideaId), false);
    assert.equal(workspace.futureOpportunities.some((idea) => idea.ideaId === inactive.ideaId), true);

    console.log("general-campaign-check: direct General Campaign review ranks individual ideas");
    await assignIdeaRanking(generalOwner, unreviewed.ideaId, {
      familyId: "not-a-real-group",
      rankPosition: 1,
      rankReasons: ["Strong company fit", "Clear reuse path", "Low implementation risk"]
    });
    const [ranking] = await db
      .select()
      .from(ideaRankings)
      .where(eq(ideaRankings.ideaId, unreviewed.ideaId))
      .limit(1);
    assert(ranking, "ranking exists");
    assert.equal(ranking.campaignId, "general-campaign");
    assert.equal(ranking.ideaId, unreviewed.ideaId);
    assert.equal(ranking.familyId, null);
    await assert.rejects(
      () =>
        assignIdeaRanking(teamMember, unreviewed.ideaId, {
          rankPosition: 2,
          rankReasons: ["Team cannot rank", "Owner-only General Campaign control"]
        }),
      /Only General Campaign owners/
    );

    console.log("general-campaign-check: answered clarification updates General Campaign board counts");
    const clarificationIdea = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Maybe reuse a digital checklist for lab material sharing.",
      title: "Unclear checklist reuse"
    });
    const sentEmails: string[] = [];
    const emailProvider: ClarificationEmailProvider = async (message) => {
      sentEmails.push(message.subject);
      return { messages: ["queued"], trackingId: "general-clarification-email" };
    };
    const clarification = await requestEmployeeClarification(generalOwner, clarificationIdea.ideaId, {
      appBaseUrl: "http://localhost:3000",
      emailProvider,
      provider: clarificationQuestionProvider("Which team would use this checklist first?")
    });
    assert.equal(clarification.status, "sent");
    await submitClarificationAnswer(clarification.token, {
      answerText: "Maintenance would use it first to list reusable materials after experiments."
    });
    const [request] = await db
      .select({ requestId: clarificationRequests.id })
      .from(clarificationRequests)
      .where(eq(clarificationRequests.ideaId, clarificationIdea.ideaId))
      .limit(1);
    const applied = await applyAnsweredGeneralClarificationRouting(generalOwner, request.requestId, {
      provider: routingProvider({
        decision: "ready_for_rd_review",
        readinessBasis: "Employee answer supplies the missing first-use team for the General Campaign packet.",
        reason: "Clarification answer makes this General Campaign idea review-ready."
      })
    });
    assert.equal(applied.status, "routed");
    workspace = await getGeneralCampaignWorkspaceView(generalOwner);
    assert.equal(workspace.counts.awaitingClarification, 0);
    assert.equal(workspace.readyReviewIdeas.some((idea) => idea.ideaId === clarificationIdea.ideaId), true);

    console.log("general-campaign-check: owner authority enforced and audit recorded");
    await assert.rejects(
      () =>
        updateGeneralCampaignReviewPacket(teamMember, {
          packetText: "Team member should not be able to change General Campaign packet."
        }),
      /Only General Campaign owners/
    );
    await assert.rejects(() => getGeneralCampaignWorkspaceView(employee), /Only R&D users/);
    await updateGeneralCampaignReviewPacket(manager, {
      packetText: "Manager can update broad General Campaign packet as default owner."
    });
    const audits = await db
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, "general-campaign"));
    assert(audits.some((audit) => audit.eventType === "general_campaign.packet.updated"));

    console.log("general-campaign-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
