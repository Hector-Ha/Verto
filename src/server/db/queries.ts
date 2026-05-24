import { and, eq, inArray, sql } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId, type RoleId } from "../auth/personas";
import type { DemoSession } from "../auth/session";
import { getNextCampaignLifecycleStatuses } from "../campaigns/service";
import { db } from "./client";
import { campaignMemberships, campaigns, ideas, roles, userRoles, users } from "./schema";

type CountRow = {
  count: number | string | bigint;
};

function readCount(row: CountRow | undefined) {
  return Number(row?.count ?? 0);
}

export async function getDemoSnapshot() {
  const userCountPromise = db.select({ count: sql<number>`count(*)` }).from(users);
  const roleCountPromise = db.select({ count: sql<number>`count(*)` }).from(roles);
  const campaignCountPromise = db.select({ count: sql<number>`count(*)` }).from(campaigns);
  const ideaCountPromise = db.select({ count: sql<number>`count(*)` }).from(ideas);
  const campaignsPromise = db
    .select({
      id: campaigns.id,
      lifecycleStatus: campaigns.lifecycleStatus,
      name: campaigns.name,
      publicTitle: campaigns.publicTitle,
      type: campaigns.type
    })
    .from(campaigns)
    .orderBy(campaigns.id);
  const usersPromise = db
    .select({
      department: users.department,
      displayName: users.displayName,
      email: users.email,
      id: users.id
    })
    .from(users)
    .orderBy(users.id);
  const generalIdeasPromise = db
    .select({
      id: ideas.id,
      title: ideas.title
    })
    .from(ideas)
    .where(eq(ideas.campaignId, "general-campaign"));

  const [userCount, roleCount, campaignCount, ideaCount, campaignRows, userRows, generalIdeas] = await Promise.all([
    userCountPromise,
    roleCountPromise,
    campaignCountPromise,
    ideaCountPromise,
    campaignsPromise,
    usersPromise,
    generalIdeasPromise
  ]);

  return {
    campaignCount: readCount(campaignCount[0]),
    campaigns: campaignRows,
    generalIdeas,
    ideaCount: readCount(ideaCount[0]),
    roleCount: readCount(roleCount[0]),
    userCount: readCount(userCount[0]),
    users: userRows
  };
}

export async function getDemoRoleSwitchOptions() {
  const rows = await db
    .select({
      department: users.department,
      displayName: users.displayName,
      email: users.email,
      roleId: roles.id,
      roleName: roles.name,
      userId: users.id
    })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(userRoles.roleId, roles.id));

  const assignmentByPersona = new Map(rows.map((row) => [`${row.userId}:${row.roleId}`, row]));

  return DEMO_PERSONAS.map((persona) => {
    const assignment = assignmentByPersona.get(`${persona.userId}:${persona.roleId}`);
    if (!assignment) {
      return null;
    }

    return {
      department: assignment.department,
      displayName: assignment.displayName,
      email: assignment.email,
      label: persona.label,
      personaId: persona.id,
      roleId: assignment.roleId as RoleId,
      roleName: assignment.roleName,
      userId: assignment.userId
    };
  }).filter((option): option is NonNullable<typeof option> => Boolean(option));
}

export async function getDemoRoleSwitchOptionById(personaId: string) {
  if (!DEMO_PERSONAS.some((persona) => persona.id === personaId)) {
    return null;
  }

  const options = await getDemoRoleSwitchOptions();
  return options.find((option) => option.personaId === (personaId as DemoPersonaId)) ?? null;
}

export async function getCampaignOperationsView(session: DemoSession) {
  const managingRole =
    session.role.id === "rd_manager" ? "manager" : session.role.id === "specific_campaign_owner" ? "owner" : null;

  if (!managingRole) {
    return {
      ownerOptions: [],
      specificCampaigns: [],
      teamMemberOptions: []
    };
  }

  const campaignRows = await db
    .select({
      id: campaigns.id,
      intakeEndsAt: campaigns.intakeEndsAt,
      intakeStartsAt: campaigns.intakeStartsAt,
      lifecycleStatus: campaigns.lifecycleStatus,
      name: campaigns.name,
      publicTitle: campaigns.publicTitle
    })
    .from(campaigns)
    .innerJoin(
      campaignMemberships,
      and(
        eq(campaignMemberships.campaignId, campaigns.id),
        eq(campaignMemberships.userId, session.user.id),
        eq(campaignMemberships.membershipRole, managingRole)
      )
    )
    .where(eq(campaigns.type, "specific"))
    .orderBy(campaigns.id);

  const campaignIds = campaignRows.map((campaign) => campaign.id);
  if (campaignIds.length === 0) {
    return {
      ownerOptions: [],
      specificCampaigns: [],
      teamMemberOptions: []
    };
  }

  const membershipRows = await db
    .select({
      campaignId: campaignMemberships.campaignId,
      displayName: users.displayName,
      membershipRole: campaignMemberships.membershipRole,
      userId: users.id
    })
    .from(campaignMemberships)
    .innerJoin(users, eq(users.id, campaignMemberships.userId))
    .where(inArray(campaignMemberships.campaignId, campaignIds));

  const ownerRows = await db
    .select({
      displayName: users.displayName,
      roleId: roles.id,
      userId: users.id
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(inArray(userRoles.roleId, ["rd_manager", "specific_campaign_owner"]));

  const teamMemberRows = await db
    .select({
      displayName: users.displayName,
      userId: users.id
    })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(eq(userRoles.roleId, "rd_team_member"));

  const membershipsByCampaign = new Map<string, typeof membershipRows>();
  for (const membership of membershipRows) {
    const memberships = membershipsByCampaign.get(membership.campaignId) ?? [];
    memberships.push(membership);
    membershipsByCampaign.set(membership.campaignId, memberships);
  }

  return {
    ownerOptions: ownerRows,
    specificCampaigns: campaignRows.map((campaign) => ({
      ...campaign,
      memberships: membershipsByCampaign.get(campaign.id) ?? [],
      nextStatuses: getNextCampaignLifecycleStatuses(campaign.lifecycleStatus)
    })),
    teamMemberOptions: teamMemberRows
  };
}
