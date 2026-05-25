import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import {
  classifyIdeaIntoGroups,
  GENERAL_CLASSIFICATION_GROUP_CAP,
  getAccessibleClassificationGroupReviewView,
  rankSpecificCampaignGroups,
  updateIdeaClassificationAfterClarification
} from "../src/server/classification-groups/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import {
  auditEvents,
  ideaClassificationGroupMembers,
  ideaClassificationGroups,
  ideaRankings
} from "../src/server/db/schema";
import { submitIdea } from "../src/server/employee-intake/service";
import type { LlmProvider } from "../src/server/llm/adapter";
import { assignIdeaRanking } from "../src/server/rd-review/service";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

function classificationProvider(input: {
  groups: Array<{
    groupType: "standard" | "single_idea" | "emerging_theme";
    isPrimary: boolean;
    name: string;
    placementReason: string;
    summaryText: string;
  }>;
}): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify(input),
                name: "record_idea_classification"
              },
              id: "tool-call-classification",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-classification-test",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function rankingProvider(rankings: Array<{ groupName: string; rankPosition: number }>): LlmProvider {
  return async (request) => {
    const prompt = JSON.stringify(request);
    assert.match(prompt, /campaign fit/i);
    assert.match(prompt, /expected benefit|potential value/i);
    assert.match(prompt, /evidence strength/i);
    assert.match(prompt, /unresolved risk/i);

    return {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  arguments: JSON.stringify({ rankings }),
                  name: "record_idea_group_ranking"
                },
                id: "tool-call-group-ranking",
                type: "function"
              }
            ]
          }
        }
      ],
      id: "chatcmpl-group-ranking-test",
      model: "moonshotai/kimi-k2.6",
      object: "chat.completion"
    };
  };
}

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function groupsForCampaign(campaignId: string) {
  return db
    .select()
    .from(ideaClassificationGroups)
    .where(and(eq(ideaClassificationGroups.campaignId, campaignId), eq(ideaClassificationGroups.isActive, true)));
}

async function main() {
  try {
    console.log("classification-groups-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();
    assert.equal(GENERAL_CLASSIFICATION_GROUP_CAP, 100);

    const employee = await sessionFor("employee");
    const specificOwner = await sessionFor("specific-campaign-owner");
    const generalOwner = await sessionFor("general-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");

    console.log("classification-groups-check: ideas can be in multiple groups with one primary");
    const batteryIdea = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Reuse test-cycle battery modules for training rigs before recycling them.",
      title: "Training rig battery reuse"
    });
    const firstClassification = await classifyIdeaIntoGroups(specificOwner, batteryIdea.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: classificationProvider({
        groups: [
          {
            groupType: "standard",
            isPrimary: true,
            name: "Battery reuse workflows",
            placementReason: "Main value is a reuse workflow for test-cycle modules.",
            summaryText: "Ideas that reuse battery material or modules inside manufacturing workflows."
          },
          {
            groupType: "emerging_theme",
            isPrimary: false,
            name: "Training operations themes",
            placementReason: "Also touches operator training and enablement.",
            summaryText: "Early training and enablement ideas that are worth scanning but not yet a strong group."
          }
        ]
      })
    });
    assert.equal(firstClassification.assignedGroups.length, 2);
    assert.equal(firstClassification.primaryGroupName, "Battery reuse workflows");
    const memberships = await db
      .select()
      .from(ideaClassificationGroupMembers)
      .where(eq(ideaClassificationGroupMembers.ideaId, batteryIdea.ideaId));
    assert.equal(memberships.length, 2);
    assert.equal(memberships.filter((membership) => membership.isPrimary).length, 1);

    console.log("classification-groups-check: group view returns summary before packets");
    let groupView = await getAccessibleClassificationGroupReviewView(teamMember);
    const batteryGroup = groupView.find((group) => group.groupName === "Battery reuse workflows");
    assert(batteryGroup, "battery group appears");
    assert.equal(batteryGroup.summary.summaryText.includes("reuse battery"), true);
    assert(Object.keys(batteryGroup).indexOf("summary") < Object.keys(batteryGroup).indexOf("ideas"));
    assert.equal(batteryGroup.ideas.some((idea) => idea.ideaId === batteryIdea.ideaId), true);

    console.log("classification-groups-check: specific campaign group ranking keeps lower ranks visible");
    const safetyIdea = await submitIdea(employee, {
      campaignId: "specific-campaign",
      originalText: "Add visual checks for safe battery reuse handoffs between test benches.",
      title: "Battery reuse safety checks"
    });
    await classifyIdeaIntoGroups(specificOwner, safetyIdea.ideaId, {
      contextVersion: "knowledge-report-specific-approved",
      provider: classificationProvider({
        groups: [
          {
            groupType: "standard",
            isPrimary: true,
            name: "Safety checks",
            placementReason: "Primary concern is safe handoff before reuse.",
            summaryText: "Ideas that reduce unresolved safety risk before reuse work proceeds."
          }
        ]
      })
    });
    const ranking = await rankSpecificCampaignGroups(specificOwner, "specific-campaign", {
      contextVersion: "knowledge-report-specific-approved",
      provider: rankingProvider([
        { groupName: "Safety checks", rankPosition: 1 },
        { groupName: "Battery reuse workflows", rankPosition: 2 }
      ])
    });
    assert.equal(ranking.rankedGroupCount, 2);
    groupView = await getAccessibleClassificationGroupReviewView(teamMember);
    const specificGroups = groupView.filter((group) => group.campaignId === "specific-campaign");
    assert.deepEqual(
      specificGroups.map((group) => group.groupName),
      ["Safety checks", "Battery reuse workflows", "Training operations themes"]
    );
    assert.equal(specificGroups.some((group) => group.groupName === "Battery reuse workflows"), true);

    console.log("classification-groups-check: idea rank reasons expose no numeric score");
    await assignIdeaRanking(specificOwner, batteryIdea.ideaId, {
      rankPosition: 1,
      rankReasons: ["Strong campaign fit", "Clear training reuse path"]
    });
    const [ideaRanking] = await db
      .select()
      .from(ideaRankings)
      .where(eq(ideaRankings.ideaId, batteryIdea.ideaId))
      .limit(1);
    assert(ideaRanking, "idea ranking exists");
    assert.equal(ideaRanking.rankReasons.length, 2);
    assert.equal("score" in ideaRanking, false);

    console.log("classification-groups-check: clarification placement update does not rerank groups");
    const clarified = await updateIdeaClassificationAfterClarification(specificOwner, batteryIdea.ideaId, {
      contextVersion: "knowledge-report-specific-approved:clarification-answer",
      provider: classificationProvider({
        groups: [
          {
            groupType: "single_idea",
            isPrimary: true,
            name: "Training rig battery reuse",
            placementReason: "Clarification made this a high-value single-idea group.",
            summaryText: "A single high-signal training-rig reuse idea worth owner attention."
          },
          {
            groupType: "standard",
            isPrimary: false,
            name: "Battery reuse workflows",
            placementReason: "Still related to the broader battery reuse workflow.",
            summaryText: "Ideas that reuse battery material or modules inside manufacturing workflows."
          }
        ]
      })
    });
    assert.equal(clarified.rerankTriggered, false);
    groupView = await getAccessibleClassificationGroupReviewView(teamMember);
    const stillRanked = groupView.filter((group) => group.campaignId === "specific-campaign" && group.rankPosition);
    assert.deepEqual(
      stillRanked.map((group) => [group.groupName, group.rankPosition]),
      [
        ["Safety checks", 1],
        ["Battery reuse workflows", 2]
      ]
    );

    console.log("classification-groups-check: General Campaign cap dissolves smallest group with audit");
    const generalA = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Create reusable office supply totes for cross-team moves.",
      title: "Supply totes"
    });
    const generalB = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Share spare maker tools through a checkout shelf.",
      title: "Tool checkout shelf"
    });
    const generalC = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "Recover useful fixture offcuts for prototype mockups.",
      title: "Fixture offcut mockups"
    });
    await classifyIdeaIntoGroups(generalOwner, generalA.ideaId, {
      maxGeneralGroups: 2,
      provider: classificationProvider({
        groups: [
          {
            groupType: "standard",
            isPrimary: true,
            name: "Supply movement",
            placementReason: "Focuses on moving reusable supplies.",
            summaryText: "Reusable supply movement and transfer ideas."
          }
        ]
      })
    });
    await classifyIdeaIntoGroups(generalOwner, generalB.ideaId, {
      maxGeneralGroups: 2,
      provider: classificationProvider({
        groups: [
          {
            groupType: "standard",
            isPrimary: true,
            name: "Tool access",
            placementReason: "Focuses on shared access to tools.",
            summaryText: "Ideas that improve shared tool access."
          }
        ]
      })
    });
    const capped = await classifyIdeaIntoGroups(generalOwner, generalC.ideaId, {
      maxGeneralGroups: 2,
      provider: classificationProvider({
        groups: [
          {
            groupType: "standard",
            isPrimary: true,
            name: "Prototype material recovery",
            placementReason: "Unique material recovery theme needs its own group.",
            summaryText: "Ideas that recover prototype-ready material from fixture waste."
          }
        ]
      })
    });
    assert(capped.dissolvedGroups.length >= 1);
    const activeGeneralGroups = await groupsForCampaign("general-campaign");
    assert.equal(activeGeneralGroups.length, 2);
    const dissolutionAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, "general_campaign.classification_group.dissolved"));
    assert.equal(dissolutionAudits.length >= 1, true);
    assert.match(dissolutionAudits[0].reason ?? "", /cap/i);

    console.log("classification-groups-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
