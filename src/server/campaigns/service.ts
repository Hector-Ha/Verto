import crypto from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { canManageCampaignLifecycle } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { assertCampaignSetupReadyForIntake } from "../campaign-setup/service";
import { db } from "../db/client";
import {
  auditEvents,
  campaignMemberships,
  campaigns,
  ideaStateHistory,
  ideas,
  userRoles
} from "../db/schema";

type CampaignStatus = (typeof campaigns.$inferSelect)["lifecycleStatus"];
type MembershipRole = (typeof campaignMemberships.$inferSelect)["membershipRole"];
type ReviewOutcome = Extract<
  (typeof ideaStateHistory.$inferSelect)["workflowState"],
  "future_opportunity" | "inactive_idea" | "potential_idea"
>;

type CreateSpecificCampaignInput = {
  id?: string;
  intakeEndsAt?: Date | null;
  intakeStartsAt?: Date | null;
  name: string;
  ownerUserId: string;
  publicPrompt: string;
  publicTitle: string;
};

type ChangeLifecycleInput = {
  intakeEndsAt?: Date | null;
  intakeStartsAt?: Date | null;
  nextStatus: CampaignStatus;
};

type ReviewOutcomeInput = {
  nextState: ReviewOutcome;
  reason?: string | null;
};

const allowedTransitions: Record<CampaignStatus, CampaignStatus[]> = {
  always_open: [],
  draft: ["setup_in_progress"],
  ended: [],
  intake_closed: ["review_in_progress"],
  intake_open: ["intake_closed"],
  intake_scheduled: ["intake_open", "intake_closed"],
  ready_to_open: ["intake_scheduled", "intake_open"],
  retrospective: ["ended"],
  review_complete: ["retrospective", "ended"],
  review_in_progress: ["review_complete"],
  setup_in_progress: ["setup_review"],
  setup_review: ["ready_to_open", "setup_in_progress"]
};

export const campaignLifecycleStatuses = Object.keys(allowedTransitions) as CampaignStatus[];

export function isCampaignLifecycleStatus(value: unknown): value is CampaignStatus {
  return typeof value === "string" && campaignLifecycleStatuses.includes(value as CampaignStatus);
}

export function getNextCampaignLifecycleStatuses(status: CampaignStatus) {
  return allowedTransitions[status];
}

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function slugId(prefix: string, value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  return slug ? `${prefix}-${slug}-${crypto.randomUUID().slice(0, 8)}` : newId(prefix);
}

async function userHasRole(userId: string, roleIds: string[]) {
  const [row] = await db
    .select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), inArray(userRoles.roleId, roleIds)))
    .limit(1);

  return Boolean(row);
}

async function assertSpecificCampaign(campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign || campaign.type !== "specific") {
    throw new Error("Specific campaign not found.");
  }

  return campaign;
}

async function assertCanManageCampaign(session: DemoSession, campaignId: string, action: string) {
  const allowed = await canManageCampaignLifecycle(session, campaignId);
  if (!allowed) {
    throw new Error(`Only the R&D Manager or Campaign Owner can ${action}.`);
  }
}

async function assertCanOwnSpecificCampaign(userId: string) {
  const canOwn = await userHasRole(userId, ["rd_manager", "specific_campaign_owner"]);
  if (!canOwn) {
    throw new Error("Specific campaign owner must be an R&D Manager or R&D Campaign Owner.");
  }
}

async function assertCanBecomeTeamMember(userId: string) {
  const canJoin = await userHasRole(userId, ["rd_team_member"]);
  if (!canJoin) {
    throw new Error("Campaign team member must use the R&D Team Member role.");
  }
}

async function addMembership(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  campaignId: string,
  userId: string,
  membershipRole: MembershipRole
) {
  const [existing] = await tx
    .select()
    .from(campaignMemberships)
    .where(
      and(
        eq(campaignMemberships.campaignId, campaignId),
        eq(campaignMemberships.userId, userId),
        eq(campaignMemberships.membershipRole, membershipRole)
      )
    )
    .limit(1);

  if (!existing) {
    await tx.insert(campaignMemberships).values({
      campaignId,
      createdAt: new Date(),
      membershipRole,
      userId
    });
  }
}

async function addDefaultManagerMemberships(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  campaignId: string
) {
  const managerRows = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, "rd_manager"));
  for (const manager of managerRows) {
    await addMembership(tx, campaignId, manager.userId, "manager");
  }
}

async function writeCampaignAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: DemoSession,
  eventType: string,
  campaignId: string,
  reason: string,
  metadata: Record<string, unknown> | null = null
) {
  await tx.insert(auditEvents).values({
    actorType: "user",
    actorUserId: session.user.id,
    createdAt: new Date(),
    entityId: campaignId,
    entityType: "campaign",
    eventType,
    id: newId("audit"),
    metadata,
    reason
  });
}

export async function createSpecificCampaign(session: DemoSession, input: CreateSpecificCampaignInput) {
  if (session.role.id === "specific_campaign_owner" && input.ownerUserId !== session.user.id) {
    throw new Error("R&D Campaign Owner can create a campaign only when they assign themself as owner.");
  }

  if (session.role.id !== "rd_manager" && session.role.id !== "specific_campaign_owner") {
    throw new Error("Only an R&D Manager or R&D Campaign Owner can create campaigns.");
  }

  await assertCanOwnSpecificCampaign(input.ownerUserId);

  const campaignId = input.id ?? slugId("campaign", input.name);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(campaigns).values({
      createdAt: now,
      createdByUserId: session.user.id,
      id: campaignId,
      intakeEndsAt: input.intakeEndsAt ?? null,
      intakeStartsAt: input.intakeStartsAt ?? null,
      lifecycleStatus: "draft",
      name: input.name,
      publicPrompt: input.publicPrompt,
      publicTitle: input.publicTitle,
      type: "specific",
      updatedAt: now
    });

    await addDefaultManagerMemberships(tx, campaignId);
    await addMembership(tx, campaignId, input.ownerUserId, "owner");
    await writeCampaignAudit(tx, session, "campaign.created", campaignId, "Specific campaign created.", {
      ownerUserId: input.ownerUserId
    });
    await writeCampaignAudit(tx, session, "campaign.owner.assigned", campaignId, "Campaign owner assigned.", {
      ownerUserId: input.ownerUserId
    });
  });

  return campaignId;
}

export async function changeCampaignOwner(session: DemoSession, campaignId: string, ownerUserId: string) {
  if (session.role.id !== "rd_manager") {
    throw new Error("Only an R&D Manager can change campaign owner.");
  }

  await assertSpecificCampaign(campaignId);
  await assertCanManageCampaign(session, campaignId, "change owner");
  await assertCanOwnSpecificCampaign(ownerUserId);

  await db.transaction(async (tx) => {
    await tx
      .delete(campaignMemberships)
      .where(and(eq(campaignMemberships.campaignId, campaignId), eq(campaignMemberships.membershipRole, "owner")));
    await addMembership(tx, campaignId, ownerUserId, "owner");
    await writeCampaignAudit(tx, session, "campaign.owner.changed", campaignId, "Campaign owner changed.", {
      ownerUserId
    });
  });
}

export async function addCampaignTeamMember(session: DemoSession, campaignId: string, userId: string) {
  await assertSpecificCampaign(campaignId);
  await assertCanManageCampaign(session, campaignId, "manage team members");
  await assertCanBecomeTeamMember(userId);

  await db.transaction(async (tx) => {
    await addMembership(tx, campaignId, userId, "member");
    await writeCampaignAudit(tx, session, "campaign.member.added", campaignId, "Campaign team member added.", {
      userId
    });
  });
}

export async function removeCampaignTeamMember(session: DemoSession, campaignId: string, userId: string) {
  await assertSpecificCampaign(campaignId);
  await assertCanManageCampaign(session, campaignId, "manage team members");

  await db.transaction(async (tx) => {
    await tx
      .delete(campaignMemberships)
      .where(
        and(
          eq(campaignMemberships.campaignId, campaignId),
          eq(campaignMemberships.userId, userId),
          eq(campaignMemberships.membershipRole, "member")
        )
      );
    await writeCampaignAudit(tx, session, "campaign.member.removed", campaignId, "Campaign team member removed.", {
      userId
    });
  });
}

async function countReadyReviewIdeas(campaignId: string) {
  const rows = await db
    .select({ id: ideas.id })
    .from(ideas)
    .innerJoin(ideaStateHistory, eq(ideaStateHistory.ideaId, ideas.id))
    .where(
      and(
        eq(ideas.campaignId, campaignId),
        eq(ideaStateHistory.isCurrent, true),
        eq(ideaStateHistory.workflowState, "ready_for_rd_review")
      )
    );

  return rows.length;
}

function validateSchedule(input: ChangeLifecycleInput) {
  if (input.nextStatus !== "intake_scheduled") {
    return;
  }

  if (!input.intakeStartsAt || !input.intakeEndsAt) {
    throw new Error("Intake Scheduled requires intake start and end dates.");
  }

  if (input.intakeEndsAt <= input.intakeStartsAt) {
    throw new Error("Intake end date must be after intake start date.");
  }
}

export async function changeCampaignLifecycle(
  session: DemoSession,
  campaignId: string,
  input: ChangeLifecycleInput
) {
  const campaign = await assertSpecificCampaign(campaignId);
  await assertCanManageCampaign(session, campaignId, "change lifecycle");

  if (!allowedTransitions[campaign.lifecycleStatus].includes(input.nextStatus)) {
    throw new Error(`Invalid lifecycle transition from ${campaign.lifecycleStatus} to ${input.nextStatus}.`);
  }

  validateSchedule(input);

  if (["ready_to_open", "intake_scheduled", "intake_open"].includes(input.nextStatus)) {
    await assertCampaignSetupReadyForIntake(campaignId);
  }

  if (input.nextStatus === "review_complete") {
    const readyReviewIdeas = await countReadyReviewIdeas(campaignId);
    if (readyReviewIdeas > 0) {
      throw new Error("Review Complete is blocked while Ready for R&D Review ideas lack outcomes.");
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(campaigns)
      .set({
        intakeEndsAt: input.intakeEndsAt ?? campaign.intakeEndsAt,
        intakeStartsAt: input.intakeStartsAt ?? campaign.intakeStartsAt,
        lifecycleStatus: input.nextStatus,
        updatedAt: new Date()
      })
      .where(eq(campaigns.id, campaignId));
    await writeCampaignAudit(tx, session, "campaign.lifecycle.changed", campaignId, "Campaign lifecycle gate changed.", {
      from: campaign.lifecycleStatus,
      to: input.nextStatus
    });
  });
}

export async function recordIdeaReviewOutcome(session: DemoSession, ideaId: string, input: ReviewOutcomeInput) {
  const [row] = await db
    .select({
      campaignId: ideas.campaignId,
      lifecycleStatus: campaigns.lifecycleStatus
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .where(eq(ideas.id, ideaId))
    .limit(1);

  if (!row) {
    throw new Error("Idea not found.");
  }

  if (row.lifecycleStatus === "ended") {
    throw new Error("Cannot record review decisions for an ended campaign.");
  }

  await assertCanManageCampaign(session, row.campaignId, "record review decisions");

  await db.transaction(async (tx) => {
    await tx.update(ideaStateHistory).set({ isCurrent: false }).where(eq(ideaStateHistory.ideaId, ideaId));
    await tx.insert(ideaStateHistory).values({
      changedAt: new Date(),
      changedByUserId: session.user.id,
      ideaId,
      id: newId("idea-state"),
      isCurrent: true,
      reason: input.reason ?? null,
      workflowState: input.nextState
    });
    await writeCampaignAudit(
      tx,
      session,
      "campaign.review_outcome.recorded",
      row.campaignId,
      "Campaign review outcome recorded.",
      {
        ideaId,
        nextState: input.nextState
      }
    );
  });
}
