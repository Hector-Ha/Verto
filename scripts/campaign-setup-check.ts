import assert from "node:assert/strict";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { changeCampaignLifecycle } from "../src/server/campaigns/service";
import {
  answerSetupQuestion,
  approveCampaignKnowledgeReport,
  approveSetupAnswer,
  editPendingSetupAnswer,
  generateCampaignKnowledgeReport,
  getCampaignSetupView,
  rejectSetupAnswer
} from "../src/server/campaign-setup/service";
import { closeDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function main() {
  try {
    console.log("setup-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const owner = await sessionFor("specific-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");

    console.log("setup-check: inspect prioritized question queue");
    let view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.openHardBlockerCount, 2);
    assert.deepEqual(
      view.questionQueue.map((question) => question.priority),
      ["hard_blocker", "hard_blocker", "warning", "clarity"]
    );
    assert.equal(view.ownerAttentionQueue.some((item) => item.kind === "hard_blocker"), true);

    console.log("setup-check: owner answers blocker and records intentional ambiguity");
    await answerSetupQuestion(owner, "setup-q-topic", {
      answerText: "Keep the campaign broad enough for packaging reuse variants, but exclude unrelated logistics ideas.",
      decisionTitle: "Campaign scope",
      isIntentionalAmbiguity: true
    });
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.openHardBlockerCount, 1);
    assert(view.structuredSetup.some((decision) => decision.title === "Campaign scope" && decision.isIntentionalAmbiguity));
    await assert.rejects(
      () =>
        answerSetupQuestion(owner, "setup-q-topic", {
          answerText: "Duplicate answer should not be accepted.",
          decisionTitle: "Duplicate scope"
        }),
      /already answered/
    );

    console.log("setup-check: team member draft stays pending owner approval");
    const pending = await answerSetupQuestion(teamMember, "setup-q-review-packet", {
      answerText: "Draft: require employee problem, expected benefit, and one feasibility signal.",
      decisionTitle: "Minimum review packet",
      isContextOverride: true
    });
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.pendingOwnerApprovals.length, 1);
    assert.equal(view.structuredSetup.some((decision) => decision.title === "Minimum review packet"), false);

    console.log("setup-check: owner edits and approves pending contribution");
    await editPendingSetupAnswer(owner, pending.answerId, {
      answerText: "Require employee problem, expected benefit, and at least one feasibility signal or example."
    });
    await approveSetupAnswer(owner, pending.answerId);
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.openHardBlockerCount, 0);
    assert.equal(view.pendingOwnerApprovals.length, 0);
    assert(
      view.structuredSetup.some(
        (decision) =>
          decision.title === "Minimum review packet" &&
          decision.isContextOverride &&
          decision.value.includes("at least one feasibility signal")
      )
    );
    assert.equal(view.warnings.length, 1);

    console.log("setup-check: owner can reject pending setup contribution");
    const rejected = await answerSetupQuestion(teamMember, "setup-q-ambiguity", {
      answerText: "Draft: allow any packaging-adjacent idea without follow-up.",
      decisionTitle: "Ambiguity policy"
    });
    await rejectSetupAnswer(owner, rejected.answerId, { reason: "Too broad for launch." });
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.rejectedAnswers.some((answer) => answer.id === rejected.answerId), true);
    assert.equal(view.questionQueue.some((question) => question.id === "setup-q-ambiguity"), true);

    console.log("setup-check: report is generated from setup state and required for intake");
    const report = await generateCampaignKnowledgeReport(owner, "setup-campaign");
    assert.equal(report.status, "draft");
    assert(report.html.includes("Campaign scope"));
    assert(report.html.includes("Minimum review packet"));
    assert(report.html.includes("Warnings"));
    await assert.rejects(
      () => changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "ready_to_open" }),
      /Knowledge Report/
    );

    await approveCampaignKnowledgeReport(owner, report.id);
    await changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "ready_to_open" });
    await changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "intake_open" });
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.latestReport?.status, "approved");
    assert.equal(view.campaign.lifecycleStatus, "intake_open");
    assert.equal(view.warnings.length, 1);

    console.log("setup-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
