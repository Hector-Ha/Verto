import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { canContributeToCampaign, canManageGeneralCampaign } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  auditEvents,
  clarificationRequests,
  generalCampaignReviewPackets,
  ideaRoutingDecisions,
  ideaStateHistory,
  ideas,
  users
} from "../db/schema";
import type { LlmProvider } from "../llm/adapter";
import { routeIdeaBeforeRdReview, runGeneralCampaignRoutingRecheck } from "../pre-rd-routing/service";

type GeneralReclassificationState = "general_idea" | "ready_for_rd_review" | "future_opportunity";

type GeneralCampaignIdea = {
  evidence: string | null;
  ideaId: string;
  originalText: string;
  reason: string | null;
  submittedAt: Date;
  submitterDepartment: string | null;
  submitterDisplayName: string;
  title: string;
};

type UpdatePacketInput = {
  now?: Date;
  packetText: string;
  provider?: LlmProvider;
};

type ReclassifyInput = {
  nextState: GeneralReclassificationState;
  now?: Date;
  reason: string;
};

type ApplyAnsweredClarificationInput = {
  now?: Date;
  provider?: LlmProvider;
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function requireText(value: string | null | undefined, fieldName: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required.`);
  }

  return trimmed;
}

async function assertCanManageGeneral(session: DemoSession) {
  if (!(await canManageGeneralCampaign(session))) {
    throw new Error("Only General Campaign owners can manage General Campaign review.");
  }
}

async function assertCanViewGeneral(session: DemoSession) {
  if (session.role.id === "employee" || !(await canContributeToCampaign(session, "general-campaign"))) {
    throw new Error("Only R&D users with General Campaign access can inspect General Campaign review.");
  }
}

async function readCurrentGeneralPacket() {
  const [packet] = await db
    .select({
      contextVersion: generalCampaignReviewPackets.contextVersion,
      createdAt: generalCampaignReviewPackets.createdAt,
      createdByUserId: generalCampaignReviewPackets.createdByUserId,
      id: generalCampaignReviewPackets.id,
      packetText: generalCampaignReviewPackets.packetText
    })
    .from(generalCampaignReviewPackets)
    .where(
      and(
        eq(generalCampaignReviewPackets.campaignId, "general-campaign"),
        eq(generalCampaignReviewPackets.isCurrent, true)
      )
    )
    .orderBy(desc(generalCampaignReviewPackets.createdAt))
    .limit(1);

  return packet ?? null;
}

async function latestRoutingByIdea(ideaIds: string[]) {
  if (ideaIds.length === 0) {
    return new Map<string, typeof ideaRoutingDecisions.$inferSelect>();
  }

  const rows = await db
    .select()
    .from(ideaRoutingDecisions)
    .where(inArray(ideaRoutingDecisions.ideaId, ideaIds))
    .orderBy(desc(ideaRoutingDecisions.createdAt));
  const byIdea = new Map<string, typeof ideaRoutingDecisions.$inferSelect>();

  for (const row of rows) {
    if (!byIdea.has(row.ideaId)) {
      byIdea.set(row.ideaId, row);
    }
  }

  return byIdea;
}

function toGeneralIdea(
  row: {
    currentReason: string | null;
    ideaId: string;
    originalText: string;
    submittedAt: Date;
    submitterDepartment: string | null;
    submitterDisplayName: string;
    title: string;
  },
  routing: (typeof ideaRoutingDecisions.$inferSelect) | undefined
): GeneralCampaignIdea {
  return {
    evidence: routing?.outOfScopeReason ?? routing?.readinessBasis ?? null,
    ideaId: row.ideaId,
    originalText: row.originalText,
    reason: row.currentReason,
    submittedAt: row.submittedAt,
    submitterDepartment: row.submitterDepartment,
    submitterDisplayName: row.submitterDisplayName,
    title: row.title
  };
}

export async function getGeneralCampaignWorkspaceView(session: DemoSession) {
  await assertCanViewGeneral(session);
  const canManage = await canManageGeneralCampaign(session);

  const [currentPacket, ideaRows] = await Promise.all([
    readCurrentGeneralPacket(),
    db
      .select({
        currentReason: ideaStateHistory.reason,
        currentWorkflowState: ideaStateHistory.workflowState,
        ideaId: ideas.id,
        originalText: ideas.originalText,
        submittedAt: ideas.submittedAt,
        submitterDepartment: users.department,
        submitterDisplayName: users.displayName,
        title: ideas.title
      })
      .from(ideas)
      .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
      .innerJoin(users, eq(users.id, ideas.submitterUserId))
      .where(eq(ideas.campaignId, "general-campaign"))
      .orderBy(desc(ideas.submittedAt))
  ]);
  const routingByIdea = await latestRoutingByIdea(ideaRows.map((row) => row.ideaId));
  const generalIdeas: GeneralCampaignIdea[] = [];
  const awaitingClarification: GeneralCampaignIdea[] = [];
  const readyReviewIdeas: GeneralCampaignIdea[] = [];
  const futureOpportunities: GeneralCampaignIdea[] = [];
  const inactiveByReason = new Map<
    string,
    {
      evidence: string | null;
      ideas: GeneralCampaignIdea[];
      reason: string;
    }
  >();

  for (const row of ideaRows) {
    const item = toGeneralIdea(row, routingByIdea.get(row.ideaId));

    if (row.currentWorkflowState === "general_idea") {
      generalIdeas.push(item);
    } else if (row.currentWorkflowState === "needs_employee_clarification") {
      awaitingClarification.push(item);
    } else if (row.currentWorkflowState === "ready_for_rd_review") {
      readyReviewIdeas.push(item);
    } else if (row.currentWorkflowState === "future_opportunity") {
      futureOpportunities.push(item);
    } else if (row.currentWorkflowState === "inactive_idea") {
      const reason = row.currentReason ?? "Unspecified inactive reason.";
      const group = inactiveByReason.get(reason) ?? {
        evidence: item.evidence,
        ideas: [],
        reason
      };
      group.ideas.push(item);
      inactiveByReason.set(reason, group);
    }
  }

  return {
    awaitingClarification,
    canManage,
    counts: {
      awaitingClarification: awaitingClarification.length,
      futureOpportunities: futureOpportunities.length,
      generalIdeas: generalIdeas.length,
      inactiveIdeas: Array.from(inactiveByReason.values()).reduce((count, group) => count + group.ideas.length, 0),
      readyReviewIdeas: readyReviewIdeas.length
    },
    currentPacket,
    futureOpportunities,
    generalIdeas,
    inactiveGroups: Array.from(inactiveByReason.values()),
    readyReviewIdeas
  };
}

async function writeGeneralCampaignAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: DemoSession,
  input: {
    entityId: string;
    entityType: "campaign" | "idea";
    eventType: string;
    metadata?: Record<string, unknown> | null;
    reason: string;
  }
) {
  await tx.insert(auditEvents).values({
    actorType: "user",
    actorUserId: session.user.id,
    createdAt: new Date(),
    entityId: input.entityId,
    entityType: input.entityType,
    eventType: input.eventType,
    id: newId("audit"),
    metadata: input.metadata ?? null,
    reason: input.reason
  });
}

export async function updateGeneralCampaignReviewPacket(session: DemoSession, input: UpdatePacketInput) {
  await assertCanManageGeneral(session);
  const packetText = requireText(input.packetText, "General Campaign review packet");
  const now = input.now ?? new Date();
  const packetId = newId("general-packet");
  const contextVersion = packetId;

  await db.transaction(async (tx) => {
    await tx
      .update(generalCampaignReviewPackets)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generalCampaignReviewPackets.campaignId, "general-campaign"),
          eq(generalCampaignReviewPackets.isCurrent, true)
        )
      );
    await tx.insert(generalCampaignReviewPackets).values({
      campaignId: "general-campaign",
      contextVersion,
      createdAt: now,
      createdByUserId: session.user.id,
      id: packetId,
      isCurrent: true,
      packetText
    });
    await writeGeneralCampaignAudit(tx, session, {
      entityId: "general-campaign",
      entityType: "campaign",
      eventType: "general_campaign.packet.updated",
      metadata: { contextVersion, packetId },
      reason: "General Campaign Minimum Review Packet updated."
    });
  });

  const recheck = await runGeneralCampaignRoutingRecheck(session, {
    contextVersion,
    now,
    provider: input.provider
  });

  return {
    contextVersion,
    packetId,
    recheck
  };
}

export async function reclassifyInactiveGeneralIdea(session: DemoSession, ideaId: string, input: ReclassifyInput) {
  await assertCanManageGeneral(session);
  const reason = requireText(input.reason, "Reclassification reason");
  const now = input.now ?? new Date();

  if (!["general_idea", "ready_for_rd_review", "future_opportunity"].includes(input.nextState)) {
    throw new Error("Inactive General Campaign ideas can only return to General Ideas, Future Opportunities, or review.");
  }

  await db.transaction(async (tx) => {
    const [idea] = await tx
      .select({
        campaignId: ideas.campaignId,
        currentStateId: ideaStateHistory.id,
        currentWorkflowState: ideaStateHistory.workflowState
      })
      .from(ideas)
      .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
      .where(eq(ideas.id, ideaId))
      .limit(1)
      .for("update");

    if (!idea || idea.campaignId !== "general-campaign") {
      throw new Error("General Campaign idea not found.");
    }
    if (idea.currentWorkflowState !== "inactive_idea") {
      throw new Error("Only Inactive Ideas can be reclassified from the inactive view.");
    }

    await tx.update(ideaStateHistory).set({ isCurrent: false }).where(eq(ideaStateHistory.id, idea.currentStateId));
    await tx.insert(ideaStateHistory).values({
      changedAt: now,
      changedByUserId: session.user.id,
      ideaId,
      id: newId("idea-state"),
      isCurrent: true,
      reason,
      workflowState: input.nextState
    });
    await writeGeneralCampaignAudit(tx, session, {
      entityId: ideaId,
      entityType: "idea",
      eventType: "general_campaign.inactive.reclassified",
      metadata: { from: "inactive_idea", to: input.nextState },
      reason
    });
  });

  return {
    ideaId,
    nextState: input.nextState
  };
}

export async function applyAnsweredGeneralClarificationRouting(
  session: DemoSession,
  requestId: string,
  input: ApplyAnsweredClarificationInput = {}
) {
  await assertCanManageGeneral(session);
  const [request] = await db
    .select({
      ideaId: ideas.id,
      requestStatus: clarificationRequests.status
    })
    .from(clarificationRequests)
    .innerJoin(ideas, eq(ideas.id, clarificationRequests.ideaId))
    .where(and(eq(clarificationRequests.id, requestId), eq(ideas.campaignId, "general-campaign")))
    .limit(1);

  if (!request) {
    throw new Error("Answered General Campaign clarification not found.");
  }
  if (request.requestStatus !== "answered") {
    throw new Error("General Campaign clarification must be answered before routing can apply it.");
  }

  const currentPacket = await readCurrentGeneralPacket();

  return routeIdeaBeforeRdReview(session, request.ideaId, {
    contextVersion: currentPacket?.contextVersion ?? "general-clarification-answer",
    now: input.now,
    provider: input.provider
  });
}
