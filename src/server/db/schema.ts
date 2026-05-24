import {
  boolean,
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

export const ideaSourceType = mysqlEnum("source_type", ["employee_submission", "seed_demo"]);

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
  sourceType: ideaSourceType.notNull(),
  submittedAt: timestamp("submitted_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow()
});

export const ideaWorkflowState = mysqlEnum("workflow_state", [
  "general_idea",
  "needs_employee_clarification",
  "ready_for_rd_review",
  "future_opportunity",
  "inactive_idea",
  "potential_idea"
]);

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

export const clarificationRequests = mysqlTable("clarification_requests", {
  id: varchar("id", { length: 64 }).primaryKey(),
  ideaId: varchar("idea_id", { length: 64 })
    .notNull()
    .references(() => ideas.id, { onDelete: "cascade" }),
  requestText: text("request_text").notNull(),
  status: clarificationStatus.notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  answeredAt: timestamp("answered_at"),
  answerText: text("answer_text"),
  createdAt: timestamp("created_at").notNull().defaultNow()
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
