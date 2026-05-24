import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { recordIdeaReviewOutcome } from "../src/server/campaigns/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { auditEvents, clarificationRequests, ideaRoutingDecisions, ideaStateHistory, ideas } from "../src/server/db/schema";
import { submitIdea } from "../src/server/employee-intake/service";
import type { LlmProvider } from "../src/server/llm/adapter";
import {
  getAccessibleRoutingReviewView,
  routeIdeaBeforeRdReview,
  runCampaignRoutingRecheck,
  runGeneralCampaignRoutingRecheck
} from "../src/server/pre-rd-routing/service";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

type RoutingDecision = "ready_for_rd_review" | "needs_employee_clarification" | "future_opportunity" | "inactive_idea";
type ReviewPacketStatus = "ready" | "missing_critical_info" | "not_applicable";

function routingProvider(input: {
  decision: RoutingDecision;
  outOfScopeMatched?: boolean;
  outOfScopeReason?: string | null;
  readinessBasis?: string;
  reason: string;
  reviewPacketStatus?: ReviewPacketStatus;
}): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  outOfScopeMatched: input.outOfScopeMatched ?? false,
                  outOfScopeReason: input.outOfScopeReason ?? null,
                  readinessBasis:
                    input.readinessBasis ??
                    "Minimum review packet information gate is satisfied by submitted source fields.",
                  reviewPacketStatus: input.reviewPacketStatus ?? "ready",
                  routingDecision: input.decision,
                  routingReason: input.reason
                }),
                name: "record_pre_rd_routing_decision"
              },
              id: "tool-call-pre-rd-routing",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-pre-rd-routing-test",
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
  assert(state, `${ideaId} has a current workflow state`);
  return state;
}

async function routingRows(ideaId: string) {
  return db.select().from(ideaRoutingDecisions).where(eq(ideaRoutingDecisions.ideaId, ideaId));
}

async function readIdea(ideaId: string) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId)).limit(1);
  assert(idea, `${ideaId} exists`);
  return idea;
}

async function countClarificationRequests(ideaId: string) {
  return (await db.select({ id: clarificationRequests.id }).from(clarificationRequests).where(eq(clarificationRequests.ideaId, ideaId))).length;
}

async function main() {
  try {
    console.log("pre-rd-routing-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const employee = await sessionFor("employee");
    const owner = await sessionFor("specific-campaign-owner");
    const generalOwner = await sessionFor("general-campaign-owner");

    console.log("pre-rd-routing-check: route specific campaign idea without detaching it");
    const specificReady = await submitIdea(employee, {
      campaignId: "specific-campaign",
      evidenceExample: "Fixture team already sorts packs manually.",
      expectedBenefit: "Lower scrap and replacement spend.",
      originalText: "We can reuse battery packs with enough remaining charge for fixture testing.",
      problemOpportunity: "Usable battery packs are being discarded too early.",
      title: "Reuse battery packs for fixture testing"
    });
    const readyResult = await routeIdeaBeforeRdReview(owner, specificReady.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({
        decision: "ready_for_rd_review",
        reason: "Submitted source satisfies the minimum packet information gate for R&D review."
      })
    });
    assert.equal(readyResult.status, "routed");
    assert.equal((await currentState(specificReady.ideaId)).workflowState, "ready_for_rd_review");
    assert.equal((await readIdea(specificReady.ideaId)).campaignId, "specific-campaign");
    const readyRows = await routingRows(specificReady.ideaId);
    assert.equal(readyRows.length, 1);
    assert.equal(readyRows[0].contextVersion, "knowledge-report-specific-approved");
    assert.equal(readyRows[0].newWorkflowState, "ready_for_rd_review");
    assert.equal(readyRows[0].reviewPacketStatus, "ready");
    assert.match(readyRows[0].readinessBasis, /information gate/i);
    assert.doesNotMatch(readyRows[0].readinessBasis, /good idea|bad idea|quality score/i);

    console.log("pre-rd-routing-check: route all pre-R&D outcomes");
    const needsClarification = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Maybe there is a battery reuse path but I am not sure which station can use it.",
      title: "Unclear battery reuse path"
    });
    await routeIdeaBeforeRdReview(owner, needsClarification.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({
        decision: "needs_employee_clarification",
        readinessBasis: "Minimum packet is missing the first-use production context.",
        reason: "Critical production context is missing.",
        reviewPacketStatus: "missing_critical_info"
      })
    });
    assert.equal((await currentState(needsClarification.ideaId)).workflowState, "needs_employee_clarification");

    const future = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "A supplier swap could reduce packaging waste when the next packaging campaign opens.",
      title: "Supplier packaging swap"
    });
    await routeIdeaBeforeRdReview(generalOwner, future.ideaId, {
      contextVersion: "general-packet-v1",
      provider: routingProvider({
        decision: "future_opportunity",
        readinessBasis: "No active specific campaign fit, but the idea has reusable context.",
        reason: "Useful later but not ready for current review.",
        reviewPacketStatus: "not_applicable"
      })
    });
    assert.equal((await currentState(future.ideaId)).workflowState, "future_opportunity");

    const inactive = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Buy unrelated office snacks for the lab.",
      title: "Snack drawer"
    });
    await routeIdeaBeforeRdReview(generalOwner, inactive.ideaId, {
      contextVersion: "general-packet-v1",
      provider: routingProvider({
        decision: "inactive_idea",
        readinessBasis: "Review packet is not applicable because a clear out-of-scope pattern matched.",
        reason: "Clearly unrelated to R&D innovation intake.",
        reviewPacketStatus: "not_applicable"
      })
    });
    assert.equal((await currentState(inactive.ideaId)).workflowState, "inactive_idea");

    console.log("pre-rd-routing-check: clear out-of-scope stops clarification");
    const outOfScope = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Replace the cafeteria coffee machine with a premium model.",
      title: "Premium coffee machine"
    });
    await routeIdeaBeforeRdReview(owner, outOfScope.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({
        decision: "inactive_idea",
        outOfScopeMatched: true,
        outOfScopeReason: "Cafeteria equipment is outside battery material reuse scope.",
        readinessBasis: "Clarification is unnecessary because the submitted idea clearly matches an out-of-scope pattern.",
        reason: "Clear out-of-scope pattern stops employee clarification.",
        reviewPacketStatus: "not_applicable"
      })
    });
    assert.equal((await currentState(outOfScope.ideaId)).workflowState, "inactive_idea");
    assert.equal(await countClarificationRequests(outOfScope.ideaId), 0);
    assert.equal((await routingRows(outOfScope.ideaId))[0].outOfScopeMatched, true);

    console.log("pre-rd-routing-check: LLM retry leaves state unchanged");
    const retryIdea = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Battery idea that should wait when LLM fails.",
      title: "Retry protected idea"
    });
    const beforeRetry = await currentState(retryIdea.ideaId);
    const retry = await routeIdeaBeforeRdReview(owner, retryIdea.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: async () => {
        throw new Error("routing provider down");
      }
    });
    assert.equal(retry.status, "retry_required");
    assert.equal((await currentState(retryIdea.ideaId)).id, beforeRetry.id);
    assert.equal((await routingRows(retryIdea.ideaId)).length, 0);

    console.log("pre-rd-routing-check: rechecks only unreviewed in scope and store old/new reasons");
    const reviewed = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "A complete battery reuse idea that R&D will review once.",
      title: "Reviewed battery reuse"
    });
    await routeIdeaBeforeRdReview(owner, reviewed.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({
        decision: "ready_for_rd_review",
        reason: "Ready before owner review."
      })
    });
    await recordIdeaReviewOutcome(owner, reviewed.ideaId, {
      nextState: "future_opportunity",
      reason: "Owner reviewed and returned for later."
    });

    const recheckCandidate = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Battery reuse needs routing recheck when campaign context changes.",
      title: "Unreviewed battery recheck"
    });
    await routeIdeaBeforeRdReview(owner, recheckCandidate.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: routingProvider({
        decision: "needs_employee_clarification",
        readinessBasis: "Missing production owner blocks the information gate.",
        reason: "Old context needed employee clarification.",
        reviewPacketStatus: "missing_critical_info"
      })
    });

    const specificRecheck = await runCampaignRoutingRecheck(owner, "specific-campaign", {
      contextVersion: "specific-context-v2",
      provider: routingProvider({
        decision: "ready_for_rd_review",
        readinessBasis: "Updated campaign context makes the production owner noncritical.",
        reason: "New campaign context removes the missing-owner blocker."
      })
    });
    assert.equal(specificRecheck.routedCount, 5);
    assert.equal(specificRecheck.skippedReviewedCount, 1);
    assert.equal((await routingRows(reviewed.ideaId)).length, 1);
    const recheckRows = await routingRows(recheckCandidate.ideaId);
    assert.equal(recheckRows.length, 2);
    const recheckRow = recheckRows.find((row) => row.contextVersion === "specific-context-v2");
    assert(recheckRow, "recheck routing row is stored");
    assert.equal(recheckRow.trigger, "campaign_context_recheck");
    assert.equal(recheckRow.oldWorkflowState, "needs_employee_clarification");
    assert.equal(recheckRow.oldReason, "Old context needed employee clarification.");
    assert.equal(recheckRow.newReason, "New campaign context removes the missing-owner blocker.");

    const generalRecheck = await runGeneralCampaignRoutingRecheck(generalOwner, {
      contextVersion: "general-packet-v2",
      provider: routingProvider({
        decision: "ready_for_rd_review",
        readinessBasis: "General Campaign packet now has enough information for low-priority review.",
        reason: "General packet recheck makes the idea review-ready."
      })
    });
    assert(generalRecheck.routedCount >= 2);
    assert.equal((await readIdea(recheckCandidate.ideaId)).campaignId, "specific-campaign");

    const reviewEvents = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, "idea"), eq(auditEvents.eventType, "idea.routing.changed")));
    assert(reviewEvents.length >= 1);

    console.log("pre-rd-routing-check: R&D routing review view exposes internal history only to R&D");
    const routingView = await getAccessibleRoutingReviewView(owner);
    assert(routingView.some((row) => row.ideaId === recheckCandidate.ideaId && row.contextVersion === "specific-context-v2"));
    await assert.rejects(() => getAccessibleRoutingReviewView(employee), /Only R&D users/);

    console.log("pre-rd-routing-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
