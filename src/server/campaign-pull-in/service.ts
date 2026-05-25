import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { canContributeToCampaign, canManageCampaignLifecycle } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { requestEmployeeClarification, type ClarificationEmailProvider } from "../clarifications/service";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  auditEvents,
  campaigns,
  clarificationRequests,
  ideaCampaignAssociations,
  ideaStateHistory,
  ideas,
  users
} from "../db/schema";
import { getLlmModel } from "../env";
import { callStructuredTool, LlmInvalidResponseError, type LlmProvider } from "../llm/adapter";

export const REUSED_IDEA_CLARIFICATION_WINDOW_DAYS = 183;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type JsonRecord = Record<string, unknown>;
type PullInDecision = {
  fitBasis: string;
  fitEstablished: boolean;
  hasCriticalClarity: boolean;
  needsReusedClarification: boolean;
  routingBasis: string;
  shouldPull: boolean;
};
type CandidateState = "future_opportunity" | "general_idea" | "ready_for_rd_review";
type PullInOptions = {
  clarificationProvider?: LlmProvider;
  contextVersion?: string;
  emailProvider?: ClarificationEmailProvider;
  now?: Date;
  provider?: LlmProvider;
};

const pullInPurpose = "campaign_pull_in.evaluate";
const pullInTool = {
  description: "Record whether one General Campaign idea should be reused by a specific campaign.",
  name: "record_campaign_pull_in_decision",
  parameters: {
    additionalProperties: false,
    properties: {
      fitBasis: {
        description: "Why existing source material does or does not establish campaign fit.",
        type: "string"
      },
      fitEstablished: {
        description: "True only when source material is enough to establish fit for this campaign.",
        type: "boolean"
      },
      hasCriticalClarity: {
        description: "True when existing source material is enough for the campaign-specific routing packet.",
        type: "boolean"
      },
      needsReusedClarification: {
        description: "True when the idea should ask one allowed reused clarification for campaign-specific packet detail.",
        type: "boolean"
      },
      routingBasis: {
        description: "How the idea can enter this campaign's routing, or which critical clarity is missing.",
        type: "string"
      },
      shouldPull: {
        description: "True when the idea should be associated with the campaign instead of copied.",
        type: "boolean"
      }
    },
    required: [
      "fitBasis",
      "fitEstablished",
      "hasCriticalClarity",
      "needsReusedClarification",
      "routingBasis",
      "shouldPull"
    ],
    type: "object"
  }
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function readOptionalString(value: JsonRecord, key: string) {
  const raw = value[key];

  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function readRequiredBoolean(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (typeof raw !== "boolean") {
    throw new LlmInvalidResponseError(`LLM pull-in result is missing ${key}.`, rawResponse, value);
  }

  return raw;
}

function parsePullInDecision(argumentsValue: JsonRecord, rawResponse: JsonRecord | null): PullInDecision {
  const shouldPull = readRequiredBoolean(argumentsValue, "shouldPull", rawResponse);
  const fitEstablished = readRequiredBoolean(argumentsValue, "fitEstablished", rawResponse);
  const hasCriticalClarity = readRequiredBoolean(argumentsValue, "hasCriticalClarity", rawResponse);
  const needsReusedClarification = readRequiredBoolean(argumentsValue, "needsReusedClarification", rawResponse);
  const fitBasis =
    readOptionalString(argumentsValue, "fitBasis") ??
    (fitEstablished
      ? "LLM established campaign fit but did not provide a fit basis."
      : "LLM did not establish campaign fit.");
  const routingBasis =
    readOptionalString(argumentsValue, "routingBasis") ??
    (hasCriticalClarity
      ? "Existing source material supplies campaign-critical clarity."
      : "Campaign-critical clarity is missing.");

  if (shouldPull && !fitEstablished) {
    throw new LlmInvalidResponseError("Campaign pull-in cannot proceed without established fit.", rawResponse, argumentsValue);
  }
  if (needsReusedClarification && hasCriticalClarity) {
    throw new LlmInvalidResponseError(
      "Reused clarification should be requested only when campaign-specific critical clarity is missing.",
      rawResponse,
      argumentsValue
    );
  }

  return {
    fitBasis,
    fitEstablished,
    hasCriticalClarity,
    needsReusedClarification,
    routingBasis,
    shouldPull
  };
}

async function assertSpecificCampaignOwner(session: DemoSession, campaignId: string) {
  const [campaign] = await db
    .select({
      id: campaigns.id,
      lifecycleStatus: campaigns.lifecycleStatus,
      publicPrompt: campaigns.publicPrompt,
      publicTitle: campaigns.publicTitle,
      type: campaigns.type
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign || campaign.type !== "specific") {
    throw new Error("Specific campaign not found.");
  }
  if (!(await canManageCampaignLifecycle(session, campaignId))) {
    throw new Error("Only the R&D Manager or Campaign Owner can run campaign pull-in.");
  }

  return campaign;
}

async function assertCanViewPullIn(session: DemoSession, campaignId: string) {
  if (session.role.id === "employee" || !(await canContributeToCampaign(session, campaignId))) {
    throw new Error("Only R&D users with campaign access can inspect campaign pull-in.");
  }
}

async function existingAssociationsForCampaign(campaignId: string) {
  const rows = await db
    .select({ ideaId: ideaCampaignAssociations.ideaId })
    .from(ideaCampaignAssociations)
    .where(eq(ideaCampaignAssociations.campaignId, campaignId));

  return new Set(rows.map((row) => row.ideaId));
}

async function readCandidates(campaignId: string) {
  const [existingAssociations, rows] = await Promise.all([
    existingAssociationsForCampaign(campaignId),
    db
      .select({
        currentReason: ideaStateHistory.reason,
        currentWorkflowState: ideaStateHistory.workflowState,
        evidenceExample: ideas.evidenceExample,
        expectedBenefit: ideas.expectedBenefit,
        ideaId: ideas.id,
        originalText: ideas.originalText,
        problemOpportunity: ideas.problemOpportunity,
        submittedAt: ideas.submittedAt,
        submitterDisplayName: users.displayName,
        submitterIsActive: users.isActive,
        submitterUserId: users.id,
        supportingLink: ideas.supportingLink,
        title: ideas.title
      })
      .from(ideas)
      .innerJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
      .innerJoin(users, eq(users.id, ideas.submitterUserId))
      .where(eq(ideas.campaignId, "general-campaign"))
  ]);

  let skippedInactiveCount = 0;
  const candidates = [];
  for (const row of rows) {
    if (existingAssociations.has(row.ideaId)) {
      continue;
    }
    if (row.currentWorkflowState === "inactive_idea") {
      skippedInactiveCount += 1;
      continue;
    }
    if (row.currentWorkflowState === "potential_idea") {
      continue;
    }
    if (
      row.currentWorkflowState === "future_opportunity" ||
      row.currentWorkflowState === "general_idea" ||
      row.currentWorkflowState === "ready_for_rd_review"
    ) {
      candidates.push({
        ...row,
        currentWorkflowState: row.currentWorkflowState as CandidateState
      });
    }
  }

  candidates.sort((left, right) => {
    const priority = (state: CandidateState) => (state === "future_opportunity" ? 0 : 1);
    const priorityDiff = priority(left.currentWorkflowState) - priority(right.currentWorkflowState);
    if (priorityDiff) {
      return priorityDiff;
    }

    return right.submittedAt.getTime() - left.submittedAt.getTime();
  });

  return {
    candidates,
    skippedInactiveCount
  };
}

async function generatePullInDecision(input: {
  campaign: Awaited<ReturnType<typeof assertSpecificCampaignOwner>>;
  candidate: Awaited<ReturnType<typeof readCandidates>>["candidates"][number];
  contextVersion: string;
  provider?: LlmProvider;
}) {
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "You decide whether a General Campaign idea should be reused by one specific Verto campaign.",
          "Search Future Opportunities before lower-priority General Ideas is handled by the app.",
          "Do not copy ideas. If fit is established, the app creates one campaign association.",
          "Pull only when existing source material establishes campaign fit.",
          "Inactive Ideas are not candidates unless rechecked out of inactive before this step.",
          "If campaign-critical clarity is missing, request reused clarification only when allowed by age and active submitter."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          campaign: {
            contextVersion: input.contextVersion,
            lifecycleStatus: input.campaign.lifecycleStatus,
            prompt: input.campaign.publicPrompt,
            title: input.campaign.publicTitle
          },
          idea: {
            currentReason: input.candidate.currentReason,
            currentWorkflowState: input.candidate.currentWorkflowState,
            evidenceExample: input.candidate.evidenceExample,
            expectedBenefit: input.candidate.expectedBenefit,
            ideaId: input.candidate.ideaId,
            originalText: input.candidate.originalText,
            problemOpportunity: input.candidate.problemOpportunity,
            submittedAt: input.candidate.submittedAt.toISOString(),
            supportingLink: input.candidate.supportingLink,
            title: input.candidate.title
          }
        }),
        role: "user"
      }
    ],
    provider: input.provider,
    tool: pullInTool
  });

  return {
    decision: parsePullInDecision(result.arguments, result.rawResponse),
    model: result.model,
    rawResponse: result.rawResponse
  };
}

async function writeAiLog(input: {
  candidateIdeaId: string;
  campaignId: string;
  contextVersion: string;
  decision: PullInDecision;
  model: string;
  now: Date;
  rawResponse: JsonRecord;
}) {
  const logId = newId("ai-log");
  await db.insert(aiDecisionLogs).values({
    createdAt: input.now,
    decisionResult: input.decision,
    id: logId,
    inputReference: JSON.stringify({
      campaignId: input.campaignId,
      contextVersion: input.contextVersion,
      ideaId: input.candidateIdeaId,
      source: "campaign_pull_in"
    }),
    model: input.model,
    outputSummary: input.decision.fitBasis,
    purpose: pullInPurpose,
    rawResponse: input.rawResponse,
    status: "succeeded"
  });

  return logId;
}

async function writeAudit(
  tx: DbTransaction,
  input: {
    campaignId: string;
    eventType: string;
    ideaId: string;
    metadata?: Record<string, unknown> | null;
    now: Date;
    reason: string;
  }
) {
  await tx.insert(auditEvents).values({
    actorType: "ai",
    actorUserId: null,
    createdAt: input.now,
    entityId: input.campaignId,
    entityType: "campaign",
    eventType: input.eventType,
    id: newId("audit"),
    metadata: {
      ideaId: input.ideaId,
      ...(input.metadata ?? {})
    },
    reason: input.reason
  });
}

function canAskReusedClarification(
  candidate: Awaited<ReturnType<typeof readCandidates>>["candidates"][number],
  now: Date
) {
  const windowEnd = addDays(candidate.submittedAt, REUSED_IDEA_CLARIFICATION_WINDOW_DAYS);

  return candidate.submitterIsActive && windowEnd >= now;
}

async function createAssociation(input: {
  campaignId: string;
  candidate: Awaited<ReturnType<typeof readCandidates>>["candidates"][number];
  clarificationAllowed: boolean;
  clarificationReason: string | null;
  clarificationRequestId: string | null;
  contextVersion: string;
  decision: PullInDecision;
  now: Date;
}) {
  const associationId = newId("idea-association");
  await db.transaction(async (tx) => {
    await tx.insert(ideaCampaignAssociations).values({
      associationType: "pulled_in",
      campaignId: input.campaignId,
      clarificationAllowed: input.clarificationAllowed,
      clarificationReason: input.clarificationReason,
      clarificationRequestId: input.clarificationRequestId,
      contextVersion: input.contextVersion,
      createdAt: input.now,
      fitBasis: input.decision.fitBasis,
      id: associationId,
      ideaId: input.candidate.ideaId,
      routingBasis: input.decision.routingBasis,
      sourceWorkflowState: input.candidate.currentWorkflowState,
      updatedAt: input.now
    });
    await writeAudit(tx, {
      campaignId: input.campaignId,
      eventType: "campaign_pull_in.idea_associated",
      ideaId: input.candidate.ideaId,
      metadata: {
        associationId,
        clarificationAllowed: input.clarificationAllowed,
        clarificationRequestId: input.clarificationRequestId,
        sourceWorkflowState: input.candidate.currentWorkflowState
      },
      now: input.now,
      reason: "AI associated one General Campaign idea with a specific campaign without copying it."
    });
  });

  return associationId;
}

async function createReusedClarification(input: {
  campaignId: string;
  candidate: Awaited<ReturnType<typeof readCandidates>>["candidates"][number];
  clarificationProvider?: LlmProvider;
  emailProvider?: ClarificationEmailProvider;
  now: Date;
  session: DemoSession;
}) {
  const result = await requestEmployeeClarification(input.session, input.candidate.ideaId, {
    campaignContextId: input.campaignId,
    emailProvider: input.emailProvider,
    expiresAt: addDays(input.now, 30),
    markIdeaWorkflowState: false,
    now: input.now,
    provider: input.clarificationProvider
  });

  return {
    requestId: "requestId" in result ? result.requestId : null,
    sent: result.status === "sent"
  };
}

export async function runCampaignIdeaPullIn(
  session: DemoSession,
  campaignId: string,
  options: PullInOptions = {}
) {
  const campaign = await assertSpecificCampaignOwner(session, campaignId);
  const now = options.now ?? new Date();
  const contextVersion = options.contextVersion ?? `${campaignId}:campaign-pull-in`;
  const { candidates, skippedInactiveCount } = await readCandidates(campaignId);
  let pulledCount = 0;
  let reusedClarificationSentCount = 0;
  let skippedMissingFitCount = 0;
  let skippedMissingCriticalClarityCount = 0;

  for (const candidate of candidates) {
    const generated = await generatePullInDecision({
      campaign,
      candidate,
      contextVersion,
      provider: options.provider
    });
    await writeAiLog({
      campaignId,
      candidateIdeaId: candidate.ideaId,
      contextVersion,
      decision: generated.decision,
      model: generated.model,
      now,
      rawResponse: generated.rawResponse
    });

    if (!generated.decision.fitEstablished || !generated.decision.shouldPull) {
      skippedMissingFitCount += 1;
      await db.transaction((tx) =>
        writeAudit(tx, {
          campaignId,
          eventType: "campaign_pull_in.skipped_missing_fit",
          ideaId: candidate.ideaId,
          metadata: { sourceWorkflowState: candidate.currentWorkflowState },
          now,
          reason: generated.decision.fitBasis
        })
      );
      continue;
    }

    const clarificationAllowed =
      generated.decision.needsReusedClarification && canAskReusedClarification(candidate, now);
    if (!generated.decision.hasCriticalClarity && !clarificationAllowed) {
      skippedMissingCriticalClarityCount += 1;
      await db.transaction((tx) =>
        writeAudit(tx, {
          campaignId,
          eventType: "campaign_pull_in.skipped_missing_critical_clarity",
          ideaId: candidate.ideaId,
          metadata: {
            employeeActive: candidate.submitterIsActive,
            sourceWorkflowState: candidate.currentWorkflowState,
            submittedAt: candidate.submittedAt.toISOString()
          },
          now,
          reason: generated.decision.routingBasis
        })
      );
      continue;
    }

    const clarificationResult = clarificationAllowed
      ? await createReusedClarification({
          campaignId,
          candidate,
          clarificationProvider: options.clarificationProvider,
          emailProvider: options.emailProvider,
          now,
          session
        })
      : null;
    const clarificationRequestId = clarificationResult?.requestId ?? null;
    if (clarificationAllowed && !clarificationRequestId) {
      skippedMissingCriticalClarityCount += 1;
      await db.transaction((tx) =>
        writeAudit(tx, {
          campaignId,
          eventType: "campaign_pull_in.reused_clarification_retry_required",
          ideaId: candidate.ideaId,
          metadata: { sourceWorkflowState: candidate.currentWorkflowState },
          now,
          reason: "Reused clarification could not be created; pull-in is blocked until retry succeeds."
        })
      );
      continue;
    }
    if (clarificationResult?.sent) {
      reusedClarificationSentCount += 1;
    }

    await createAssociation({
      campaignId,
      candidate,
      clarificationAllowed,
      clarificationReason: clarificationAllowed ? generated.decision.routingBasis : null,
      clarificationRequestId,
      contextVersion,
      decision: generated.decision,
      now
    });
    pulledCount += 1;
  }

  return {
    evaluatedCount: candidates.length,
    pulledCount,
    reusedClarificationSentCount,
    skippedInactiveCount,
    skippedMissingCriticalClarityCount,
    skippedMissingFitCount
  };
}

export async function getCampaignPullInWorkspaceView(session: DemoSession, campaignId: string) {
  await assertCanViewPullIn(session, campaignId);

  const associations = await db
    .select({
      associationId: ideaCampaignAssociations.id,
      associationType: ideaCampaignAssociations.associationType,
      clarificationAllowed: ideaCampaignAssociations.clarificationAllowed,
      clarificationRequestId: ideaCampaignAssociations.clarificationRequestId,
      clarificationStatus: clarificationRequests.status,
      contextVersion: ideaCampaignAssociations.contextVersion,
      createdAt: ideaCampaignAssociations.createdAt,
      fitBasis: ideaCampaignAssociations.fitBasis,
      ideaId: ideas.id,
      routingBasis: ideaCampaignAssociations.routingBasis,
      sourceWorkflowState: ideaCampaignAssociations.sourceWorkflowState,
      submitterDisplayName: users.displayName,
      title: ideas.title
    })
    .from(ideaCampaignAssociations)
    .innerJoin(ideas, eq(ideas.id, ideaCampaignAssociations.ideaId))
    .innerJoin(users, eq(users.id, ideas.submitterUserId))
    .leftJoin(clarificationRequests, eq(clarificationRequests.id, ideaCampaignAssociations.clarificationRequestId))
    .where(
      and(
        eq(ideaCampaignAssociations.campaignId, campaignId),
        inArray(ideaCampaignAssociations.associationType, ["pulled_in"])
      )
    )
    .orderBy(desc(ideaCampaignAssociations.createdAt));

  return {
    associations,
    canRunPullIn: await canManageCampaignLifecycle(session, campaignId)
  };
}
