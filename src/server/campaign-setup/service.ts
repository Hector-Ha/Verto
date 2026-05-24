import crypto from "node:crypto";

import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { canContributeToCampaign, canManageCampaignLifecycle } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  auditEvents,
  campaignKnowledgeReports,
  campaignSetupAnswers,
  campaignSetupDecisions,
  campaignSetupQuestions,
  campaigns
} from "../db/schema";
import { getLlmModel } from "../env";
import { LlmInvalidResponseError, LlmProviderError, type LlmProvider } from "../llm/adapter";
import { generateAiSetupQuestion, type CampaignSetupPromptContext } from "./ai";

type SetupArea = (typeof campaignSetupQuestions.$inferSelect)["setupArea"];
type SetupQuestion = typeof campaignSetupQuestions.$inferSelect;
type SetupAnswer = typeof campaignSetupAnswers.$inferSelect;
type SetupCampaign = typeof campaigns.$inferSelect;
type AiDecisionLog = typeof aiDecisionLogs.$inferSelect;
type SetupTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const campaignSetupAreas = ["topic", "intent", "review_packet", "rules_memory", "final_review"] as const;
const setupMutableStatuses: Array<SetupCampaign["lifecycleStatus"]> = ["setup_in_progress", "setup_review"];
const setupQuestionAiPurpose = "campaign_setup.question";

export function isCampaignSetupArea(value: unknown): value is SetupArea {
  return typeof value === "string" && campaignSetupAreas.includes(value as SetupArea);
}

type AnswerSetupQuestionInput = {
  answerText: string;
  decisionTitle: string;
  isContextOverride?: boolean;
  isIntentionalAmbiguity?: boolean;
};

type EditPendingAnswerInput = {
  answerText: string;
};

type RejectAnswerInput = {
  reason?: string | null;
};

const priorityRank: Record<SetupQuestion["priority"], number> = {
  hard_blocker: 0,
  warning: 1,
  clarity: 2
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getSpecificCampaign(campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign || campaign.type !== "specific") {
    throw new Error("Specific campaign not found.");
  }

  return campaign;
}

async function getSpecificCampaignForUpdate(tx: SetupTx, campaignId: string) {
  const [campaign] = await tx
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)
    .for("update");
  if (!campaign || campaign.type !== "specific") {
    throw new Error("Specific campaign not found.");
  }

  return campaign;
}

async function getQuestion(questionId: string) {
  const [question] = await db.select().from(campaignSetupQuestions).where(eq(campaignSetupQuestions.id, questionId)).limit(1);
  if (!question) {
    throw new Error("Setup question not found.");
  }

  return question;
}

async function getAnswer(answerId: string) {
  const [answer] = await db.select().from(campaignSetupAnswers).where(eq(campaignSetupAnswers.id, answerId)).limit(1);
  if (!answer) {
    throw new Error("Setup answer not found.");
  }

  return answer;
}

async function assertCanManageSetup(session: DemoSession, campaignId: string, action: string) {
  if (!(await canManageCampaignLifecycle(session, campaignId))) {
    throw new Error(`Only the R&D Manager or Campaign Owner can ${action}.`);
  }
}

async function assertCanDraftSetup(session: DemoSession, campaignId: string) {
  if (!(await canContributeToCampaign(session, campaignId))) {
    throw new Error("Only campaign R&D members can contribute setup answers.");
  }
}

function assertCampaignSetupMutable(campaign: SetupCampaign, action: string) {
  if (!setupMutableStatuses.includes(campaign.lifecycleStatus)) {
    throw new Error(`Cannot ${action} after campaign setup is complete.`);
  }
}

async function writeSetupAudit(
  tx: SetupTx,
  session: DemoSession,
  eventType: string,
  campaignId: string,
  reason: string,
  metadata: Record<string, unknown> | null = null
) {
  await tx.insert(auditEvents).values({
    actorType: "user",
    actorUserId: session.user.id,
    createdAt: new Date(),
    entityId: campaignId,
    entityType: "campaign",
    eventType,
    id: newId("audit"),
    metadata,
    reason
  });
}

async function insertDecision(
  tx: SetupTx,
  answer: Pick<
    SetupAnswer,
    "answerText" | "campaignId" | "decisionTitle" | "id" | "isContextOverride" | "isIntentionalAmbiguity" | "setupArea"
  >
) {
  await tx.insert(campaignSetupDecisions).values({
    campaignId: answer.campaignId,
    createdAt: new Date(),
    id: newId("setup-decision"),
    isContextOverride: answer.isContextOverride,
    isIntentionalAmbiguity: answer.isIntentionalAmbiguity,
    setupArea: answer.setupArea,
    sourceAnswerId: answer.id,
    title: answer.decisionTitle,
    updatedAt: new Date(),
    value: answer.answerText
  });
}

async function getQuestionForUpdate(tx: SetupTx, questionId: string) {
  const [question] = await tx
    .select()
    .from(campaignSetupQuestions)
    .where(eq(campaignSetupQuestions.id, questionId))
    .limit(1)
    .for("update");
  if (!question) {
    throw new Error("Setup question not found.");
  }

  return question;
}

async function getAnswerForUpdate(tx: SetupTx, answerId: string) {
  const [answer] = await tx
    .select()
    .from(campaignSetupAnswers)
    .where(eq(campaignSetupAnswers.id, answerId))
    .limit(1)
    .for("update");
  if (!answer) {
    throw new Error("Setup answer not found.");
  }

  return answer;
}

async function getKnowledgeReportForUpdate(tx: SetupTx, reportId: string) {
  const [report] = await tx
    .select()
    .from(campaignKnowledgeReports)
    .where(eq(campaignKnowledgeReports.id, reportId))
    .limit(1)
    .for("update");
  if (!report) {
    throw new Error("Campaign Knowledge Report not found.");
  }

  return report;
}

async function getActiveAnswersForQuestion(tx: SetupTx, questionId: string) {
  return tx
    .select()
    .from(campaignSetupAnswers)
    .where(
      and(
        eq(campaignSetupAnswers.questionId, questionId),
        inArray(campaignSetupAnswers.status, ["pending_owner_approval", "approved"])
      )
    )
    .for("update");
}

function assertQuestionAcceptsNewAnswer(question: SetupQuestion, activeAnswers: SetupAnswer[]) {
  if (question.status !== "open") {
    throw new Error("Setup question is already answered or dismissed.");
  }

  if (activeAnswers.some((answer) => answer.status === "approved")) {
    throw new Error("Setup question is already answered.");
  }

  if (activeAnswers.some((answer) => answer.status === "pending_owner_approval")) {
    throw new Error("Setup question already has an answer pending owner approval.");
  }
}

function assertPendingAnswerCanBeApproved(question: SetupQuestion, activeAnswers: SetupAnswer[], answerId: string) {
  if (question.status !== "open") {
    throw new Error("Setup question is already answered or dismissed.");
  }

  if (activeAnswers.some((answer) => answer.status === "pending_owner_approval" && answer.id !== answerId)) {
    throw new Error("Setup question already has another answer pending owner approval.");
  }

  if (activeAnswers.some((answer) => answer.status === "approved" && answer.id !== answerId)) {
    throw new Error("Setup question is already answered.");
  }
}

async function invalidateCampaignKnowledgeReports(tx: SetupTx, campaignId: string) {
  await tx
    .update(campaignKnowledgeReports)
    .set({ status: "stale", updatedAt: new Date() })
    .where(and(eq(campaignKnowledgeReports.campaignId, campaignId), ne(campaignKnowledgeReports.status, "stale")));
}

type CampaignSetupAiReference = {
  attemptStartedAt: string;
  campaignId: string;
  latestReportId: string | null;
  openQuestionIds: string[];
  structuredDecisionIds: string[];
};

function isCampaignSetupAiReference(value: unknown): value is CampaignSetupAiReference {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<CampaignSetupAiReference>;

  return (
    typeof candidate.attemptStartedAt === "string" &&
    typeof candidate.campaignId === "string" &&
    (typeof candidate.latestReportId === "string" || candidate.latestReportId === null) &&
    Array.isArray(candidate.openQuestionIds) &&
    candidate.openQuestionIds.every((id) => typeof id === "string") &&
    Array.isArray(candidate.structuredDecisionIds) &&
    candidate.structuredDecisionIds.every((id) => typeof id === "string")
  );
}

function parseCampaignSetupAiReference(inputReference: string) {
  try {
    const parsed = JSON.parse(inputReference) as unknown;
    return isCampaignSetupAiReference(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildCampaignSetupAiReference(
  campaignId: string,
  view: Awaited<ReturnType<typeof getCampaignSetupView>>,
  attemptStartedAt: Date
): CampaignSetupAiReference {
  return {
    attemptStartedAt: attemptStartedAt.toISOString(),
    campaignId,
    latestReportId: view.latestReport?.id ?? null,
    openQuestionIds: view.questionQueue.map((question) => question.id),
    structuredDecisionIds: view.structuredSetup.map((decision) => decision.id)
  };
}

async function buildCampaignSetupAiReferenceForUpdate(
  tx: SetupTx,
  campaignId: string,
  attemptStartedAt: Date
): Promise<CampaignSetupAiReference> {
  const openQuestions = await tx
    .select({ id: campaignSetupQuestions.id })
    .from(campaignSetupQuestions)
    .where(and(eq(campaignSetupQuestions.campaignId, campaignId), eq(campaignSetupQuestions.status, "open")))
    .for("update");
  const structuredDecisions = await tx
    .select({ id: campaignSetupDecisions.id })
    .from(campaignSetupDecisions)
    .where(eq(campaignSetupDecisions.campaignId, campaignId))
    .for("update");

  return {
    attemptStartedAt: attemptStartedAt.toISOString(),
    campaignId,
    latestReportId: null,
    openQuestionIds: openQuestions.map((question) => question.id),
    structuredDecisionIds: structuredDecisions.map((decision) => decision.id)
  };
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightValues = new Set(right);

  return left.every((value) => rightValues.has(value));
}

function setupAiReferencesMatch(left: CampaignSetupAiReference, right: CampaignSetupAiReference) {
  return (
    left.campaignId === right.campaignId &&
    sameStringSet(left.openQuestionIds, right.openQuestionIds) &&
    sameStringSet(left.structuredDecisionIds, right.structuredDecisionIds)
  );
}

function getCampaignSetupAiContext(view: Awaited<ReturnType<typeof getCampaignSetupView>>): CampaignSetupPromptContext {
  return {
    campaign: {
      id: view.campaign.id,
      lifecycleStatus: view.campaign.lifecycleStatus,
      publicPrompt: view.campaign.publicPrompt,
      publicTitle: view.campaign.publicTitle
    },
    latestReportStatus: view.latestReport?.status ?? null,
    openQuestions: view.questionQueue.map((question) => ({
      priority: question.priority,
      questionText: question.questionText,
      setupArea: question.setupArea
    })),
    structuredSetup: view.structuredSetup.map((decision) => ({
      isContextOverride: decision.isContextOverride,
      isIntentionalAmbiguity: decision.isIntentionalAmbiguity,
      setupArea: decision.setupArea,
      title: decision.title,
      value: decision.value
    })),
    warnings: view.warnings.map((warning) => ({
      questionText: warning.questionText
    }))
  };
}

async function getCampaignSetupAiLogs(campaignId: string) {
  const logs = await db
    .select()
    .from(aiDecisionLogs)
    .where(eq(aiDecisionLogs.purpose, setupQuestionAiPurpose))
    .orderBy(desc(aiDecisionLogs.createdAt));

  return logs
    .map((log) => ({
      log,
      reference: parseCampaignSetupAiReference(log.inputReference)
    }))
    .filter((entry): entry is { log: AiDecisionLog; reference: CampaignSetupAiReference } => {
      return entry.reference?.campaignId === campaignId;
    })
    .sort((left, right) => right.reference.attemptStartedAt.localeCompare(left.reference.attemptStartedAt));
}

function getBlockingAiRetryStates(aiLogs: Awaited<ReturnType<typeof getCampaignSetupAiLogs>>) {
  const [latestAttempt] = aiLogs;

  return latestAttempt?.log.status === "retry_required" ? [latestAttempt.log] : [];
}

function assertNoAiRetryState(view: Awaited<ReturnType<typeof getCampaignSetupView>>, action: string) {
  if (view.aiRetryStates.length > 0) {
    throw new Error(`AI setup retry state must be resolved before ${action}.`);
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown LLM failure.";
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

async function writeAiSetupAudit(
  tx: SetupTx,
  eventType: string,
  campaignId: string,
  reason: string,
  metadata: Record<string, unknown> | null = null
) {
  await tx.insert(auditEvents).values({
    actorType: "ai",
    actorUserId: null,
    createdAt: new Date(),
    entityId: campaignId,
    entityType: "campaign",
    eventType,
    id: newId("audit"),
    metadata,
    reason
  });
}

export async function getCampaignSetupView(campaignId: string) {
  const campaign = await getSpecificCampaign(campaignId);
  const questions = await db
    .select()
    .from(campaignSetupQuestions)
    .where(eq(campaignSetupQuestions.campaignId, campaignId));
  const answers = await db
    .select()
    .from(campaignSetupAnswers)
    .where(eq(campaignSetupAnswers.campaignId, campaignId))
    .orderBy(campaignSetupAnswers.createdAt);
  const structuredSetup = await db
    .select()
    .from(campaignSetupDecisions)
    .where(eq(campaignSetupDecisions.campaignId, campaignId))
    .orderBy(campaignSetupDecisions.createdAt);
  const [latestReport] = await db
    .select()
    .from(campaignKnowledgeReports)
    .where(and(eq(campaignKnowledgeReports.campaignId, campaignId), ne(campaignKnowledgeReports.status, "stale")))
    .orderBy(desc(campaignKnowledgeReports.generatedAt))
    .limit(1);
  const aiLogs = await getCampaignSetupAiLogs(campaignId);
  const aiRetryStates = getBlockingAiRetryStates(aiLogs);

  const questionQueue = questions
    .filter((question) => question.status === "open")
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]);
  const pendingOwnerApprovals = answers.filter((answer) => answer.status === "pending_owner_approval");
  const rejectedAnswers = answers.filter((answer) => answer.status === "rejected");
  const warnings = questionQueue.filter((question) => question.priority === "warning");
  const hardBlockers = questionQueue.filter((question) => question.priority === "hard_blocker");
  const ownerAttentionQueue = [
    ...hardBlockers.map((question) => ({ id: question.id, kind: "hard_blocker" as const, text: question.questionText })),
    ...aiRetryStates.map((log) => ({
      id: log.id,
      kind: "ai_retry_required" as const,
      text: log.outputSummary ?? "AI retry required before this setup step can continue."
    })),
    ...pendingOwnerApprovals.map((answer) => ({ id: answer.id, kind: "pending_owner_approval" as const, text: answer.answerText })),
    ...warnings.map((question) => ({ id: question.id, kind: "warning" as const, text: question.questionText }))
  ];

  return {
    aiRetryStates,
    campaign,
    latestReport: latestReport ?? null,
    openHardBlockerCount: hardBlockers.length,
    ownerAttentionQueue,
    pendingOwnerApprovals,
    questionQueue,
    rejectedAnswers,
    structuredSetup,
    warnings
  };
}

export async function getAuthorizedCampaignSetupView(session: DemoSession, campaignId: string) {
  if (!(await canContributeToCampaign(session, campaignId))) {
    throw new Error("Only campaign R&D members can view setup.");
  }

  const [view, canManageSetup] = await Promise.all([
    getCampaignSetupView(campaignId),
    canManageCampaignLifecycle(session, campaignId)
  ]);

  return {
    ...view,
    canManageSetup
  };
}

export async function answerSetupQuestion(
  session: DemoSession,
  questionId: string,
  input: AnswerSetupQuestionInput
) {
  const question = await getQuestion(questionId);
  const campaign = await getSpecificCampaign(question.campaignId);
  assertCampaignSetupMutable(campaign, "answer setup questions");
  await assertCanDraftSetup(session, question.campaignId);

  const canApproveOwnAnswer = await canManageCampaignLifecycle(session, question.campaignId);
  const status = canApproveOwnAnswer ? "approved" : "pending_owner_approval";
  const now = new Date();
  const answerId = newId("setup-answer");

  await db.transaction(async (tx) => {
    const lockedQuestion = await getQuestionForUpdate(tx, questionId);
    const lockedCampaign = await getSpecificCampaignForUpdate(tx, lockedQuestion.campaignId);
    assertCampaignSetupMutable(lockedCampaign, "answer setup questions");
    const activeAnswers = await getActiveAnswersForQuestion(tx, questionId);
    assertQuestionAcceptsNewAnswer(lockedQuestion, activeAnswers);

    await tx.insert(campaignSetupAnswers).values({
      answerText: input.answerText,
      approvedAt: canApproveOwnAnswer ? now : null,
      approvedByUserId: canApproveOwnAnswer ? session.user.id : null,
      authorUserId: session.user.id,
      campaignId: lockedQuestion.campaignId,
      createdAt: now,
      decisionTitle: input.decisionTitle,
      id: answerId,
      isContextOverride: input.isContextOverride ?? false,
      isIntentionalAmbiguity: input.isIntentionalAmbiguity ?? false,
      questionId,
      rejectedAt: null,
      rejectedByUserId: null,
      rejectionReason: null,
      setupArea: lockedQuestion.setupArea,
      status,
      updatedAt: now
    });

    if (canApproveOwnAnswer) {
      await tx
        .update(campaignSetupQuestions)
        .set({ status: "answered", updatedAt: now })
        .where(eq(campaignSetupQuestions.id, questionId));
      await insertDecision(tx, {
        answerText: input.answerText,
        campaignId: lockedQuestion.campaignId,
        decisionTitle: input.decisionTitle,
        id: answerId,
        isContextOverride: input.isContextOverride ?? false,
        isIntentionalAmbiguity: input.isIntentionalAmbiguity ?? false,
        setupArea: lockedQuestion.setupArea
      });
      await invalidateCampaignKnowledgeReports(tx, lockedQuestion.campaignId);
    }

    await writeSetupAudit(
      tx,
      session,
      canApproveOwnAnswer ? "campaign.setup.answer.approved" : "campaign.setup.answer.pending",
      lockedQuestion.campaignId,
      canApproveOwnAnswer ? "Setup answer approved by owner." : "Setup answer pending owner approval.",
      { answerId, questionId }
    );
  });

  return { answerId, status };
}

export async function editPendingSetupAnswer(
  session: DemoSession,
  answerId: string,
  input: EditPendingAnswerInput
) {
  const answer = await getAnswer(answerId);
  await assertCanManageSetup(session, answer.campaignId, "edit pending setup answers");
  const campaign = await getSpecificCampaign(answer.campaignId);
  assertCampaignSetupMutable(campaign, "edit pending setup answers");

  await db.transaction(async (tx) => {
    const currentAnswer = await getAnswerForUpdate(tx, answerId);
    if (currentAnswer.status !== "pending_owner_approval") {
      throw new Error("Only pending setup answers can be edited.");
    }
    const lockedCampaign = await getSpecificCampaignForUpdate(tx, currentAnswer.campaignId);
    assertCampaignSetupMutable(lockedCampaign, "edit pending setup answers");

    await tx
      .update(campaignSetupAnswers)
      .set({
        answerText: input.answerText,
        ownerEditedByUserId: session.user.id,
        updatedAt: new Date()
      })
      .where(and(eq(campaignSetupAnswers.id, answerId), eq(campaignSetupAnswers.status, "pending_owner_approval")));
    await writeSetupAudit(tx, session, "campaign.setup.answer.edited", currentAnswer.campaignId, "Pending setup answer edited.", {
      answerId
    });
  });
}

export async function approveSetupAnswer(session: DemoSession, answerId: string) {
  const answer = await getAnswer(answerId);
  await assertCanManageSetup(session, answer.campaignId, "approve setup answers");
  const campaign = await getSpecificCampaign(answer.campaignId);
  assertCampaignSetupMutable(campaign, "approve setup answers");
  if (answer.status !== "pending_owner_approval") {
    throw new Error("Only pending setup answers can be approved.");
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    const lockedQuestion = await getQuestionForUpdate(tx, answer.questionId);
    const currentAnswer = await getAnswerForUpdate(tx, answerId);
    if (currentAnswer.status !== "pending_owner_approval") {
      throw new Error("Only pending setup answers can be approved.");
    }
    if (currentAnswer.questionId !== lockedQuestion.id) {
      throw new Error("Setup answer no longer belongs to the locked setup question.");
    }
    const lockedCampaign = await getSpecificCampaignForUpdate(tx, currentAnswer.campaignId);
    assertCampaignSetupMutable(lockedCampaign, "approve setup answers");

    const activeAnswers = await getActiveAnswersForQuestion(tx, currentAnswer.questionId);
    assertPendingAnswerCanBeApproved(lockedQuestion, activeAnswers, answerId);

    await tx
      .update(campaignSetupAnswers)
      .set({
        approvedAt: now,
        approvedByUserId: session.user.id,
        status: "approved",
        updatedAt: now
      })
      .where(and(eq(campaignSetupAnswers.id, answerId), eq(campaignSetupAnswers.status, "pending_owner_approval")));
    await tx
      .update(campaignSetupQuestions)
      .set({ status: "answered", updatedAt: now })
      .where(eq(campaignSetupQuestions.id, currentAnswer.questionId));
    await insertDecision(tx, currentAnswer);
    await invalidateCampaignKnowledgeReports(tx, currentAnswer.campaignId);
    await writeSetupAudit(tx, session, "campaign.setup.answer.approved", answer.campaignId, "Pending setup answer approved.", {
      answerId,
      questionId: currentAnswer.questionId
    });
  });
}

export async function rejectSetupAnswer(session: DemoSession, answerId: string, input: RejectAnswerInput = {}) {
  const answer = await getAnswer(answerId);
  await assertCanManageSetup(session, answer.campaignId, "reject setup answers");
  const campaign = await getSpecificCampaign(answer.campaignId);
  assertCampaignSetupMutable(campaign, "reject setup answers");
  if (answer.status !== "pending_owner_approval") {
    throw new Error("Only pending setup answers can be rejected.");
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    const currentAnswer = await getAnswerForUpdate(tx, answerId);
    if (currentAnswer.status !== "pending_owner_approval") {
      throw new Error("Only pending setup answers can be rejected.");
    }
    const lockedCampaign = await getSpecificCampaignForUpdate(tx, currentAnswer.campaignId);
    assertCampaignSetupMutable(lockedCampaign, "reject setup answers");

    await tx
      .update(campaignSetupAnswers)
      .set({
        rejectedAt: now,
        rejectedByUserId: session.user.id,
        rejectionReason: input.reason ?? null,
        status: "rejected",
        updatedAt: now
      })
      .where(and(eq(campaignSetupAnswers.id, answerId), eq(campaignSetupAnswers.status, "pending_owner_approval")));
    await writeSetupAudit(tx, session, "campaign.setup.answer.rejected", currentAnswer.campaignId, "Pending setup answer rejected.", {
      answerId,
      reason: input.reason ?? null
    });
  });
}

export async function requestAiSetupQuestion(
  session: DemoSession,
  campaignId: string,
  options: {
    provider?: LlmProvider;
  } = {}
) {
  await assertCanManageSetup(session, campaignId, "request AI setup questions");
  const campaign = await getSpecificCampaign(campaignId);
  assertCampaignSetupMutable(campaign, "request AI setup questions");

  const view = await getCampaignSetupView(campaignId);
  const attemptStartedAt = new Date();
  const inputReference = JSON.stringify(buildCampaignSetupAiReference(campaignId, view, attemptStartedAt));
  const model = getLlmModel();

  try {
    const aiResult = await generateAiSetupQuestion(getCampaignSetupAiContext(view), {
      model,
      provider: options.provider
    });
    const now = new Date();
    const logId = newId("ai-decision");
    const questionId = newId("setup-question");
    let transactionResult:
      | {
          logId: string;
          questionId: string;
          status: "succeeded";
        }
      | {
          logId: string;
          status: "retry_required";
        }
      | null = null;

    await db.transaction(async (tx) => {
      const lockedCampaign = await getSpecificCampaignForUpdate(tx, campaignId);
      assertCampaignSetupMutable(lockedCampaign, "request AI setup questions");
      const originalReference = parseCampaignSetupAiReference(inputReference);
      const currentReference = await buildCampaignSetupAiReferenceForUpdate(tx, campaignId, attemptStartedAt);

      if (!originalReference || !setupAiReferencesMatch(originalReference, currentReference)) {
        const outputSummary = "Campaign setup changed while AI was generating; retry required.";
        await tx.insert(aiDecisionLogs).values({
          createdAt: now,
          decisionResult: aiResult.parsedQuestion,
          id: logId,
          inputReference,
          model: aiResult.model,
          outputSummary,
          purpose: setupQuestionAiPurpose,
          rawResponse: aiResult.rawResponse,
          status: "retry_required"
        });
        await writeAiSetupAudit(tx, "campaign.setup.ai_question.retry_required", campaignId, "AI setup question retry required.", {
          error: outputSummary,
          logId,
          requestedByUserId: session.user.id
        });
        transactionResult = {
          logId,
          status: "retry_required"
        };
        return;
      }

      await tx.insert(aiDecisionLogs).values({
        createdAt: now,
        decisionResult: aiResult.parsedQuestion,
        id: logId,
        inputReference,
        model: aiResult.model,
        outputSummary: aiResult.parsedQuestion.questionText,
        purpose: setupQuestionAiPurpose,
        rawResponse: aiResult.rawResponse,
        status: "succeeded"
      });
      await tx.insert(campaignSetupQuestions).values({
        campaignId,
        createdAt: now,
        id: questionId,
        priority: aiResult.parsedQuestion.priority,
        questionText: aiResult.parsedQuestion.questionText,
        rationale: aiResult.parsedQuestion.rationale,
        recommendedAnswer: aiResult.parsedQuestion.recommendedAnswer,
        setupArea: aiResult.parsedQuestion.setupArea,
        status: "open",
        updatedAt: now
      });
      await invalidateCampaignKnowledgeReports(tx, campaignId);
      await writeAiSetupAudit(tx, "campaign.setup.ai_question.generated", campaignId, "AI setup question generated.", {
        logId,
        questionId,
        requestedByUserId: session.user.id
      });
      transactionResult = {
        logId,
        questionId,
        status: "succeeded"
      };
    });

    if (!transactionResult) {
      throw new Error("AI setup question transaction did not complete.");
    }

    return transactionResult;
  } catch (error) {
    const now = new Date();
    const logId = newId("ai-decision");

    await db.transaction(async (tx) => {
      await tx.insert(aiDecisionLogs).values({
        createdAt: now,
        decisionResult: getErrorDecisionResult(error),
        id: logId,
        inputReference,
        model,
        outputSummary: getErrorMessage(error),
        purpose: setupQuestionAiPurpose,
        rawResponse: getErrorRawResponse(error),
        status: "retry_required"
      });
      await writeAiSetupAudit(tx, "campaign.setup.ai_question.retry_required", campaignId, "AI setup question retry required.", {
        error: getErrorMessage(error),
        logId,
        requestedByUserId: session.user.id
      });
    });

    return {
      logId,
      status: "retry_required" as const
    };
  }
}

function renderKnowledgeReport(view: Awaited<ReturnType<typeof getCampaignSetupView>>) {
  const decisions = view.structuredSetup
    .map(
      (decision) =>
        `<li><strong>${escapeHtml(decision.title)}</strong>: ${escapeHtml(decision.value)}${
          decision.isIntentionalAmbiguity ? " <em>Intentional ambiguity</em>" : ""
        }${decision.isContextOverride ? " <em>Campaign context override</em>" : ""}</li>`
    )
    .join("");
  const warnings = view.warnings.map((warning) => `<li>${escapeHtml(warning.questionText)}</li>`).join("");
  const unresolved = view.questionQueue
    .filter((question) => question.priority !== "warning")
    .map((question) => `<li>${escapeHtml(question.questionText)}</li>`)
    .join("");

  return [
    `<article>`,
    `<h1>Campaign Knowledge Report</h1>`,
    `<p>${escapeHtml(view.campaign.publicTitle)}</p>`,
    `<h2>Approved Setup</h2>`,
    `<ul>${decisions || "<li>No approved setup decisions yet.</li>"}</ul>`,
    `<h2>Warnings</h2>`,
    `<ul>${warnings || "<li>No unresolved setup warnings.</li>"}</ul>`,
    `<h2>Unresolved Assumptions</h2>`,
    `<ul>${unresolved || "<li>No unresolved hard blockers or clarity questions.</li>"}</ul>`,
    `</article>`
  ].join("");
}

export async function generateCampaignKnowledgeReport(session: DemoSession, campaignId: string) {
  await assertCanManageSetup(session, campaignId, "generate campaign knowledge reports");
  const campaign = await getSpecificCampaign(campaignId);
  assertCampaignSetupMutable(campaign, "generate campaign knowledge reports");
  const view = await getCampaignSetupView(campaignId);
  assertNoAiRetryState(view, "generating a Campaign Knowledge Report");
  const now = new Date();
  const report = {
    campaignId,
    createdAt: now,
    generatedAt: now,
    html: renderKnowledgeReport(view),
    id: newId("knowledge-report"),
    status: "draft" as const,
    updatedAt: now
  };

  await db.transaction(async (tx) => {
    const lockedCampaign = await getSpecificCampaignForUpdate(tx, campaignId);
    assertCampaignSetupMutable(lockedCampaign, "generate campaign knowledge reports");
    assertNoAiRetryState(await getCampaignSetupView(campaignId), "generating a Campaign Knowledge Report");
    await tx.insert(campaignKnowledgeReports).values(report);
    await writeSetupAudit(tx, session, "campaign.knowledge_report.generated", campaignId, "Campaign knowledge report generated.", {
      reportId: report.id
    });
  });

  return report;
}

export async function approveCampaignKnowledgeReport(session: DemoSession, reportId: string) {
  const [report] = await db.select().from(campaignKnowledgeReports).where(eq(campaignKnowledgeReports.id, reportId)).limit(1);
  if (!report) {
    throw new Error("Campaign Knowledge Report not found.");
  }

  await assertCanManageSetup(session, report.campaignId, "approve campaign knowledge reports");
  const campaign = await getSpecificCampaign(report.campaignId);
  assertCampaignSetupMutable(campaign, "approve campaign knowledge reports");

  await db.transaction(async (tx) => {
    const currentReport = await getKnowledgeReportForUpdate(tx, reportId);
    const lockedCampaign = await getSpecificCampaignForUpdate(tx, currentReport.campaignId);
    assertCampaignSetupMutable(lockedCampaign, "approve campaign knowledge reports");
    if (currentReport.status === "stale") {
      throw new Error("Campaign Knowledge Report must be regenerated after setup changes.");
    }
    if (currentReport.status !== "draft") {
      throw new Error("Only draft Campaign Knowledge Reports can be approved.");
    }

    const view = await getCampaignSetupView(currentReport.campaignId);
    assertNoAiRetryState(view, "approving a Campaign Knowledge Report");
    if (view.openHardBlockerCount > 0) {
      throw new Error("Campaign Knowledge Report cannot be approved while setup hard blockers remain.");
    }
    if (view.structuredSetup.length === 0) {
      throw new Error("Campaign Knowledge Report requires an approved setup baseline before approval.");
    }

    const now = new Date();
    await tx
      .update(campaignKnowledgeReports)
      .set({
        approvedAt: now,
        approvedByUserId: session.user.id,
        status: "approved",
        updatedAt: now
      })
      .where(and(eq(campaignKnowledgeReports.id, reportId), eq(campaignKnowledgeReports.status, "draft")));
    await writeSetupAudit(
      tx,
      session,
      "campaign.knowledge_report.approved",
      currentReport.campaignId,
      "Campaign knowledge report approved.",
      { reportId }
    );
  });
}

export async function assertCampaignSetupReadyForIntake(campaignId: string) {
  const view = await getCampaignSetupView(campaignId);
  assertNoAiRetryState(view, "opening intake");
  if (view.openHardBlockerCount > 0) {
    throw new Error("Setup hard blockers prevent opening intake.");
  }
  if (view.structuredSetup.length === 0) {
    throw new Error("Campaign Knowledge Report requires an approved setup baseline before opening intake.");
  }

  const [staleReport] = await db
    .select({ id: campaignKnowledgeReports.id })
    .from(campaignKnowledgeReports)
    .where(and(eq(campaignKnowledgeReports.campaignId, campaignId), eq(campaignKnowledgeReports.status, "stale")))
    .orderBy(desc(campaignKnowledgeReports.updatedAt))
    .limit(1);

  if (!view.latestReport && staleReport) {
    throw new Error("Campaign Knowledge Report must be regenerated and approved after setup changes.");
  }

  if (view.latestReport?.status !== "approved") {
    throw new Error("Campaign Knowledge Report must be approved before opening intake.");
  }
}
