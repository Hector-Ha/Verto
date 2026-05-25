import assert from "node:assert/strict";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { changeCampaignLifecycle, recordIdeaReviewOutcome } from "../src/server/campaigns/service";
import {
  answerSetupQuestion,
  approveCampaignKnowledgeReport,
  generateCampaignKnowledgeReport,
  getCampaignSetupView
} from "../src/server/campaign-setup/service";
import {
  requestEmployeeClarification,
  submitClarificationAnswer
} from "../src/server/clarifications/service";
import {
  classifyIdeaIntoGroups,
  rankSpecificCampaignGroups
} from "../src/server/classification-groups/service";
import { closeDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { submitIdea } from "../src/server/employee-intake/service";
import { routeIdeaBeforeRdReview } from "../src/server/pre-rd-routing/service";
import { runReviewDigestDemoJob } from "../src/server/review-digests/service";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

function requireRealProviderEnv() {
  const llmKey = process.env.NVIDIA_API_KEY ?? process.env.LLM_API_KEY;
  const emailKey = process.env.PINGRAM_API_KEY ?? process.env.EMAIL_API_KEY;

  if (!llmKey || llmKey.startsWith("replace-with")) {
    throw new Error("demo:vertical-smoke requires NVIDIA_API_KEY or LLM_API_KEY for real AI decisions.");
  }
  if (!emailKey || emailKey.startsWith("replace-with")) {
    throw new Error("demo:vertical-smoke requires PINGRAM_API_KEY or EMAIL_API_KEY for real clarification email.");
  }
}

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function approveSetupBaseline() {
  const owner = await sessionFor("specific-campaign-owner");
  await changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "ready_to_open" }).catch(async () => {
    const setupView = await getCampaignSetupView("setup-campaign");
    for (const question of setupView.questionQueue.filter((candidate) => candidate.priority === "hard_blocker")) {
      await answerSetupQuestion(owner, question.id, {
        answerText: question.recommendedAnswer ?? "Owner-approved setup baseline.",
        decisionTitle: question.setupArea.replaceAll("_", " ")
      });
    }
    const report = await generateCampaignKnowledgeReport(owner, "setup-campaign");
    await approveCampaignKnowledgeReport(owner, report.id);
    await changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "ready_to_open" });
  });
  await changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "intake_open" });
}

async function main() {
  try {
    requireRealProviderEnv();

    console.log("full-vertical-smoke: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const employee = await sessionFor("employee");
    const owner = await sessionFor("specific-campaign-owner");

    console.log("full-vertical-smoke: approve setup and open intake");
    await approveSetupBaseline();

    console.log("full-vertical-smoke: employee submits messy idea");
    const idea = await submitIdea(employee, {
      campaignId: "setup-campaign",
      originalText:
        "We waste packaging after parts move between cells. Maybe reusable totes or some return loop could help, but I do not know first cell.",
      title: "Reusable packaging loop"
    });

    console.log("full-vertical-smoke: AI sends clarification");
    const clarification = await requestEmployeeClarification(owner, idea.ideaId);
    if (clarification.status !== "sent") {
      throw new Error(`Clarification did not send: ${clarification.reason}`);
    }

    console.log("full-vertical-smoke: employee answers magic link");
    await submitClarificationAnswer(clarification.token, {
      answerText: "Assembly cell A would use reusable totes first because they already collect returnable dunnage."
    });

    console.log("full-vertical-smoke: AI routes, classifies, and ranks");
    const routing = await routeIdeaBeforeRdReview(owner, idea.ideaId);
    if (routing.status !== "routed" || routing.routingDecision !== "ready_for_rd_review") {
      throw new Error(`Expected Ready for R&D Review, got ${routing.status}.`);
    }
    await classifyIdeaIntoGroups(owner, idea.ideaId);
    await rankSpecificCampaignGroups(owner, "setup-campaign");

    console.log("full-vertical-smoke: owner marks Potential Idea and digest runs");
    await recordIdeaReviewOutcome(owner, idea.ideaId, {
      nextState: "potential_idea",
      reasonTag: "quick_prototype",
      reasonNote: "Clear first-use owner and low-friction prototype path."
    });
    await runReviewDigestDemoJob();

    console.log("full-vertical-smoke: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
