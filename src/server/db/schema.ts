import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  department: varchar("department", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const roles = mysqlTable("roles", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const userRoles = mysqlTable(
  "user_roles",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: varchar("role_id", { length: 64 })
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })]
);

export const campaignType = mysqlEnum("type", ["general", "specific"]);
export const campaignLifecycleStatus = mysqlEnum("lifecycle_status", [
  "always_open",
  "draft",
  "setup_in_progress",
  "setup_review",
  "ready_to_open",
  "intake_scheduled",
  "intake_open",
  "intake_closed",
  "review_in_progress",
  "review_complete",
  "retrospective",
  "ended"
]);

export const campaigns = mysqlTable("campaigns", {
  id: varchar("id", { length: 64 }).primaryKey(),
  type: campaignType.notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  publicTitle: varchar("public_title", { length: 255 }).notNull(),
  publicPrompt: text("public_prompt").notNull(),
  publicExamples: text("public_examples"),
  previewVersion: int("preview_version").notNull().default(1),
  lifecycleStatus: campaignLifecycleStatus.notNull(),
  intakeStartsAt: timestamp("intake_starts_at"),
  intakeEndsAt: timestamp("intake_ends_at"),
  createdByUserId: varchar("created_by_user_id", { length: 64 })
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const campaignMembershipRole = mysqlEnum("membership_role", ["manager", "owner", "member"]);

export const campaignMemberships = mysqlTable(
  "campaign_memberships",
  {
    campaignId: varchar("campaign_id", { length: 64 })
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    membershipRole: campaignMembershipRole.notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.campaignId, table.userId, table.membershipRole] })]
);

const setupAreas = ["topic", "intent", "review_packet", "rules_memory", "final_review"] as const;

export const campaignSetupQuestions = mysqlTable("campaign_setup_questions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  setupArea: mysqlEnum("setup_area", setupAreas).notNull(),
  questionText: text("question_text").notNull(),
  rationale: text("rationale").notNull(),
  recommendedAnswer: text("recommended_answer"),
  priority: mysqlEnum("priority", ["hard_blocker", "warning", "clarity"]).notNull(),
  status: mysqlEnum("status", ["open", "answered", "dismissed"]).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const campaignSetupAnswers = mysqlTable("campaign_setup_answers", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  questionId: varchar("question_id", { length: 64 })
    .notNull()
    .references(() => campaignSetupQuestions.id, { onDelete: "cascade" }),
  authorUserId: varchar("author_user_id", { length: 64 })
    .notNull()
    .references(() => users.id),
  setupArea: mysqlEnum("setup_area", setupAreas).notNull(),
  decisionTitle: varchar("decision_title", { length: 255 }).notNull(),
  answerText: text("answer_text").notNull(),
  status: mysqlEnum("status", ["pending_owner_approval", "approved", "rejected"]).notNull(),
  isIntentionalAmbiguity: boolean("is_intentional_ambiguity").notNull().default(false),
  isContextOverride: boolean("is_context_override").notNull().default(false),
  ownerEditedByUserId: varchar("owner_edited_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  approvedByUserId: varchar("approved_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  approvedAt: timestamp("approved_at"),
  rejectedByUserId: varchar("rejected_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const campaignSetupDecisions = mysqlTable("campaign_setup_decisions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  sourceAnswerId: varchar("source_answer_id", { length: 64 }).references(() => campaignSetupAnswers.id, {
    onDelete: "set null"
  }),
  setupArea: mysqlEnum("setup_area", setupAreas).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  value: text("value").notNull(),
  isIntentionalAmbiguity: boolean("is_intentional_ambiguity").notNull().default(false),
  isContextOverride: boolean("is_context_override").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const campaignKnowledgeReports = mysqlTable("campaign_knowledge_reports", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  html: text("html").notNull(),
  status: mysqlEnum("status", ["draft", "approved", "stale"]).notNull(),
  generatedAt: timestamp("generated_at").notNull(),
  approvedByUserId: varchar("approved_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const generalCampaignReviewPackets = mysqlTable("general_campaign_review_packets", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  packetText: text("packet_text").notNull(),
  contextVersion: varchar("context_version", { length: 255 }).notNull(),
  createdByUserId: varchar("created_by_user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const ideaSourceType = mysqlEnum("source_type", ["employee_submission", "seed_demo"]);

export const ideaDrafts = mysqlTable("idea_drafts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ownerUserId: varchar("owner_user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  originalText: text("original_text").notNull(),
  problemOpportunity: text("problem_opportunity"),
  expectedBenefit: text("expected_benefit"),
  evidenceExample: text("evidence_example"),
  supportingLink: varchar("supporting_link", { length: 2048 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const ideas = mysqlTable("ideas", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  submitterUserId: varchar("submitter_user_id", { length: 64 })
    .notNull()
    .references(() => users.id),
  title: varchar("title", { length: 255 }).notNull(),
  originalText: text("original_text").notNull(),
  problemOpportunity: text("problem_opportunity"),
  expectedBenefit: text("expected_benefit"),
  evidenceExample: text("evidence_example"),
  supportingLink: varchar("supporting_link", { length: 2048 }),
  previewVersion: int("preview_version").notNull().default(1),
  previewTitle: varchar("preview_title", { length: 255 }).notNull().default(""),
  previewPrompt: text("preview_prompt"),
  previewExamples: text("preview_examples"),
  sourceType: ideaSourceType.notNull(),
  submittedAt: timestamp("submitted_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

const ideaWorkflowStates = [
  "submitted",
  "general_idea",
  "needs_employee_clarification",
  "ready_for_rd_review",
  "future_opportunity",
  "inactive_idea",
  "potential_idea"
] as const;

export const ideaWorkflowState = mysqlEnum("workflow_state", ideaWorkflowStates);

export const ideaStateHistory = mysqlTable("idea_state_history", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  workflowState: ideaWorkflowState.notNull(),
  reason: text("reason"),
  changedByUserId: varchar("changed_by_user_id", { length: 64 }).references(() => users.id, { onDelete: "set null" }),
  changedAt: timestamp("changed_at").notNull(),
  isCurrent: boolean("is_current").notNull().default(true)
});

export const clarificationStatus = mysqlEnum("status", ["pending", "answered", "expired", "cancelled"]);
export const clarificationEmailStatus = mysqlEnum("email_status", ["pending", "sent", "retry_required"]);

export const clarificationRequests = mysqlTable("clarification_requests", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  campaignContextId: varchar("campaign_context_id", { length: 64 }).references(() => campaigns.id, {
    onDelete: "set null"
  }),
  requestText: text("request_text").notNull(),
  status: clarificationStatus.notNull(),
  emailStatus: clarificationEmailStatus.notNull().default("pending"),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  emailTrackingId: varchar("email_tracking_id", { length: 255 }),
  emailError: text("email_error"),
  sentAt: timestamp("sent_at"),
  reminderSentAt: timestamp("reminder_sent_at"),
  reminderEmailTrackingId: varchar("reminder_email_tracking_id", { length: 255 }),
  expiresAt: timestamp("expires_at").notNull(),
  expiredAt: timestamp("expired_at"),
  assumptionText: text("assumption_text"),
  assumptionReason: text("assumption_reason"),
  assumptionRoutingDecision: varchar("assumption_routing_decision", { length: 64 }).$type<
    "future_opportunity" | "inactive_idea"
  >(),
  answeredAt: timestamp("answered_at"),
  answerText: text("answer_text"),
  supportingLink: varchar("supporting_link", { length: 2048 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const aiDecisionStatus = mysqlEnum("status", ["pending", "succeeded", "failed", "retry_required"]);

export const aiDecisionLogs = mysqlTable("ai_decision_logs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  purpose: varchar("purpose", { length: 128 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  status: aiDecisionStatus.notNull(),
  inputReference: text("input_reference").notNull(),
  outputSummary: text("output_summary"),
  rawResponse: json("raw_response").$type<Record<string, unknown> | null>(),
  decisionResult: json("decision_result").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const contextDocumentType = mysqlEnum("context_type", ["company", "global_innovation"]);
export const contextDocumentStatus = mysqlEnum("status", ["draft", "approved", "superseded"]);

export const contextDocuments = mysqlTable("context_documents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  contextType: contextDocumentType.notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  sourceMetadata: json("source_metadata").$type<Record<string, unknown> | null>(),
  status: contextDocumentStatus.notNull(),
  createdByUserId: varchar("created_by_user_id", { length: 64 })
    .notNull()
    .references(() => users.id),
  approvedByUserId: varchar("approved_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const globalContextProposalStatus = mysqlEnum("status", [
  "pending_manager_approval",
  "approved",
  "rejected"
]);

export const globalContextChangeProposals = mysqlTable("global_context_change_proposals", {
  id: varchar("id", { length: 64 }).primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  rationale: text("rationale").notNull(),
  proposedByUserId: varchar("proposed_by_user_id", { length: 64 })
    .notNull()
    .references(() => users.id),
  status: globalContextProposalStatus.notNull(),
  approvedContextId: varchar("approved_context_id", { length: 64 }).references(() => contextDocuments.id, {
    onDelete: "set null"
  }),
  decidedByUserId: varchar("decided_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  decidedAt: timestamp("decided_at"),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const contextImpactLevel = mysqlEnum("impact_level", [
  "no_impact",
  "active_alert",
  "draft_warning",
  "draft_hard_blocker"
]);

export const contextImpactChecks = mysqlTable("context_impact_checks", {
  id: varchar("id", { length: 64 }).primaryKey(),
  sourceContextId: varchar("source_context_id", { length: 64 })
    .notNull()
    .references(() => contextDocuments.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  aiDecisionLogId: varchar("ai_decision_log_id", { length: 64 }).references(() => aiDecisionLogs.id, {
    onDelete: "set null"
  }),
  impactLevel: contextImpactLevel.notNull(),
  summary: text("summary").notNull(),
  recommendedResolution: text("recommended_resolution").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const contextChangeAlertStatus = mysqlEnum("status", ["open", "resolved"]);
export const contextChangeAlertResolution = mysqlEnum("resolution_type", [
  "no_impact",
  "update_campaign_context",
  "campaign_context_override",
  "follow_up_question",
  "escalate_to_manager"
]);

export const contextChangeAlerts = mysqlTable("context_change_alerts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  impactCheckId: varchar("impact_check_id", { length: 64 })
    .notNull()
    .references(() => contextImpactChecks.id, { onDelete: "cascade" }),
  sourceContextId: varchar("source_context_id", { length: 64 })
    .notNull()
    .references(() => contextDocuments.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  status: contextChangeAlertStatus.notNull(),
  summary: text("summary").notNull(),
  recommendedResolution: text("recommended_resolution").notNull(),
  resolutionType: contextChangeAlertResolution,
  resolutionNote: text("resolution_note"),
  resolvedByUserId: varchar("resolved_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const routingTrigger = mysqlEnum("trigger", [
  "initial_route",
  "campaign_context_recheck",
  "general_context_recheck"
]);
export const reviewPacketStatus = mysqlEnum("review_packet_status", [
  "ready",
  "missing_critical_info",
  "not_applicable"
]);

export const ideaRoutingDecisions = mysqlTable("idea_routing_decisions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  aiDecisionLogId: varchar("ai_decision_log_id", { length: 64 }).references(() => aiDecisionLogs.id, {
    onDelete: "set null"
  }),
  trigger: routingTrigger.notNull(),
  oldWorkflowState: mysqlEnum("old_workflow_state", ideaWorkflowStates).notNull(),
  newWorkflowState: mysqlEnum("new_workflow_state", ideaWorkflowStates).notNull(),
  oldReason: text("old_reason"),
  newReason: text("new_reason").notNull(),
  reviewPacketStatus: reviewPacketStatus.notNull(),
  readinessBasis: text("readiness_basis").notNull(),
  outOfScopeMatched: boolean("out_of_scope_matched").notNull().default(false),
  outOfScopeReason: text("out_of_scope_reason"),
  contextVersion: varchar("context_version", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const ideaFamilies = mysqlTable("idea_families", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  primaryIdeaId: varchar("primary_idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const ideaFamilyRelationshipType = mysqlEnum("relationship_type", [
  "primary",
  "exact_duplicate",
  "related_submission",
  "variant"
]);

export const ideaFamilyMembers = mysqlTable(
  "idea_family_members",
  {
    familyId: varchar("family_id", { length: 64 })
      .notNull()
      .references(() => ideaFamilies.id, { onDelete: "cascade" }),
    ideaId: varchar("idea_id", { length: 64 })
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    relationshipType: ideaFamilyRelationshipType.notNull(),
    variantDifference: text("variant_difference"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.familyId, table.ideaId] })]
);

export type IdeaSummarySourceTrace = Array<{
  clarificationRequestId: string | null;
  excerpt: string;
  ideaId: string;
  sourceType: "original_submission" | "clarification_answer";
}>;

export const ideaReviewSummaries = mysqlTable("idea_review_summaries", {
  id: varchar("id", { length: 64 }).primaryKey(),
  familyId: varchar("family_id", { length: 64 })
    .notNull()
    .references(() => ideaFamilies.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  aiDecisionLogId: varchar("ai_decision_log_id", { length: 64 }).references(() => aiDecisionLogs.id, {
    onDelete: "set null"
  }),
  requestedByUserId: varchar("requested_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  version: int("version").notNull(),
  summaryText: text("summary_text").notNull(),
  sourceTrace: json("source_trace").$type<IdeaSummarySourceTrace>().notNull(),
  aiReason: text("ai_reason").notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const reviewOutcomeValues = [
  "potential_idea",
  "future_opportunity",
  "inactive_idea"
] as const;

export type ReviewOutcomeValue = (typeof reviewOutcomeValues)[number];

export const ideaRankings = mysqlTable("idea_rankings", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  familyId: varchar("family_id", { length: 64 }).references(() => ideaFamilies.id, { onDelete: "set null" }),
  rankPosition: int("rank_position").notNull(),
  rankReasons: json("rank_reasons").$type<string[]>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const ideaClassificationGroupType = mysqlEnum("group_type", [
  "standard",
  "single_idea",
  "emerging_theme"
]);

export const ideaClassificationGroups = mysqlTable("idea_classification_groups", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  groupType: ideaClassificationGroupType.notNull(),
  summaryText: text("summary_text").notNull(),
  contextVersion: varchar("context_version", { length: 255 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  rankPosition: int("rank_position"),
  rankingContextVersion: varchar("ranking_context_version", { length: 255 }),
  rankedAt: timestamp("ranked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const ideaCampaignAssociationType = mysqlEnum("association_type", ["submitted", "pulled_in"]);

export const ideaCampaignAssociations = mysqlTable("idea_campaign_associations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  associationType: ideaCampaignAssociationType.notNull(),
  sourceWorkflowState: mysqlEnum("source_workflow_state", ideaWorkflowStates).notNull(),
  fitBasis: text("fit_basis").notNull(),
  routingBasis: text("routing_basis").notNull(),
  contextVersion: varchar("context_version", { length: 255 }).notNull(),
  clarificationAllowed: boolean("clarification_allowed").notNull().default(false),
  clarificationReason: text("clarification_reason"),
  clarificationRequestId: varchar("clarification_request_id", { length: 64 }).references(() => clarificationRequests.id, {
    onDelete: "set null"
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const ideaClassificationGroupMembers = mysqlTable(
  "idea_classification_group_members",
  {
    groupId: varchar("group_id", { length: 64 })
      .notNull()
      .references(() => ideaClassificationGroups.id, { onDelete: "cascade" }),
    ideaId: varchar("idea_id", { length: 64 })
      .notNull()
      .references(() => ideas.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    placementReason: text("placement_reason").notNull(),
    contextVersion: varchar("context_version", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
  },
  (table) => [primaryKey({ columns: [table.groupId, table.ideaId] })]
);

export const ideaReviewRecommendations = mysqlTable("idea_review_recommendations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  familyId: varchar("family_id", { length: 64 }).references(() => ideaFamilies.id, { onDelete: "set null" }),
  recommendedOutcome: mysqlEnum("recommended_outcome", reviewOutcomeValues).notNull(),
  reasonTag: varchar("reason_tag", { length: 64 }).notNull(),
  reasonNote: text("reason_note"),
  recommendedByUserId: varchar("recommended_by_user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const ideaReviewOutcomes = mysqlTable("idea_review_outcomes", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  familyId: varchar("family_id", { length: 64 }).references(() => ideaFamilies.id, { onDelete: "set null" }),
  outcome: mysqlEnum("outcome", reviewOutcomeValues).notNull(),
  reasonTag: varchar("reason_tag", { length: 64 }).notNull(),
  reasonNote: text("reason_note"),
  decidedByUserId: varchar("decided_by_user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  decidedAt: timestamp("decided_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const reviewDigestCadence = mysqlEnum("cadence", ["daily", "weekly"]);
export const reviewDigestItemType = mysqlEnum("item_type", [
  "new_review_ready",
  "clarification_expiring",
  "major_routing_change",
  "rerank_summary"
]);

export const reviewDigests = mysqlTable("review_digests", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  cadence: reviewDigestCadence.notNull(),
  windowStartedAt: timestamp("window_started_at").notNull(),
  windowEndedAt: timestamp("window_ended_at").notNull(),
  generatedAt: timestamp("generated_at").notNull(),
  summary: text("summary").notNull(),
  itemCount: int("item_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const reviewDigestItems = mysqlTable("review_digest_items", {
  id: varchar("id", { length: 64 }).primaryKey(),
  digestId: varchar("digest_id", { length: 64 })
    .notNull()
    .references(() => reviewDigests.id, { onDelete: "cascade" }),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  itemType: reviewDigestItemType.notNull(),
  ideaId: varchar("idea_id", { length: 64 }).references(() => ideas.id, { onDelete: "set null" }),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  linkLabel: varchar("link_label", { length: 128 }).notNull(),
  linkHref: varchar("link_href", { length: 255 }).notNull(),
  sortOrder: int("sort_order").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const returnedIdeaLineage = mysqlTable("returned_idea_lineage", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  fromCampaignId: varchar("from_campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  toCampaignId: varchar("to_campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  originalWorkflowState: mysqlEnum("original_workflow_state", ideaWorkflowStates).notNull(),
  returnedWorkflowState: mysqlEnum("returned_workflow_state", ideaWorkflowStates).notNull(),
  returnReasonTag: varchar("return_reason_tag", { length: 64 }).notNull(),
  returnReason: text("return_reason").notNull(),
  returnedByUserId: varchar("returned_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  returnedAt: timestamp("returned_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const campaignRetrospectiveStatus = mysqlEnum("status", ["skipped", "started", "completed"]);

export const campaignRetrospectives = mysqlTable("campaign_retrospectives", {
  id: varchar("id", { length: 64 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  status: campaignRetrospectiveStatus.notNull(),
  questionText: text("question_text").notNull(),
  answerText: text("answer_text"),
  campaignLearning: text("campaign_learning"),
  evidenceSummary: text("evidence_summary"),
  aiDecisionLogId: varchar("ai_decision_log_id", { length: 64 }).references(() => aiDecisionLogs.id, {
    onDelete: "set null"
  }),
  startedByUserId: varchar("started_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  startedAt: timestamp("started_at"),
  completedByUserId: varchar("completed_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  completedAt: timestamp("completed_at"),
  skippedByUserId: varchar("skipped_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  skippedAt: timestamp("skipped_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const globalContextProposalTarget = mysqlEnum("target_context", [
  "company_context",
  "global_innovation_context"
]);

export const retrospectiveGlobalContextProposals = mysqlTable("retrospective_global_context_proposals", {
  id: varchar("id", { length: 64 }).primaryKey(),
  sourceCampaignId: varchar("source_campaign_id", { length: 64 })
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  sourceRetrospectiveId: varchar("source_retrospective_id", { length: 64 }).references(
    () => campaignRetrospectives.id,
    {
      onDelete: "set null"
    }
  ),
  targetContext: globalContextProposalTarget.notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  proposedChange: text("proposed_change").notNull(),
  evidenceSummary: text("evidence_summary").notNull(),
  status: globalContextProposalStatus.notNull(),
  createdByUserId: varchar("created_by_user_id", { length: 64 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  decidedByUserId: varchar("decided_by_user_id", { length: 64 }).references(() => users.id, {
    onDelete: "set null"
  }),
  decidedAt: timestamp("decided_at"),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow()
});

export const auditActorType = mysqlEnum("actor_type", ["user", "system", "ai"]);

export const auditEvents = mysqlTable("audit_events", {
  id: varchar("id", { length: 64 }).primaryKey(),
  actorType: auditActorType.notNull(),
  actorUserId: varchar("actor_user_id", { length: 64 }).references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  entityType: varchar("entity_type", { length: 128 }).notNull(),
  entityId: varchar("entity_id", { length: 64 }).notNull(),
  reason: text("reason"),
  metadata: json("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
