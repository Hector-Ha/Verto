import crypto from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { canContributeToCampaign, canManageCampaignLifecycle, canManageGeneralCampaign } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  auditEvents,
  campaignKnowledgeReports,
  campaignMemberships,
  campaigns,
  ideaRoutingDecisions,
  ideaStateHistory,
  ideas,
  users
} from "../db/schema";
import { getLlmModel } from "../env";
import { callStructuredTool, LlmInvalidResponseError, LlmProviderError, type LlmProvider } from "../llm/adapter";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type JsonRecord = Record<string, unknown>;
type RoutingDecision = "ready_for_rd_review" | "needs_employee_clarification" | "future_opportunity" | "inactive_idea";
type ReviewPacketStatus = "ready" | "missing_critical_info" | "not_applicable";
type RoutingTrigger = "initial_route" | "campaign_context_recheck" | "general_context_recheck";

type RoutingOptions = {
  contextVersion?: string;
  now?: Date;
  provider?: LlmProvider;
  trigger?: RoutingTrigger;
};

type ParsedRoutingDecision = {
  outOfScopeMatched: boolean;
  outOfScopeReason: string | null;
  readinessBasis: string;
  reviewPacketStatus: ReviewPacketStatus;
  routingDecision: RoutingDecision;
  routingReason: string;
};

const routingPurpose = "pre_rd_routing.route";
const routingTool = {
  description: "Record one validated pre-R&D routing decision for a Verto idea.",
  name: "record_pre_rd_routing_decision",
  parameters: {
    additionalProperties: false,
    properties: {
      outOfScopeMatched: {
        description: "True only when a clear R&D out-of-scope pattern makes employee clarification unnecessary.",
        type: "boolean"
      },
      outOfScopeReason: {
        description: "Matched out-of-scope evidence or null.",
        type: ["string", "null"]
      },
      readinessBasis: {
        description:
          "Explain review packet readiness as an information gate only. Do not judge idea quality, rank, or value.",
        type: "string"
      },
      reviewPacketStatus: {
        enum: ["ready", "missing_critical_info", "not_applicable"],
        type: "string"
      },
      routingDecision: {
        enum: ["ready_for_rd_review", "needs_employee_clarification", "future_opportunity", "inactive_idea"],
        type: "string"
      },
      routingReason: {
        description: "Internal reason for the routing decision.",
        type: "string"
      }
    },
    required: [
      "outOfScopeMatched",
      "outOfScopeReason",
      "readinessBasis",
      "reviewPacketStatus",
      "routingDecision",
      "routingReason"
    ],
    type: "object"
  }
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function readRequiredString(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LlmInvalidResponseError(`LLM routing result is missing ${key}.`, rawResponse, value);
  }

  return raw.trim();
}

function readNullableString(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new LlmInvalidResponseError(`LLM routing result has invalid ${key}.`, rawResponse, value);
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function readRequiredBoolean(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (typeof raw !== "boolean") {
    throw new LlmInvalidResponseError(`LLM routing result is missing ${key}.`, rawResponse, value);
  }

  return raw;
}

function readRoutingDecision(value: JsonRecord, rawResponse: JsonRecord | null): RoutingDecision {
  const raw = value.routingDecision;
  if (
    raw === "ready_for_rd_review" ||
    raw === "needs_employee_clarification" ||
    raw === "future_opportunity" ||
    raw === "inactive_idea"
  ) {
    return raw;
  }

  throw new LlmInvalidResponseError("LLM routing result used an unsupported routing decision.", rawResponse, value);
}

function readReviewPacketStatus(value: JsonRecord, rawResponse: JsonRecord | null): ReviewPacketStatus {
  const raw = value.reviewPacketStatus;
  if (raw === "ready" || raw === "missing_critical_info" || raw === "not_applicable") {
    return raw;
  }

  throw new LlmInvalidResponseError("LLM routing result used an unsupported review packet status.", rawResponse, value);
}

function parseRoutingDecision(argumentsValue: JsonRecord, rawResponse: JsonRecord | null): ParsedRoutingDecision {
  const routingDecision = readRoutingDecision(argumentsValue, rawResponse);
  const reviewPacketStatus = readReviewPacketStatus(argumentsValue, rawResponse);
  const outOfScopeMatched = readRequiredBoolean(argumentsValue, "outOfScopeMatched", rawResponse);

  if (routingDecision === "ready_for_rd_review" && reviewPacketStatus !== "ready") {
    throw new LlmInvalidResponseError("Ready for R&D Review requires a ready information gate.", rawResponse, argumentsValue);
  }

  if (routingDecision === "needs_employee_clarification" && reviewPacketStatus !== "missing_critical_info") {
    throw new LlmInvalidResponseError(
      "Needs Employee Clarification requires missing critical packet information.",
      rawResponse,
      argumentsValue
    );
  }

  if (outOfScopeMatched && routingDecision !== "inactive_idea") {
    throw new LlmInvalidResponseError("Out-of-scope matches must route to Inactive Idea.", rawResponse, argumentsValue);
  }

  return {
    outOfScopeMatched,
    outOfScopeReason: readNullableString(argumentsValue, "outOfScopeReason", rawResponse),
    readinessBasis: readRequiredString(argumentsValue, "readinessBasis", rawResponse),
    reviewPacketStatus,
    routingDecision,
    routingReason: readRequiredString(argumentsValue, "routingReason", rawResponse)
  };
}

async function readIdeaContext(ideaId: string) {
  const [row] = await db
    .select({
      campaignId: ideas.campaignId,
      campaignLifecycleStatus: campaigns.lifecycleStatus,
      campaignPrompt: campaigns.publicPrompt,
      campaignTitle: campaigns.publicTitle,
      campaignType: campaigns.type,
      campaignPreviewVersion: campaigns.previewVersion,
      currentReason: ideaStateHistory.reason,
      currentWorkflowState: ideaStateHistory.workflowState,
      evidenceExample: ideas.evidenceExample,
      expectedBenefit: ideas.expectedBenefit,
      ideaId: ideas.id,
      originalText: ideas.originalText,
      previewPrompt: ideas.previewPrompt,
      previewTitle: ideas.previewTitle,
      problemOpportunity: ideas.problemOpportunity,
      submittedAt: ideas.submittedAt,
      submitterDepartment: users.department,
      supportingLink: ideas.supportingLink,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .innerJoin(users, eq(users.id, ideas.submitterUserId))
    .leftJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
    .where(eq(ideas.id, ideaId))
    .limit(1);

  if (!row || !row.currentWorkflowState) {
    throw new Error("Idea not found.");
  }

  return row;
}

async function assertCanRouteIdea(session: DemoSession, idea: Awaited<ReturnType<typeof readIdeaContext>>) {
  if (idea.campaignType === "general") {
    if (!(await canManageGeneralCampaign(session))) {
      throw new Error("Only General Campaign owners can route General Campaign ideas.");
    }
    return;
  }

  if (!(await canContributeToCampaign(session, idea.campaignId))) {
    throw new Error("Only campaign R&D members can route campaign ideas.");
  }
}

async function assertSpecificCampaignManager(session: DemoSession, campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign || campaign.type !== "specific") {
    throw new Error("Specific campaign not found.");
  }

  if (!(await canManageCampaignLifecycle(session, campaignId))) {
    throw new Error("Only the R&D Manager or Campaign Owner can recheck campaign routing.");
  }
}

async function resolveContextVersion(idea: Awaited<ReturnType<typeof readIdeaContext>>, contextVersion?: string) {
  if (contextVersion?.trim()) {
    return contextVersion.trim();
  }

  const [report] = await db
    .select({ id: campaignKnowledgeReports.id })
    .from(campaignKnowledgeReports)
    .where(and(eq(campaignKnowledgeReports.campaignId, idea.campaignId), eq(campaignKnowledgeReports.status, "approved")))
    .orderBy(desc(campaignKnowledgeReports.generatedAt))
    .limit(1);

  return report?.id ?? `${idea.campaignId}:preview-${idea.campaignPreviewVersion}`;
}

function routingInputReference(input: {
  contextVersion: string;
  idea: Awaited<ReturnType<typeof readIdeaContext>>;
  trigger: RoutingTrigger;
}) {
  return JSON.stringify({
    campaignId: input.idea.campaignId,
    contextVersion: input.contextVersion,
    ideaId: input.idea.ideaId,
    source: "pre_rd_routing",
    trigger: input.trigger
  });
}

async function generateRoutingDecision(
  idea: Awaited<ReturnType<typeof readIdeaContext>>,
  contextVersion: string,
  trigger: RoutingTrigger,
  provider?: LlmProvider
) {
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "You perform Verto pre-R&D routing before an idea enters R&D review.",
          "Use campaign context and employee source material only.",
          "Minimum Review Packet readiness is an information gate, not a quality judgment.",
          "Do not rank, score, or call the idea good or bad.",
          "For specific campaign submissions, never detach the idea from the submitted campaign.",
          "Choose ready_for_rd_review only when critical review packet information is present.",
          "Choose needs_employee_clarification when critical information is missing.",
          "Choose future_opportunity when the idea may be useful later but should not enter current review.",
          "Choose inactive_idea when evidence is weak, poor fit, duplicate/covered, or clearly out of scope.",
          "When a clear out-of-scope pattern matches, route inactive_idea and avoid employee clarification."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          campaign: {
            contextVersion,
            lifecycleStatus: idea.campaignLifecycleStatus,
            prompt: idea.previewPrompt ?? idea.campaignPrompt,
            title: idea.previewTitle ?? idea.campaignTitle,
            type: idea.campaignType
          },
          idea: {
            currentReason: idea.currentReason,
            currentWorkflowState: idea.currentWorkflowState,
            evidenceExample: idea.evidenceExample,
            expectedBenefit: idea.expectedBenefit,
            originalText: idea.originalText,
            problemOpportunity: idea.problemOpportunity,
            submittedAt: idea.submittedAt.toISOString(),
            submitterDepartment: idea.submitterDepartment,
            supportingLink: idea.supportingLink,
            title: idea.title
          },
          trigger
        }),
        role: "user"
      }
    ],
    provider,
    tool: routingTool
  });

  return {
    decision: parseRoutingDecision(result.arguments, result.rawResponse),
    model: result.model,
    rawResponse: result.rawResponse
  };
}

async function writeAiRoutingLog(input: {
  decisionResult: JsonRecord | null;
  inputReference: string;
  model: string;
  outputSummary: string | null;
  rawResponse: JsonRecord | null;
  status: "succeeded" | "retry_required";
}) {
  const logId = newId("ai-log");
  await db.insert(aiDecisionLogs).values({
    createdAt: new Date(),
    decisionResult: input.decisionResult,
    id: logId,
    inputReference: input.inputReference,
    model: input.model,
    outputSummary: input.outputSummary,
    purpose: routingPurpose,
    rawResponse: input.rawResponse,
    status: input.status
  });

  return logId;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Pre-R&D routing failed.";
}

function getErrorRawResponse(error: unknown) {
  if (error instanceof LlmProviderError || error instanceof LlmInvalidResponseError) {
    return error.rawResponse;
  }

  return { error: getErrorMessage(error) };
}

function getErrorDecisionResult(error: unknown) {
  if (error instanceof LlmInvalidResponseError) {
    return error.parsedResult;
  }

  return null;
}

async function writeRoutingAudit(
  tx: DbTransaction,
  input: {
    contextVersion: string;
    ideaId: string;
    newWorkflowState: RoutingDecision;
    oldWorkflowState: (typeof ideaStateHistory.$inferSelect)["workflowState"];
    reason: string;
    trigger: RoutingTrigger;
  }
) {
  await tx.insert(auditEvents).values({
    actorType: "ai",
    actorUserId: null,
    createdAt: new Date(),
    entityId: input.ideaId,
    entityType: "idea",
    eventType: "idea.routing.changed",
    id: newId("audit"),
    metadata: {
      contextVersion: input.contextVersion,
      from: input.oldWorkflowState,
      to: input.newWorkflowState,
      trigger: input.trigger
    },
    reason: input.reason
  });
}

async function applyRoutingDecision(input: {
  aiDecisionLogId: string;
  contextVersion: string;
  decision: ParsedRoutingDecision;
  ideaId: string;
  now: Date;
  trigger: RoutingTrigger;
}) {
  await db.transaction(async (tx) => {
    const [idea] = await tx
      .select({
        campaignId: ideas.campaignId,
        currentReason: ideaStateHistory.reason,
        currentStateId: ideaStateHistory.id,
        currentWorkflowState: ideaStateHistory.workflowState
      })
      .from(ideas)
      .leftJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
      .where(eq(ideas.id, input.ideaId))
      .limit(1)
      .for("update");

    if (!idea || !idea.currentStateId || !idea.currentWorkflowState) {
      throw new Error("Idea not found.");
    }
    if (idea.currentWorkflowState === "potential_idea") {
      throw new Error("Potential Ideas have left the Idea Filter Pipeline.");
    }

    await tx.update(ideaStateHistory).set({ isCurrent: false }).where(eq(ideaStateHistory.id, idea.currentStateId));
    await tx.insert(ideaStateHistory).values({
      changedAt: input.now,
      changedByUserId: null,
      ideaId: input.ideaId,
      id: newId("idea-state"),
      isCurrent: true,
      reason: input.decision.routingReason,
      workflowState: input.decision.routingDecision
    });
    await tx.insert(ideaRoutingDecisions).values({
      aiDecisionLogId: input.aiDecisionLogId,
      campaignId: idea.campaignId,
      contextVersion: input.contextVersion,
      createdAt: input.now,
      id: newId("idea-routing"),
      ideaId: input.ideaId,
      newReason: input.decision.routingReason,
      newWorkflowState: input.decision.routingDecision,
      oldReason: idea.currentReason,
      oldWorkflowState: idea.currentWorkflowState,
      outOfScopeMatched: input.decision.outOfScopeMatched,
      outOfScopeReason: input.decision.outOfScopeReason,
      readinessBasis: input.decision.readinessBasis,
      reviewPacketStatus: input.decision.reviewPacketStatus,
      trigger: input.trigger
    });
    await writeRoutingAudit(tx, {
      contextVersion: input.contextVersion,
      ideaId: input.ideaId,
      newWorkflowState: input.decision.routingDecision,
      oldWorkflowState: idea.currentWorkflowState,
      reason: input.decision.routingReason,
      trigger: input.trigger
    });
  });
}

export async function routeIdeaBeforeRdReview(session: DemoSession, ideaId: string, options: RoutingOptions = {}) {
  const idea = await readIdeaContext(ideaId);
  await assertCanRouteIdea(session, idea);

  const trigger = options.trigger ?? "initial_route";
  const contextVersion = await resolveContextVersion(idea, options.contextVersion);
  const inputReference = routingInputReference({ contextVersion, idea, trigger });
  const model = getLlmModel();
  let routing: Awaited<ReturnType<typeof generateRoutingDecision>>;

  try {
    routing = await generateRoutingDecision(idea, contextVersion, trigger, options.provider);
  } catch (error) {
    await writeAiRoutingLog({
      decisionResult: getErrorDecisionResult(error),
      inputReference,
      model,
      outputSummary: getErrorMessage(error),
      rawResponse: getErrorRawResponse(error),
      status: "retry_required"
    });

    return {
      reason: getErrorMessage(error),
      status: "retry_required" as const
    };
  }

  const logId = await writeAiRoutingLog({
    decisionResult: {
      outOfScopeMatched: routing.decision.outOfScopeMatched,
      outOfScopeReason: routing.decision.outOfScopeReason,
      readinessBasis: routing.decision.readinessBasis,
      reviewPacketStatus: routing.decision.reviewPacketStatus,
      routingDecision: routing.decision.routingDecision,
      routingReason: routing.decision.routingReason
    },
    inputReference,
    model: routing.model,
    outputSummary: routing.decision.routingReason,
    rawResponse: routing.rawResponse,
    status: "succeeded"
  });

  await applyRoutingDecision({
    aiDecisionLogId: logId,
    contextVersion,
    decision: routing.decision,
    ideaId: idea.ideaId,
    now: options.now ?? new Date(),
    trigger
  });

  return {
    contextVersion,
    routingDecision: routing.decision.routingDecision,
    status: "routed" as const
  };
}

function metadataIdeaId(metadata: Record<string, unknown> | null) {
  return typeof metadata?.ideaId === "string" ? metadata.ideaId : null;
}

async function reviewedIdeaIdsForCampaign(campaignId: string) {
  const rows = await db
    .select({ metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityId, campaignId),
        eq(auditEvents.entityType, "campaign"),
        eq(auditEvents.eventType, "campaign.review_outcome.recorded")
      )
    );

  return new Set(rows.map((row) => metadataIdeaId(row.metadata)).filter((id): id is string => Boolean(id)));
}

async function recheckCandidates(campaignId: string) {
  const [rows, reviewedIds] = await Promise.all([
    db
      .select({
        currentWorkflowState: ideaStateHistory.workflowState,
        ideaId: ideas.id
      })
      .from(ideas)
      .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
      .where(eq(ideas.campaignId, campaignId)),
    reviewedIdeaIdsForCampaign(campaignId)
  ]);

  const candidates: string[] = [];
  let skippedReviewedCount = 0;

  for (const row of rows) {
    if (reviewedIds.has(row.ideaId) || row.currentWorkflowState === "potential_idea") {
      skippedReviewedCount += 1;
      continue;
    }
    candidates.push(row.ideaId);
  }

  return {
    candidates,
    skippedReviewedCount
  };
}

async function runRoutingRecheck(
  session: DemoSession,
  campaignId: string,
  trigger: Extract<RoutingTrigger, "campaign_context_recheck" | "general_context_recheck">,
  options: Omit<RoutingOptions, "trigger"> = {}
) {
  const { candidates, skippedReviewedCount } = await recheckCandidates(campaignId);
  let routedCount = 0;
  let retryRequiredCount = 0;

  for (const ideaId of candidates) {
    const result = await routeIdeaBeforeRdReview(session, ideaId, {
      ...options,
      trigger
    });

    if (result.status === "routed") {
      routedCount += 1;
    } else {
      retryRequiredCount += 1;
    }
  }

  return {
    retryRequiredCount,
    routedCount,
    skippedReviewedCount
  };
}

export async function runCampaignRoutingRecheck(
  session: DemoSession,
  campaignId: string,
  options: Omit<RoutingOptions, "trigger"> = {}
) {
  await assertSpecificCampaignManager(session, campaignId);

  return runRoutingRecheck(session, campaignId, "campaign_context_recheck", options);
}

export async function runGeneralCampaignRoutingRecheck(session: DemoSession, options: Omit<RoutingOptions, "trigger"> = {}) {
  if (!(await canManageGeneralCampaign(session))) {
    throw new Error("Only General Campaign owners can recheck General Campaign routing.");
  }

  return runRoutingRecheck(session, "general-campaign", "general_context_recheck", options);
}

export async function getAccessibleRoutingReviewView(session: DemoSession) {
  if (session.role.id === "employee") {
    throw new Error("Only R&D users can inspect pre-R&D routing.");
  }

  return db
    .select({
      campaignTitle: campaigns.publicTitle,
      contextVersion: ideaRoutingDecisions.contextVersion,
      createdAt: ideaRoutingDecisions.createdAt,
      ideaId: ideas.id,
      ideaTitle: ideas.title,
      newReason: ideaRoutingDecisions.newReason,
      newWorkflowState: ideaRoutingDecisions.newWorkflowState,
      oldReason: ideaRoutingDecisions.oldReason,
      oldWorkflowState: ideaRoutingDecisions.oldWorkflowState,
      outOfScopeMatched: ideaRoutingDecisions.outOfScopeMatched,
      outOfScopeReason: ideaRoutingDecisions.outOfScopeReason,
      readinessBasis: ideaRoutingDecisions.readinessBasis,
      reviewPacketStatus: ideaRoutingDecisions.reviewPacketStatus,
      routingDecisionId: ideaRoutingDecisions.id,
      trigger: ideaRoutingDecisions.trigger
    })
    .from(ideaRoutingDecisions)
    .innerJoin(ideas, eq(ideas.id, ideaRoutingDecisions.ideaId))
    .innerJoin(campaigns, eq(campaigns.id, ideaRoutingDecisions.campaignId))
    .innerJoin(
      campaignMemberships,
      and(
        eq(campaignMemberships.campaignId, ideaRoutingDecisions.campaignId),
        eq(campaignMemberships.userId, session.user.id)
      )
    )
    .orderBy(desc(ideaRoutingDecisions.createdAt));
}

export async function getAccessibleRoutingCandidateIdeas(session: DemoSession) {
  if (session.role.id === "employee") {
    return [];
  }

  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaignTitle: campaigns.publicTitle,
      campaignType: campaigns.type,
      currentWorkflowState: ideaStateHistory.workflowState,
      ideaId: ideas.id,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .innerJoin(campaignMemberships, and(eq(campaignMemberships.campaignId, ideas.campaignId), eq(campaignMemberships.userId, session.user.id)))
    .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
    .orderBy(desc(ideas.createdAt));

  return Array.from(
    new Map(
      rows
        .filter((row) => row.currentWorkflowState !== "potential_idea")
        .map((row) => [`${row.campaignId}:${row.ideaId}`, row])
    ).values()
  );
}
