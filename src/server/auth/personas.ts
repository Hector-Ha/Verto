export const ROLE_IDS = [
  "rd_manager",
  "general_campaign_owner",
  "specific_campaign_owner",
  "rd_team_member",
  "employee"
] as const;

export type RoleId = (typeof ROLE_IDS)[number];

export const DEMO_PERSONAS = [
  {
    id: "rd-manager",
    label: "R&D Manager",
    roleId: "rd_manager",
    userId: "rd-manager"
  },
  {
    id: "general-campaign-owner",
    label: "General Campaign Owner",
    roleId: "general_campaign_owner",
    userId: "general-campaign-owner"
  },
  {
    id: "specific-campaign-owner",
    label: "R&D Campaign Owner",
    roleId: "specific_campaign_owner",
    userId: "specific-campaign-owner"
  },
  {
    id: "rd-team-member",
    label: "R&D Team Member",
    roleId: "rd_team_member",
    userId: "rd-team-member"
  },
  {
    id: "employee",
    label: "Employee",
    roleId: "employee",
    userId: "employee"
  }
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  roleId: RoleId;
  userId: string;
}>;

export type DemoPersonaId = (typeof DEMO_PERSONAS)[number]["id"];
