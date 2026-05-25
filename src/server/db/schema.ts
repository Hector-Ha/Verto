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
