import crypto from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import { auditEvents, campaignKnowledgeReports, campaigns, ideaDrafts, ideaStateHistory, ideas } from "../db/schema";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbLike = typeof db | DbTransaction;

type IdeaFieldsInput = {
  campaignId: string;
  evidenceExample?: string | null;
  expectedBenefit?: string | null;
  originalText: string;
  problemOpportunity?: string | null;
  supportingLink?: string | null;
  title: string;
};

export type SaveIdeaDraftInput = IdeaFieldsInput & {
  draftId?: string;
};

export type SubmitIdeaInput = IdeaFieldsInput;

export type IdeaSubmissionReceipt = {
  confirmationText: string;
  ideaId: string;
  title: string;
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function requireEmployee(session: DemoSession, message: string) {
  if (session.role.id !== "employee") {
    throw new Error(message);
  }
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

function normalizeIdeaFields(input: IdeaFieldsInput) {
  const rawInput = input as Record<string, unknown>;
  if (Array.isArray(rawInput.campaignIds)) {
    throw new Error("Choose exactly one destination for each idea.");
  }

  return {
    campaignId: requireText(input.campaignId, "A destination campaign"),
    evidenceExample: optionalText(input.evidenceExample),
    expectedBenefit: optionalText(input.expectedBenefit),
    originalText: requireText(input.originalText, "Idea description"),
    problemOpportunity: optionalText(input.problemOpportunity),
    supportingLink: optionalText(input.supportingLink),
    title: requireText(input.title, "Idea title")
  };
}

async function approvedCampaignIds(query: DbLike, campaignIds: string[]) {
  if (campaignIds.length === 0) {
    return new Set<string>();
  }

  const rows = await query
    .select({ campaignId: campaignKnowledgeReports.campaignId })
    .from(campaignKnowledgeReports)
    .where(
      and(
        inArray(campaignKnowledgeReports.campaignId, campaignIds),
        eq(campaignKnowledgeReports.status, "approved")
      )
    );

  return new Set(rows.map((row) => row.campaignId));
}

async function readSubmissionDestination(query: DbLike, campaignId: string) {
  const [campaign] = await query
    .select({
      id: campaigns.id,
      intakeEndsAt: campaigns.intakeEndsAt,
      lifecycleStatus: campaigns.lifecycleStatus,
      previewVersion: campaigns.previewVersion,
      publicExamples: campaigns.publicExamples,
      publicPrompt: campaigns.publicPrompt,
      publicTitle: campaigns.publicTitle,
      type: campaigns.type
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1)
    .for("update");

  if (!campaign) {
    throw new Error("Selected destination is not open for employee intake.");
  }

  if (campaign.type === "general") {
    return campaign;
  }

  if (campaign.lifecycleStatus !== "intake_open") {
    throw new Error("Selected destination is not open for employee intake.");
  }

  const approvedIds = await approvedCampaignIds(query, [campaign.id]);
  if (!approvedIds.has(campaign.id)) {
    throw new Error("Selected destination is not open for employee intake.");
  }

  return campaign;
}

function receiptFor(ideaId: string, title: string): IdeaSubmissionReceipt {
  return {
    confirmationText: `${title} was submitted as ${ideaId}.`,
    ideaId,
    title
  };
}

async function writeIdeaSubmission(
  tx: DbTransaction,
  session: DemoSession,
  input: ReturnType<typeof normalizeIdeaFields>
) {
  const destination = await readSubmissionDestination(tx, input.campaignId);
  const now = new Date();
  const ideaId = newId("idea");
  const workflowState = destination.type === "general" ? "general_idea" : "submitted";
  const reason =
    destination.type === "general"
      ? "Initial employee submission to the always-open General Campaign."
      : "Initial employee submission to an Intake Open campaign. Awaiting pre-R&D routing.";

  await tx.insert(ideas).values({
    campaignId: destination.id,
    createdAt: now,
    evidenceExample: input.evidenceExample,
    expectedBenefit: input.expectedBenefit,
    id: ideaId,
    originalText: input.originalText,
    previewExamples: destination.publicExamples,
    previewPrompt: destination.publicPrompt,
    previewTitle: destination.publicTitle,
    previewVersion: destination.previewVersion,
    problemOpportunity: input.problemOpportunity,
    sourceType: "employee_submission",
    submittedAt: now,
    submitterUserId: session.user.id,
    supportingLink: input.supportingLink,
    title: input.title
  });

  await tx.insert(ideaStateHistory).values({
    changedAt: now,
    changedByUserId: session.user.id,
    ideaId,
    id: newId("idea-state"),
    isCurrent: true,
    reason,
    workflowState
  });

  await tx.insert(auditEvents).values({
    actorType: "user",
    actorUserId: session.user.id,
    createdAt: now,
    entityId: ideaId,
    entityType: "idea",
    eventType: "idea.submitted",
    id: newId("audit"),
    metadata: {
      campaignId: destination.id,
      previewVersion: destination.previewVersion
    },
    reason: "Employee submitted immutable idea source material."
  });

  return receiptFor(ideaId, input.title);
}

export async function getEmployeeIntakeView(session: DemoSession) {
  requireEmployee(session, "Only employees can use intake.");

  const campaignRowsPromise = db
    .select({
      campaignId: campaigns.id,
      intakeEndsAt: campaigns.intakeEndsAt,
      lifecycleStatus: campaigns.lifecycleStatus,
      previewExamples: campaigns.publicExamples,
      previewPrompt: campaigns.publicPrompt,
      previewTitle: campaigns.publicTitle,
      previewVersion: campaigns.previewVersion,
      type: campaigns.type
    })
    .from(campaigns)
    .orderBy(campaigns.id);
  const draftsPromise = db
    .select({
      campaignId: ideaDrafts.campaignId,
      evidenceExample: ideaDrafts.evidenceExample,
      expectedBenefit: ideaDrafts.expectedBenefit,
      id: ideaDrafts.id,
      originalText: ideaDrafts.originalText,
      problemOpportunity: ideaDrafts.problemOpportunity,
      supportingLink: ideaDrafts.supportingLink,
      title: ideaDrafts.title,
      updatedAt: ideaDrafts.updatedAt
    })
    .from(ideaDrafts)
    .where(eq(ideaDrafts.ownerUserId, session.user.id))
    .orderBy(ideaDrafts.updatedAt);
  const ideaCountPromise = db
    .select({ count: sql<number>`count(*)` })
    .from(ideas)
    .where(eq(ideas.submitterUserId, session.user.id));

  const [campaignRows, drafts, ideaCountRows] = await Promise.all([campaignRowsPromise, draftsPromise, ideaCountPromise]);
  const specificOpenCampaignIds = campaignRows
    .filter((campaign) => campaign.type === "specific" && campaign.lifecycleStatus === "intake_open")
    .map((campaign) => campaign.campaignId);
  const approvedIds = await approvedCampaignIds(db, specificOpenCampaignIds);
  const destinations = campaignRows
    .filter(
      (campaign) =>
        campaign.type === "general" ||
        (campaign.lifecycleStatus === "intake_open" && approvedIds.has(campaign.campaignId))
    )
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "general" ? -1 : 1;
      }

      return left.campaignId.localeCompare(right.campaignId);
    });
  const destinationIds = new Set(destinations.map((destination) => destination.campaignId));
  const destinationById = new Map(campaignRows.map((campaign) => [campaign.campaignId, campaign]));

  return {
    destinations,
    drafts: drafts.map((draft) => {
      const destination = destinationById.get(draft.campaignId);

      return {
        ...draft,
        destinationAvailable: destinationIds.has(draft.campaignId),
        destinationTitle: destination?.previewTitle ?? "Unavailable campaign"
      };
    }),
    ideaCount: Number(ideaCountRows[0]?.count ?? 0)
  };
}

export async function getEmployeeSubmissionReceipt(session: DemoSession, ideaId: string) {
  requireEmployee(session, "Only employees can use intake.");

  const [idea] = await db
    .select({
      id: ideas.id,
      title: ideas.title
    })
    .from(ideas)
    .where(and(eq(ideas.id, ideaId), eq(ideas.submitterUserId, session.user.id)))
    .limit(1);

  if (!idea) {
    return null;
  }

  return receiptFor(idea.id, idea.title);
}

export async function saveIdeaDraft(session: DemoSession, input: SaveIdeaDraftInput) {
  requireEmployee(session, "Only employees can save idea drafts.");
  const normalized = normalizeIdeaFields(input);

  return db.transaction(async (tx) => {
    await readSubmissionDestination(tx, normalized.campaignId);
    const now = new Date();

    if (input.draftId) {
      const [draft] = await tx
        .select({ id: ideaDrafts.id })
        .from(ideaDrafts)
        .where(and(eq(ideaDrafts.id, input.draftId), eq(ideaDrafts.ownerUserId, session.user.id)))
        .limit(1)
        .for("update");

      if (!draft) {
        throw new Error("Draft not found.");
      }

      await tx
        .update(ideaDrafts)
        .set({
          campaignId: normalized.campaignId,
          evidenceExample: normalized.evidenceExample,
          expectedBenefit: normalized.expectedBenefit,
          originalText: normalized.originalText,
          problemOpportunity: normalized.problemOpportunity,
          supportingLink: normalized.supportingLink,
          title: normalized.title,
          updatedAt: now
        })
        .where(eq(ideaDrafts.id, draft.id));

      return { draftId: draft.id };
    }

    const draftId = newId("idea-draft");
    await tx.insert(ideaDrafts).values({
      campaignId: normalized.campaignId,
      createdAt: now,
      evidenceExample: normalized.evidenceExample,
      expectedBenefit: normalized.expectedBenefit,
      id: draftId,
      originalText: normalized.originalText,
      ownerUserId: session.user.id,
      problemOpportunity: normalized.problemOpportunity,
      supportingLink: normalized.supportingLink,
      title: normalized.title,
      updatedAt: now
    });

    return { draftId };
  });
}

export async function deleteIdeaDraft(session: DemoSession, draftId: string) {
  requireEmployee(session, "Only employees can delete idea drafts.");
  const normalizedDraftId = requireText(draftId, "Draft");

  await db.transaction(async (tx) => {
    const [draft] = await tx
      .select({ id: ideaDrafts.id })
      .from(ideaDrafts)
      .where(and(eq(ideaDrafts.id, normalizedDraftId), eq(ideaDrafts.ownerUserId, session.user.id)))
      .limit(1)
      .for("update");

    if (!draft) {
      throw new Error("Draft not found.");
    }

    await tx.delete(ideaDrafts).where(eq(ideaDrafts.id, draft.id));
  });
}

export async function submitIdea(session: DemoSession, input: SubmitIdeaInput) {
  requireEmployee(session, "Only employees can submit ideas.");
  const normalized = normalizeIdeaFields(input);

  return db.transaction((tx) => writeIdeaSubmission(tx, session, normalized));
}

export async function submitIdeaDraft(session: DemoSession, draftId: string) {
  requireEmployee(session, "Only employees can submit ideas.");
  const normalizedDraftId = requireText(draftId, "Draft");

  return db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(ideaDrafts)
      .where(and(eq(ideaDrafts.id, normalizedDraftId), eq(ideaDrafts.ownerUserId, session.user.id)))
      .limit(1)
      .for("update");

    if (!draft) {
      throw new Error("Draft not found.");
    }

    const receipt = await writeIdeaSubmission(
      tx,
      session,
      normalizeIdeaFields({
        campaignId: draft.campaignId,
        evidenceExample: draft.evidenceExample,
        expectedBenefit: draft.expectedBenefit,
        originalText: draft.originalText,
        problemOpportunity: draft.problemOpportunity,
        supportingLink: draft.supportingLink,
        title: draft.title
      })
    );

    await tx.delete(ideaDrafts).where(eq(ideaDrafts.id, draft.id));

    return receipt;
  });
}
