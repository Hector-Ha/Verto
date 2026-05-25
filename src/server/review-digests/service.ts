import crypto from "node:crypto";

import { and, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";

import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  auditEvents,
  campaignMemberships,
  campaigns,
  clarificationRequests,
  ideaClassificationGroups,
  ideaRankings,
  ideaRoutingDecisions,
  ideaStateHistory,
  ideas,
  reviewDigestItems,
  reviewDigests
} from "../db/schema";

type DigestCadence = (typeof reviewDigests.$inferInsert)["cadence"];
type DigestItemType = (typeof reviewDigestItems.$inferInsert)["itemType"];
type DigestItemDraft = {
  body: string;
  campaignId: string;
  ideaId: string | null;
  itemType: DigestItemType;
  linkHref: string;
  linkLabel: string;
  title: string;
};

type DigestJobOptions = {
  now?: Date;
};

const dayMs = 24 * 60 * 60 * 1000;
const activeSpecificDigestStatuses = ["intake_open", "intake_closed", "review_in_progress"] as const;
const expiringClarificationLookaheadMs = 7 * dayMs;

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function windowStart(now: Date, cadence: DigestCadence) {
  return new Date(now.getTime() - (cadence === "weekly" ? 7 : 1) * dayMs);
}

function digestSummary(cadence: DigestCadence, itemCount: number) {
  if (itemCount === 0) {
    return `No ${cadence} review changes in this digest window.`;
  }

  return `${itemCount} ${cadence} review update${itemCount === 1 ? "" : "s"} ready in Verto.`;
}

async function readActiveSpecificCampaigns() {
  return db
    .select({
      campaignId: campaigns.id,
      campaignTitle: campaigns.publicTitle
    })
    .from(campaigns)
    .where(and(eq(campaigns.type, "specific"), inArray(campaigns.lifecycleStatus, activeSpecificDigestStatuses)));
}

async function buildReviewReadyItems(campaignId: string, startedAt: Date, endedAt: Date): Promise<DigestItemDraft[]> {
  const rows = await db
    .select({
      changedAt: ideaStateHistory.changedAt,
      ideaId: ideas.id,
      reason: ideaStateHistory.reason,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
    .where(
      and(
        eq(ideas.campaignId, campaignId),
        eq(ideaStateHistory.workflowState, "ready_for_rd_review"),
        gte(ideaStateHistory.changedAt, startedAt),
        lt(ideaStateHistory.changedAt, endedAt)
      )
    )
    .orderBy(desc(ideaStateHistory.changedAt));

  return rows.map((row) => ({
    body: row.reason ?? "Idea became Ready for R&D Review.",
    campaignId,
    ideaId: row.ideaId,
    itemType: "new_review_ready",
    linkHref: `#review-idea-${row.ideaId}`,
    linkLabel: "Open review packet",
    title: `Ready for review: ${row.title}`
  }));
}

async function buildExpiringClarificationItems(
  campaignId: string,
  now: Date,
  lookaheadEndsAt: Date
): Promise<DigestItemDraft[]> {
  const rows = await db
    .select({
      expiresAt: clarificationRequests.expiresAt,
      ideaId: ideas.id,
      title: ideas.title
    })
    .from(clarificationRequests)
    .innerJoin(ideas, eq(ideas.id, clarificationRequests.ideaId))
    .where(
      and(
        eq(ideas.campaignId, campaignId),
        eq(clarificationRequests.status, "pending"),
        eq(clarificationRequests.emailStatus, "sent"),
        gte(clarificationRequests.expiresAt, now),
        lt(clarificationRequests.expiresAt, lookaheadEndsAt)
      )
    )
    .orderBy(clarificationRequests.expiresAt);

  return rows.map((row) => ({
    body: `Clarification expires ${row.expiresAt.toISOString().slice(0, 10)}.`,
    campaignId,
    ideaId: row.ideaId,
    itemType: "clarification_expiring",
    linkHref: `#clarification-idea-${row.ideaId}`,
    linkLabel: "Open clarification queue",
    title: `Clarification near expiry: ${row.title}`
  }));
}

async function buildMajorRoutingChangeItems(
  campaignId: string,
  startedAt: Date,
  endedAt: Date
): Promise<DigestItemDraft[]> {
  const rows = await db
    .select({
      ideaId: ideas.id,
      newReason: ideaRoutingDecisions.newReason,
      newWorkflowState: ideaRoutingDecisions.newWorkflowState,
      oldWorkflowState: ideaRoutingDecisions.oldWorkflowState,
      routingDecisionId: ideaRoutingDecisions.id,
      title: ideas.title,
      trigger: ideaRoutingDecisions.trigger
    })
    .from(ideaRoutingDecisions)
    .innerJoin(ideas, eq(ideas.id, ideaRoutingDecisions.ideaId))
    .where(
      and(
        eq(ideaRoutingDecisions.campaignId, campaignId),
        inArray(ideaRoutingDecisions.trigger, ["campaign_context_recheck", "general_context_recheck"]),
        ne(ideaRoutingDecisions.oldWorkflowState, ideaRoutingDecisions.newWorkflowState),
        gte(ideaRoutingDecisions.createdAt, startedAt),
        lt(ideaRoutingDecisions.createdAt, endedAt)
      )
    )
    .orderBy(desc(ideaRoutingDecisions.createdAt));

  return rows.map((row) => ({
    body: `${row.oldWorkflowState} to ${row.newWorkflowState}: ${row.newReason}`,
    campaignId,
    ideaId: row.ideaId,
    itemType: "major_routing_change",
    linkHref: `#routing-decision-${row.routingDecisionId}`,
    linkLabel: "Open routing detail",
    title: `Routing changed: ${row.title}`
  }));
}

async function buildRerankSummaryItem(
  campaignId: string,
  startedAt: Date,
  endedAt: Date
): Promise<DigestItemDraft[]> {
  const [groupRows, ideaRows] = await Promise.all([
    db
      .select({
        groupId: ideaClassificationGroups.id
      })
      .from(ideaClassificationGroups)
      .where(
        and(
          eq(ideaClassificationGroups.campaignId, campaignId),
          gte(ideaClassificationGroups.rankedAt, startedAt),
          lt(ideaClassificationGroups.rankedAt, endedAt)
        )
      ),
    db
      .select({
        ideaId: ideaRankings.ideaId
      })
      .from(ideaRankings)
      .where(
        and(
          eq(ideaRankings.campaignId, campaignId),
          gte(ideaRankings.createdAt, startedAt),
          lt(ideaRankings.createdAt, endedAt)
        )
      )
  ]);
  const groupCount = groupRows.length;
  const ideaCount = ideaRows.length;
  if (groupCount === 0 && ideaCount === 0) {
    return [];
  }

  return [
    {
      body: `Reranked ${groupCount} group${groupCount === 1 ? "" : "s"} and ${ideaCount} idea${ideaCount === 1 ? "" : "s"}.`,
      campaignId,
      ideaId: null,
      itemType: "rerank_summary",
      linkHref: "#classification-groups",
      linkLabel: "Open ranking view",
      title: "Rerank summary"
    }
  ];
}

async function buildDigestItems(campaignId: string, cadence: DigestCadence, now: Date) {
  const startedAt = windowStart(now, cadence);
  const [reviewReadyItems, clarificationItems, routingItems, rerankItems] = await Promise.all([
    buildReviewReadyItems(campaignId, startedAt, now),
    buildExpiringClarificationItems(campaignId, now, new Date(now.getTime() + expiringClarificationLookaheadMs)),
    buildMajorRoutingChangeItems(campaignId, startedAt, now),
    buildRerankSummaryItem(campaignId, startedAt, now)
  ]);

  return {
    items: [...reviewReadyItems, ...clarificationItems, ...routingItems, ...rerankItems],
    windowStartedAt: startedAt,
    windowEndedAt: now
  };
}

async function replaceDigest(input: {
  cadence: DigestCadence;
  campaignId: string;
  items: DigestItemDraft[];
  now: Date;
  windowEndedAt: Date;
  windowStartedAt: Date;
}) {
  const digestId = newId("review-digest");
  const summary = digestSummary(input.cadence, input.items.length);

  await db.transaction(async (tx) => {
    await tx.delete(reviewDigests).where(eq(reviewDigests.campaignId, input.campaignId));
    await tx.insert(reviewDigests).values({
      cadence: input.cadence,
      campaignId: input.campaignId,
      createdAt: input.now,
      generatedAt: input.now,
      id: digestId,
      itemCount: input.items.length,
      summary,
      windowEndedAt: input.windowEndedAt,
      windowStartedAt: input.windowStartedAt
    });

    if (input.items.length > 0) {
      await tx.insert(reviewDigestItems).values(
        input.items.map((item, index) => ({
          body: item.body,
          campaignId: item.campaignId,
          createdAt: input.now,
          digestId,
          id: newId("review-digest-item"),
          ideaId: item.ideaId,
          itemType: item.itemType,
          linkHref: item.linkHref,
          linkLabel: item.linkLabel,
          sortOrder: index + 1,
          title: item.title
        }))
      );
    }

    await tx.insert(auditEvents).values({
      actorType: "system",
      actorUserId: null,
      createdAt: input.now,
      entityId: input.campaignId,
      entityType: "campaign",
      eventType: "review_digest.generated",
      id: newId("audit"),
      metadata: {
        cadence: input.cadence,
        delivery: "in_app",
        digestId,
        itemCount: input.items.length
      },
      reason: "Scheduled in-app review digest generated."
    });
  });

  return {
    digestId,
    itemCount: input.items.length
  };
}

export async function generateReviewDigestForCampaign(
  campaignId: string,
  cadence: DigestCadence,
  options: DigestJobOptions = {}
) {
  const now = options.now ?? new Date();
  const digest = await buildDigestItems(campaignId, cadence, now);

  return replaceDigest({
    cadence,
    campaignId,
    items: digest.items,
    now,
    windowEndedAt: digest.windowEndedAt,
    windowStartedAt: digest.windowStartedAt
  });
}

export async function runSpecificCampaignDailyDigestJob(options: DigestJobOptions = {}) {
  const now = options.now ?? new Date();
  const campaignRows = await readActiveSpecificCampaigns();
  let itemCount = 0;

  for (const campaign of campaignRows) {
    const digest = await generateReviewDigestForCampaign(campaign.campaignId, "daily", { now });
    itemCount += digest.itemCount;
  }

  return {
    generatedCount: campaignRows.length,
    itemCount
  };
}

export async function runGeneralCampaignWeeklyDigestJob(options: DigestJobOptions = {}) {
  const now = options.now ?? new Date();
  const digest = await generateReviewDigestForCampaign("general-campaign", "weekly", { now });

  return {
    generatedCount: 1,
    itemCount: digest.itemCount
  };
}

export async function runReviewDigestDemoJob(options: DigestJobOptions = {}) {
  const now = options.now ?? new Date();
  const specific = await runSpecificCampaignDailyDigestJob({ now });
  const general = await runGeneralCampaignWeeklyDigestJob({ now });

  return {
    generalGeneratedCount: general.generatedCount,
    generatedCount: specific.generatedCount + general.generatedCount,
    itemCount: specific.itemCount + general.itemCount,
    specificGeneratedCount: specific.generatedCount
  };
}

export async function getAccessibleReviewDigests(session: DemoSession) {
  if (session.role.id === "employee") {
    return [];
  }

  const digestRows = await db
    .select({
      cadence: reviewDigests.cadence,
      campaignId: reviewDigests.campaignId,
      campaignTitle: campaigns.publicTitle,
      digestId: reviewDigests.id,
      generatedAt: reviewDigests.generatedAt,
      itemCount: reviewDigests.itemCount,
      summary: reviewDigests.summary,
      windowEndedAt: reviewDigests.windowEndedAt,
      windowStartedAt: reviewDigests.windowStartedAt
    })
    .from(reviewDigests)
    .innerJoin(campaigns, eq(campaigns.id, reviewDigests.campaignId))
    .innerJoin(
      campaignMemberships,
      and(
        eq(campaignMemberships.campaignId, reviewDigests.campaignId),
        eq(campaignMemberships.userId, session.user.id)
      )
    )
    .orderBy(desc(reviewDigests.generatedAt));

  const uniqueDigests = Array.from(new Map(digestRows.map((row) => [row.digestId, row])).values());
  const digestIds = uniqueDigests.map((row) => row.digestId);
  const itemRows =
    digestIds.length === 0
      ? []
      : await db
          .select({
            body: reviewDigestItems.body,
            digestId: reviewDigestItems.digestId,
            ideaId: reviewDigestItems.ideaId,
            itemId: reviewDigestItems.id,
            itemType: reviewDigestItems.itemType,
            linkHref: reviewDigestItems.linkHref,
            linkLabel: reviewDigestItems.linkLabel,
            sortOrder: reviewDigestItems.sortOrder,
            title: reviewDigestItems.title
          })
          .from(reviewDigestItems)
          .where(inArray(reviewDigestItems.digestId, digestIds))
          .orderBy(reviewDigestItems.sortOrder);
  const itemsByDigest = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const digestItems = itemsByDigest.get(item.digestId) ?? [];
    digestItems.push(item);
    itemsByDigest.set(item.digestId, digestItems);
  }

  return uniqueDigests.map((digest) => ({
    ...digest,
    items: itemsByDigest.get(digest.digestId) ?? []
  }));
}
