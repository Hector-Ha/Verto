import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { canSubmitIdea } from "../src/server/auth/permissions";
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
import { closeDatabase, db } from "../src/server/db/client";
import { createMysqlConnection } from "../src/server/db/config";
import { runMigrations } from "../src/server/db/migrate";
import { campaignKnowledgeReports, campaignSetupAnswers, campaignSetupQuestions } from "../src/server/db/schema";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function lockAnswerRow(answerId: string) {
  const connection = await createMysqlConnection();
  await connection.beginTransaction();
  await connection.execute("SELECT id FROM campaign_setup_answers WHERE id = ? FOR UPDATE", [answerId]);
  return connection;
}

async function lockReportRow(reportId: string) {
  const connection = await createMysqlConnection();
  await connection.beginTransaction();
  await connection.execute("SELECT id FROM campaign_knowledge_reports WHERE id = ? FOR UPDATE", [reportId]);
  return connection;
}

async function waitForQuestionLock(questionId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const connection = await createMysqlConnection();

    try {
      await connection.beginTransaction();
      await connection.execute("SELECT id FROM campaign_setup_questions WHERE id = ? FOR UPDATE NOWAIT", [questionId]);
      await connection.rollback();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if (error instanceof Error && error.message.includes("NOWAIT")) {
        await connection.end();
        return;
      }
      await connection.end();
      throw error;
    }

    await connection.end();
    await delay(20);
  }

  throw new Error(`Timed out waiting for ${questionId} lock waiter.`);
}

async function main() {
  try {
    console.log("setup-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const owner = await sessionFor("specific-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");
    const employee = await sessionFor("employee");

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
    await assert.rejects(
      () =>
        answerSetupQuestion(teamMember, "setup-q-review-packet", {
          answerText: "Duplicate pending answer should not be accepted.",
          decisionTitle: "Duplicate minimum review packet"
        }),
      /pending owner approval|already answered/
    );
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.pendingOwnerApprovals.length, 1);
    assert.equal(view.structuredSetup.some((decision) => decision.title === "Minimum review packet"), false);

    console.log("setup-check: owner edits and approves pending contribution");
    await db.insert(campaignSetupAnswers).values({
      answerText: "Legacy duplicate pending answer.",
      approvedAt: null,
      approvedByUserId: null,
      authorUserId: teamMember.user.id,
      campaignId: "setup-campaign",
      createdAt: new Date(),
      decisionTitle: "Legacy duplicate minimum review packet",
      id: "setup-answer-legacy-duplicate",
      isContextOverride: false,
      isIntentionalAmbiguity: false,
      ownerEditedByUserId: null,
      questionId: "setup-q-review-packet",
      rejectedAt: null,
      rejectedByUserId: null,
      rejectionReason: null,
      setupArea: "review_packet",
      status: "pending_owner_approval",
      updatedAt: new Date()
    });
    await editPendingSetupAnswer(owner, pending.answerId, {
      answerText: "Require employee problem, expected benefit, and at least one feasibility signal or example."
    });
    await assert.rejects(() => approveSetupAnswer(owner, pending.answerId), /pending owner approval/);
    await rejectSetupAnswer(owner, "setup-answer-legacy-duplicate", { reason: "Legacy duplicate pending answer." });
    await approveSetupAnswer(owner, pending.answerId);
    await assert.rejects(() => approveSetupAnswer(owner, "setup-answer-legacy-duplicate"), /pending setup answers|already answered/);
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

    console.log("setup-check: concurrent stale edit cannot mutate approved setup answer");
    await db.insert(campaignSetupQuestions).values({
      campaignId: "setup-campaign",
      createdAt: new Date(),
      id: "setup-q-stale-edit-race",
      priority: "clarity",
      questionText: "How should stale pending answer edits behave during owner approval?",
      rationale: "Concurrent owner edits must not mutate answers after approval records a decision.",
      recommendedAnswer: "Reject stale edits once an answer is approved.",
      setupArea: "intent",
      status: "open",
      updatedAt: new Date()
    });
    const staleEditAnswer = await answerSetupQuestion(teamMember, "setup-q-stale-edit-race", {
      answerText: "Draft value before concurrent owner approval.",
      decisionTitle: "Stale edit race policy"
    });
    const editLockConnection = await lockAnswerRow(staleEditAnswer.answerId);
    const staleEditApprovePromise = approveSetupAnswer(owner, staleEditAnswer.answerId);
    await waitForQuestionLock("setup-q-stale-edit-race");
    const staleEditRejects = assert.rejects(
      () =>
        editPendingSetupAnswer(owner, staleEditAnswer.answerId, {
          answerText: "Stale edit that must not overwrite approved answer text."
        }),
      /Only pending setup answers can be edited/
    );
    await editLockConnection.commit();
    await editLockConnection.end();
    await staleEditApprovePromise;
    await staleEditRejects;
    const [staleEditedAnswer] = await db
      .select()
      .from(campaignSetupAnswers)
      .where(eq(campaignSetupAnswers.id, staleEditAnswer.answerId))
      .limit(1);
    assert.equal(staleEditedAnswer?.status, "approved");
    assert.equal(staleEditedAnswer?.answerText, "Draft value before concurrent owner approval.");

    console.log("setup-check: concurrent reject cannot overwrite approved setup answer");
    const raceAnswer = await answerSetupQuestion(teamMember, "setup-q-ambiguity", {
      answerText: "Draft: allow any packaging-adjacent idea without follow-up.",
      decisionTitle: "Ambiguity policy"
    });
    const lockConnection = await lockAnswerRow(raceAnswer.answerId);
    const approvePromise = approveSetupAnswer(owner, raceAnswer.answerId);
    await waitForQuestionLock("setup-q-ambiguity");
    const rejectRejects = assert.rejects(
      () => rejectSetupAnswer(owner, raceAnswer.answerId, { reason: "Concurrent stale reject." }),
      /pending setup answers|already answered|answered or dismissed/
    );
    await lockConnection.commit();
    await lockConnection.end();
    await approvePromise;
    await rejectRejects;
    const [racedAnswer] = await db
      .select()
      .from(campaignSetupAnswers)
      .where(eq(campaignSetupAnswers.id, raceAnswer.answerId))
      .limit(1);
    assert.equal(racedAnswer?.status, "approved");

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

    console.log("setup-check: pending drafts do not stale approved report");
    await db.insert(campaignSetupQuestions).values({
      campaignId: "setup-campaign",
      createdAt: new Date(),
      id: "setup-q-pending-report-staleness",
      priority: "clarity",
      questionText: "Should pending drafts affect the approved Campaign Knowledge Report?",
      rationale: "Pending owner approval is not AI-usable campaign ground truth.",
      recommendedAnswer: "Keep approved reports fresh until owner-approved setup changes.",
      setupArea: "final_review",
      status: "open",
      updatedAt: new Date()
    });
    const pendingReportAnswer = await answerSetupQuestion(teamMember, "setup-q-pending-report-staleness", {
      answerText: "Draft: pending answer should not stale an approved report.",
      decisionTitle: "Pending report staleness"
    });
    let [approvedReport] = await db
      .select()
      .from(campaignKnowledgeReports)
      .where(eq(campaignKnowledgeReports.id, report.id))
      .limit(1);
    assert.equal(approvedReport?.status, "approved");
    await editPendingSetupAnswer(owner, pendingReportAnswer.answerId, {
      answerText: "Edited pending answer should still not stale an approved report."
    });
    [approvedReport] = await db
      .select()
      .from(campaignKnowledgeReports)
      .where(eq(campaignKnowledgeReports.id, report.id))
      .limit(1);
    assert.equal(approvedReport?.status, "approved");
    await rejectSetupAnswer(owner, pendingReportAnswer.answerId, { reason: "Pending answer was not ground truth." });
    [approvedReport] = await db
      .select()
      .from(campaignKnowledgeReports)
      .where(eq(campaignKnowledgeReports.id, report.id))
      .limit(1);
    assert.equal(approvedReport?.status, "approved");

    console.log("setup-check: stale report approval cannot overwrite setup invalidation");
    const staleRaceReport = await generateCampaignKnowledgeReport(owner, "setup-campaign");
    const reportLockConnection = await lockReportRow(staleRaceReport.id);
    const staleReportSetupPromise = answerSetupQuestion(owner, "setup-q-equipment-warning", {
      answerText: "Keep equipment-heavy ideas visible, but require the report to call out capex risk.",
      decisionTitle: "Equipment-heavy ideas"
    });
    await delay(50);
    const staleReportApprovalRejects = assert.rejects(
      () => approveCampaignKnowledgeReport(owner, staleRaceReport.id),
      /regenerated|stale|fresh/
    );
    await reportLockConnection.commit();
    await reportLockConnection.end();
    await staleReportSetupPromise;
    await staleReportApprovalRejects;
    const [staleReport] = await db
      .select()
      .from(campaignKnowledgeReports)
      .where(eq(campaignKnowledgeReports.id, staleRaceReport.id))
      .limit(1);
    assert.equal(staleReport?.status, "stale");
    await assert.rejects(
      () => changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "ready_to_open" }),
      /fresh|regenerated|Knowledge Report/
    );
    const freshReport = await generateCampaignKnowledgeReport(owner, "setup-campaign");
    await approveCampaignKnowledgeReport(owner, freshReport.id);
    await changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "ready_to_open" });
    await changeCampaignLifecycle(owner, "setup-campaign", { nextStatus: "intake_open" });
    view = await getCampaignSetupView("setup-campaign");
    assert.equal(view.latestReport?.status, "approved");
    assert.equal(view.campaign.lifecycleStatus, "intake_open");
    assert.equal(view.warnings.length, 0);
    assert(view.structuredSetup.some((decision) => decision.title === "Equipment-heavy ideas"));
    assert.equal(await canSubmitIdea(employee, "setup-campaign"), true);

    console.log("setup-check: setup writes are blocked after intake opens");
    await db.insert(campaignSetupQuestions).values({
      campaignId: "setup-campaign",
      createdAt: new Date(),
      id: "setup-q-after-launch",
      priority: "clarity",
      questionText: "Can setup mutate after intake opens?",
      rationale: "Active intake should not drift from its approved report.",
      recommendedAnswer: "No setup mutation after launch.",
      setupArea: "final_review",
      status: "open",
      updatedAt: new Date()
    });
    await assert.rejects(
      () =>
        answerSetupQuestion(owner, "setup-q-after-launch", {
          answerText: "This should not be accepted after intake opens.",
          decisionTitle: "After launch mutation"
        }),
      /setup is complete/
    );
    await assert.rejects(
      () => generateCampaignKnowledgeReport(owner, "setup-campaign"),
      /setup is complete/
    );
    await db
      .update(campaignKnowledgeReports)
      .set({ status: "stale", updatedAt: new Date() })
      .where(eq(campaignKnowledgeReports.id, freshReport.id));
    assert.equal(await canSubmitIdea(employee, "setup-campaign"), false);

    console.log("setup-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
