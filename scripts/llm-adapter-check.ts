import assert from "node:assert/strict";

import { callStructuredTool, type LlmProvider } from "../src/server/llm/adapter";
import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { getCampaignSetupView, requestAiSetupQuestion } from "../src/server/campaign-setup/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { aiDecisionLogs, campaignSetupQuestions } from "../src/server/db/schema";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

function setupQuestionProvider(input: Record<string, unknown>): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify(input),
                name: "record_campaign_setup_question"
              },
              id: "tool-call-1",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-test",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function countSetupQuestions() {
  return (await db.select({ id: campaignSetupQuestions.id }).from(campaignSetupQuestions)).length;
}

async function getAiLogs() {
  return db.select().from(aiDecisionLogs);
}

async function main() {
  try {
    console.log("llm-check: parse mocked structured tool response");

    const provider = setupQuestionProvider({
      priority: "clarity",
      questionText: "Which packaging reuse edge case should AI ask about next?",
      rationale: "R&D needs one focused follow-up before employee intake opens.",
      recommendedAnswer: "Ask whether supplier-owned packaging is in scope.",
      setupArea: "rules_memory"
    });

    const result = await callStructuredTool({
      messages: [
        { content: "Return one JSON setup question.", role: "system" },
        { content: "Campaign setup needs another focused question.", role: "user" }
      ],
      provider,
      tool: {
        description: "Records one campaign setup question.",
        name: "record_campaign_setup_question",
        parameters: {
          additionalProperties: false,
          properties: {
            priority: { enum: ["hard_blocker", "warning", "clarity"], type: "string" },
            questionText: { type: "string" },
            rationale: { type: "string" },
            recommendedAnswer: { type: "string" },
            setupArea: { enum: ["topic", "intent", "review_packet", "rules_memory", "final_review"], type: "string" }
          },
          required: ["setupArea", "priority", "questionText", "rationale", "recommendedAnswer"],
          type: "object"
        }
      }
    });

    assert.equal(result.model, "moonshotai/kimi-k2.6");
    assert.equal(result.toolName, "record_campaign_setup_question");
    assert.equal((result.arguments as { setupArea: string }).setupArea, "rules_memory");
    assert.equal((result.arguments as { priority: string }).priority, "clarity");
    assert.equal(result.rawResponse.id, "chatcmpl-test");

    console.log("llm-check: store valid AI question and decision log");
    await runMigrations();
    await resetAndSeedDemoData();
    const owner = await sessionFor("specific-campaign-owner");
    const beforeSuccessCount = await countSetupQuestions();
    const success = await requestAiSetupQuestion(owner, "setup-campaign", { provider });
    assert.equal(success.status, "succeeded");
    assert.equal(await countSetupQuestions(), beforeSuccessCount + 1);
    let view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.questionQueue.some((question) => question.id === success.questionId), true);
    let logs = await getAiLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].purpose, "campaign_setup.question");
    assert.equal(logs[0].status, "succeeded");
    assert.equal((JSON.parse(logs[0].inputReference) as { campaignId: string }).campaignId, "setup-campaign");
    assert.equal(logs[0].rawResponse?.id, "chatcmpl-test");
    assert.equal((logs[0].decisionResult as { setupArea: string } | null)?.setupArea, "rules_memory");
    assert.equal(view.aiRetryStates.length, 0);

    console.log("llm-check: provider failure creates retry state without setup mutation");
    await resetAndSeedDemoData();
    const beforeFailureCount = await countSetupQuestions();
    const failure = await requestAiSetupQuestion(owner, "setup-campaign", {
      provider: async () => {
        throw new Error("provider unavailable");
      }
    });
    assert.equal(failure.status, "retry_required");
    assert.equal(await countSetupQuestions(), beforeFailureCount);
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.aiRetryStates.length, 1);
    assert.equal(view.aiRetryStates[0].status, "retry_required");
    logs = await getAiLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, "retry_required");
    assert.equal((JSON.parse(logs[0].inputReference) as { campaignId: string }).campaignId, "setup-campaign");
    assert.equal(logs[0].decisionResult, null);
    assert.match(logs[0].outputSummary ?? "", /provider unavailable/);

    console.log("llm-check: invalid structure creates retry state without setup mutation");
    await resetAndSeedDemoData();
    const beforeInvalidCount = await countSetupQuestions();
    const invalid = await requestAiSetupQuestion(owner, "setup-campaign", {
      provider: setupQuestionProvider({
        priority: "urgent",
        questionText: "Invalid priority should not write.",
        rationale: "Validation must happen before setup writes.",
        recommendedAnswer: "Do not write invalid output.",
        setupArea: "rules_memory"
      })
    });
    assert.equal(invalid.status, "retry_required");
    assert.equal(await countSetupQuestions(), beforeInvalidCount);
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.aiRetryStates.length, 1);

    console.log("llm-check: later success clears latest retry state");
    const retrySuccess = await requestAiSetupQuestion(owner, "setup-campaign", { provider });
    assert.equal(retrySuccess.status, "succeeded");
    assert.equal(await countSetupQuestions(), beforeInvalidCount + 1);
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.aiRetryStates.length, 0);
    logs = await getAiLogs();
    assert.equal(logs.filter((log) => log.status === "retry_required").length, 1);
    assert.equal(logs.filter((log) => log.status === "succeeded").length, 1);

    console.log("llm-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
