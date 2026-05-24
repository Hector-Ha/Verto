import { and, eq } from "drizzle-orm";

import { db } from "../db/client";
import { campaignMemberships, campaigns } from "../db/schema";
import type { DemoSession } from "./session";

type CampaignAuthority = {
  lifecycleStatus: (typeof campaigns.$inferSelect)["lifecycleStatus"];
  membershipRoles: Array<(typeof campaignMemberships.$inferSelect)["membershipRole"]>;
  type: (typeof campaigns.$inferSelect)["type"];
};

async function getCampaignAuthority(session: DemoSession, campaignId: string): Promise<CampaignAuthority | null> {
  const rows = await db
    .select({
      lifecycleStatus: campaigns.lifecycleStatus,
      membershipRole: campaignMemberships.membershipRole,
      type: campaigns.type
    })
    .from(campaigns)
    .leftJoin(
      campaignMemberships,
      and(eq(campaignMemberships.campaignId, campaigns.id), eq(campaignMemberships.userId, session.user.id))
    )
    .where(eq(campaigns.id, campaignId));

  if (rows.length === 0) {
    return null;
  }

  return {
    lifecycleStatus: rows[0].lifecycleStatus,
    membershipRoles: rows
      .map((row) => row.membershipRole)
      .filter((membershipRole): membershipRole is NonNullable<typeof membershipRole> => Boolean(membershipRole)),
    type: rows[0].type
  };
}

function hasMembership(authority: CampaignAuthority, role: "manager" | "owner" | "member") {
  return authority.membershipRoles.includes(role);
}

export async function canManageGeneralCampaignOwnerMembership(session: DemoSession) {
  const authority = await getCampaignAuthority(session, "general-campaign");

  return Boolean(session.role.id === "rd_manager" && authority && hasMembership(authority, "manager"));
}

export async function canManageGeneralCampaign(session: DemoSession) {
  const authority = await getCampaignAuthority(session, "general-campaign");
  if (!authority || authority.type !== "general") {
    return false;
  }

  return (
    (session.role.id === "rd_manager" && hasMembership(authority, "manager")) ||
    (session.role.id === "general_campaign_owner" && hasMembership(authority, "owner"))
  );
}

export async function canManageCampaignLifecycle(session: DemoSession, campaignId: string) {
  const authority = await getCampaignAuthority(session, campaignId);
  if (!authority || authority.type !== "specific") {
    return false;
  }

  return (
    (session.role.id === "rd_manager" && hasMembership(authority, "manager")) ||
    (session.role.id === "specific_campaign_owner" && hasMembership(authority, "owner"))
  );
}

export async function canContributeToCampaign(session: DemoSession, campaignId: string) {
  const authority = await getCampaignAuthority(session, campaignId);
  if (!authority || session.role.id === "employee") {
    return false;
  }

  return authority.membershipRoles.length > 0;
}

export async function canSubmitIdea(session: DemoSession, campaignId: string) {
  const authority = await getCampaignAuthority(session, campaignId);
  if (!authority || session.role.id !== "employee") {
    return false;
  }

  return authority.type === "general" || authority.lifecycleStatus === "intake_open";
}

export async function getDemoPermissionSummary(session: DemoSession) {
  const [
    manageGeneralOwners,
    manageGeneralCampaign,
    manageSpecificLifecycle,
    contributeSpecificCampaign,
    submitGeneralIdea
  ] = await Promise.all([
    canManageGeneralCampaignOwnerMembership(session),
    canManageGeneralCampaign(session),
    canManageCampaignLifecycle(session, "specific-campaign"),
    canContributeToCampaign(session, "specific-campaign"),
    canSubmitIdea(session, "general-campaign")
  ]);

  return {
    contributeSpecificCampaign,
    manageGeneralCampaign,
    manageGeneralOwners,
    manageSpecificLifecycle,
    submitGeneralIdea
  };
}
