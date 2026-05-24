export const BASELINE_TIMESTAMP = "2026-01-15 09:00:00";

export const DEMO_ROLES = [
  {
    description: "Authority for Company Context, Global Innovation Context, and manager-only owner membership.",
    id: "rd_manager",
    name: "R&D Manager"
  },
  {
    description: "Owner authority inside the always-open General Campaign.",
    id: "general_campaign_owner",
    name: "General Campaign Owner"
  },
  {
    description: "Owner authority for one specific campaign.",
    id: "specific_campaign_owner",
    name: "Specific Campaign Owner"
  },
  {
    description: "R&D contributor with campaign workspace access but no owner gates.",
    id: "rd_team_member",
    name: "R&D Team Member"
  },
  {
    description: "Employee submitter for General Campaign and open campaign ideas.",
    id: "employee",
    name: "Employee"
  }
] as const;

export const DEMO_USERS = [
  {
    department: "Innovation",
    displayName: "Morgan Lee",
    email: "rd.manager@verto.demo",
    id: "rd-manager"
  },
  {
    department: "R&D",
    displayName: "Avery Chen",
    email: "general.owner@verto.demo",
    id: "general-campaign-owner"
  },
  {
    department: "Advanced Manufacturing",
    displayName: "Sam Rivera",
    email: "specific.owner@verto.demo",
    id: "specific-campaign-owner"
  },
  {
    department: "R&D",
    displayName: "Priya Shah",
    email: "rd.team.member@verto.demo",
    id: "rd-team-member"
  },
  {
    department: "Operations",
    displayName: "Jordan Kim",
    email: "employee@verto.demo",
    id: "employee"
  }
] as const;

export const DEMO_USER_ROLES = [
  ["rd-manager", "rd_manager"],
  ["rd-manager", "general_campaign_owner"],
  ["general-campaign-owner", "general_campaign_owner"],
  ["specific-campaign-owner", "specific_campaign_owner"],
  ["rd-team-member", "rd_team_member"],
  ["employee", "employee"]
] as const;

export const DEMO_CAMPAIGNS = [
  {
    createdByUserId: "rd-manager",
    id: "general-campaign",
    intakeEndsAt: null,
    intakeStartsAt: null,
    lifecycleStatus: "always_open",
    name: "General Campaign",
    publicPrompt: "Submit useful ideas that do not fit a current specific campaign.",
    publicTitle: "General Ideas",
    type: "general"
  },
  {
    createdByUserId: "specific-campaign-owner",
    id: "specific-campaign",
    intakeEndsAt: "2026-12-31 17:00:00",
    intakeStartsAt: "2026-01-15 09:00:00",
    lifecycleStatus: "intake_open",
    name: "Battery Reuse Campaign",
    publicPrompt: "Share practical ways to reuse or extend the life of battery materials in manufacturing workflows.",
    publicTitle: "Battery Reuse Ideas",
    type: "specific"
  },
  {
    createdByUserId: "specific-campaign-owner",
    id: "setup-campaign",
    intakeEndsAt: null,
    intakeStartsAt: null,
    lifecycleStatus: "setup_review",
    name: "Packaging Reuse Setup Campaign",
    publicPrompt: "Share practical packaging reuse ideas that could reduce waste without slowing production.",
    publicTitle: "Packaging Reuse Ideas",
    type: "specific"
  }
] as const;

export const DEMO_CAMPAIGN_MEMBERSHIPS = [
  ["general-campaign", "rd-manager", "manager"],
  ["general-campaign", "rd-manager", "owner"],
  ["general-campaign", "general-campaign-owner", "owner"],
  ["general-campaign", "rd-team-member", "member"],
  ["specific-campaign", "rd-manager", "manager"],
  ["specific-campaign", "specific-campaign-owner", "owner"],
  ["specific-campaign", "rd-team-member", "member"],
  ["setup-campaign", "rd-manager", "manager"],
  ["setup-campaign", "specific-campaign-owner", "owner"],
  ["setup-campaign", "rd-team-member", "member"]
] as const;

export const DEMO_SETUP_QUESTIONS = [
  {
    campaignId: "setup-campaign",
    id: "setup-q-topic",
    priority: "hard_blocker",
    questionText: "Which employee idea types should this campaign include and exclude?",
    rationale: "AI needs campaign scope before it can judge whether an idea belongs in this campaign.",
    recommendedAnswer:
      "Include packaging reuse ideas that reduce material waste; exclude unrelated logistics or procurement ideas.",
    setupArea: "topic",
    status: "open"
  },
  {
    campaignId: "setup-campaign",
    id: "setup-q-review-packet",
    priority: "hard_blocker",
    questionText: "What minimum information must an employee idea contain before R&D reviews it?",
    rationale: "Minimum review packet gaps should trigger clarification instead of wasting R&D review time.",
    recommendedAnswer: "Require the problem, expected benefit, feasibility signal, and relevant production context.",
    setupArea: "review_packet",
    status: "open"
  },
  {
    campaignId: "setup-campaign",
    id: "setup-q-equipment-warning",
    priority: "warning",
    questionText: "How should AI treat packaging ideas that require new capital equipment?",
    rationale: "Equipment-heavy ideas may still be useful, but AI should flag them with lower confidence.",
    recommendedAnswer: "Keep them visible as warnings unless the owner defines them as out of scope.",
    setupArea: "rules_memory",
    status: "open"
  },
  {
    campaignId: "setup-campaign",
    id: "setup-q-ambiguity",
    priority: "clarity",
    questionText: "Should broad packaging-adjacent ideas remain allowed when they are not clearly reuse ideas?",
    rationale: "Intentional ambiguity can be useful, but it must be recorded so AI does not over-filter.",
    recommendedAnswer: "Allow useful adjacent variants but record the ambiguity in the knowledge report.",
    setupArea: "intent",
    status: "open"
  }
] as const;

export const DEMO_IDEAS = [
  {
    campaignId: "general-campaign",
    id: "idea-general-material-exchange",
    originalText:
      "We throw away usable lab materials when teams finish experiments. A shared exchange could make leftovers visible before new orders go out.",
    sourceType: "employee_submission",
    submittedAt: "2026-01-15 10:30:00",
    submitterUserId: "employee",
    title: "Reusable lab material exchange"
  }
] as const;

export const DEMO_IDEA_STATES = [
  {
    changedAt: "2026-01-15 10:30:00",
    changedByUserId: "employee",
    ideaId: "idea-general-material-exchange",
    id: "idea-state-general-material-exchange",
    isCurrent: true,
    reason: "Initial employee submission to the always-open General Campaign.",
    workflowState: "general_idea"
  }
] as const;

export const DEMO_AUDIT_EVENTS = [
  {
    actorType: "system",
    actorUserId: null,
    entityId: "general-campaign",
    entityType: "campaign",
    eventType: "seed.campaign.created",
    id: "audit-seed-general-campaign",
    metadata: JSON.stringify({ baseline: "issue-2" }),
    reason: "Deterministic demo baseline for issue 2.",
    createdAt: BASELINE_TIMESTAMP
  },
  {
    actorType: "system",
    actorUserId: null,
    entityId: "specific-campaign",
    entityType: "campaign",
    eventType: "seed.campaign.created",
    id: "audit-seed-specific-campaign",
    metadata: JSON.stringify({ baseline: "issue-2" }),
    reason: "Deterministic demo baseline for issue 2.",
    createdAt: BASELINE_TIMESTAMP
  }
] as const;
