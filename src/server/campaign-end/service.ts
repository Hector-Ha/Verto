import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { canManageCampaignLifecycle } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  auditEvents,
  campaignKnowledgeReports,
  campaignMemberships,
  campaignRetrospectives,
  campaigns,
  retrospectiveGlobalContextProposals,
  ideaStateHistory,
  ideas,
  returnedIdeaLineage
} from "../db/schema";
import { getLlmModel } from "../env";
import {
  callStructuredTool,
  LlmInvalidResponseError,
  LlmProviderError,
  type LlmProvider
} from "../llm/adapter";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type WorkflowState = (typeof ideaStateHistory.$inferSelect)["workflowState"];
type RetrospectiveTargetContext = "company_context" | "global_innovation_context" | "none";
type JsonRecord = Record<string, unknown>;

type EndCampaignInput = {
  inactiveIdeaIds?: string[];
  now?: Date;
};

type RetrospectiveInput = {
  learningText: string;
  now?: Date;
  provider?: LlmProvider;
};

type ParsedRetrospective = {
  campaignLearning: string;
  evidenceSummary: string;
  proposalText: string | null;
  proposalTitle: string | null;
  targetContext: RetrospectiveTargetContext;
};

const generalCampaignId = "general-campaign";
const endableStatuses = ["review_in_progress", "review_complete", "retrospective", "ended"] as const;
const retrospectiveQuestion =
  "What campaign learning should stay campaign-specific, and what, if anything, should be proposed for Global Innovation Context?";
const retrospectivePurpose = "campaign_retrospective.learning";
const retrospectiveTool = {
  description: "Record end-of-campaign learning and an optional broad context proposal.",
  name: "record_campaign_retrospective_learning",
  parameters: {
    additionalProperties: false,
    properties: {
      campaignLearning: {
        description: "Concise learning from this campaign that should remain on the campaign record.",
        type: "string"
      },
      evidenceSummary: {
        description: "Short evidence summary based on campaign outcomes and returned idea lineage.",
        type: "string"
      },
      proposalText: {
        description: "Proposed Company Context or Global Innovation Context change, or null when no broad change is needed.",
        type: ["string", "null"]
      },
      proposalTitle: {
        description: "Short proposal title, or null when no broad change is needed.",
        type: ["string", "null"]
      },
      targetContext: {
        description: "Broad context target that requires R&D Manager approval, or none.",
        enum: ["company_context", "global_innovation_context", "none"],
        type: "string"
      }
    },
    required: ["campaignLearning", "evidenceSummary", "proposalText", "proposalTitle", "targetContext"],
    type: "object"
  }
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

function readRequiredString(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LlmInvalidResponseError(`LLM retrospective result is missing ${key}.`, rawResponse, value);
  }

  return raw.trim();
}

function readOptionalString(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new LlmInvalidResponseError(`LLM retrospective result has invalid ${key}.`, rawResponse, value);
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function readTargetContext(value: JsonRecord, rawResponse: JsonRecord | null): RetrospectiveTargetContext {
  const raw = value.targetContext;
  if (raw === "company_context" || raw === "global_innovation_context" || raw === "none") {
    return raw;
  }

  throw new LlmInvalidResponseError("LLM retrospective result used unsupported targetContext.", rawResponse, value);
}

function parseRetrospective(argumentsValue: JsonRecord, rawResponse: JsonRecord | null): ParsedRetrospective {
  const targetContext = readTargetContext(argumentsValue, rawResponse);
  const proposalTitle = readOptionalString(argumentsValue, "proposalTitle", rawResponse);
  const proposalText = readOptionalString(argumentsValue, "proposalText", rawResponse);

  if (targetContext !== "none" && (!proposalTitle || !proposalText)) {
    throw new LlmInvalidResponseError(
      "LLM retrospective result must include proposal title and text for broad context changes.",
      rawResponse,
      argumentsValue
    );
  }

  return {
    campaignLearning: readRequiredString(argumentsValue, "campaignLearning", rawResponse),
    evidenceSummary: readRequiredString(argumentsValue, "evidenceSummary", rawResponse),
    proposalText,
    proposalTitle,
    targetContext
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Campaign retrospective failed.";
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

async function assertSpecificCampaignForEnd(campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign || campaign.type !== "specific") {
    throw new Error("Specific campaign not found.");
  }

  return campaign;
}

async function assertCanEndCampaign(session: DemoSession, campaignId: string) {
  if (!(await canManageCampaignLifecycle(session, campaignId))) {
    throw new Error("Only the R&D Manager or Campaign Owner can end campaigns.");
  }
}

async function assertCampaignOwner(session: DemoSession, campaignId: string) {
  if (session.role.id !== "specific_campaign_owner") {
    throw new Error("Only the R&D Campaign Owner can start or complete a campaign retrospective.");
  }

  const [membership] = await db
    .select({ campaignId: campaignMemberships.campaignId })
    .from(campaignMemberships)
    .where(
      and(
        eq(campaignMemberships.campaignId, campaignId),
        eq(campaignMemberships.userId, session.user.id),
        eq(campaignMemberships.membershipRole, "owner")
      )
    )
    .limit(1);

  if (!membership) {
    throw new Error("Only the R&D Campaign Owner can start or complete a campaign retrospective.");
  }
}

async function writeAudit(
  tx: DbTransaction,
  input: {
    actorType: "user" | "system" | "ai";
    actorUserId: string | null;
    entityId: string;
    entityType: "campaign" | "idea" | "global_context_change_proposal";
    eventType: string;
    metadata?: Record<string, unknown> | null;
    now: Date;
    reason: string;
  }
) {
  await tx.insert(auditEvents).values({
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    createdAt: input.now,
    entityId: input.entityId,
    entityType: input.entityType,
    eventType: input.eventType,
    id: newId("audit"),
    metadata: input.metadata ?? null,
    reason: input.reason
  });
}

function returnedStateFor(state: WorkflowState, inactiveIdeaIds: Set<string>, ideaId: string): WorkflowState | null {
  if (state === "potential_idea") {
    return null;
  }
  if (state === "ready_for_rd_review") {
    return inactiveIdeaIds.has(ideaId) ? "inactive_idea" : "future_opportunity";
  }
  if (state === "submitted") {
    return "general_idea";
  }

  return state;
}

function returnReasonFor(originalState: WorkflowState, returnedState: WorkflowState) {
  if (originalState === "ready_for_rd_review" && returnedState === "future_opportunity") {
    return {
      tag: "not_reviewed_before_campaign_ended",
      text: "Unreviewed Ready for R&D Review idea returned to General Campaign as Future Opportunity by default."
    };
  }
  if (originalState === "ready_for_rd_review" && returnedState === "inactive_idea") {
    return {
      tag: "owner_marked_inactive_at_campaign_end",
      text: "Owner returned unreviewed Ready for R&D Review idea to Inactive Ideas during campaign end."
    };
  }
  if (originalState === "needs_employee_clarification") {
    return {
      tag: "clarification_timer_continues_after_campaign_end",
      text: "Idea returned to General Campaign while keeping the existing employee clarification timer."
    };
  }
  if (originalState === "future_opportunity" || originalState === "inactive_idea") {
    return {
      tag: "reviewed_non_potential_return",
      text: "Reviewed non-Potential idea moved to General Campaign storage after campaign end."
    };
  }

  return {
    tag: "unfinished_work_returned_after_campaign_end",
    text: "Unfinished campaign idea returned to General Campaign after campaign end."
  };
}

async function latestRetrospectiveForUpdate(tx: DbTransaction, campaignId: string) {
  const [retrospective] = await tx
    .select()
    .from(campaignRetrospectives)
    .where(eq(campaignRetrospectives.campaignId, campaignId))
    .orderBy(desc(campaignRetrospectives.createdAt))
    .limit(1)
    .for("update");

  return retrospective ?? null;
}

async function markRetrospectiveSkippedIfNeeded(
  tx: DbTransaction,
  session: DemoSession,
  campaignId: string,
  now: Date
) {
  const latest = await latestRetrospectiveForUpdate(tx, campaignId);
  if (latest?.status === "started" || latest?.status === "completed") {
    return latest.id;
  }
  if (latest?.status === "skipped") {
    return latest.id;
  }

  const retrospectiveId = newId("campaign-retrospective");
  await tx.insert(campaignRetrospectives).values({
    campaignId,
    createdAt: now,
    id: retrospectiveId,
    questionText: retrospectiveQuestion,
    skippedAt: now,
    skippedByUserId: session.user.id,
    status: "skipped",
    updatedAt: now
  });
  await writeAudit(tx, {
    actorType: "user",
    actorUserId: session.user.id,
    entityId: campaignId,
    entityType: "campaign",
    eventType: "campaign.retrospective.skipped",
    now,
    reason: "Campaign ended without running retrospective Question Mode."
  });

  return retrospectiveId;
}

async function sweepCampaignIdeas(
  tx: DbTransaction,
  session: DemoSession,
  campaignId: string,
  inactiveIdeaIds: Set<string>,
  now: Date
) {
  const rows = await tx
    .select({
      currentReason: ideaStateHistory.reason,
      currentStateId: ideaStateHistory.id,
      currentWorkflowState: ideaStateHistory.workflowState,
      ideaId: ideas.id
    })
    .from(ideas)
    .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
    .where(eq(ideas.campaignId, campaignId))
    .for("update");

  let returnedCount = 0;
  let skippedPotentialCount = 0;

  for (const row of rows) {
    const returnedWorkflowState = returnedStateFor(row.currentWorkflowState, inactiveIdeaIds, row.ideaId);
    if (!returnedWorkflowState) {
      skippedPotentialCount += 1;
      continue;
    }

    const returnReason = returnReasonFor(row.currentWorkflowState, returnedWorkflowState);

    await tx.update(ideas).set({ campaignId: generalCampaignId }).where(eq(ideas.id, row.ideaId));
    await tx.update(ideaStateHistory).set({ isCurrent: false }).where(eq(ideaStateHistory.id, row.currentStateId));
    await tx.insert(ideaStateHistory).values({
      changedAt: now,
      changedByUserId: session.user.id,
      ideaId: row.ideaId,
      id: newId("idea-state"),
      isCurrent: true,
      reason: returnReason.text,
      workflowState: returnedWorkflowState
    });
    await tx.insert(returnedIdeaLineage).values({
      createdAt: now,
      fromCampaignId: campaignId,
      id: newId("returned-lineage"),
      ideaId: row.ideaId,
      originalWorkflowState: row.currentWorkflowState,
      returnReason: returnReason.text,
      returnReasonTag: returnReason.tag,
      returnedAt: now,
      returnedByUserId: session.user.id,
      returnedWorkflowState,
      toCampaignId: generalCampaignId
    });
    await writeAudit(tx, {
      actorType: "user",
      actorUserId: session.user.id,
      entityId: row.ideaId,
      entityType: "idea",
      eventType: "campaign_end.idea_returned",
      metadata: {
        fromCampaignId: campaignId,
        fromWorkflowState: row.currentWorkflowState,
        toCampaignId: generalCampaignId,
        toWorkflowState: returnedWorkflowState
      },
      now,
      reason: returnReason.text
    });
    returnedCount += 1;
  }

  return {
    returnedCount,
    skippedPotentialCount
  };
}

export async function endCampaignWithSweep(
  session: DemoSession,
  campaignId: string,
  input: EndCampaignInput = {}
) {
  await assertSpecificCampaignForEnd(campaignId);
  await assertCanEndCampaign(session, campaignId);
  const now = input.now ?? new Date();
  const inactiveIdeaIds = new Set(input.inactiveIdeaIds ?? []);

  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)
      .for("update");
    if (!campaign || campaign.type !== "specific") {
      throw new Error("Specific campaign not found.");
    }
    if (!endableStatuses.includes(campaign.lifecycleStatus as (typeof endableStatuses)[number])) {
      throw new Error("Campaign can end only from Review In Progress, Review Complete, Retrospective, or Ended.");
    }

    if (campaign.lifecycleStatus !== "ended") {
      await tx
        .update(campaigns)
        .set({ lifecycleStatus: "ended", updatedAt: now })
        .where(eq(campaigns.id, campaignId));
      await writeAudit(tx, {
        actorType: "user",
        actorUserId: session.user.id,
        entityId: campaignId,
        entityType: "campaign",
        eventType: "campaign.lifecycle.changed",
        metadata: { from: campaign.lifecycleStatus, to: "ended" },
        now,
        reason: "Campaign ended with campaign-end sweep."
      });
    }

    const sweep = await sweepCampaignIdeas(tx, session, campaignId, inactiveIdeaIds, now);
    const retrospectiveId = await markRetrospectiveSkippedIfNeeded(tx, session, campaignId, now);
    await writeAudit(tx, {
      actorType: "system",
      actorUserId: null,
      entityId: campaignId,
      entityType: "campaign",
      eventType: "campaign_end.sweep.completed",
      metadata: {
        returnedCount: sweep.returnedCount,
        skippedPotentialCount: sweep.skippedPotentialCount
      },
      now,
      reason: "Campaign-end sweep returned non-Potential ideas to General Campaign."
    });

    return {
      ...sweep,
      retrospectiveId
    };
  });
}

export async function startCampaignRetrospective(
  session: DemoSession,
  campaignId: string,
  input: { now?: Date } = {}
) {
  await assertSpecificCampaignForEnd(campaignId);
  await assertCampaignOwner(session, campaignId);
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1)
      .for("update");
    if (!campaign || campaign.type !== "specific") {
      throw new Error("Specific campaign not found.");
    }
    if (!["review_complete", "retrospective", "ended"].includes(campaign.lifecycleStatus)) {
      throw new Error("Campaign retrospective can start only after Review Complete or from ended history.");
    }

    const latest = await latestRetrospectiveForUpdate(tx, campaignId);
    if (latest?.status === "completed") {
      return {
        questionText: latest.questionText,
        retrospectiveId: latest.id,
        status: "completed" as const
      };
    }
    if (latest?.status === "started") {
      return {
        questionText: latest.questionText,
        retrospectiveId: latest.id,
        status: "started" as const
      };
    }

    const retrospectiveId = latest?.id ?? newId("campaign-retrospective");
    if (latest?.status === "skipped") {
      await tx
        .update(campaignRetrospectives)
        .set({
          questionText: retrospectiveQuestion,
          startedAt: now,
          startedByUserId: session.user.id,
          status: "started",
          updatedAt: now
        })
        .where(eq(campaignRetrospectives.id, latest.id));
    } else {
      await tx.insert(campaignRetrospectives).values({
        campaignId,
        createdAt: now,
        id: retrospectiveId,
        questionText: retrospectiveQuestion,
        startedAt: now,
        startedByUserId: session.user.id,
        status: "started",
        updatedAt: now
      });
    }

    if (campaign.lifecycleStatus === "review_complete") {
      await tx
        .update(campaigns)
        .set({ lifecycleStatus: "retrospective", updatedAt: now })
        .where(eq(campaigns.id, campaignId));
    }
    await writeAudit(tx, {
      actorType: "user",
      actorUserId: session.user.id,
      entityId: campaignId,
      entityType: "campaign",
      eventType: "campaign.retrospective.started",
      metadata: { retrospectiveId },
      now,
      reason: "Campaign Owner started post-campaign retrospective Question Mode."
    });

    return {
      questionText: retrospectiveQuestion,
      retrospectiveId,
      status: "started" as const
    };
  });
}

async function readRetrospectiveContext(retrospectiveId: string) {
  const [retrospective] = await db
    .select({
      campaignId: campaignRetrospectives.campaignId,
      campaignTitle: campaigns.publicTitle,
      questionText: campaignRetrospectives.questionText,
      retrospectiveId: campaignRetrospectives.id,
      status: campaignRetrospectives.status
    })
    .from(campaignRetrospectives)
    .innerJoin(campaigns, eq(campaigns.id, campaignRetrospectives.campaignId))
    .where(eq(campaignRetrospectives.id, retrospectiveId))
    .limit(1);

  if (!retrospective) {
    throw new Error("Campaign retrospective not found.");
  }

  const lineages = await db
    .select({
      ideaId: returnedIdeaLineage.ideaId,
      originalWorkflowState: returnedIdeaLineage.originalWorkflowState,
      returnReasonTag: returnedIdeaLineage.returnReasonTag,
      returnedWorkflowState: returnedIdeaLineage.returnedWorkflowState,
      title: ideas.title
    })
    .from(returnedIdeaLineage)
    .innerJoin(ideas, eq(ideas.id, returnedIdeaLineage.ideaId))
    .where(eq(returnedIdeaLineage.fromCampaignId, retrospective.campaignId))
    .orderBy(returnedIdeaLineage.returnedAt);

  return {
    ...retrospective,
    lineages
  };
}

function retrospectiveInputReference(input: {
  campaignId: string;
  learningText: string;
  retrospectiveId: string;
}) {
  return JSON.stringify({
    campaignId: input.campaignId,
    retrospectiveId: input.retrospectiveId,
    source: "campaign_retrospective",
    userLearningText: input.learningText
  });
}

async function generateRetrospectiveLearning(
  context: Awaited<ReturnType<typeof readRetrospectiveContext>>,
  learningText: string,
  provider?: LlmProvider
) {
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "You support Verto post-campaign Question Mode.",
          "Use only the campaign outcomes, returned idea lineage, and the owner's learning text.",
          "If a broad reusable rule is justified, propose Company Context or Global Innovation Context.",
          "Broad context proposals are pending recommendations only and require R&D Manager approval.",
          "Return none when learning should stay campaign-specific."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          campaign: {
            id: context.campaignId,
            title: context.campaignTitle
          },
          ownerLearning: learningText,
          returnedIdeaLineage: context.lineages
        }),
        role: "user"
      }
    ],
    provider,
    tool: retrospectiveTool
  });

  return {
    decision: parseRetrospective(result.arguments, result.rawResponse),
    model: result.model,
    rawResponse: result.rawResponse
  };
}

async function writeRetrospectiveAiLog(input: {
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
    purpose: retrospectivePurpose,
    rawResponse: input.rawResponse,
    status: input.status
  });

  return logId;
}

export async function completeCampaignRetrospective(
  session: DemoSession,
  retrospectiveId: string,
  input: RetrospectiveInput
) {
  const learningText = requireText(input.learningText, "Retrospective learning");
  const context = await readRetrospectiveContext(retrospectiveId);
  await assertCampaignOwner(session, context.campaignId);
  if (context.status !== "started") {
    throw new Error("Campaign retrospective must be started before it can be completed.");
  }

  const inputReference = retrospectiveInputReference({
    campaignId: context.campaignId,
    learningText,
    retrospectiveId
  });
  const model = getLlmModel();
  let generated: Awaited<ReturnType<typeof generateRetrospectiveLearning>>;

  try {
    generated = await generateRetrospectiveLearning(context, learningText, input.provider);
  } catch (error) {
    await writeRetrospectiveAiLog({
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

  const now = input.now ?? new Date();
  const logId = await writeRetrospectiveAiLog({
    decisionResult: generated.decision,
    inputReference,
    model: generated.model,
    outputSummary: generated.decision.campaignLearning,
    rawResponse: generated.rawResponse,
    status: "succeeded"
  });

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(campaignRetrospectives)
      .where(eq(campaignRetrospectives.id, retrospectiveId))
      .limit(1)
      .for("update");
    if (!current || current.status !== "started") {
      throw new Error("Campaign retrospective must be started before it can be completed.");
    }

    let proposalId: string | null = null;
    if (generated.decision.targetContext !== "none" && generated.decision.proposalTitle && generated.decision.proposalText) {
      proposalId = newId("global-context-proposal");
      await tx.insert(retrospectiveGlobalContextProposals).values({
        createdAt: now,
        createdByUserId: session.user.id,
        evidenceSummary: generated.decision.evidenceSummary,
        id: proposalId,
        proposedChange: generated.decision.proposalText,
        sourceCampaignId: current.campaignId,
        sourceRetrospectiveId: retrospectiveId,
        status: "pending_manager_approval",
        targetContext: generated.decision.targetContext,
        title: generated.decision.proposalTitle,
        updatedAt: now
      });
      await writeAudit(tx, {
        actorType: "ai",
        actorUserId: null,
        entityId: proposalId,
        entityType: "global_context_change_proposal",
        eventType: "global_context_change_proposal.created",
        metadata: {
          sourceCampaignId: current.campaignId,
          sourceRetrospectiveId: retrospectiveId,
          targetContext: generated.decision.targetContext
        },
        now,
        reason: "Retrospective created a broad context change proposal pending R&D Manager approval."
      });
    }

    await tx
      .update(campaignRetrospectives)
      .set({
        aiDecisionLogId: logId,
        answerText: learningText,
        campaignLearning: generated.decision.campaignLearning,
        completedAt: now,
        completedByUserId: session.user.id,
        evidenceSummary: generated.decision.evidenceSummary,
        status: "completed",
        updatedAt: now
      })
      .where(eq(campaignRetrospectives.id, retrospectiveId));
    await writeAudit(tx, {
      actorType: "user",
      actorUserId: session.user.id,
      entityId: current.campaignId,
      entityType: "campaign",
      eventType: "campaign.retrospective.completed",
      metadata: { proposalId, retrospectiveId },
      now,
      reason: "Campaign retrospective completed."
    });

    return {
      proposalId,
      retrospectiveId,
      status: "completed" as const
    };
  });
}

export async function getEndedCampaignHistoryView(
  session: DemoSession,
  input: {
    query?: string;
  } = {}
) {
  if (session.role.id === "employee") {
    return { campaigns: [] };
  }

  const query = input.query?.trim().toLowerCase() ?? "";
  const campaignRows = await db
    .select({
      campaignId: campaigns.id,
      endedAt: campaigns.updatedAt,
      name: campaigns.name,
      publicTitle: campaigns.publicTitle
    })
    .from(campaigns)
    .innerJoin(
      campaignMemberships,
      and(eq(campaignMemberships.campaignId, campaigns.id), eq(campaignMemberships.userId, session.user.id))
    )
    .where(and(eq(campaigns.type, "specific"), eq(campaigns.lifecycleStatus, "ended")))
    .orderBy(desc(campaigns.updatedAt));
  const uniqueCampaigns = Array.from(new Map(campaignRows.map((campaign) => [campaign.campaignId, campaign])).values())
    .filter((campaign) => {
      if (!query) {
        return true;
      }

      return `${campaign.publicTitle} ${campaign.name}`.toLowerCase().includes(query);
    });
  const campaignIds = uniqueCampaigns.map((campaign) => campaign.campaignId);
  if (campaignIds.length === 0) {
    return { campaigns: [] };
  }

  const [reportRows, lineageRows, potentialRows, retrospectiveRows] = await Promise.all([
    db
      .select({
        campaignId: campaignKnowledgeReports.campaignId,
        generatedAt: campaignKnowledgeReports.generatedAt,
        id: campaignKnowledgeReports.id,
        status: campaignKnowledgeReports.status
      })
      .from(campaignKnowledgeReports)
      .where(inArray(campaignKnowledgeReports.campaignId, campaignIds))
      .orderBy(desc(campaignKnowledgeReports.generatedAt)),
    db
      .select({
        ideaId: returnedIdeaLineage.ideaId,
        originalWorkflowState: returnedIdeaLineage.originalWorkflowState,
        returnReason: returnedIdeaLineage.returnReason,
        returnReasonTag: returnedIdeaLineage.returnReasonTag,
        returnedAt: returnedIdeaLineage.returnedAt,
        returnedWorkflowState: returnedIdeaLineage.returnedWorkflowState,
        sourceCampaignId: returnedIdeaLineage.fromCampaignId,
        title: ideas.title
      })
      .from(returnedIdeaLineage)
      .innerJoin(ideas, eq(ideas.id, returnedIdeaLineage.ideaId))
      .where(inArray(returnedIdeaLineage.fromCampaignId, campaignIds))
      .orderBy(returnedIdeaLineage.returnedAt),
    db
      .select({
        campaignId: ideas.campaignId,
        ideaId: ideas.id,
        title: ideas.title
      })
      .from(ideas)
      .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
      .where(and(inArray(ideas.campaignId, campaignIds), eq(ideaStateHistory.workflowState, "potential_idea"))),
    db
      .select({
        campaignId: campaignRetrospectives.campaignId,
        completedAt: campaignRetrospectives.completedAt,
        id: campaignRetrospectives.id,
        questionText: campaignRetrospectives.questionText,
        status: campaignRetrospectives.status
      })
      .from(campaignRetrospectives)
      .where(inArray(campaignRetrospectives.campaignId, campaignIds))
      .orderBy(desc(campaignRetrospectives.createdAt))
  ]);

  const reportByCampaign = new Map<string, (typeof reportRows)[number]>();
  for (const report of reportRows) {
    if (!reportByCampaign.has(report.campaignId)) {
      reportByCampaign.set(report.campaignId, report);
    }
  }
  const retrospectiveByCampaign = new Map<string, (typeof retrospectiveRows)[number]>();
  for (const retrospective of retrospectiveRows) {
    if (!retrospectiveByCampaign.has(retrospective.campaignId)) {
      retrospectiveByCampaign.set(retrospective.campaignId, retrospective);
    }
  }

  return {
    campaigns: uniqueCampaigns.map((campaign) => {
      const retrospective = retrospectiveByCampaign.get(campaign.campaignId);

      return {
        ...campaign,
        latestKnowledgeReport: reportByCampaign.get(campaign.campaignId) ?? null,
        potentialIdeas: potentialRows
          .filter((idea) => idea.campaignId === campaign.campaignId)
          .map(({ campaignId: _campaignId, ...idea }) => idea),
        retrospectiveId: retrospective?.id ?? null,
        retrospectiveQuestion: retrospective?.questionText ?? null,
        retrospectiveStatus: retrospective?.status ?? "not_started",
        returnedIdeas: lineageRows
          .filter((lineage) => lineage.sourceCampaignId === campaign.campaignId)
          .map(({ sourceCampaignId: _sourceCampaignId, ...lineage }) => lineage)
      };
    })
  };
}
