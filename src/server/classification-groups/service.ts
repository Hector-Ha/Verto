import crypto from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { canContributeToCampaign, canManageGeneralCampaign } from "../auth/permissions";
import type { DemoSession } from "../auth/session";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  auditEvents,
  campaignKnowledgeReports,
  campaigns,
  generalCampaignReviewPackets,
  ideaClassificationGroupMembers,
  ideaClassificationGroups,
  ideas,
  users
} from "../db/schema";
import { getLlmModel } from "../env";
import { callStructuredTool, LlmInvalidResponseError, type LlmProvider } from "../llm/adapter";

export const GENERAL_CLASSIFICATION_GROUP_CAP = 100;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type JsonRecord = Record<string, unknown>;
type ClassificationGroupType = (typeof ideaClassificationGroups.$inferSelect)["groupType"];
type ClassificationTrigger = "initial_classification" | "clarification_answer";

type ClassificationGroupDecision = {
  groupType: ClassificationGroupType;
  isPrimary: boolean;
  name: string;
  placementReason: string;
  summaryText: string;
};

type ClassificationDecision = {
  groups: ClassificationGroupDecision[];
};

type ClassificationOptions = {
  contextVersion?: string;
  maxGeneralGroups?: number;
  now?: Date;
  provider?: LlmProvider;
};

type RankingOptions = {
  contextVersion?: string;
  now?: Date;
  provider?: LlmProvider;
};

type RankingDecision = {
  groupName: string;
  rankPosition: number;
};

const classificationPurpose = "idea_classification.assign_groups";
const groupRankingPurpose = "idea_classification.rank_groups";
const classificationTool = {
  description: "Record AI-managed Verto idea classification groups for one idea.",
  name: "record_idea_classification",
  parameters: {
    additionalProperties: false,
    properties: {
      groups: {
        items: {
          additionalProperties: false,
          properties: {
            groupType: {
              enum: ["standard", "single_idea", "emerging_theme"],
              type: "string"
            },
            isPrimary: { type: "boolean" },
            name: { type: "string" },
            placementReason: { type: "string" },
            summaryText: { type: "string" }
          },
          required: ["groupType", "isPrimary", "name", "placementReason", "summaryText"],
          type: "object"
        },
        minItems: 1,
        type: "array"
      }
    },
    required: ["groups"],
    type: "object"
  }
};
const groupRankingTool = {
  description: "Record one ranking order for Verto idea classification groups in a specific campaign.",
  name: "record_idea_group_ranking",
  parameters: {
    additionalProperties: false,
    properties: {
      rankings: {
        items: {
          additionalProperties: false,
          properties: {
            groupName: { type: "string" },
            rankPosition: { minimum: 1, type: "integer" }
          },
          required: ["groupName", "rankPosition"],
          type: "object"
        },
        minItems: 1,
        type: "array"
      }
    },
    required: ["rankings"],
    type: "object"
  }
};

function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LlmInvalidResponseError(`LLM classification result is missing ${key}.`, rawResponse, value);
  }

  return raw.trim();
}

function readRequiredBoolean(value: JsonRecord, key: string, rawResponse: JsonRecord | null) {
  const raw = value[key];
  if (typeof raw !== "boolean") {
    throw new LlmInvalidResponseError(`LLM classification result is missing ${key}.`, rawResponse, value);
  }

  return raw;
}

function readGroupType(value: JsonRecord, rawResponse: JsonRecord | null): ClassificationGroupType {
  const raw = value.groupType;
  if (raw === "standard" || raw === "single_idea" || raw === "emerging_theme") {
    return raw;
  }

  throw new LlmInvalidResponseError("LLM classification result used unsupported groupType.", rawResponse, value);
}

function parseClassificationDecision(argumentsValue: JsonRecord, rawResponse: JsonRecord | null): ClassificationDecision {
  const rawGroups = argumentsValue.groups;
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) {
    throw new LlmInvalidResponseError("LLM classification result must include at least one group.", rawResponse, argumentsValue);
  }

  const seenNames = new Set<string>();
  const groups = rawGroups.map((entry) => {
    if (!isRecord(entry)) {
      throw new LlmInvalidResponseError("LLM classification group is malformed.", rawResponse, argumentsValue);
    }

    const name = readRequiredString(entry, "name", rawResponse);
    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      throw new LlmInvalidResponseError("LLM classification result duplicated a group name.", rawResponse, argumentsValue);
    }
    seenNames.add(normalizedName);

    return {
      groupType: readGroupType(entry, rawResponse),
      isPrimary: readRequiredBoolean(entry, "isPrimary", rawResponse),
      name,
      placementReason: readRequiredString(entry, "placementReason", rawResponse),
      summaryText: readRequiredString(entry, "summaryText", rawResponse)
    };
  });

  if (groups.filter((group) => group.isPrimary).length !== 1) {
    throw new LlmInvalidResponseError("LLM classification result must choose exactly one primary group.", rawResponse, argumentsValue);
  }

  return { groups };
}

function parseRankingDecision(argumentsValue: JsonRecord, rawResponse: JsonRecord | null): RankingDecision[] {
  const rawRankings = argumentsValue.rankings;
  if (!Array.isArray(rawRankings) || rawRankings.length === 0) {
    throw new LlmInvalidResponseError("LLM group ranking result must include rankings.", rawResponse, argumentsValue);
  }

  const seenGroups = new Set<string>();
  const seenPositions = new Set<number>();
  return rawRankings.map((entry) => {
    if (!isRecord(entry)) {
      throw new LlmInvalidResponseError("LLM group ranking entry is malformed.", rawResponse, argumentsValue);
    }

    const groupName = readRequiredString(entry, "groupName", rawResponse);
    const rawRankPosition = entry.rankPosition;
    if (typeof rawRankPosition !== "number" || !Number.isInteger(rawRankPosition) || rawRankPosition < 1) {
      throw new LlmInvalidResponseError("LLM group ranking result has invalid rankPosition.", rawResponse, argumentsValue);
    }
    const rankPosition = rawRankPosition;
    const normalizedName = groupName.toLowerCase();
    if (seenGroups.has(normalizedName) || seenPositions.has(rankPosition)) {
      throw new LlmInvalidResponseError("LLM group ranking result has duplicate groups or ranks.", rawResponse, argumentsValue);
    }
    seenGroups.add(normalizedName);
    seenPositions.add(rankPosition);

    return { groupName, rankPosition };
  });
}

async function readIdeaContext(ideaId: string) {
  const [row] = await db
    .select({
      campaignId: ideas.campaignId,
      campaignLifecycleStatus: campaigns.lifecycleStatus,
      campaignPrompt: campaigns.publicPrompt,
      campaignTitle: campaigns.publicTitle,
      campaignType: campaigns.type,
      evidenceExample: ideas.evidenceExample,
      expectedBenefit: ideas.expectedBenefit,
      ideaId: ideas.id,
      originalText: ideas.originalText,
      problemOpportunity: ideas.problemOpportunity,
      supportingLink: ideas.supportingLink,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .where(eq(ideas.id, ideaId))
    .limit(1);

  if (!row) {
    throw new Error("Idea not found.");
  }

  return row;
}

async function readCampaign(campaignId: string) {
  const [campaign] = await db
    .select({
      campaignId: campaigns.id,
      campaignPrompt: campaigns.publicPrompt,
      campaignTitle: campaigns.publicTitle,
      campaignType: campaigns.type,
      lifecycleStatus: campaigns.lifecycleStatus
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error("Campaign not found.");
  }

  return campaign;
}

async function assertCanClassify(session: DemoSession, campaignId: string, campaignType: "general" | "specific") {
  if (campaignType === "general") {
    if (!(await canManageGeneralCampaign(session))) {
      throw new Error("Only General Campaign owners can classify General Campaign ideas.");
    }
    return;
  }

  if (!(await canContributeToCampaign(session, campaignId))) {
    throw new Error("Only R&D users with campaign access can classify ideas.");
  }
}

async function assertCanViewClassificationGroups(session: DemoSession, campaignId: string) {
  if (session.role.id === "employee" || !(await canContributeToCampaign(session, campaignId))) {
    throw new Error("Only R&D users with campaign access can inspect classification groups.");
  }
}

async function resolveContextVersion(
  campaignId: string,
  campaignType: "general" | "specific",
  contextVersion?: string
) {
  if (contextVersion?.trim()) {
    return contextVersion.trim();
  }

  if (campaignType === "general") {
    const [packet] = await db
      .select({ contextVersion: generalCampaignReviewPackets.contextVersion })
      .from(generalCampaignReviewPackets)
      .where(
        and(
          eq(generalCampaignReviewPackets.campaignId, campaignId),
          eq(generalCampaignReviewPackets.isCurrent, true)
        )
      )
      .orderBy(desc(generalCampaignReviewPackets.createdAt))
      .limit(1);

    return packet?.contextVersion ?? `${campaignId}:general-classification`;
  }

  const [report] = await db
    .select({ id: campaignKnowledgeReports.id })
    .from(campaignKnowledgeReports)
    .where(and(eq(campaignKnowledgeReports.campaignId, campaignId), eq(campaignKnowledgeReports.status, "approved")))
    .orderBy(desc(campaignKnowledgeReports.generatedAt))
    .limit(1);

  return report?.id ?? `${campaignId}:classification`;
}

async function activeGroupsForCampaign(campaignId: string) {
  return db
    .select()
    .from(ideaClassificationGroups)
    .where(and(eq(ideaClassificationGroups.campaignId, campaignId), eq(ideaClassificationGroups.isActive, true)))
    .orderBy(ideaClassificationGroups.createdAt);
}

async function memberCountsForGroups(groupIds: string[]) {
  if (groupIds.length === 0) {
    return new Map<string, number>();
  }

  const rows = await db
    .select({ groupId: ideaClassificationGroupMembers.groupId })
    .from(ideaClassificationGroupMembers)
    .where(inArray(ideaClassificationGroupMembers.groupId, groupIds));
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + 1);
  }

  return counts;
}

async function generateClassificationDecision(input: {
  contextVersion: string;
  existingGroups: Awaited<ReturnType<typeof activeGroupsForCampaign>>;
  idea: Awaited<ReturnType<typeof readIdeaContext>>;
  maxGeneralGroups: number;
  provider?: LlmProvider;
  trigger: ClassificationTrigger;
}) {
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "You manage Verto idea classification groups.",
          "Groups are review filters, not taxonomy maintenance tasks.",
          "One idea may appear in multiple groups, but choose exactly one primary group for dashboard counting.",
          "Opening a group must show a summary before individual idea packets.",
          "Create single_idea groups only for unusually valuable, novel, low-volume, or easy-to-miss ideas.",
          "Use emerging_theme for ordinary lone or weak early clusters.",
          "For General Campaign, fit existing groups before creating new groups and respect the default 100 group cap.",
          "Do not use employee identity, seniority, department, or popularity for classification."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          campaign: {
            contextVersion: input.contextVersion,
            lifecycleStatus: input.idea.campaignLifecycleStatus,
            maxGeneralGroups: input.maxGeneralGroups,
            prompt: input.idea.campaignPrompt,
            title: input.idea.campaignTitle,
            type: input.idea.campaignType
          },
          existingGroups: input.existingGroups.map((group) => ({
            groupType: group.groupType,
            name: group.name,
            summaryText: group.summaryText
          })),
          idea: {
            evidenceExample: input.idea.evidenceExample,
            expectedBenefit: input.idea.expectedBenefit,
            originalText: input.idea.originalText,
            problemOpportunity: input.idea.problemOpportunity,
            supportingLink: input.idea.supportingLink,
            title: input.idea.title
          },
          trigger: input.trigger
        }),
        role: "user"
      }
    ],
    provider: input.provider,
    tool: classificationTool
  });

  return {
    decision: parseClassificationDecision(result.arguments, result.rawResponse),
    model: result.model,
    rawResponse: result.rawResponse
  };
}

async function writeAiLog(input: {
  decisionResult: JsonRecord | null;
  inputReference: string;
  model: string;
  outputSummary: string | null;
  purpose: string;
  rawResponse: JsonRecord | null;
}) {
  const logId = newId("ai-log");
  await db.insert(aiDecisionLogs).values({
    createdAt: new Date(),
    decisionResult: input.decisionResult,
    id: logId,
    inputReference: input.inputReference,
    model: input.model,
    outputSummary: input.outputSummary,
    purpose: input.purpose,
    rawResponse: input.rawResponse,
    status: "succeeded"
  });

  return logId;
}

async function groupIdsForCampaign(tx: DbTransaction, campaignId: string) {
  const rows = await tx
    .select({ groupId: ideaClassificationGroups.id })
    .from(ideaClassificationGroups)
    .where(eq(ideaClassificationGroups.campaignId, campaignId));

  return rows.map((row) => row.groupId);
}

async function insertAudit(
  tx: DbTransaction,
  input: {
    actorType: "ai" | "user";
    actorUserId?: string | null;
    entityId: string;
    entityType: string;
    eventType: string;
    metadata?: Record<string, unknown> | null;
    now: Date;
    reason: string;
  }
) {
  await tx.insert(auditEvents).values({
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    createdAt: input.now,
    entityId: input.entityId,
    entityType: input.entityType,
    eventType: input.eventType,
    id: newId("audit"),
    metadata: input.metadata ?? null,
    reason: input.reason
  });
}

async function dissolveSmallestGeneralGroup(input: {
  activeGroups: Array<typeof ideaClassificationGroups.$inferSelect>;
  contextVersion: string;
  newGroupName: string;
  now: Date;
  tx: DbTransaction;
}) {
  if (input.activeGroups.length < 2) {
    throw new Error("General Campaign classification cap requires at least one remaining group.");
  }

  const groupIds = input.activeGroups.map((group) => group.id);
  const memberRows = await input.tx
    .select({
      groupId: ideaClassificationGroupMembers.groupId,
      ideaId: ideaClassificationGroupMembers.ideaId,
      isPrimary: ideaClassificationGroupMembers.isPrimary,
      placementReason: ideaClassificationGroupMembers.placementReason
    })
    .from(ideaClassificationGroupMembers)
    .where(inArray(ideaClassificationGroupMembers.groupId, groupIds));
  const memberCounts = new Map<string, number>();
  for (const row of memberRows) {
    memberCounts.set(row.groupId, (memberCounts.get(row.groupId) ?? 0) + 1);
  }

  const dissolved = [...input.activeGroups].sort((left, right) => {
    const countDiff = (memberCounts.get(left.id) ?? 0) - (memberCounts.get(right.id) ?? 0);
    return countDiff || left.createdAt.getTime() - right.createdAt.getTime();
  })[0];
  const remainingGroups = input.activeGroups.filter((group) => group.id !== dissolved.id);
  const destination = [...remainingGroups].sort((left, right) => {
    const countDiff = (memberCounts.get(right.id) ?? 0) - (memberCounts.get(left.id) ?? 0);
    return countDiff || left.name.localeCompare(right.name);
  })[0];
  const movedIdeas: Array<{ destinationGroupId: string; destinationGroupName: string; ideaId: string }> = [];

  for (const member of memberRows.filter((row) => row.groupId === dissolved.id)) {
    const [existingDestinationMember] = await input.tx
      .select({ groupId: ideaClassificationGroupMembers.groupId, isPrimary: ideaClassificationGroupMembers.isPrimary })
      .from(ideaClassificationGroupMembers)
      .where(
        and(
          eq(ideaClassificationGroupMembers.groupId, destination.id),
          eq(ideaClassificationGroupMembers.ideaId, member.ideaId)
        )
      )
      .limit(1);
    const [existingPrimary] = await input.tx
      .select({ groupId: ideaClassificationGroupMembers.groupId })
      .from(ideaClassificationGroupMembers)
      .innerJoin(ideaClassificationGroups, eq(ideaClassificationGroups.id, ideaClassificationGroupMembers.groupId))
      .where(
        and(
          eq(ideaClassificationGroups.campaignId, dissolved.campaignId),
          eq(ideaClassificationGroupMembers.ideaId, member.ideaId),
          eq(ideaClassificationGroupMembers.isPrimary, true)
        )
      )
      .limit(1);
    const shouldBePrimary = member.isPrimary && (!existingPrimary || existingPrimary.groupId === dissolved.id);

    if (existingDestinationMember) {
      if (shouldBePrimary && !existingDestinationMember.isPrimary) {
        await input.tx
          .update(ideaClassificationGroupMembers)
          .set({
            isPrimary: true,
            placementReason: `${member.placementReason} Moved after ${dissolved.name} dissolved at cap.`,
            updatedAt: input.now
          })
          .where(
            and(
              eq(ideaClassificationGroupMembers.groupId, destination.id),
              eq(ideaClassificationGroupMembers.ideaId, member.ideaId)
            )
          );
      }
    } else {
      await input.tx.insert(ideaClassificationGroupMembers).values({
        contextVersion: input.contextVersion,
        createdAt: input.now,
        groupId: destination.id,
        ideaId: member.ideaId,
        isPrimary: shouldBePrimary,
        placementReason: `${member.placementReason} Moved after ${dissolved.name} dissolved at cap.`,
        updatedAt: input.now
      });
    }

    movedIdeas.push({
      destinationGroupId: destination.id,
      destinationGroupName: destination.name,
      ideaId: member.ideaId
    });
  }

  await input.tx
    .delete(ideaClassificationGroupMembers)
    .where(eq(ideaClassificationGroupMembers.groupId, dissolved.id));
  await input.tx
    .update(ideaClassificationGroups)
    .set({
      isActive: false,
      rankPosition: null,
      rankedAt: null,
      rankingContextVersion: null,
      updatedAt: input.now
    })
    .where(eq(ideaClassificationGroups.id, dissolved.id));
  await insertAudit(input.tx, {
    actorType: "ai",
    entityId: "general-campaign",
    entityType: "campaign",
    eventType: "general_campaign.classification_group.dissolved",
    metadata: {
      contextVersion: input.contextVersion,
      destinationGroups: movedIdeas.map((move) => ({
        groupId: move.destinationGroupId,
        name: move.destinationGroupName
      })),
      dissolvedGroupId: dissolved.id,
      movedIdeas,
      newGroupName: input.newGroupName,
      oldGroupName: dissolved.name
    },
    now: input.now,
    reason: `General Campaign classification cap reached; dissolved ${dissolved.name} before creating ${input.newGroupName}.`
  });

  return {
    groupId: dissolved.id,
    groupName: dissolved.name,
    movedIdeas
  };
}

async function ensureGroup(input: {
  contextVersion: string;
  decision: ClassificationGroupDecision;
  campaignId: string;
  now: Date;
  tx: DbTransaction;
}) {
  const [existing] = await input.tx
    .select()
    .from(ideaClassificationGroups)
    .where(
      and(
        eq(ideaClassificationGroups.campaignId, input.campaignId),
        eq(ideaClassificationGroups.name, input.decision.name)
      )
    )
    .limit(1);

  if (existing) {
    await input.tx
      .update(ideaClassificationGroups)
      .set({
        contextVersion: input.contextVersion,
        groupType: input.decision.groupType,
        isActive: true,
        summaryText: input.decision.summaryText,
        updatedAt: input.now
      })
      .where(eq(ideaClassificationGroups.id, existing.id));

    return existing.id;
  }

  const groupId = newId("idea-group");
  await input.tx.insert(ideaClassificationGroups).values({
    campaignId: input.campaignId,
    contextVersion: input.contextVersion,
    createdAt: input.now,
    groupType: input.decision.groupType,
    id: groupId,
    isActive: true,
    name: input.decision.name,
    rankPosition: null,
    rankedAt: null,
    rankingContextVersion: null,
    summaryText: input.decision.summaryText,
    updatedAt: input.now
  });

  return groupId;
}

async function applyClassification(input: {
  contextVersion: string;
  decision: ClassificationDecision;
  idea: Awaited<ReturnType<typeof readIdeaContext>>;
  maxGeneralGroups: number;
  now: Date;
  trigger: ClassificationTrigger;
}) {
  const dissolvedGroups: Array<Awaited<ReturnType<typeof dissolveSmallestGeneralGroup>>> = [];
  const assignedGroups: Array<{ groupId: string; groupName: string; isPrimary: boolean }> = [];

  await db.transaction(async (tx) => {
    const campaignGroups = await tx
      .select()
      .from(ideaClassificationGroups)
      .where(eq(ideaClassificationGroups.campaignId, input.idea.campaignId))
      .for("update");
    let activeGroups = campaignGroups.filter((group) => group.isActive);

    if (input.idea.campaignType === "general" && input.maxGeneralGroups < 2) {
      throw new Error("General Campaign classification cap must allow at least two groups.");
    }

    const activeNames = new Set(activeGroups.map((group) => group.name.toLowerCase()));
    for (const group of input.decision.groups) {
      if (input.idea.campaignType !== "general" || activeNames.has(group.name.toLowerCase())) {
        continue;
      }

      if (activeGroups.length >= input.maxGeneralGroups) {
        const dissolved = await dissolveSmallestGeneralGroup({
          activeGroups,
          contextVersion: input.contextVersion,
          newGroupName: group.name,
          now: input.now,
          tx
        });
        dissolvedGroups.push(dissolved);
        activeGroups = activeGroups.filter((activeGroup) => activeGroup.id !== dissolved.groupId);
      }
      activeNames.add(group.name.toLowerCase());
      activeGroups = [
        ...activeGroups,
        {
          campaignId: input.idea.campaignId,
          contextVersion: input.contextVersion,
          createdAt: input.now,
          groupType: group.groupType,
          id: newId("pending"),
          isActive: true,
          name: group.name,
          rankPosition: null,
          rankedAt: null,
          rankingContextVersion: null,
          summaryText: group.summaryText,
          updatedAt: input.now
        }
      ];
    }

    const allGroupIds = await groupIdsForCampaign(tx, input.idea.campaignId);
    if (allGroupIds.length > 0) {
      await tx
        .delete(ideaClassificationGroupMembers)
        .where(
          and(
            eq(ideaClassificationGroupMembers.ideaId, input.idea.ideaId),
            inArray(ideaClassificationGroupMembers.groupId, allGroupIds)
          )
        );
    }

    for (const group of input.decision.groups) {
      const groupId = await ensureGroup({
        campaignId: input.idea.campaignId,
        contextVersion: input.contextVersion,
        decision: group,
        now: input.now,
        tx
      });
      await tx.insert(ideaClassificationGroupMembers).values({
        contextVersion: input.contextVersion,
        createdAt: input.now,
        groupId,
        ideaId: input.idea.ideaId,
        isPrimary: group.isPrimary,
        placementReason: group.placementReason,
        updatedAt: input.now
      });
      assignedGroups.push({ groupId, groupName: group.name, isPrimary: group.isPrimary });
    }

    await insertAudit(tx, {
      actorType: "ai",
      entityId: input.idea.ideaId,
      entityType: "idea",
      eventType:
        input.trigger === "clarification_answer"
          ? "idea.classification.placement_updated"
          : "idea.classification.assigned",
      metadata: {
        assignedGroups,
        contextVersion: input.contextVersion,
        dissolvedGroups,
        primaryGroupName: assignedGroups.find((group) => group.isPrimary)?.groupName ?? null,
        trigger: input.trigger
      },
      now: input.now,
      reason:
        input.trigger === "clarification_answer"
          ? "Clarification answer updated one idea's classification placement without reranking groups."
          : "AI assigned classification groups for one idea."
    });
  });

  return {
    assignedGroups,
    dissolvedGroups
  };
}

async function classifyWithTrigger(
  session: DemoSession,
  ideaId: string,
  trigger: ClassificationTrigger,
  options: ClassificationOptions = {}
) {
  const idea = await readIdeaContext(ideaId);
  await assertCanClassify(session, idea.campaignId, idea.campaignType);
  const now = options.now ?? new Date();
  const maxGeneralGroups = options.maxGeneralGroups ?? GENERAL_CLASSIFICATION_GROUP_CAP;
  const contextVersion = await resolveContextVersion(idea.campaignId, idea.campaignType, options.contextVersion);
  const existingGroups = await activeGroupsForCampaign(idea.campaignId);
  const generated = await generateClassificationDecision({
    contextVersion,
    existingGroups,
    idea,
    maxGeneralGroups,
    provider: options.provider,
    trigger
  });
  const inputReference = JSON.stringify({
    campaignId: idea.campaignId,
    contextVersion,
    ideaId: idea.ideaId,
    source: "idea_classification",
    trigger
  });

  await writeAiLog({
    decisionResult: { groups: generated.decision.groups },
    inputReference,
    model: generated.model,
    outputSummary: generated.decision.groups.find((group) => group.isPrimary)?.placementReason ?? null,
    purpose: classificationPurpose,
    rawResponse: generated.rawResponse
  });

  const applied = await applyClassification({
    contextVersion,
    decision: generated.decision,
    idea,
    maxGeneralGroups,
    now,
    trigger
  });

  return {
    assignedGroups: applied.assignedGroups,
    contextVersion,
    dissolvedGroups: applied.dissolvedGroups,
    primaryGroupName: applied.assignedGroups.find((group) => group.isPrimary)?.groupName ?? null,
    rerankTriggered: false
  };
}

export async function classifyIdeaIntoGroups(session: DemoSession, ideaId: string, options: ClassificationOptions = {}) {
  return classifyWithTrigger(session, ideaId, "initial_classification", options);
}

export async function updateIdeaClassificationAfterClarification(
  session: DemoSession,
  ideaId: string,
  options: ClassificationOptions = {}
) {
  return classifyWithTrigger(session, ideaId, "clarification_answer", options);
}

async function generateGroupRanking(input: {
  campaign: Awaited<ReturnType<typeof readCampaign>>;
  contextVersion: string;
  groups: Awaited<ReturnType<typeof activeGroupsForCampaign>>;
  provider?: LlmProvider;
}) {
  const result = await callStructuredTool({
    messages: [
      {
        content: [
          "Rank Verto classification groups for one specific campaign.",
          "Use expected benefit to the R&D Campaign Owner.",
          "Consider campaign fit, potential value, number and quality of ideas, urgency, evidence strength, novelty, feasibility signals, and unresolved risk.",
          "Do not hide lower-ranked groups; ranking only orders the scan path.",
          "Do not return exact numeric value scores."
        ].join(" "),
        role: "system"
      },
      {
        content: JSON.stringify({
          campaign: {
            contextVersion: input.contextVersion,
            lifecycleStatus: input.campaign.lifecycleStatus,
            prompt: input.campaign.campaignPrompt,
            title: input.campaign.campaignTitle
          },
          groups: input.groups.map((group) => ({
            groupType: group.groupType,
            name: group.name,
            summaryText: group.summaryText
          }))
        }),
        role: "user"
      }
    ],
    provider: input.provider,
    tool: groupRankingTool
  });

  return {
    decision: parseRankingDecision(result.arguments, result.rawResponse),
    model: result.model,
    rawResponse: result.rawResponse
  };
}

export async function rankSpecificCampaignGroups(
  session: DemoSession,
  campaignId: string,
  options: RankingOptions = {}
) {
  const campaign = await readCampaign(campaignId);
  if (campaign.campaignType !== "specific") {
    throw new Error("General Campaign uses direct idea ranking, not group ranking.");
  }
  if (!(await canContributeToCampaign(session, campaignId))) {
    throw new Error("Only R&D users with campaign access can rank classification groups.");
  }

  const groups = await activeGroupsForCampaign(campaignId);
  if (groups.length === 0) {
    return { rankedGroupCount: 0 };
  }

  const contextVersion = await resolveContextVersion(campaignId, campaign.campaignType, options.contextVersion);
  const now = options.now ?? new Date();
  const generated = await generateGroupRanking({
    campaign,
    contextVersion,
    groups,
    provider: options.provider
  });
  const byName = new Map(groups.map((group) => [group.name.toLowerCase(), group]));
  const updates = generated.decision.map((ranking) => {
    const group = byName.get(ranking.groupName.toLowerCase());
    if (!group) {
      throw new LlmInvalidResponseError("LLM group ranking referenced an unknown group.", generated.rawResponse, {
        ranking
      });
    }

    return { group, rankPosition: ranking.rankPosition };
  });

  await writeAiLog({
    decisionResult: { rankings: generated.decision },
    inputReference: JSON.stringify({
      campaignId,
      contextVersion,
      groupIds: groups.map((group) => group.id),
      source: "idea_group_ranking"
    }),
    model: generated.model,
    outputSummary: `Ranked ${updates.length} classification groups.`,
    purpose: groupRankingPurpose,
    rawResponse: generated.rawResponse
  });

  await db.transaction(async (tx) => {
    for (const update of updates) {
      await tx
        .update(ideaClassificationGroups)
        .set({
          rankPosition: update.rankPosition,
          rankedAt: now,
          rankingContextVersion: contextVersion,
          updatedAt: now
        })
        .where(eq(ideaClassificationGroups.id, update.group.id));
    }
    await insertAudit(tx, {
      actorType: "ai",
      entityId: campaignId,
      entityType: "campaign",
      eventType: "campaign.classification_groups.ranked",
      metadata: {
        contextVersion,
        rankings: updates.map((update) => ({
          groupId: update.group.id,
          groupName: update.group.name,
          rankPosition: update.rankPosition
        }))
      },
      now,
      reason: "AI ranked specific campaign classification groups by expected benefit criteria."
    });
  });

  return { rankedGroupCount: updates.length };
}

export async function getAccessibleClassificationGroupReviewView(session: DemoSession) {
  if (session.role.id === "employee") {
    throw new Error("Only R&D users with campaign access can inspect classification groups.");
  }

  const groupRows = await db
    .select({
      campaignId: ideaClassificationGroups.campaignId,
      campaignTitle: campaigns.publicTitle,
      campaignType: campaigns.type,
      contextVersion: ideaClassificationGroups.contextVersion,
      groupId: ideaClassificationGroups.id,
      groupName: ideaClassificationGroups.name,
      groupType: ideaClassificationGroups.groupType,
      rankPosition: ideaClassificationGroups.rankPosition,
      rankedAt: ideaClassificationGroups.rankedAt,
      rankingContextVersion: ideaClassificationGroups.rankingContextVersion,
      summaryText: ideaClassificationGroups.summaryText
    })
    .from(ideaClassificationGroups)
    .innerJoin(campaigns, eq(campaigns.id, ideaClassificationGroups.campaignId))
    .where(eq(ideaClassificationGroups.isActive, true));

  const accessibleGroups = [];
  for (const group of groupRows) {
    if (await canContributeToCampaign(session, group.campaignId)) {
      accessibleGroups.push(group);
    }
  }

  const hydrated = await Promise.all(
    accessibleGroups.map(async (group) => {
      const memberRows = await db
        .select({
          ideaId: ideas.id,
          isPrimary: ideaClassificationGroupMembers.isPrimary,
          originalText: ideas.originalText,
          placementReason: ideaClassificationGroupMembers.placementReason,
          submittedAt: ideas.submittedAt,
          submitterDepartment: users.department,
          submitterDisplayName: users.displayName,
          title: ideas.title
        })
        .from(ideaClassificationGroupMembers)
        .innerJoin(ideas, eq(ideas.id, ideaClassificationGroupMembers.ideaId))
        .innerJoin(users, eq(users.id, ideas.submitterUserId))
        .where(eq(ideaClassificationGroupMembers.groupId, group.groupId))
        .orderBy(desc(ideas.submittedAt));

      return {
        campaignId: group.campaignId,
        campaignTitle: group.campaignTitle,
        campaignType: group.campaignType,
        groupId: group.groupId,
        groupName: group.groupName,
        groupType: group.groupType,
        primaryIdeaCount: memberRows.filter((member) => member.isPrimary).length,
        rankPosition: group.rankPosition,
        rankedAt: group.rankedAt,
        rankingContextVersion: group.rankingContextVersion,
        summary: {
          contextVersion: group.contextVersion,
          summaryText: group.summaryText
        },
        ideas: memberRows
      };
    })
  );

  return hydrated.sort((left, right) => {
    const campaignDiff = left.campaignTitle.localeCompare(right.campaignTitle);
    if (campaignDiff) {
      return campaignDiff;
    }
    const leftRank = left.rankPosition ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.rankPosition ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.groupName.localeCompare(right.groupName);
  });
}

export async function getAccessibleClassificationCandidateIdeas(session: DemoSession) {
  if (session.role.id === "employee") {
    return [];
  }

  const rows = await db
    .select({
      campaignId: campaigns.id,
      campaignTitle: campaigns.publicTitle,
      campaignType: campaigns.type,
      ideaId: ideas.id,
      title: ideas.title
    })
    .from(ideas)
    .innerJoin(campaigns, eq(campaigns.id, ideas.campaignId))
    .orderBy(desc(ideas.createdAt));

  const candidates = [];
  for (const row of rows) {
    if (await canContributeToCampaign(session, row.campaignId)) {
      candidates.push(row);
    }
  }

  return candidates;
}
