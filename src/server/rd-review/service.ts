import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import {
  canContributeToCampaign,
  canManageGeneralCampaign,
  canRecommendReviewOutcome,
  canRecordReviewOutcome
} from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  auditEvents,
  campaigns,
  ideaFamilies,
  ideaFamilyMembers,
  ideaRankings,
  ideaReviewOutcomes,
  ideaReviewRecommendations,
  ideaReviewSummaries,
  ideaRoutingDecisions,
  ideaStateHistory,
  ideas,
  users
} from "../db/schema";

export type ReviewOutcome = "potential_idea" | "future_opportunity" | "inactive_idea";

export const potentialIdeaReasonTags = [
  "high_value",
  "strong_fit",
  "novel",
  "quick_prototype",
  "strategic_timing",
  "customer_employee_pain"
] as const;

export const returnIdeaReasonTags = [
  "not_now",
  "insufficient_value",
  "poor_fit",
  "too_unclear",
  "out_of_scope",
  "duplicate_covered"
] as const;

type ReviewOutcomeInput = {
  campaignContextId?: string;
  nextState: ReviewOutcome;
  reason?: string | null;
  reasonNote?: string | null;
  reasonTag?: string;
};

type RecommendReviewOutcomeInput = {
  nextState: ReviewOutcome;
  reasonNote?: string | null;
  reasonTag: string;
};

type AssignRankingInput = {
  familyId?: string | null;
  rankPosition: number;
  rankReasons: string[];
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function defaultReasonTag(outcome: ReviewOutcome) {
  if (outcome === "potential_idea") {
    return "high_value";
  }
  if (outcome === "future_opportunity") {
    return "not_now";
  }

  return "poor_fit";
}

function assertValidReasonTag(outcome: ReviewOutcome, reasonTag: string) {
  const allowed =
    outcome === "potential_idea"
      ? (potentialIdeaReasonTags as readonly string[])
      : (returnIdeaReasonTags as readonly string[]);
  if (!allowed.includes(reasonTag)) {
    throw new Error(`Invalid reason tag ${reasonTag} for ${outcome}.`);
  }
}

function normalizeReviewInput(input: ReviewOutcomeInput) {
  const reasonTag = input.reasonTag ?? defaultReasonTag(input.nextState);
  assertValidReasonTag(input.nextState, reasonTag);

  return {
    nextState: input.nextState,
    reasonNote: input.reasonNote ?? input.reason ?? null,
    reasonTag
  };
}

async function readReviewableIdea(ideaId: string) {
  const [row] = await db
    .select({
      campaignId: ideas.campaignId,
      campaignType: campaigns.type,
      currentWorkflowState: ideaStateHistory.workflowState,
      lifecycleStatus: campaigns.lifecycleStatus,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .leftJoin(
      ideaStateHistory,
      and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true))
    )
    .where(eq(ideas.id, ideaId))
    .limit(1);

  if (!row) {
    throw new Error("Idea not found.");
  }

  return row;
}

async function readFamilyIdForIdea(ideaId: string) {
  const [member] = await db
    .select({ familyId: ideaFamilyMembers.familyId })
    .from(ideaFamilyMembers)
    .where(eq(ideaFamilyMembers.ideaId, ideaId))
    .limit(1);

  return member?.familyId ?? null;
}

async function writeReviewAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: DemoSession,
  eventType: string,
  ideaId: string,
  reason: string,
  metadata: Record<string, unknown>
) {
  await tx.insert(auditEvents).values({
    actorType: "user",
    actorUserId: session.user.id,
    createdAt: new Date(),
    entityId: ideaId,
    entityType: "idea",
    eventType,
    id: newId("audit"),
    metadata,
    reason
  });
}

async function assertReviewableForOutcome(ideaId: string) {
  const row = await readReviewableIdea(ideaId);
  if (row.lifecycleStatus === "ended") {
    throw new Error("Cannot record review decisions for an ended campaign.");
  }
  if (row.currentWorkflowState !== "ready_for_rd_review") {
    throw new Error("Review outcome can only be recorded for ideas ready for R&D review.");
  }

  return row;
}

export async function assignIdeaRanking(
  session: DemoSession,
  ideaId: string,
  input: AssignRankingInput
) {
  const row = await readReviewableIdea(ideaId);
  if (row.campaignType === "general") {
    if (!(await canManageGeneralCampaign(session))) {
      throw new Error("Only General Campaign owners can rank General Campaign ideas.");
    }
  } else if (!(await canContributeToCampaign(session, row.campaignId))) {
    throw new Error("Only R&D users with campaign access can assign rankings.");
  }
  if (input.rankReasons.length < 2 || input.rankReasons.length > 4) {
    throw new Error("Rank reasons must include 2 to 4 short reasons.");
  }

  const familyId = row.campaignType === "general" ? null : input.familyId ?? (await readFamilyIdForIdea(ideaId));
  const rankingId = newId("idea-ranking");

  await db
    .insert(ideaRankings)
    .values({
      campaignId: row.campaignId,
      createdAt: new Date(),
      familyId,
      id: rankingId,
      ideaId,
      rankPosition: input.rankPosition,
      rankReasons: input.rankReasons
    })
    .onDuplicateKeyUpdate({
      set: {
        familyId,
        rankPosition: input.rankPosition,
        rankReasons: input.rankReasons
      }
    });

  return { ideaId, rankingId };
}

export async function recommendReviewOutcome(session: DemoSession, ideaId: string, input: RecommendReviewOutcomeInput) {
  const row = await assertReviewableForOutcome(ideaId);
  if (!(await canRecommendReviewOutcome(session, row.campaignId))) {
    throw new Error("Only R&D Team Members can recommend review outcomes.");
  }

  assertValidReasonTag(input.nextState, input.reasonTag);
  const familyId = await readFamilyIdForIdea(ideaId);

  const recommendationId = newId("idea-review-recommendation");
  await db.transaction(async (tx) => {
    await tx.insert(ideaReviewRecommendations).values({
      campaignId: row.campaignId,
      createdAt: new Date(),
      familyId,
      id: recommendationId,
      ideaId,
      reasonNote: input.reasonNote ?? null,
      reasonTag: input.reasonTag,
      recommendedByUserId: session.user.id,
      recommendedOutcome: input.nextState
    });
    await writeReviewAudit(tx, session, "idea.review_outcome.recommended", ideaId, "R&D team member recommended a review outcome.", {
      campaignId: row.campaignId,
      nextState: input.nextState,
      reasonTag: input.reasonTag
    });
  });

  return { ideaId, recommendationId };
}

export async function recordReviewOutcome(session: DemoSession, ideaId: string, input: ReviewOutcomeInput) {
  const normalized = normalizeReviewInput(input);
  const row = await assertReviewableForOutcome(ideaId);
  const reviewCampaignId = input.campaignContextId ?? row.campaignId;
  if (!(await canRecordReviewOutcome(session, reviewCampaignId))) {
    throw new Error("Only the relevant campaign owner can record review outcomes.");
  }

  const familyId = await readFamilyIdForIdea(ideaId);
  const now = new Date();
  const outcomeId = newId("idea-review-outcome");

  await db.transaction(async (tx) => {
    await tx.insert(ideaReviewOutcomes).values({
      campaignId: reviewCampaignId,
      decidedAt: now,
      decidedByUserId: session.user.id,
      familyId,
      id: outcomeId,
      ideaId,
      outcome: normalized.nextState,
      reasonNote: normalized.reasonNote,
      reasonTag: normalized.reasonTag
    });

    const shouldUpdateGlobalState =
      normalized.nextState === "potential_idea" || reviewCampaignId === row.campaignId;

    if (shouldUpdateGlobalState) {
      await tx
        .update(ideaStateHistory)
        .set({ isCurrent: false })
        .where(and(eq(ideaStateHistory.ideaId, ideaId), eq(ideaStateHistory.isCurrent, true)));
      await tx.insert(ideaStateHistory).values({
        changedAt: now,
        changedByUserId: session.user.id,
        ideaId,
        id: newId("idea-state"),
        isCurrent: true,
        reason: normalized.reasonNote,
        workflowState: normalized.nextState
      });
    }

    await writeReviewAudit(tx, session, "campaign.review_outcome.recorded", ideaId, "Campaign review outcome recorded.", {
      campaignContextId: reviewCampaignId,
      campaignId: row.campaignId,
      nextState: normalized.nextState,
      reasonTag: normalized.reasonTag
    });
    await writeReviewAudit(tx, session, "idea.review_outcome.approved", ideaId, "Owner approved review outcome.", {
      campaignContextId: reviewCampaignId,
      campaignId: row.campaignId,
      nextState: normalized.nextState,
      reasonTag: normalized.reasonTag
    });
    await tx.insert(auditEvents).values({
      actorType: "user",
      actorUserId: session.user.id,
      createdAt: now,
      entityId: reviewCampaignId,
      entityType: "campaign",
      eventType: "campaign.review_outcome.recorded",
      id: newId("audit"),
      metadata: {
        campaignContextId: reviewCampaignId,
        ideaId,
        nextState: normalized.nextState,
        reasonTag: normalized.reasonTag
      },
      reason: "Campaign review outcome recorded."
    });
  });

  return { ideaId, outcomeId, outcome: normalized.nextState };
}

export async function recordIdeaReviewOutcome(session: DemoSession, ideaId: string, input: ReviewOutcomeInput) {
  return recordReviewOutcome(session, ideaId, input);
}

export async function countReadyReviewIdeasForCampaign(campaignId: string) {
  const rows = await db
    .select({ ideaId: ideas.id })
    .from(ideas)
    .innerJoin(
      ideaStateHistory,
      and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true))
    )
    .where(and(eq(ideas.campaignId, campaignId), eq(ideaStateHistory.workflowState, "ready_for_rd_review")));

  return rows.length;
}

async function countIdeasByState(campaignIds: string[], workflowState: (typeof ideaStateHistory.$inferSelect)["workflowState"]) {
  if (campaignIds.length === 0) {
    return 0;
  }

  const rows = await db
    .select({ id: ideas.id })
    .from(ideas)
    .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
    .where(and(inArray(ideas.campaignId, campaignIds), eq(ideaStateHistory.workflowState, workflowState)));

  return rows.length;
}

export async function getAccessibleRdReviewBoard(session: DemoSession) {
  if (session.role.id === "employee") {
    throw new Error("Only R&D users with campaign access can inspect the review board.");
  }

  const campaignRows = await db
    .select({
      campaignId: campaigns.id,
      campaignTitle: campaigns.publicTitle,
      campaignType: campaigns.type
    })
    .from(campaigns)
    .orderBy(campaigns.publicTitle);

  const accessibleCampaigns = [];
  for (const campaign of campaignRows) {
    if (await canContributeToCampaign(session, campaign.campaignId)) {
      accessibleCampaigns.push(campaign);
    }
  }

  const campaignIds = accessibleCampaigns.map((campaign) => campaign.campaignId);
  const readyRows =
    campaignIds.length === 0
      ? []
      : await db
          .select({
            campaignId: ideas.campaignId,
            campaignTitle: campaigns.publicTitle,
            campaignType: campaigns.type,
            currentWorkflowState: ideaStateHistory.workflowState,
            ideaId: ideas.id,
            originalText: ideas.originalText,
            submittedAt: ideas.submittedAt,
            submitterDepartment: users.department,
            submitterDisplayName: users.displayName,
            title: ideas.title
          })
          .from(ideas)
          .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
          .innerJoin(users, eq(users.id, ideas.submitterUserId))
          .innerJoin(
            ideaStateHistory,
            and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true))
          )
          .where(
            and(
              inArray(ideas.campaignId, campaignIds),
              eq(ideaStateHistory.workflowState, "ready_for_rd_review")
            )
          )
          .orderBy(desc(ideas.submittedAt));

  const readyPackets = await Promise.all(
    readyRows.map(async (row) => {
      const [routing] = await db
        .select({
          contextVersion: ideaRoutingDecisions.contextVersion,
          newReason: ideaRoutingDecisions.newReason,
          readinessBasis: ideaRoutingDecisions.readinessBasis
        })
        .from(ideaRoutingDecisions)
        .where(eq(ideaRoutingDecisions.ideaId, row.ideaId))
        .orderBy(desc(ideaRoutingDecisions.createdAt))
        .limit(1);
      const [ranking] = await db
        .select({
          rankPosition: ideaRankings.rankPosition,
          rankReasons: ideaRankings.rankReasons
        })
        .from(ideaRankings)
        .where(and(eq(ideaRankings.campaignId, row.campaignId), eq(ideaRankings.ideaId, row.ideaId)))
        .limit(1);
      const [familyMember] = await db
        .select({ familyId: ideaFamilyMembers.familyId })
        .from(ideaFamilyMembers)
        .where(eq(ideaFamilyMembers.ideaId, row.ideaId))
        .limit(1);
      const familyId = familyMember?.familyId ?? null;
      const members = familyId
        ? await db
            .select({
              department: users.department,
              displayName: users.displayName,
              ideaId: ideas.id,
              relationshipType: ideaFamilyMembers.relationshipType,
              title: ideas.title,
              variantDifference: ideaFamilyMembers.variantDifference
            })
            .from(ideaFamilyMembers)
            .innerJoin(ideas, eq(ideas.id, ideaFamilyMembers.ideaId))
            .innerJoin(users, eq(users.id, ideas.submitterUserId))
            .where(eq(ideaFamilyMembers.familyId, familyId))
            .orderBy(ideaFamilyMembers.createdAt)
        : [];
      const [summary] = familyId
        ? await db
            .select({
              aiReason: ideaReviewSummaries.aiReason,
              sourceTrace: ideaReviewSummaries.sourceTrace,
              summaryText: ideaReviewSummaries.summaryText,
              version: ideaReviewSummaries.version
            })
            .from(ideaReviewSummaries)
            .where(and(eq(ideaReviewSummaries.familyId, familyId), eq(ideaReviewSummaries.isCurrent, true)))
            .limit(1)
        : [undefined];
      const recommendations = await db
        .select({
          reasonNote: ideaReviewRecommendations.reasonNote,
          reasonTag: ideaReviewRecommendations.reasonTag,
          recommendedByUserId: ideaReviewRecommendations.recommendedByUserId,
          recommendedOutcome: ideaReviewRecommendations.recommendedOutcome,
          recommendationId: ideaReviewRecommendations.id
        })
        .from(ideaReviewRecommendations)
        .where(and(eq(ideaReviewRecommendations.ideaId, row.ideaId), eq(ideaReviewRecommendations.campaignId, row.campaignId)))
        .orderBy(desc(ideaReviewRecommendations.createdAt));

      return {
        ...row,
        familyId,
        members,
        ranking: ranking ?? null,
        recommendations,
        sourceTrace: routing
          ? {
              contextVersion: routing.contextVersion,
              readinessBasis: routing.readinessBasis,
              routingReason: routing.newReason
            }
          : null,
        summary: summary ?? null
      };
    })
  );

  const [awaitingClarificationCount, futureOpportunityCount, inactiveIdeaCount] = await Promise.all([
    countIdeasByState(campaignIds, "needs_employee_clarification"),
    countIdeasByState(campaignIds, "future_opportunity"),
    countIdeasByState(campaignIds, "inactive_idea")
  ]);

  return {
    awaitingClarificationCount,
    campaigns: accessibleCampaigns,
    futureOpportunityCount,
    inactiveIdeaCount,
    readyPackets
  };
}

export async function getCampaignContextReviewOutcome(campaignId: string, ideaId: string) {
  const [outcome] = await db
    .select()
    .from(ideaReviewOutcomes)
    .where(and(eq(ideaReviewOutcomes.campaignId, campaignId), eq(ideaReviewOutcomes.ideaId, ideaId)))
    .limit(1);

  return outcome ?? null;
}

export async function ideaIsGloballyRemovedFromReviewQueues(ideaId: string) {
  const [state] = await db
    .select({ workflowState: ideaStateHistory.workflowState })
    .from(ideaStateHistory)
    .where(and(eq(ideaStateHistory.ideaId, ideaId), eq(ideaStateHistory.isCurrent, true)))
    .limit(1);

  return state?.workflowState === "potential_idea";
}
