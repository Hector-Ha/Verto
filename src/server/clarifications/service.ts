import crypto from "node:crypto";

import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";

import { canContributeToCampaign } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  auditEvents,
  campaignMemberships,
  campaigns,
  clarificationRequests,
  ideaStateHistory,
  ideas,
  users
} from "../db/schema";
import { getAppBaseUrl, getClarificationLinkSecret, getLlmModel } from "../env";
import {
  callStructuredTool,
  LlmInvalidResponseError,
  LlmProviderError,
  type LlmProvider
} from "../llm/adapter";
import { sendClarificationEmail, type ClarificationEmailProvider } from "../email/adapter";

export type { ClarificationEmailProvider } from "../email/adapter";

type ClarificationOptions = {
  appBaseUrl?: string;
  emailProvider?: ClarificationEmailProvider;
  expiresAt?: Date;
  now?: Date;
  provider?: LlmProvider;
};

type JsonRecord = Record<string, unknown>;
type AssumptionRoutingDecision = "future_opportunity" | "inactive_idea";

const clarificationPurpose = "employee_clarification.question";
const assumptionRoutingPurpose = "employee_clarification.assumption_routing";
const clarificationTool = {
  description: "Record exactly one focused employee clarification question for a submitted idea.",
  name: "record_employee_clarification_question",
  parameters: {
    additionalProperties: false,
    properties: {
      questionText: {
        description: "One employee-safe question. Do not expose internal routing labels, rank, outcome, or review criteria.",
        type: "string"
      },
      rationale: {
        description: "Internal reason this question is needed before R&D review.",
        type: "string"
      }
    },
    required: ["questionText", "rationale"],
    type: "object"
  }
};
const assumptionRoutingTool = {
  description: "Record assumption-based routing for an unanswered expired employee clarification.",
  name: "record_assumption_based_routing",
  parameters: {
    additionalProperties: false,
    properties: {
      assumptions: {
        description: "Concise assumptions AI used because no employee answer arrived.",
        type: "string"
      },
      rationale: {
        description: "Why those assumptions are reasonable from existing source material.",
        type: "string"
      },
      routingDecision: {
        description: "Supported routing decision after timeout.",
        enum: ["future_opportunity", "inactive_idea"],
        type: "string"
      }
    },
    required: ["assumptions", "rationale", "routingDecision"],
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

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function tokenHash(token: string) {
  return crypto.createHmac("sha256", getClarificationLinkSecret()).update(token).digest("hex");
}

function createMagicToken(requestId: string) {
  const signature = crypto.createHmac("sha256", getClarificationLinkSecret()).update(requestId).digest("base64url");

  return `${requestId}.${signature}`;
}

function buildClarificationLink(baseUrl: string, token: string) {
  return new URL(`/clarifications/${token}`, baseUrl).toString();
}

export function formatClarificationExpiryDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC"
  }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readRequiredString(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LlmInvalidResponseError(`LLM clarification result is missing ${key}.`, rawResponse, value);
  }

  return raw.trim();
}

function readAssumptionRoutingDecision(value: JsonRecord, rawResponse: JsonRecord | null): AssumptionRoutingDecision {
  const raw = value.routingDecision;
  if (raw === "future_opportunity" || raw === "inactive_idea") {
    return raw;
  }

  throw new LlmInvalidResponseError("LLM assumption routing result used an unsupported routing decision.", rawResponse, value);
}

async function readIdeaContext(ideaId: string) {
  const [row] = await db
    .select({
      campaignId: ideas.campaignId,
      campaignPrompt: campaigns.publicPrompt,
      campaignTitle: campaigns.publicTitle,
      currentWorkflowState: ideaStateHistory.workflowState,
      evidenceExample: ideas.evidenceExample,
      expectedBenefit: ideas.expectedBenefit,
      ideaId: ideas.id,
      originalText: ideas.originalText,
      previewPrompt: ideas.previewPrompt,
      previewTitle: ideas.previewTitle,
      problemOpportunity: ideas.problemOpportunity,
      submitterDisplayName: users.displayName,
      submitterEmail: users.email,
      submitterUserId: ideas.submitterUserId,
      supportingLink: ideas.supportingLink,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .innerJoin(users, eq(users.id, ideas.submitterUserId))
    .leftJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
    .where(eq(ideas.id, ideaId))
    .limit(1);

  if (!row) {
    throw new Error("Idea not found.");
  }

  return row;
}

async function assertCanTriggerClarification(session: DemoSession, campaignId: string) {
  if (!(await canContributeToCampaign(session, campaignId))) {
    throw new Error("Only R&D users with campaign access can request employee clarification.");
  }
}

async function assertNoClarificationBatch(ideaId: string) {
  const [existing] = await db
    .select({ id: clarificationRequests.id })
    .from(clarificationRequests)
    .where(
      and(eq(clarificationRequests.ideaId, ideaId), inArray(clarificationRequests.status, ["pending", "answered", "expired"]))
    )
    .limit(1);

  if (existing) {
    throw new Error("Clarification batch already exists for this idea.");
  }
}

function aiInputReference(idea: Awaited<ReturnType<typeof readIdeaContext>>) {
  return JSON.stringify({
    campaignId: idea.campaignId,
    ideaId: idea.ideaId,
    source: "employee_clarification",
    title: idea.title
  });
}

async function writeAiLog(input: {
  decisionResult: JsonRecord | null;
  inputReference: string;
  model: string;
  outputSummary: string | null;
  purpose?: string;
  rawResponse: JsonRecord | null;
  status: "succeeded" | "retry_required";
}) {
  await db.insert(aiDecisionLogs).values({
    createdAt: new Date(),
    decisionResult: input.decisionResult,
    id: newId("ai-log"),
    inputReference: input.inputReference,
    model: input.model,
    outputSummary: input.outputSummary,
    purpose: input.purpose ?? clarificationPurpose,
    rawResponse: input.rawResponse,
    status: input.status
  });
}

async function generateAssumptionRoutingDecision(
  request: {
    campaignPrompt: string;
    campaignTitle: string;
    evidenceExample: string | null;
    expectedBenefit: string | null;
    ideaId: string;
    originalText: string;
    problemOpportunity: string | null;
    requestId: string;
    requestText: string;
    supportingLink: string | null;
    title: string;
  },
  provider?: LlmProvider
) {
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "You route a Verto idea after an employee clarification timed out.",
          "Use only existing source material and reasonable assumptions.",
          "Do not invent a positive answer to the unanswered question.",
          "Choose future_opportunity when the idea remains promising but unclear.",
          "Choose inactive_idea when available evidence is too weak, poor fit, or not actionable.",
          "Return concise assumptions and why they are reasonable."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          campaign: {
            prompt: request.campaignPrompt,
            title: request.campaignTitle
          },
          expiredClarification: {
            requestId: request.requestId,
            question: request.requestText
          },
          idea: {
            evidenceExample: request.evidenceExample,
            expectedBenefit: request.expectedBenefit,
            originalText: request.originalText,
            problemOpportunity: request.problemOpportunity,
            supportingLink: request.supportingLink,
            title: request.title
          }
        }),
        role: "user"
      }
    ],
    provider,
    tool: assumptionRoutingTool
  });
  const assumptions = readRequiredString(result.arguments, "assumptions", result.rawResponse);
  const rationale = readRequiredString(result.arguments, "rationale", result.rawResponse);
  const routingDecision = readAssumptionRoutingDecision(result.arguments, result.rawResponse);

  return {
    assumptions,
    model: result.model,
    rationale,
    rawResponse: result.rawResponse,
    routingDecision
  };
}

async function generateClarificationQuestion(
  idea: Awaited<ReturnType<typeof readIdeaContext>>,
  provider?: LlmProvider
) {
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "You create one focused employee clarification question for Verto.",
          "Use employee-safe language only.",
          "Hide internal labels, rank, outcome, minimum review packet names, and R&D criteria.",
          "Ask for missing concrete detail that helps R&D understand the submitted idea.",
          "Do not ask multiple questions."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          campaign: {
            prompt: idea.previewPrompt ?? idea.campaignPrompt,
            title: idea.previewTitle ?? idea.campaignTitle
          },
          idea: {
            evidenceExample: idea.evidenceExample,
            expectedBenefit: idea.expectedBenefit,
            originalText: idea.originalText,
            problemOpportunity: idea.problemOpportunity,
            supportingLink: idea.supportingLink,
            title: idea.title
          }
        }),
        role: "user"
      }
    ],
    provider,
    tool: clarificationTool
  });
  const questionText = readRequiredString(result.arguments, "questionText", result.rawResponse);
  const rationale = readRequiredString(result.arguments, "rationale", result.rawResponse);

  return {
    model: result.model,
    questionText,
    rationale,
    rawResponse: result.rawResponse
  };
}

function emailHtml(input: {
  campaignTitle: string;
  expiresAt: Date;
  ideaTitle: string;
  link: string;
  questionText: string;
  reminder?: boolean;
}) {
  const expiryDate = formatClarificationExpiryDate(input.expiresAt);

  return [
    "<article>",
    `<p>${input.reminder ? "Reminder: Verto still needs one clarification for your idea." : "Verto needs one clarification for your idea."}</p>`,
    `<h1>${escapeHtml(input.ideaTitle)}</h1>`,
    `<p>${escapeHtml(input.campaignTitle)}</p>`,
    `<p>${escapeHtml(input.questionText)}</p>`,
    `<p>Expires ${escapeHtml(expiryDate)}.</p>`,
    `<p><a href="${escapeHtml(input.link)}">Answer clarification</a></p>`,
    "</article>"
  ].join("");
}

async function writeClarificationAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    actorType: "user" | "system" | "ai";
    actorUserId: string | null;
    entityId: string;
    eventType: string;
    metadata?: Record<string, unknown> | null;
    reason: string;
  }
) {
  await tx.insert(auditEvents).values({
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    createdAt: new Date(),
    entityId: input.entityId,
    entityType: "clarification_request",
    eventType: input.eventType,
    id: newId("audit"),
    metadata: input.metadata ?? null,
    reason: input.reason
  });
}

async function markIdeaNeedsClarification(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ideaId: string,
  actorUserId: string,
  reason: string
) {
  await tx
    .update(ideaStateHistory)
    .set({ isCurrent: false })
    .where(and(eq(ideaStateHistory.ideaId, ideaId), eq(ideaStateHistory.isCurrent, true)));
  await tx.insert(ideaStateHistory).values({
    changedAt: new Date(),
    changedByUserId: actorUserId,
    ideaId,
    id: newId("idea-state"),
    isCurrent: true,
    reason,
    workflowState: "needs_employee_clarification"
  });
}

async function markIdeaRoutedByAssumption(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    assumptions: string;
    changedAt: Date;
    ideaId: string;
    rationale: string;
    routingDecision: AssumptionRoutingDecision;
  }
) {
  await tx
    .update(ideaStateHistory)
    .set({ isCurrent: false })
    .where(and(eq(ideaStateHistory.ideaId, input.ideaId), eq(ideaStateHistory.isCurrent, true)));
  await tx.insert(ideaStateHistory).values({
    changedAt: input.changedAt,
    changedByUserId: null,
    ideaId: input.ideaId,
    id: newId("idea-state"),
    isCurrent: true,
    reason: `Assumption-Based Routing: ${input.routingDecision}. Assumptions: ${input.assumptions} Reason: ${input.rationale}`,
    workflowState: input.routingDecision
  });
}

export async function requestEmployeeClarification(
  session: DemoSession,
  ideaId: string,
  options: ClarificationOptions = {}
) {
  const idea = await readIdeaContext(ideaId);
  await assertCanTriggerClarification(session, idea.campaignId);
  await assertNoClarificationBatch(idea.ideaId);

  const inputReference = aiInputReference(idea);
  let aiQuestion: Awaited<ReturnType<typeof generateClarificationQuestion>>;

  try {
    aiQuestion = await generateClarificationQuestion(idea, options.provider);
    await writeAiLog({
      decisionResult: {
        questionText: aiQuestion.questionText,
        rationale: aiQuestion.rationale
      },
      inputReference,
      model: aiQuestion.model,
      outputSummary: aiQuestion.questionText,
      rawResponse: aiQuestion.rawResponse,
      status: "succeeded"
    });
  } catch (error) {
    await writeAiLog({
      decisionResult: null,
      inputReference,
      model: getLlmModel(),
      outputSummary: error instanceof Error ? error.message : "Employee clarification question generation failed.",
      rawResponse:
        error instanceof LlmProviderError || error instanceof LlmInvalidResponseError ? error.rawResponse : null,
      status: "retry_required"
    });

    return {
      reason: error instanceof Error ? error.message : "Employee clarification question generation failed.",
      status: "retry_required" as const
    };
  }

  const now = options.now ?? new Date();
  const requestId = newId("clarification");
  const token = createMagicToken(requestId);
  const link = buildClarificationLink(options.appBaseUrl ?? getAppBaseUrl(), token);
  const expiresAt = options.expiresAt ?? addDays(now, 30);

  await db.transaction(async (tx) => {
    await tx.insert(clarificationRequests).values({
      createdAt: now,
      emailStatus: "pending",
      expiresAt,
      id: requestId,
      ideaId: idea.ideaId,
      requestText: aiQuestion.questionText,
      status: "pending",
      tokenHash: tokenHash(token),
      updatedAt: now
    });
    await markIdeaNeedsClarification(tx, idea.ideaId, session.user.id, aiQuestion.rationale);
    await writeClarificationAudit(tx, {
      actorType: "ai",
      actorUserId: null,
      entityId: requestId,
      eventType: "clarification.created",
      metadata: { ideaId: idea.ideaId },
      reason: "AI created one employee clarification question."
    });
  });

  try {
    const emailResult = await sendClarificationEmail(
      {
        html: emailHtml({
          campaignTitle: idea.previewTitle ?? idea.campaignTitle,
          expiresAt,
          ideaTitle: idea.title,
          link,
          questionText: aiQuestion.questionText
        }),
        subject: `Clarification needed: ${idea.title}`,
        text: `${aiQuestion.questionText}\n\nExpires ${formatClarificationExpiryDate(expiresAt)}.\n${link}`,
        to: {
          email: idea.submitterEmail,
          id: idea.submitterUserId
        }
      },
      options.emailProvider
    );
    await db.transaction(async (tx) => {
      await tx
        .update(clarificationRequests)
        .set({
          emailError: null,
          emailStatus: "sent",
          emailTrackingId: emailResult.trackingId,
          sentAt: now,
          updatedAt: now
        })
        .where(eq(clarificationRequests.id, requestId));
      await writeClarificationAudit(tx, {
        actorType: "system",
        actorUserId: null,
        entityId: requestId,
        eventType: "clarification.email.sent",
        metadata: { messages: emailResult.messages, trackingId: emailResult.trackingId },
        reason: "Clarification email sent through configured provider."
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clarification email provider failed.";
    await db.transaction(async (tx) => {
      await tx
        .update(clarificationRequests)
        .set({
          emailError: message,
          emailStatus: "retry_required",
          updatedAt: now
        })
        .where(eq(clarificationRequests.id, requestId));
      await writeClarificationAudit(tx, {
        actorType: "system",
        actorUserId: null,
        entityId: requestId,
        eventType: "clarification.email.retry_required",
        metadata: { error: message },
        reason: "Clarification email failed before any sent state was recorded."
      });
    });

    return {
      reason: message,
      requestId,
      status: "retry_required" as const
    };
  }

  return {
    link,
    questionText: aiQuestion.questionText,
    requestId,
    status: "sent" as const,
    token
  };
}

export async function runClarificationReminderJob(options: {
  appBaseUrl?: string;
  emailProvider?: ClarificationEmailProvider;
  now?: Date;
} = {}) {
  const now = options.now ?? new Date();
  const dueSince = addDays(now, -23);
  const rows = await db
    .select({
      campaignTitle: campaigns.publicTitle,
      expiresAt: clarificationRequests.expiresAt,
      ideaTitle: ideas.title,
      previewTitle: ideas.previewTitle,
      requestId: clarificationRequests.id,
      requestText: clarificationRequests.requestText,
      submitterEmail: users.email,
      submitterUserId: users.id
    })
    .from(clarificationRequests)
    .innerJoin(ideas, eq(ideas.id, clarificationRequests.ideaId))
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .innerJoin(users, eq(users.id, ideas.submitterUserId))
    .where(
      and(
        eq(clarificationRequests.status, "pending"),
        eq(clarificationRequests.emailStatus, "sent"),
        isNull(clarificationRequests.reminderSentAt),
        lte(clarificationRequests.sentAt, dueSince),
        gt(clarificationRequests.expiresAt, now)
      )
    );

  let sentCount = 0;
  let retryRequiredCount = 0;

  for (const row of rows) {
    const token = createMagicToken(row.requestId);
    const link = buildClarificationLink(options.appBaseUrl ?? getAppBaseUrl(), token);

    try {
      const emailResult = await sendClarificationEmail(
        {
          html: emailHtml({
            campaignTitle: row.previewTitle || row.campaignTitle,
            expiresAt: row.expiresAt,
            ideaTitle: row.ideaTitle,
            link,
            questionText: row.requestText,
            reminder: true
          }),
          subject: `Reminder: clarification needed: ${row.ideaTitle}`,
          text: `${row.requestText}\n\nExpires ${formatClarificationExpiryDate(row.expiresAt)}.\n${link}`,
          to: {
            email: row.submitterEmail,
            id: row.submitterUserId
          }
        },
        options.emailProvider
      );

      await db.transaction(async (tx) => {
        await tx
          .update(clarificationRequests)
          .set({
            reminderEmailTrackingId: emailResult.trackingId,
            reminderSentAt: now,
            updatedAt: now
          })
          .where(eq(clarificationRequests.id, row.requestId));
        await writeClarificationAudit(tx, {
          actorType: "system",
          actorUserId: null,
          entityId: row.requestId,
          eventType: "clarification.reminder.sent",
          metadata: { messages: emailResult.messages, trackingId: emailResult.trackingId },
          reason: "Single day-23 clarification reminder sent through configured provider."
        });
      });
      sentCount += 1;
    } catch (error) {
      retryRequiredCount += 1;
      await db.transaction(async (tx) => {
        await writeClarificationAudit(tx, {
          actorType: "system",
          actorUserId: null,
          entityId: row.requestId,
          eventType: "clarification.reminder.retry_required",
          metadata: { error: error instanceof Error ? error.message : "Clarification reminder failed." },
          reason: "Clarification reminder failed before any reminder sent state was recorded."
        });
      });
    }
  }

  return {
    retryRequiredCount,
    sentCount
  };
}

export async function runClarificationExpiryJob(options: {
  now?: Date;
  provider?: LlmProvider;
} = {}) {
  const now = options.now ?? new Date();
  const rows = await db
    .select({
      campaignPrompt: campaigns.publicPrompt,
      campaignTitle: campaigns.publicTitle,
      evidenceExample: ideas.evidenceExample,
      expectedBenefit: ideas.expectedBenefit,
      ideaId: ideas.id,
      originalText: ideas.originalText,
      previewPrompt: ideas.previewPrompt,
      previewTitle: ideas.previewTitle,
      problemOpportunity: ideas.problemOpportunity,
      requestId: clarificationRequests.id,
      requestText: clarificationRequests.requestText,
      supportingLink: ideas.supportingLink,
      title: ideas.title
    })
    .from(clarificationRequests)
    .innerJoin(ideas, eq(ideas.id, clarificationRequests.ideaId))
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .where(
      and(
        eq(clarificationRequests.status, "pending"),
        eq(clarificationRequests.emailStatus, "sent"),
        lte(clarificationRequests.expiresAt, now)
      )
    );

  let expiredCount = 0;
  let retryRequiredCount = 0;

  for (const row of rows) {
    const inputReference = JSON.stringify({
      ideaId: row.ideaId,
      requestId: row.requestId,
      source: "employee_clarification_timeout"
    });

    let routing: Awaited<ReturnType<typeof generateAssumptionRoutingDecision>>;
    try {
      routing = await generateAssumptionRoutingDecision(
        {
          ...row,
          campaignPrompt: row.previewPrompt ?? row.campaignPrompt,
          campaignTitle: row.previewTitle || row.campaignTitle
        },
        options.provider
      );
      await writeAiLog({
        decisionResult: {
          assumptions: routing.assumptions,
          rationale: routing.rationale,
          routingDecision: routing.routingDecision
        },
        inputReference,
        model: routing.model,
        outputSummary: `Assumption-Based Routing: ${routing.routingDecision}`,
        purpose: assumptionRoutingPurpose,
        rawResponse: routing.rawResponse,
        status: "succeeded"
      });
    } catch (error) {
      retryRequiredCount += 1;
      await writeAiLog({
        decisionResult: null,
        inputReference,
        model: getLlmModel(),
        outputSummary: error instanceof Error ? error.message : "Assumption-based routing failed.",
        purpose: assumptionRoutingPurpose,
        rawResponse:
          error instanceof LlmProviderError || error instanceof LlmInvalidResponseError ? error.rawResponse : null,
        status: "retry_required"
      });
      continue;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(clarificationRequests)
        .set({
          assumptionReason: routing.rationale,
          assumptionRoutingDecision: routing.routingDecision,
          assumptionText: routing.assumptions,
          expiredAt: now,
          status: "expired",
          updatedAt: now
        })
        .where(eq(clarificationRequests.id, row.requestId));
      await markIdeaRoutedByAssumption(tx, {
        assumptions: routing.assumptions,
        changedAt: now,
        ideaId: row.ideaId,
        rationale: routing.rationale,
        routingDecision: routing.routingDecision
      });
      await writeClarificationAudit(tx, {
        actorType: "ai",
        actorUserId: null,
        entityId: row.requestId,
        eventType: "clarification.expired.assumption_routed",
        metadata: {
          assumptions: routing.assumptions,
          ideaId: row.ideaId,
          rationale: routing.rationale,
          routingDecision: routing.routingDecision
        },
        reason: "Clarification timed out and AI routed the idea from existing source material."
      });
    });
    expiredCount += 1;
  }

  return {
    expiredCount,
    retryRequiredCount
  };
}

async function readRequestByToken(token: string) {
  const [row] = await db
    .select({
      answerText: clarificationRequests.answerText,
      campaignPrompt: campaigns.publicPrompt,
      campaignTitle: campaigns.publicTitle,
      emailStatus: clarificationRequests.emailStatus,
      expiresAt: clarificationRequests.expiresAt,
      ideaId: ideas.id,
      ideaTitle: ideas.title,
      originalText: ideas.originalText,
      previewPrompt: ideas.previewPrompt,
      previewTitle: ideas.previewTitle,
      requestId: clarificationRequests.id,
      requestText: clarificationRequests.requestText,
      status: clarificationRequests.status,
      submitterUserId: ideas.submitterUserId,
      supportingLink: clarificationRequests.supportingLink
    })
    .from(clarificationRequests)
    .innerJoin(ideas, eq(ideas.id, clarificationRequests.ideaId))
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .where(eq(clarificationRequests.tokenHash, tokenHash(token)))
    .limit(1);

  return row ?? null;
}

export async function getEmployeeClarificationView(token: string, now = new Date()) {
  const request = await readRequestByToken(token);
  if (!request || request.emailStatus !== "sent") {
    return null;
  }

  return {
    answered: request.status === "answered",
    canAnswer: request.status === "pending" && request.expiresAt > now,
    campaignPrompt: request.previewPrompt ?? request.campaignPrompt,
    campaignTitle: request.previewTitle ?? request.campaignTitle,
    expired: request.expiresAt <= now,
    expiresAt: request.expiresAt,
    ideaTitle: request.ideaTitle,
    originalText: request.originalText,
    requestText: request.requestText,
    supportingLink: request.supportingLink
  };
}

export async function submitClarificationAnswer(
  token: string,
  input: { answerText: string; now?: Date; supportingLink?: string | null }
) {
  const answerText = requireText(input.answerText, "Clarification answer");
  const supportingLink = optionalText(input.supportingLink);
  const now = input.now ?? new Date();
  const hash = tokenHash(token);

  await db.transaction(async (tx) => {
    const [request] = await tx
      .select({
        emailStatus: clarificationRequests.emailStatus,
        expiresAt: clarificationRequests.expiresAt,
        ideaId: ideas.id,
        requestId: clarificationRequests.id,
        status: clarificationRequests.status,
        submitterUserId: ideas.submitterUserId
      })
      .from(clarificationRequests)
      .innerJoin(ideas, eq(ideas.id, clarificationRequests.ideaId))
      .where(eq(clarificationRequests.tokenHash, hash))
      .limit(1)
      .for("update");

    if (!request || request.emailStatus !== "sent") {
      throw new Error("Clarification link is invalid.");
    }
    if (request.status !== "pending") {
      throw new Error("Clarification is no longer accepting answers.");
    }
    if (request.expiresAt <= now) {
      throw new Error("Clarification link has expired.");
    }

    await tx
      .update(clarificationRequests)
      .set({
        answeredAt: now,
        answerText,
        status: "answered",
        supportingLink,
        updatedAt: now
      })
      .where(eq(clarificationRequests.id, request.requestId));
    await writeClarificationAudit(tx, {
      actorType: "user",
      actorUserId: request.submitterUserId,
      entityId: request.requestId,
      eventType: "clarification.answered",
      metadata: { ideaId: request.ideaId, supportingLink },
      reason: "Employee answered clarification through magic link."
    });
  });
}

export async function getIdeaClarificationReview(session: DemoSession, ideaId: string) {
  const idea = await readIdeaContext(ideaId);
  if (!(await canContributeToCampaign(session, idea.campaignId))) {
    throw new Error("Only R&D users with campaign access can inspect clarifications.");
  }

  return db
    .select({
      answerText: clarificationRequests.answerText,
      assumptionReason: clarificationRequests.assumptionReason,
      assumptionRoutingDecision: clarificationRequests.assumptionRoutingDecision,
      assumptionText: clarificationRequests.assumptionText,
      emailError: clarificationRequests.emailError,
      emailStatus: clarificationRequests.emailStatus,
      emailTrackingId: clarificationRequests.emailTrackingId,
      expiredAt: clarificationRequests.expiredAt,
      expiresAt: clarificationRequests.expiresAt,
      ideaTitle: ideas.title,
      requestId: clarificationRequests.id,
      requestText: clarificationRequests.requestText,
      reminderSentAt: clarificationRequests.reminderSentAt,
      sentAt: clarificationRequests.sentAt,
      status: clarificationRequests.status,
      submitterDepartment: users.department,
      submitterDisplayName: users.displayName,
      submitterEmail: users.email,
      supportingLink: clarificationRequests.supportingLink
    })
    .from(clarificationRequests)
    .innerJoin(ideas, eq(ideas.id, clarificationRequests.ideaId))
    .innerJoin(users, eq(users.id, ideas.submitterUserId))
    .where(eq(clarificationRequests.ideaId, idea.ideaId))
    .orderBy(clarificationRequests.createdAt);
}

export async function getAccessibleClarificationReviewView(session: DemoSession) {
  if (session.role.id === "employee") {
    return [];
  }

  return db
    .select({
      answerText: clarificationRequests.answerText,
      assumptionReason: clarificationRequests.assumptionReason,
      assumptionRoutingDecision: clarificationRequests.assumptionRoutingDecision,
      assumptionText: clarificationRequests.assumptionText,
      campaignTitle: campaigns.publicTitle,
      emailStatus: clarificationRequests.emailStatus,
      expiredAt: clarificationRequests.expiredAt,
      expiresAt: clarificationRequests.expiresAt,
      ideaId: ideas.id,
      ideaTitle: ideas.title,
      requestId: clarificationRequests.id,
      requestText: clarificationRequests.requestText,
      reminderSentAt: clarificationRequests.reminderSentAt,
      sentAt: clarificationRequests.sentAt,
      status: clarificationRequests.status,
      submitterDisplayName: users.displayName,
      supportingLink: clarificationRequests.supportingLink
    })
    .from(clarificationRequests)
    .innerJoin(ideas, eq(ideas.id, clarificationRequests.ideaId))
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .innerJoin(users, eq(users.id, ideas.submitterUserId))
    .innerJoin(
      campaignMemberships,
      and(eq(campaignMemberships.campaignId, ideas.campaignId), eq(campaignMemberships.userId, session.user.id))
    )
    .orderBy(clarificationRequests.createdAt);
}

export async function getAccessibleClarificationTriggerIdeas(session: DemoSession) {
  if (session.role.id === "employee") {
    return [];
  }

  const ideaRows = await db
    .select({
      campaignId: campaigns.id,
      campaignTitle: campaigns.publicTitle,
      currentWorkflowState: ideaStateHistory.workflowState,
      ideaId: ideas.id,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .innerJoin(
      campaignMemberships,
      and(eq(campaignMemberships.campaignId, ideas.campaignId), eq(campaignMemberships.userId, session.user.id))
    )
    .leftJoin(ideaStateHistory, and(eq(ideaStateHistory.ideaId, ideas.id), eq(ideaStateHistory.isCurrent, true)))
    .orderBy(ideas.createdAt);
  const ideaIds = ideaRows.map((idea) => idea.ideaId);
  if (ideaIds.length === 0) {
    return [];
  }

  const existingRequests = await db
    .select({
      ideaId: clarificationRequests.ideaId
    })
    .from(clarificationRequests)
    .where(
      and(
        inArray(clarificationRequests.ideaId, ideaIds),
        inArray(clarificationRequests.status, ["pending", "answered", "expired"])
      )
    );
  const requestedIdeaIds = new Set(existingRequests.map((request) => request.ideaId));

  return ideaRows.map((idea) => ({
    ...idea,
    hasClarificationBatch: requestedIdeaIds.has(idea.ideaId)
  }));
}
