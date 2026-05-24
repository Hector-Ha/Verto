import crypto from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { canContributeToCampaign, canManageCampaignLifecycle } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  auditEvents,
  campaignKnowledgeReports,
  campaignSetupAnswers,
  campaignSetupDecisions,
  campaignSetupQuestions,
  campaigns
} from "../db/schema";

type SetupArea = (typeof campaignSetupQuestions.$inferSelect)["setupArea"];
type SetupQuestion = typeof campaignSetupQuestions.$inferSelect;
type SetupAnswer = typeof campaignSetupAnswers.$inferSelect;

export const campaignSetupAreas = ["topic", "intent", "review_packet", "rules_memory", "final_review"] as const;

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

async function writeSetupAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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
    .where(eq(campaignKnowledgeReports.campaignId, campaignId))
    .orderBy(desc(campaignKnowledgeReports.generatedAt))
    .limit(1);

  const questionQueue = questions
    .filter((question) => question.status === "open")
    .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority]);
  const pendingOwnerApprovals = answers.filter((answer) => answer.status === "pending_owner_approval");
  const rejectedAnswers = answers.filter((answer) => answer.status === "rejected");
  const warnings = questionQueue.filter((question) => question.priority === "warning");
  const hardBlockers = questionQueue.filter((question) => question.priority === "hard_blocker");
  const ownerAttentionQueue = [
    ...hardBlockers.map((question) => ({ id: question.id, kind: "hard_blocker" as const, text: question.questionText })),
    ...pendingOwnerApprovals.map((answer) => ({ id: answer.id, kind: "pending_owner_approval" as const, text: answer.answerText })),
    ...warnings.map((question) => ({ id: question.id, kind: "warning" as const, text: question.questionText }))
  ];

  return {
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

export async function answerSetupQuestion(
  session: DemoSession,
  questionId: string,
  input: AnswerSetupQuestionInput
) {
  const question = await getQuestion(questionId);
  if (question.status !== "open") {
    throw new Error("Setup question is already answered or dismissed.");
  }

  await getSpecificCampaign(question.campaignId);
  await assertCanDraftSetup(session, question.campaignId);

  const canApproveOwnAnswer = await canManageCampaignLifecycle(session, question.campaignId);
  const status = canApproveOwnAnswer ? "approved" : "pending_owner_approval";
  const now = new Date();
  const answerId = newId("setup-answer");

  await db.transaction(async (tx) => {
    await tx.insert(campaignSetupAnswers).values({
      answerText: input.answerText,
      approvedAt: canApproveOwnAnswer ? now : null,
      approvedByUserId: canApproveOwnAnswer ? session.user.id : null,
      authorUserId: session.user.id,
      campaignId: question.campaignId,
      createdAt: now,
      decisionTitle: input.decisionTitle,
      id: answerId,
      isContextOverride: input.isContextOverride ?? false,
      isIntentionalAmbiguity: input.isIntentionalAmbiguity ?? false,
      questionId,
      rejectedAt: null,
      rejectedByUserId: null,
      rejectionReason: null,
      setupArea: question.setupArea,
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
        campaignId: question.campaignId,
        decisionTitle: input.decisionTitle,
        id: answerId,
        isContextOverride: input.isContextOverride ?? false,
        isIntentionalAmbiguity: input.isIntentionalAmbiguity ?? false,
        setupArea: question.setupArea
      });
    }

    await writeSetupAudit(
      tx,
      session,
      canApproveOwnAnswer ? "campaign.setup.answer.approved" : "campaign.setup.answer.pending",
      question.campaignId,
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
  if (answer.status !== "pending_owner_approval") {
    throw new Error("Only pending setup answers can be edited.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(campaignSetupAnswers)
      .set({
        answerText: input.answerText,
        ownerEditedByUserId: session.user.id,
        updatedAt: new Date()
      })
      .where(eq(campaignSetupAnswers.id, answerId));
    await writeSetupAudit(tx, session, "campaign.setup.answer.edited", answer.campaignId, "Pending setup answer edited.", {
      answerId
    });
  });
}

export async function approveSetupAnswer(session: DemoSession, answerId: string) {
  const answer = await getAnswer(answerId);
  await assertCanManageSetup(session, answer.campaignId, "approve setup answers");
  if (answer.status !== "pending_owner_approval") {
    throw new Error("Only pending setup answers can be approved.");
  }

  const now = new Date();
  const [currentAnswer] = await db.select().from(campaignSetupAnswers).where(eq(campaignSetupAnswers.id, answerId)).limit(1);
  if (!currentAnswer) {
    throw new Error("Setup answer not found.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(campaignSetupAnswers)
      .set({
        approvedAt: now,
        approvedByUserId: session.user.id,
        status: "approved",
        updatedAt: now
      })
      .where(eq(campaignSetupAnswers.id, answerId));
    await tx
      .update(campaignSetupQuestions)
      .set({ status: "answered", updatedAt: now })
      .where(eq(campaignSetupQuestions.id, currentAnswer.questionId));
    await insertDecision(tx, currentAnswer);
    await writeSetupAudit(tx, session, "campaign.setup.answer.approved", answer.campaignId, "Pending setup answer approved.", {
      answerId,
      questionId: currentAnswer.questionId
    });
  });
}

export async function rejectSetupAnswer(session: DemoSession, answerId: string, input: RejectAnswerInput = {}) {
  const answer = await getAnswer(answerId);
  await assertCanManageSetup(session, answer.campaignId, "reject setup answers");
  if (answer.status !== "pending_owner_approval") {
    throw new Error("Only pending setup answers can be rejected.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(campaignSetupAnswers)
      .set({
        rejectedAt: new Date(),
        rejectedByUserId: session.user.id,
        rejectionReason: input.reason ?? null,
        status: "rejected",
        updatedAt: new Date()
      })
      .where(eq(campaignSetupAnswers.id, answerId));
    await writeSetupAudit(tx, session, "campaign.setup.answer.rejected", answer.campaignId, "Pending setup answer rejected.", {
      answerId,
      reason: input.reason ?? null
    });
  });
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
  const view = await getCampaignSetupView(campaignId);
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
  const view = await getCampaignSetupView(report.campaignId);
  if (view.openHardBlockerCount > 0) {
    throw new Error("Campaign Knowledge Report cannot be approved while setup hard blockers remain.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(campaignKnowledgeReports)
      .set({
        approvedAt: new Date(),
        approvedByUserId: session.user.id,
        status: "approved",
        updatedAt: new Date()
      })
      .where(eq(campaignKnowledgeReports.id, reportId));
    await writeSetupAudit(
      tx,
      session,
      "campaign.knowledge_report.approved",
      report.campaignId,
      "Campaign knowledge report approved.",
      { reportId }
    );
  });
}

export async function assertCampaignSetupReadyForIntake(campaignId: string) {
  const view = await getCampaignSetupView(campaignId);
  if (view.openHardBlockerCount > 0) {
    throw new Error("Setup hard blockers prevent opening intake.");
  }

  if (view.latestReport?.status !== "approved") {
    throw new Error("Campaign Knowledge Report must be approved before opening intake.");
  }
}
