import crypto from "node:crypto";

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { canContributeToCampaign, canManageCampaignLifecycle } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  auditEvents,
  campaignSetupDecisions,
  campaignSetupQuestions,
  campaigns,
  contextChangeAlerts,
  contextDocuments,
  contextImpactChecks,
  globalContextChangeProposals
} from "../db/schema";
import { getLlmModel } from "../env";
import { callStructuredTool, LlmInvalidResponseError, type LlmProvider } from "../llm/adapter";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type JsonRecord = Record<string, unknown>;
type CampaignLifecycleStatus = (typeof campaigns.$inferSelect)["lifecycleStatus"];
type ContextImpactLevel = (typeof contextImpactChecks.$inferSelect)["impactLevel"];
type AlertResolutionType = NonNullable<(typeof contextChangeAlerts.$inferInsert)["resolutionType"]>;

type ContextSourceMetadata = Record<string, unknown> | null;

type ContextDraftInput = {
  body: string;
  sourceMetadata?: ContextSourceMetadata;
  title: string;
};

type GlobalContextProposalInput = {
  body: string;
  rationale: string;
  title: string;
};

type ResolveContextChangeAlertInput = {
  note: string;
  resolutionType: AlertResolutionType;
};

type ContextImpactDecision = {
  campaignId: string;
  impactLevel: ContextImpactLevel;
  recommendedResolution: string;
  summary: string;
};

export const contextAlertResolutionOptions: AlertResolutionType[] = [
  "no_impact",
  "update_campaign_context",
  "campaign_context_override",
  "follow_up_question",
  "escalate_to_manager"
];

const impactLevels: ContextImpactLevel[] = ["no_impact", "active_alert", "draft_warning", "draft_hard_blocker"];
const contextImpactPurpose = "context.impact_check";
const draftLifecycleStatuses: CampaignLifecycleStatus[] = [
  "draft",
  "setup_in_progress",
  "setup_review",
  "ready_to_open",
  "intake_scheduled"
];

const contextImpactTool = {
  description: "Record likely impact of one approved Company or Global Innovation Context change on Verto campaigns.",
  name: "record_context_impact_check",
  parameters: {
    additionalProperties: false,
    properties: {
      decisions: {
        items: {
          additionalProperties: false,
          properties: {
            campaignId: {
              description: "Campaign ID being assessed.",
              type: "string"
            },
            impactLevel: {
              description: "No impact, active alert, draft setup warning, or draft setup hard blocker.",
              enum: impactLevels,
              type: "string"
            },
            recommendedResolution: {
              description: "Concrete owner action or no-action recommendation.",
              type: "string"
            },
            summary: {
              description: "Short explanation of the context impact.",
              type: "string"
            }
          },
          required: ["campaignId", "impactLevel", "summary", "recommendedResolution"],
          type: "object"
        },
        type: "array"
      }
    },
    required: ["decisions"],
    type: "object"
  }
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function assertManager(session: DemoSession, action: string) {
  if (session.role.id !== "rd_manager") {
    throw new Error(`Only an R&D Manager can ${action}.`);
  }
}

function assertRAndDUser(session: DemoSession, action: string) {
  if (session.role.id === "employee") {
    throw new Error(`Only an R&D user can ${action}.`);
  }
}

function readRequiredString(value: JsonRecord, key: string, rawResponse: JsonRecord) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LlmInvalidResponseError(`Context impact result is missing ${key}.`, rawResponse, value);
  }

  return raw.trim();
}

function readImpactLevel(value: JsonRecord, rawResponse: JsonRecord) {
  const raw = readRequiredString(value, "impactLevel", rawResponse);
  if (!impactLevels.includes(raw as ContextImpactLevel)) {
    throw new LlmInvalidResponseError(`Context impact result used unsupported impactLevel: ${raw}.`, rawResponse, value);
  }

  return raw as ContextImpactLevel;
}

function parseContextImpactDecisions(value: JsonRecord, rawResponse: JsonRecord) {
  const raw = value.decisions;
  if (!Array.isArray(raw)) {
    throw new LlmInvalidResponseError("Context impact result is missing decisions.", rawResponse, value);
  }

  return raw.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new LlmInvalidResponseError("Context impact decision was not an object.", rawResponse, value);
    }

    const decision = item as JsonRecord;
    return {
      campaignId: readRequiredString(decision, "campaignId", rawResponse),
      impactLevel: readImpactLevel(decision, rawResponse),
      recommendedResolution: readRequiredString(decision, "recommendedResolution", rawResponse),
      summary: readRequiredString(decision, "summary", rawResponse)
    };
  });
}

async function writeContextAudit(
  tx: DbTransaction,
  input: {
    actorType?: "user" | "system" | "ai";
    actorUserId?: string | null;
    entityId: string;
    entityType: string;
    eventType: string;
    metadata?: Record<string, unknown> | null;
    reason: string;
  }
) {
  await tx.insert(auditEvents).values({
    actorType: input.actorType ?? "user",
    actorUserId: input.actorUserId ?? null,
    createdAt: new Date(),
    entityId: input.entityId,
    entityType: input.entityType,
    eventType: input.eventType,
    id: newId("audit"),
    metadata: input.metadata ?? null,
    reason: input.reason
  });
}

async function getApprovedContext(contextId: string) {
  const [context] = await db.select().from(contextDocuments).where(eq(contextDocuments.id, contextId)).limit(1);
  if (!context) {
    throw new Error("Context document not found.");
  }
  if (context.status !== "approved") {
    throw new Error("Context Impact Check requires approved context.");
  }

  return context;
}

async function getContextDocumentForUpdate(tx: DbTransaction, contextId: string) {
  const [context] = await tx
    .select()
    .from(contextDocuments)
    .where(eq(contextDocuments.id, contextId))
    .limit(1)
    .for("update");
  if (!context) {
    throw new Error("Context document not found.");
  }

  return context;
}

async function getProposalForUpdate(tx: DbTransaction, proposalId: string) {
  const [proposal] = await tx
    .select()
    .from(globalContextChangeProposals)
    .where(eq(globalContextChangeProposals.id, proposalId))
    .limit(1)
    .for("update");
  if (!proposal) {
    throw new Error("Global Context Change Proposal not found.");
  }

  return proposal;
}

async function getAlertForUpdate(tx: DbTransaction, alertId: string) {
  const [alert] = await tx
    .select()
    .from(contextChangeAlerts)
    .where(eq(contextChangeAlerts.id, alertId))
    .limit(1)
    .for("update");
  if (!alert) {
    throw new Error("Context Change Alert not found.");
  }

  return alert;
}

async function getTargetCampaigns() {
  const campaignRows = await db
    .select({
      id: campaigns.id,
      lifecycleStatus: campaigns.lifecycleStatus,
      name: campaigns.name,
      publicPrompt: campaigns.publicPrompt,
      publicTitle: campaigns.publicTitle
    })
    .from(campaigns)
    .where(and(eq(campaigns.type, "specific"), ne(campaigns.lifecycleStatus, "ended")))
    .orderBy(campaigns.id);

  if (campaignRows.length === 0) {
    return [];
  }

  const setupRows = await db
    .select({
      campaignId: campaignSetupDecisions.campaignId,
      isContextOverride: campaignSetupDecisions.isContextOverride,
      isIntentionalAmbiguity: campaignSetupDecisions.isIntentionalAmbiguity,
      setupArea: campaignSetupDecisions.setupArea,
      title: campaignSetupDecisions.title,
      value: campaignSetupDecisions.value
    })
    .from(campaignSetupDecisions)
    .where(
      inArray(
        campaignSetupDecisions.campaignId,
        campaignRows.map((campaign) => campaign.id)
      )
    );

  const setupByCampaign = new Map<string, typeof setupRows>();
  for (const setup of setupRows) {
    const rows = setupByCampaign.get(setup.campaignId) ?? [];
    rows.push(setup);
    setupByCampaign.set(setup.campaignId, rows);
  }

  return campaignRows.map((campaign) => ({
    ...campaign,
    setupDecisions: setupByCampaign.get(campaign.id) ?? []
  }));
}

function serializeImpactPrompt(input: {
  context: Awaited<ReturnType<typeof getApprovedContext>>;
  targets: Awaited<ReturnType<typeof getTargetCampaigns>>;
}) {
  return JSON.stringify(
    {
      changedContext: {
        body: input.context.body,
        contextType: input.context.contextType,
        id: input.context.id,
        sourceMetadata: input.context.sourceMetadata,
        title: input.context.title
      },
      campaigns: input.targets.map((campaign) => ({
        id: campaign.id,
        lifecycleStatus: campaign.lifecycleStatus,
        publicPrompt: campaign.publicPrompt,
        publicTitle: campaign.publicTitle,
        setupDecisions: campaign.setupDecisions
      }))
    },
    null,
    2
  );
}

function isDraftCampaign(status: CampaignLifecycleStatus) {
  return draftLifecycleStatuses.includes(status);
}

async function createSetupImpactQuestion(
  tx: DbTransaction,
  input: {
    campaignId: string;
    decision: ContextImpactDecision;
    now: Date;
  }
) {
  await tx.insert(campaignSetupQuestions).values({
    campaignId: input.campaignId,
    createdAt: input.now,
    id: newId("setup-question"),
    priority: input.decision.impactLevel === "draft_hard_blocker" ? "hard_blocker" : "warning",
    questionText: `Context impact: ${input.decision.recommendedResolution}`,
    rationale: input.decision.summary,
    recommendedAnswer: input.decision.recommendedResolution,
    setupArea: "rules_memory",
    status: "open",
    updatedAt: input.now
  });
}

async function createContextDecision(
  tx: DbTransaction,
  input: {
    alertId: string;
    actorUserId: string;
    campaignId: string;
    isOverride: boolean;
    note: string;
    now: Date;
  }
) {
  await tx.insert(campaignSetupDecisions).values({
    campaignId: input.campaignId,
    createdAt: input.now,
    id: newId("setup-decision"),
    isContextOverride: input.isOverride,
    isIntentionalAmbiguity: false,
    setupArea: "rules_memory",
    sourceAnswerId: null,
    title: input.isOverride ? "Context change override" : "Context change update",
    updatedAt: input.now,
    value: input.note
  });
  await writeContextAudit(tx, {
    actorType: "user",
    actorUserId: input.actorUserId,
    entityId: input.campaignId,
    entityType: "campaign",
    eventType: input.isOverride ? "context.alert.override_recorded" : "context.alert.campaign_context_updated",
    metadata: { alertId: input.alertId },
    reason: input.note
  });
}

export async function createCompanyContextDraft(session: DemoSession, input: ContextDraftInput) {
  assertManager(session, "create Company Context");
  const now = new Date();
  const contextId = newId("context");

  await db.transaction(async (tx) => {
    await tx.insert(contextDocuments).values({
      approvedAt: null,
      approvedByUserId: null,
      body: input.body,
      contextType: "company",
      createdAt: now,
      createdByUserId: session.user.id,
      id: contextId,
      sourceMetadata: input.sourceMetadata ?? null,
      status: "draft",
      title: input.title,
      updatedAt: now
    });
    await writeContextAudit(tx, {
      actorUserId: session.user.id,
      entityId: contextId,
      entityType: "context_document",
      eventType: "context.company.draft_created",
      reason: "Company Context draft created."
    });
  });

  return { contextId };
}

export async function approveCompanyContext(session: DemoSession, contextId: string) {
  assertManager(session, "approve Company Context");
  const now = new Date();

  await db.transaction(async (tx) => {
    const context = await getContextDocumentForUpdate(tx, contextId);
    if (context.contextType !== "company") {
      throw new Error("Company Context document not found.");
    }
    if (context.status === "approved") {
      return;
    }
    if (context.status !== "draft") {
      throw new Error("Only draft Company Context can be approved.");
    }

    await tx
      .update(contextDocuments)
      .set({ status: "superseded", updatedAt: now })
      .where(and(eq(contextDocuments.contextType, "company"), eq(contextDocuments.status, "approved")));
    await tx
      .update(contextDocuments)
      .set({
        approvedAt: now,
        approvedByUserId: session.user.id,
        status: "approved",
        updatedAt: now
      })
      .where(eq(contextDocuments.id, contextId));
    await writeContextAudit(tx, {
      actorUserId: session.user.id,
      entityId: contextId,
      entityType: "context_document",
      eventType: "context.company.approved",
      reason: "Company Context approved for AI use."
    });
  });
}

export async function createGlobalContextProposal(session: DemoSession, input: GlobalContextProposalInput) {
  assertRAndDUser(session, "create Global Context Change Proposals");
  const now = new Date();
  const proposalId = newId("context-proposal");

  await db.transaction(async (tx) => {
    await tx.insert(globalContextChangeProposals).values({
      approvedContextId: null,
      body: input.body,
      createdAt: now,
      decidedAt: null,
      decidedByUserId: null,
      decisionReason: null,
      id: proposalId,
      proposedByUserId: session.user.id,
      rationale: input.rationale,
      status: "pending_manager_approval",
      title: input.title,
      updatedAt: now
    });
    await writeContextAudit(tx, {
      actorUserId: session.user.id,
      entityId: proposalId,
      entityType: "global_context_change_proposal",
      eventType: "context.global.proposal_created",
      reason: input.rationale
    });
  });

  return { proposalId };
}

export async function approveGlobalContextProposal(session: DemoSession, proposalId: string) {
  assertManager(session, "approve Global Context Change Proposals");
  const now = new Date();
  const contextId = newId("context");

  await db.transaction(async (tx) => {
    const proposal = await getProposalForUpdate(tx, proposalId);
    if (proposal.status !== "pending_manager_approval") {
      throw new Error("Only pending Global Context Change Proposals can be approved.");
    }

    await tx
      .update(contextDocuments)
      .set({ status: "superseded", updatedAt: now })
      .where(and(eq(contextDocuments.contextType, "global_innovation"), eq(contextDocuments.status, "approved")));
    await tx.insert(contextDocuments).values({
      approvedAt: now,
      approvedByUserId: session.user.id,
      body: proposal.body,
      contextType: "global_innovation",
      createdAt: now,
      createdByUserId: proposal.proposedByUserId,
      id: contextId,
      sourceMetadata: { proposalId },
      status: "approved",
      title: proposal.title,
      updatedAt: now
    });
    await tx
      .update(globalContextChangeProposals)
      .set({
        approvedContextId: contextId,
        decidedAt: now,
        decidedByUserId: session.user.id,
        decisionReason: "Approved by R&D Manager.",
        status: "approved",
        updatedAt: now
      })
      .where(eq(globalContextChangeProposals.id, proposalId));
    await writeContextAudit(tx, {
      actorUserId: session.user.id,
      entityId: proposalId,
      entityType: "global_context_change_proposal",
      eventType: "context.global.proposal_approved",
      metadata: { contextId },
      reason: "Global Context Change Proposal approved and published."
    });
  });

  return { contextId };
}

export async function runContextImpactCheck(
  session: DemoSession,
  contextId: string,
  options: { provider?: LlmProvider } = {}
) {
  assertManager(session, "run Context Impact Checks");
  const [context, targets] = await Promise.all([getApprovedContext(contextId), getTargetCampaigns()]);
  const model = getLlmModel();
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "You are Verto's Context Impact Check AI.",
          "Compare one approved Company or Global Innovation Context change against active and draft Campaign Context.",
          "Active campaigns receive non-blocking alerts only.",
          "Draft campaigns receive setup warnings or hard blockers only when launch correctness is affected.",
          "No-impact results must be explicit for audit."
        ].join(" "),
        role: "system"
      },
      {
        content: serializeImpactPrompt({ context, targets }),
        role: "user"
      }
    ],
    model,
    provider: options.provider,
    tool: contextImpactTool
  });
  const decisions = parseContextImpactDecisions(result.arguments, result.rawResponse);
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const now = new Date();
  const logId = newId("ai-decision");
  const counts = {
    activeAlertsCreated: 0,
    draftBlockersCreated: 0,
    draftWarningsCreated: 0,
    noImpactCount: 0
  };

  await db.transaction(async (tx) => {
    await tx.insert(aiDecisionLogs).values({
      createdAt: now,
      decisionResult: { decisions },
      id: logId,
      inputReference: JSON.stringify({
        campaignIds: targets.map((target) => target.id),
        contextId,
        contextType: context.contextType
      }),
      model: result.model,
      outputSummary: `Context Impact Check evaluated ${decisions.length} campaigns.`,
      purpose: contextImpactPurpose,
      rawResponse: result.rawResponse,
      status: "succeeded"
    });

    for (const decision of decisions) {
      const target = targetById.get(decision.campaignId);
      if (!target) {
        throw new Error(`Context Impact Check returned unknown campaign: ${decision.campaignId}.`);
      }
      const impactCheckId = newId("context-impact");
      await tx.insert(contextImpactChecks).values({
        aiDecisionLogId: logId,
        campaignId: decision.campaignId,
        createdAt: now,
        id: impactCheckId,
        impactLevel: decision.impactLevel,
        recommendedResolution: decision.recommendedResolution,
        sourceContextId: contextId,
        summary: decision.summary
      });

      if (decision.impactLevel === "no_impact") {
        counts.noImpactCount += 1;
        await writeContextAudit(tx, {
          actorType: "ai",
          entityId: decision.campaignId,
          entityType: "campaign",
          eventType: "context.impact.no_impact",
          metadata: { contextId, impactCheckId },
          reason: decision.summary
        });
        continue;
      }

      if (decision.impactLevel === "active_alert" || !isDraftCampaign(target.lifecycleStatus)) {
        counts.activeAlertsCreated += 1;
        await tx.insert(contextChangeAlerts).values({
          campaignId: decision.campaignId,
          createdAt: now,
          id: newId("context-alert"),
          impactCheckId,
          recommendedResolution: decision.recommendedResolution,
          resolutionNote: null,
          resolutionType: null,
          resolvedAt: null,
          resolvedByUserId: null,
          sourceContextId: contextId,
          status: "open",
          summary: decision.summary,
          updatedAt: now
        });
        await writeContextAudit(tx, {
          actorType: "ai",
          entityId: decision.campaignId,
          entityType: "campaign",
          eventType: "context.impact.alert_created",
          metadata: { contextId, impactCheckId },
          reason: decision.summary
        });
        continue;
      }

      await createSetupImpactQuestion(tx, {
        campaignId: decision.campaignId,
        decision,
        now
      });
      if (decision.impactLevel === "draft_hard_blocker") {
        counts.draftBlockersCreated += 1;
      } else {
        counts.draftWarningsCreated += 1;
      }
      await writeContextAudit(tx, {
        actorType: "ai",
        entityId: decision.campaignId,
        entityType: "campaign",
        eventType: "context.impact.setup_question_created",
        metadata: { contextId, impactCheckId, impactLevel: decision.impactLevel },
        reason: decision.summary
      });
    }
  });

  return counts;
}

export async function resolveContextChangeAlert(
  session: DemoSession,
  alertId: string,
  input: ResolveContextChangeAlertInput
) {
  if (!contextAlertResolutionOptions.includes(input.resolutionType)) {
    throw new Error("Unsupported Context Change Alert resolution.");
  }

  await db.transaction(async (tx) => {
    const alert = await getAlertForUpdate(tx, alertId);
    if (!(await canManageCampaignLifecycle(session, alert.campaignId))) {
      throw new Error("Only the R&D Manager or Campaign Owner can resolve Context Change Alerts.");
    }
    if (alert.status !== "open") {
      throw new Error("Context Change Alert is already resolved.");
    }

    const now = new Date();
    await tx
      .update(contextChangeAlerts)
      .set({
        resolutionNote: input.note,
        resolutionType: input.resolutionType,
        resolvedAt: now,
        resolvedByUserId: session.user.id,
        status: "resolved",
        updatedAt: now
      })
      .where(and(eq(contextChangeAlerts.id, alertId), eq(contextChangeAlerts.status, "open")));

    if (input.resolutionType === "campaign_context_override" || input.resolutionType === "update_campaign_context") {
      await createContextDecision(tx, {
        alertId,
        actorUserId: session.user.id,
        campaignId: alert.campaignId,
        isOverride: input.resolutionType === "campaign_context_override",
        note: input.note,
        now
      });
    }

    if (input.resolutionType === "follow_up_question") {
      await tx.insert(campaignSetupQuestions).values({
        campaignId: alert.campaignId,
        createdAt: now,
        id: newId("setup-question"),
        priority: "warning",
        questionText: `Follow up on context alert: ${alert.recommendedResolution}`,
        rationale: alert.summary,
        recommendedAnswer: input.note,
        setupArea: "rules_memory",
        status: "open",
        updatedAt: now
      });
    }

    if (input.resolutionType === "escalate_to_manager") {
      await writeContextAudit(tx, {
        actorUserId: session.user.id,
        entityId: alert.campaignId,
        entityType: "campaign",
        eventType: "context.alert.escalated",
        metadata: { alertId },
        reason: input.note
      });
    }

    await writeContextAudit(tx, {
      actorUserId: session.user.id,
      entityId: alert.campaignId,
      entityType: "campaign",
      eventType: "context.alert.resolved",
      metadata: { alertId, resolutionType: input.resolutionType },
      reason: input.note
    });
  });
}

async function getLatestContext(contextType: "company" | "global_innovation") {
  const [context] = await db
    .select()
    .from(contextDocuments)
    .where(eq(contextDocuments.contextType, contextType))
    .orderBy(desc(contextDocuments.updatedAt))
    .limit(1);

  return context ?? null;
}

async function getVisibleAlerts(session: DemoSession) {
  const alerts = await db
    .select({
      campaignId: contextChangeAlerts.campaignId,
      campaignTitle: campaigns.publicTitle,
      createdAt: contextChangeAlerts.createdAt,
      id: contextChangeAlerts.id,
      recommendedResolution: contextChangeAlerts.recommendedResolution,
      sourceContextId: contextChangeAlerts.sourceContextId,
      summary: contextChangeAlerts.summary
    })
    .from(contextChangeAlerts)
    .innerJoin(campaigns, eq(campaigns.id, contextChangeAlerts.campaignId))
    .where(eq(contextChangeAlerts.status, "open"))
    .orderBy(desc(contextChangeAlerts.createdAt));

  const visibleAlerts = [];
  for (const alert of alerts) {
    if (session.role.id === "rd_manager" || (await canContributeToCampaign(session, alert.campaignId))) {
      visibleAlerts.push({
        ...alert,
        canResolve: await canManageCampaignLifecycle(session, alert.campaignId),
        resolutionOptions: contextAlertResolutionOptions
      });
    }
  }

  return visibleAlerts;
}

export async function getContextManagementView(session: DemoSession) {
  assertRAndDUser(session, "view Context Management");
  const [companyContext, globalInnovationContext, pendingProposals, activeAlerts] = await Promise.all([
    getLatestContext("company"),
    getLatestContext("global_innovation"),
    db
      .select()
      .from(globalContextChangeProposals)
      .where(eq(globalContextChangeProposals.status, "pending_manager_approval"))
      .orderBy(desc(globalContextChangeProposals.createdAt)),
    getVisibleAlerts(session)
  ]);

  return {
    activeAlerts,
    canManageContext: session.role.id === "rd_manager",
    companyContext,
    globalInnovationContext,
    pendingProposals
  };
}
