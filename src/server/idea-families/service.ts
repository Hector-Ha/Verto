import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { canContributeToCampaign } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  clarificationRequests,
  campaignMemberships,
  campaigns,
  ideaFamilies,
  ideaFamilyMembers,
  ideaReviewSummaries,
  ideas,
  users,
  type IdeaSummarySourceTrace
} from "../db/schema";
import { getLlmModel } from "../env";
import { callStructuredTool, LlmInvalidResponseError, type LlmProvider } from "../llm/adapter";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type JsonRecord = Record<string, unknown>;
type FamilyRelationshipType = (typeof ideaFamilyMembers.$inferSelect)["relationshipType"];

type IdeaForFamily = {
  campaignId: string;
  evidenceExample: string | null;
  expectedBenefit: string | null;
  id: string;
  originalText: string;
  problemOpportunity: string | null;
  submitterUserId: string;
  supportingLink: string | null;
  title: string;
};

type SummaryDecision = {
  aiReason: string;
  sourceTrace: IdeaSummarySourceTrace;
  summaryText: string;
};

type RelationshipDecision = {
  reason: string;
  relatedIdeaId: string | null;
  relationship: "same_idea" | "variant" | "unrelated";
  variantDifference: string | null;
};

type AnalyzeOptions = {
  now?: Date;
  relationshipProvider?: LlmProvider;
  summaryProvider?: LlmProvider;
};

type SummaryOptions = {
  now?: Date;
  summaryProvider?: LlmProvider;
};

const relationshipPurpose = "idea_family.relationship";
const summaryPurpose = "idea_family.summary";
const relationshipTool = {
  description: "Choose whether a submitted idea belongs with an existing Verto idea family.",
  name: "record_idea_family_relationship",
  parameters: {
    additionalProperties: false,
    properties: {
      reason: {
        description: "Internal reason based only on anonymized source material.",
        type: "string"
      },
      relatedIdeaId: {
        description: "Existing related idea id, or null when unrelated.",
        type: ["string", "null"]
      },
      relationship: {
        enum: ["same_idea", "variant", "unrelated"],
        type: "string"
      },
      variantDifference: {
        description: "Meaningful difference when relationship is variant, else null.",
        type: ["string", "null"]
      }
    },
    required: ["reason", "relatedIdeaId", "relationship", "variantDifference"],
    type: "object"
  }
};
const summaryTool = {
  description: "Record one R&D-facing idea family summary with source trace.",
  name: "record_idea_review_summary",
  parameters: {
    additionalProperties: false,
    properties: {
      aiReason: {
        description: "Brief internal reason for summary wording or regeneration.",
        type: "string"
      },
      sourceTrace: {
        items: {
          additionalProperties: false,
          properties: {
            clarificationRequestId: { type: ["string", "null"] },
            excerpt: { type: "string" },
            ideaId: { type: "string" },
            sourceType: { enum: ["original_submission", "clarification_answer"], type: "string" }
          },
          required: ["clarificationRequestId", "excerpt", "ideaId", "sourceType"],
          type: "object"
        },
        type: "array"
      },
      summaryText: {
        description: "Concise R&D-facing summary. Cite source material through sourceTrace, not inline footnotes.",
        type: "string"
      }
    },
    required: ["aiReason", "sourceTrace", "summaryText"],
    type: "object"
  }
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function sourceFingerprint(idea: IdeaForFamily) {
  return JSON.stringify({
    evidenceExample: normalizeText(idea.evidenceExample),
    expectedBenefit: normalizeText(idea.expectedBenefit),
    originalText: normalizeText(idea.originalText),
    problemOpportunity: normalizeText(idea.problemOpportunity),
    supportingLink: normalizeText(idea.supportingLink),
    title: normalizeText(idea.title)
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LlmInvalidResponseError(`LLM summary result is missing ${key}.`, rawResponse, value);
  }

  return raw.trim();
}

function readSourceTrace(value: JsonRecord, rawResponse: JsonRecord | null): IdeaSummarySourceTrace {
  const raw = value.sourceTrace;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new LlmInvalidResponseError("LLM summary result is missing source trace.", rawResponse, value);
  }

  return raw.map((entry) => {
    if (!isRecord(entry)) {
      throw new LlmInvalidResponseError("LLM summary source trace entry is malformed.", rawResponse, value);
    }

    const sourceType = entry.sourceType;
    if (sourceType !== "original_submission" && sourceType !== "clarification_answer") {
      throw new LlmInvalidResponseError("LLM summary source trace used unsupported source type.", rawResponse, value);
    }

    const clarificationRequestId = entry.clarificationRequestId;
    if (clarificationRequestId !== null && clarificationRequestId !== undefined && typeof clarificationRequestId !== "string") {
      throw new LlmInvalidResponseError("LLM summary clarification request id is malformed.", rawResponse, value);
    }

    return {
      clarificationRequestId: clarificationRequestId ?? null,
      excerpt: readRequiredString(entry, "excerpt", rawResponse),
      ideaId: readRequiredString(entry, "ideaId", rawResponse),
      sourceType
    };
  });
}

function readNullableString(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    throw new LlmInvalidResponseError(`LLM relationship result has invalid ${key}.`, rawResponse, value);
  }

  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function parseRelationshipDecision(argumentsValue: JsonRecord, rawResponse: JsonRecord | null): RelationshipDecision {
  const relationship = argumentsValue.relationship;
  if (relationship !== "same_idea" && relationship !== "variant" && relationship !== "unrelated") {
    throw new LlmInvalidResponseError("LLM relationship result used an unsupported relationship.", rawResponse, argumentsValue);
  }

  const relatedIdeaId = readNullableString(argumentsValue, "relatedIdeaId", rawResponse);
  const variantDifference = readNullableString(argumentsValue, "variantDifference", rawResponse);
  if (relationship === "unrelated" && relatedIdeaId) {
    throw new LlmInvalidResponseError("Unrelated idea family result cannot include relatedIdeaId.", rawResponse, argumentsValue);
  }
  if (relationship !== "unrelated" && !relatedIdeaId) {
    throw new LlmInvalidResponseError("Related idea family result requires relatedIdeaId.", rawResponse, argumentsValue);
  }
  if (relationship === "variant" && !variantDifference) {
    throw new LlmInvalidResponseError("Variant idea family result requires variantDifference.", rawResponse, argumentsValue);
  }

  return {
    reason: readRequiredString(argumentsValue, "reason", rawResponse),
    relatedIdeaId,
    relationship,
    variantDifference
  };
}

function parseSummaryDecision(argumentsValue: JsonRecord, rawResponse: JsonRecord | null): SummaryDecision {
  return {
    aiReason: readRequiredString(argumentsValue, "aiReason", rawResponse),
    sourceTrace: readSourceTrace(argumentsValue, rawResponse),
    summaryText: readRequiredString(argumentsValue, "summaryText", rawResponse)
  };
}

async function readIdeaForFamily(ideaId: string) {
  const [idea] = await db
    .select({
      campaignId: ideas.campaignId,
      evidenceExample: ideas.evidenceExample,
      expectedBenefit: ideas.expectedBenefit,
      id: ideas.id,
      originalText: ideas.originalText,
      problemOpportunity: ideas.problemOpportunity,
      submitterUserId: ideas.submitterUserId,
      supportingLink: ideas.supportingLink,
      title: ideas.title
    })
    .from(ideas)
    .where(eq(ideas.id, ideaId))
    .limit(1);

  if (!idea) {
    throw new Error("Idea not found.");
  }

  return idea;
}

async function assertCanUseIdeaFamily(session: DemoSession, campaignId: string) {
  if (!(await canContributeToCampaign(session, campaignId))) {
    throw new Error("Only R&D users with campaign access can manage idea families.");
  }
}

async function findExactDuplicate(idea: IdeaForFamily) {
  const candidates = await db
    .select({
      campaignId: ideas.campaignId,
      evidenceExample: ideas.evidenceExample,
      expectedBenefit: ideas.expectedBenefit,
      id: ideas.id,
      originalText: ideas.originalText,
      problemOpportunity: ideas.problemOpportunity,
      submitterUserId: ideas.submitterUserId,
      supportingLink: ideas.supportingLink,
      title: ideas.title
    })
    .from(ideas)
    .where(and(eq(ideas.campaignId, idea.campaignId), eq(ideas.submitterUserId, idea.submitterUserId)));

  const fingerprint = sourceFingerprint(idea);
  return candidates.find((candidate) => candidate.id !== idea.id && sourceFingerprint(candidate) === fingerprint) ?? null;
}

async function readRelationshipCandidates(idea: IdeaForFamily) {
  return db
    .select({
      campaignId: ideas.campaignId,
      evidenceExample: ideas.evidenceExample,
      expectedBenefit: ideas.expectedBenefit,
      id: ideas.id,
      originalText: ideas.originalText,
      problemOpportunity: ideas.problemOpportunity,
      submitterUserId: ideas.submitterUserId,
      supportingLink: ideas.supportingLink,
      title: ideas.title
    })
    .from(ideas)
    .where(eq(ideas.campaignId, idea.campaignId));
}

function anonymizedIdeaSource(idea: IdeaForFamily) {
  return {
    evidenceExample: idea.evidenceExample,
    expectedBenefit: idea.expectedBenefit,
    ideaId: idea.id,
    originalText: idea.originalText,
    problemOpportunity: idea.problemOpportunity,
    supportingLink: idea.supportingLink,
    title: idea.title
  };
}

async function writeRelationshipLog(input: {
  campaignId: string;
  decision: RelationshipDecision;
  ideaId: string;
  model: string;
  now: Date;
  rawResponse: JsonRecord;
}) {
  await db.insert(aiDecisionLogs).values({
    createdAt: input.now,
    decisionResult: {
      reason: input.decision.reason,
      relatedIdeaId: input.decision.relatedIdeaId,
      relationship: input.decision.relationship,
      variantDifference: input.decision.variantDifference
    },
    id: newId("ai-log"),
    inputReference: JSON.stringify({
      campaignId: input.campaignId,
      ideaId: input.ideaId,
      source: "idea_family_relationship"
    }),
    model: input.model,
    outputSummary: input.decision.reason,
    purpose: relationshipPurpose,
    rawResponse: input.rawResponse,
    status: "succeeded"
  });
}

async function generateRelationshipDecision(input: {
  candidates: IdeaForFamily[];
  idea: IdeaForFamily;
  provider?: LlmProvider;
}) {
  if (input.candidates.length === 0) {
    return {
      decision: {
        reason: "No existing submissions in this campaign.",
        relatedIdeaId: null,
        relationship: "unrelated" as const,
        variantDifference: null
      },
      model: getLlmModel(),
      rawResponse: { skipped: "no_candidates" }
    };
  }

  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "Compare a new Verto idea against existing ideas in the same campaign.",
          "Use only anonymized source material.",
          "Do not use employee names, emails, departments, submitter ids, or identity signals.",
          "Choose same_idea for the same core submission, variant for meaningful differences, unrelated otherwise."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          candidates: input.candidates.map(anonymizedIdeaSource),
          currentIdea: anonymizedIdeaSource(input.idea)
        }),
        role: "user"
      }
    ],
    provider: input.provider,
    tool: relationshipTool
  });

  return {
    decision: parseRelationshipDecision(result.arguments, result.rawResponse),
    model: result.model,
    rawResponse: result.rawResponse
  };
}

function relationshipTypeFromDecision(input: {
  decision: RelationshipDecision;
  idea: IdeaForFamily;
  relatedIdea: IdeaForFamily | null;
}): FamilyRelationshipType {
  if (input.decision.relationship === "unrelated") {
    return "primary";
  }
  if (input.decision.relationship === "variant") {
    return "variant";
  }
  if (input.relatedIdea?.submitterUserId === input.idea.submitterUserId) {
    return "exact_duplicate";
  }

  return "related_submission";
}

async function ensurePrimaryFamily(tx: DbTransaction, idea: IdeaForFamily, now: Date) {
  const [existingMember] = await tx
    .select({ familyId: ideaFamilyMembers.familyId })
    .from(ideaFamilyMembers)
    .where(eq(ideaFamilyMembers.ideaId, idea.id))
    .limit(1);

  if (existingMember) {
    return existingMember.familyId;
  }

  const familyId = newId("idea-family");
  await tx.insert(ideaFamilies).values({
    campaignId: idea.campaignId,
    createdAt: now,
    id: familyId,
    primaryIdeaId: idea.id,
    updatedAt: now
  });
  await tx.insert(ideaFamilyMembers).values({
    createdAt: now,
    familyId,
    ideaId: idea.id,
    relationshipType: "primary",
    variantDifference: null
  });

  return familyId;
}

async function addFamilyMember(input: {
  familyId: string;
  idea: IdeaForFamily;
  now: Date;
  relationshipType: FamilyRelationshipType;
  tx: DbTransaction;
  variantDifference?: string | null;
}) {
  const [existingMember] = await input.tx
    .select({ familyId: ideaFamilyMembers.familyId })
    .from(ideaFamilyMembers)
    .where(eq(ideaFamilyMembers.ideaId, input.idea.id))
    .limit(1);

  if (existingMember) {
    return;
  }

  await input.tx.insert(ideaFamilyMembers).values({
    createdAt: input.now,
    familyId: input.familyId,
    ideaId: input.idea.id,
    relationshipType: input.relationshipType,
    variantDifference: input.variantDifference ?? null
  });
  await input.tx.update(ideaFamilies).set({ updatedAt: input.now }).where(eq(ideaFamilies.id, input.familyId));
}

async function assertCanUseFamily(session: DemoSession, familyId: string) {
  const [family] = await db
    .select({
      campaignId: ideaFamilies.campaignId,
      familyId: ideaFamilies.id,
      primaryIdeaId: ideaFamilies.primaryIdeaId
    })
    .from(ideaFamilies)
    .where(eq(ideaFamilies.id, familyId))
    .limit(1);

  if (!family) {
    throw new Error("Idea family not found.");
  }
  await assertCanUseIdeaFamily(session, family.campaignId);

  return family;
}

async function familyMemberIdeaIds(familyId: string) {
  const rows = await db
    .select({ ideaId: ideaFamilyMembers.ideaId })
    .from(ideaFamilyMembers)
    .where(eq(ideaFamilyMembers.familyId, familyId));

  return rows.map((row) => row.ideaId);
}

async function readFamilySummarySource(familyId: string) {
  const memberRows = await db
    .select({
      evidenceExample: ideas.evidenceExample,
      expectedBenefit: ideas.expectedBenefit,
      ideaId: ideas.id,
      originalText: ideas.originalText,
      problemOpportunity: ideas.problemOpportunity,
      relationshipType: ideaFamilyMembers.relationshipType,
      supportingLink: ideas.supportingLink,
      title: ideas.title,
      variantDifference: ideaFamilyMembers.variantDifference
    })
    .from(ideaFamilyMembers)
    .innerJoin(ideas, eq(ideas.id, ideaFamilyMembers.ideaId))
    .where(eq(ideaFamilyMembers.familyId, familyId))
    .orderBy(ideaFamilyMembers.createdAt);

  const ideaIds = memberRows.map((row) => row.ideaId);
  const clarificationRows =
    ideaIds.length === 0
      ? []
      : await db
          .select({
            answerText: clarificationRequests.answerText,
            ideaId: clarificationRequests.ideaId,
            requestId: clarificationRequests.id,
            requestText: clarificationRequests.requestText,
            supportingLink: clarificationRequests.supportingLink
          })
          .from(clarificationRequests)
          .where(and(inArray(clarificationRequests.ideaId, ideaIds), eq(clarificationRequests.status, "answered")));

  return {
    clarifications: clarificationRows,
    members: memberRows
  };
}

function summaryInputReference(familyId: string, campaignId: string, memberIdeaIds: string[]) {
  return JSON.stringify({
    campaignId,
    familyId,
    ideaIds: memberIdeaIds,
    source: "idea_family_summary"
  });
}

async function generateSummaryDecision(input: {
  campaignId: string;
  familyId: string;
  memberIdeaIds: string[];
  provider?: LlmProvider;
}) {
  const source = await readFamilySummarySource(input.familyId);
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "Create an internal R&D-facing summary for a Verto idea family.",
          "Use source submissions and employee clarification answers only.",
          "Do not use employee names, emails, departments, or identity signals.",
          "Cite original submissions and clarification answers in sourceTrace."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          familyId: input.familyId,
          memberIdeaIds: input.memberIdeaIds,
          sources: source
        }),
        role: "user"
      }
    ],
    provider: input.provider,
    tool: summaryTool
  });

  return {
    decision: parseSummaryDecision(result.arguments, result.rawResponse),
    model: result.model,
    rawResponse: result.rawResponse
  };
}

async function writeSummary(input: {
  campaignId: string;
  familyId: string;
  memberIdeaIds: string[];
  now: Date;
  provider?: LlmProvider;
  requestedByUserId: string;
}) {
  const generated = await generateSummaryDecision({
    campaignId: input.campaignId,
    familyId: input.familyId,
    memberIdeaIds: input.memberIdeaIds,
    provider: input.provider
  });
  const logId = newId("ai-log");
  const inputReference = summaryInputReference(input.familyId, input.campaignId, input.memberIdeaIds);
  let insertedSummaryId = "";
  let insertedVersion = 0;

  await db.transaction(async (tx) => {
    await tx.insert(aiDecisionLogs).values({
      createdAt: input.now,
      decisionResult: {
        aiReason: generated.decision.aiReason,
        sourceTrace: generated.decision.sourceTrace,
        summaryText: generated.decision.summaryText
      },
      id: logId,
      inputReference,
      model: generated.model,
      outputSummary: generated.decision.aiReason,
      purpose: summaryPurpose,
      rawResponse: generated.rawResponse,
      status: "succeeded"
    });

    const [latestSummary] = await tx
      .select({ version: ideaReviewSummaries.version })
      .from(ideaReviewSummaries)
      .where(eq(ideaReviewSummaries.familyId, input.familyId))
      .orderBy(desc(ideaReviewSummaries.version))
      .limit(1);
    const version = (latestSummary?.version ?? 0) + 1;
    const summaryId = newId("idea-summary");

    await tx
      .update(ideaReviewSummaries)
      .set({ isCurrent: false })
      .where(and(eq(ideaReviewSummaries.familyId, input.familyId), eq(ideaReviewSummaries.isCurrent, true)));
    await tx.insert(ideaReviewSummaries).values({
      aiDecisionLogId: logId,
      aiReason: generated.decision.aiReason,
      campaignId: input.campaignId,
      createdAt: input.now,
      familyId: input.familyId,
      id: summaryId,
      isCurrent: true,
      requestedByUserId: input.requestedByUserId,
      sourceTrace: generated.decision.sourceTrace,
      summaryText: generated.decision.summaryText,
      version
    });
    insertedSummaryId = summaryId;
    insertedVersion = version;
  });

  return {
    ...generated.decision,
    createdAt: input.now,
    isCurrent: true,
    requestedByUserId: input.requestedByUserId,
    summaryId: insertedSummaryId,
    version: insertedVersion
  };
}

export async function analyzeIdeaFamilyForIdea(session: DemoSession, ideaId: string, options: AnalyzeOptions = {}) {
  const idea = await readIdeaForFamily(ideaId);
  await assertCanUseIdeaFamily(session, idea.campaignId);

  const now = options.now ?? new Date();
  const exactDuplicate = await findExactDuplicate(idea);
  const candidates = (await readRelationshipCandidates(idea)).filter((candidate) => candidate.id !== idea.id);
  let relationshipDecision: RelationshipDecision;
  if (exactDuplicate) {
    relationshipDecision = {
      reason: "Submitted source exactly matches an earlier submission by the same employee.",
      relatedIdeaId: exactDuplicate.id,
      relationship: "same_idea",
      variantDifference: null
    };
  } else {
    const relationship = await generateRelationshipDecision({
      candidates,
      idea,
      provider: options.relationshipProvider
    });
    await writeRelationshipLog({
      campaignId: idea.campaignId,
      decision: relationship.decision,
      ideaId: idea.id,
      model: relationship.model,
      now,
      rawResponse: relationship.rawResponse
    });
    relationshipDecision = relationship.decision;
  }

  const relatedIdea =
    relationshipDecision.relatedIdeaId ? candidates.find((candidate) => candidate.id === relationshipDecision.relatedIdeaId) ?? null : null;
  if (relationshipDecision.relationship !== "unrelated" && !relatedIdea) {
    throw new Error("Related idea not found.");
  }

  const relationshipType = relationshipTypeFromDecision({ decision: relationshipDecision, idea, relatedIdea });
  const familyId = await db.transaction(async (tx) => {
    if (!relatedIdea) {
      return ensurePrimaryFamily(tx, idea, now);
    }

    const nextFamilyId = await ensurePrimaryFamily(tx, relatedIdea, now);
    await addFamilyMember({
      familyId: nextFamilyId,
      idea,
      now,
      relationshipType,
      tx,
      variantDifference: relationshipDecision.variantDifference
    });

    return nextFamilyId;
  });
  const memberIdeaIds = await familyMemberIdeaIds(familyId);

  await writeSummary({
    campaignId: idea.campaignId,
    familyId,
    memberIdeaIds,
    now,
    provider: options.summaryProvider,
    requestedByUserId: session.user.id
  });

  return {
    familyId,
    memberIdeaIds,
    relationshipType,
    reviewPacketCount: 1
  };
}

export async function regenerateIdeaFamilySummary(session: DemoSession, familyId: string, options: SummaryOptions = {}) {
  const family = await assertCanUseFamily(session, familyId);
  const memberIdeaIds = await familyMemberIdeaIds(family.familyId);

  return writeSummary({
    campaignId: family.campaignId,
    familyId: family.familyId,
    memberIdeaIds,
    now: options.now ?? new Date(),
    provider: options.summaryProvider,
    requestedByUserId: session.user.id
  });
}

export async function getIdeaFamilySummaryHistory(session: DemoSession, familyId: string) {
  const family = await assertCanUseFamily(session, familyId);

  return db
    .select({
      aiReason: ideaReviewSummaries.aiReason,
      createdAt: ideaReviewSummaries.createdAt,
      familyId: ideaReviewSummaries.familyId,
      isCurrent: ideaReviewSummaries.isCurrent,
      requestedByUserId: ideaReviewSummaries.requestedByUserId,
      sourceTrace: ideaReviewSummaries.sourceTrace,
      summaryId: ideaReviewSummaries.id,
      summaryText: ideaReviewSummaries.summaryText,
      version: ideaReviewSummaries.version
    })
    .from(ideaReviewSummaries)
    .where(eq(ideaReviewSummaries.familyId, family.familyId))
    .orderBy(desc(ideaReviewSummaries.version));
}

export async function getAccessibleIdeaFamilyReviewView(session: DemoSession) {
  if (session.role.id === "employee") {
    throw new Error("Only R&D users with campaign access can inspect idea families.");
  }

  const familyRows = await db
    .select({
      campaignId: ideaFamilies.campaignId,
      campaignTitle: campaigns.publicTitle,
      familyId: ideaFamilies.id,
      primaryIdeaId: ideaFamilies.primaryIdeaId
    })
    .from(ideaFamilies)
    .innerJoin(campaigns, eq(campaigns.id, ideaFamilies.campaignId))
    .orderBy(desc(ideaFamilies.createdAt));

  const accessibleFamilies = [];
  for (const family of familyRows) {
    if (await canContributeToCampaign(session, family.campaignId)) {
      accessibleFamilies.push(family);
    }
  }

  return Promise.all(
    accessibleFamilies.map(async (family) => {
      const members = await db
        .select({
          department: users.department,
          displayName: users.displayName,
          email: users.email,
          ideaId: ideas.id,
          originalText: ideas.originalText,
          relationshipType: ideaFamilyMembers.relationshipType,
          submitterUserId: users.id,
          title: ideas.title,
          variantDifference: ideaFamilyMembers.variantDifference
        })
        .from(ideaFamilyMembers)
        .innerJoin(ideas, eq(ideas.id, ideaFamilyMembers.ideaId))
        .innerJoin(users, eq(users.id, ideas.submitterUserId))
        .where(eq(ideaFamilyMembers.familyId, family.familyId))
        .orderBy(ideaFamilyMembers.createdAt);
      const [currentSummary] = await db
        .select({
          aiReason: ideaReviewSummaries.aiReason,
          createdAt: ideaReviewSummaries.createdAt,
          sourceTrace: ideaReviewSummaries.sourceTrace,
          summaryId: ideaReviewSummaries.id,
          summaryText: ideaReviewSummaries.summaryText,
          version: ideaReviewSummaries.version
        })
        .from(ideaReviewSummaries)
        .where(and(eq(ideaReviewSummaries.familyId, family.familyId), eq(ideaReviewSummaries.isCurrent, true)))
        .limit(1);

      return {
        ...family,
        currentSummary: currentSummary ?? null,
        members
      };
    })
  );
}

export async function getAccessibleIdeaFamilyCandidates(session: DemoSession) {
  if (session.role.id === "employee") {
    return [];
  }

  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaignTitle: campaigns.publicTitle,
      familyId: ideaFamilyMembers.familyId,
      ideaId: ideas.id,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .innerJoin(
      campaignMemberships,
      and(eq(campaignMemberships.campaignId, ideas.campaignId), eq(campaignMemberships.userId, session.user.id))
    )
    .leftJoin(ideaFamilyMembers, eq(ideaFamilyMembers.ideaId, ideas.id))
    .orderBy(desc(ideas.createdAt));

  return rows.filter((row) => !row.familyId);
}
