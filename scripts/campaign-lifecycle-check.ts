import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { canSubmitIdea } from "../src/server/auth/permissions";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import {
  addCampaignTeamMember,
  changeCampaignLifecycle,
  changeCampaignOwner,
  createSpecificCampaign,
  recordIdeaReviewOutcome,
  removeCampaignTeamMember
} from "../src/server/campaigns/service";
import {
  answerSetupQuestion,
  approveCampaignKnowledgeReport,
  generateCampaignKnowledgeReport,
  getCampaignSetupView
} from "../src/server/campaign-setup/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { auditEvents, campaignMemberships, campaigns, ideaStateHistory, ideas } from "../src/server/db/schema";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function readCampaign(campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  assert(campaign, `${campaignId} campaign exists`);
  return campaign;
}

async function membershipExists(campaignId: string, userId: string, membershipRole: "manager" | "owner" | "member") {
  const [membership] = await db
    .select()
    .from(campaignMemberships)
    .where(
      and(
        eq(campaignMemberships.campaignId, campaignId),
        eq(campaignMemberships.userId, userId),
        eq(campaignMemberships.membershipRole, membershipRole)
      )
    )
    .limit(1);

  return Boolean(membership);
}

async function insertReadyReviewIdea(campaignId: string) {
  await db.insert(ideas).values({
    campaignId,
    createdAt: new Date("2026-01-15T10:30:00Z"),
    id: "idea-ready-review-blocker",
    originalText: "A ready idea that still needs an explicit owner outcome.",
    sourceType: "seed_demo",
    submittedAt: new Date("2026-01-15T10:30:00Z"),
    submitterUserId: "employee",
    title: "Ready blocker idea"
  });
  await db.insert(ideaStateHistory).values({
    changedAt: new Date("2026-01-15T10:30:00Z"),
    changedByUserId: "employee",
    ideaId: "idea-ready-review-blocker",
    id: "idea-ready-review-blocker-state",
    isCurrent: true,
    reason: "Issue #4 review-complete blocker fixture.",
    workflowState: "ready_for_rd_review"
  });
}

async function insertNonReadyReviewIdea(campaignId: string) {
  await db.insert(ideas).values({
    campaignId,
    createdAt: new Date("2026-01-15T10:30:00Z"),
    id: "idea-not-ready-review-outcome",
    originalText: "An idea that has not reached R&D review readiness.",
    sourceType: "seed_demo",
    submittedAt: new Date("2026-01-15T10:30:00Z"),
    submitterUserId: "employee",
    title: "Not ready review idea"
  });
  await db.insert(ideaStateHistory).values({
    changedAt: new Date("2026-01-15T10:30:00Z"),
    changedByUserId: "employee",
    ideaId: "idea-not-ready-review-outcome",
    id: "idea-not-ready-review-outcome-state",
    isCurrent: true,
    reason: "Review outcome guard fixture.",
    workflowState: "general_idea"
  });
}

async function auditEventTypesFor(campaignId: string) {
  const rows = await db
    .select({ eventType: auditEvents.eventType })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, "campaign"), eq(auditEvents.entityId, campaignId)));

  return new Set(rows.map((row) => row.eventType));
}

async function main() {
  try {
    console.log("campaign-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const manager = await sessionFor("rd-manager");
    const owner = await sessionFor("specific-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");
    const employee = await sessionFor("employee");

    console.log("campaign-check: create campaigns with authority rules");
    await assert.rejects(
      () =>
        createSpecificCampaign(owner, {
          id: "owner-assigns-other",
          name: "Owner Assigns Other",
          ownerUserId: "rd-manager",
          publicPrompt: "Should fail.",
          publicTitle: "Owner Assigns Other"
        }),
      /assign themself/
    );
    await assert.rejects(
      () =>
        createSpecificCampaign(teamMember, {
          id: "team-member-created",
          name: "Team Member Created",
          ownerUserId: "rd-team-member",
          publicPrompt: "Should fail.",
          publicTitle: "Team Member Created"
        }),
      /create campaigns/
    );

    await createSpecificCampaign(owner, {
      id: "owner-created-campaign",
      name: "Owner Created Campaign",
      ownerUserId: owner.user.id,
      publicPrompt: "Owner-created campaign for lifecycle checks.",
      publicTitle: "Owner Created"
    });
    assert(await membershipExists("owner-created-campaign", owner.user.id, "owner"));

    await createSpecificCampaign(manager, {
      id: "manager-created-campaign",
      name: "Manager Created Campaign",
      ownerUserId: manager.user.id,
      publicPrompt: "Manager-created campaign for owner reassignment checks.",
      publicTitle: "Manager Created"
    });
    await changeCampaignOwner(manager, "manager-created-campaign", owner.user.id);
    assert.equal(await membershipExists("manager-created-campaign", manager.user.id, "owner"), false);
    assert(await membershipExists("manager-created-campaign", owner.user.id, "owner"));

    console.log("campaign-check: manage campaign team membership");
    await assert.rejects(() => addCampaignTeamMember(teamMember, "owner-created-campaign", teamMember.user.id), /manage team/);
    await addCampaignTeamMember(owner, "owner-created-campaign", teamMember.user.id);
    assert(await membershipExists("owner-created-campaign", teamMember.user.id, "member"));
    await removeCampaignTeamMember(manager, "owner-created-campaign", teamMember.user.id);
    assert.equal(await membershipExists("owner-created-campaign", teamMember.user.id, "member"), false);

    console.log("campaign-check: enforce lifecycle gates");
    await assert.rejects(
      () => changeCampaignLifecycle(teamMember, "owner-created-campaign", { nextStatus: "setup_in_progress" }),
      /change lifecycle/
    );
    await assert.rejects(
      () => changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "intake_open" }),
      /Invalid lifecycle transition/
    );
    await changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "setup_in_progress" });
    await changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "setup_review" });
    let setupView = await getCampaignSetupView("owner-created-campaign");
    assert(setupView.questionQueue.length >= 2);
    await assert.rejects(
      async () => {
        const emptyReport = await generateCampaignKnowledgeReport(owner, "owner-created-campaign");
        await approveCampaignKnowledgeReport(owner, emptyReport.id);
      },
      /hard blockers|approved setup baseline/
    );
    for (const question of setupView.questionQueue.filter((candidate) => candidate.priority === "hard_blocker")) {
      await answerSetupQuestion(owner, question.id, {
        answerText: question.recommendedAnswer ?? "Owner-approved setup baseline.",
        decisionTitle: question.setupArea.replaceAll("_", " ")
      });
    }
    setupView = await getCampaignSetupView("owner-created-campaign");
    assert(setupView.structuredSetup.length > 0);
    const lifecycleReport = await generateCampaignKnowledgeReport(owner, "owner-created-campaign");
    await approveCampaignKnowledgeReport(owner, lifecycleReport.id);
    await changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "ready_to_open" });
    await changeCampaignLifecycle(owner, "owner-created-campaign", {
      intakeEndsAt: new Date("2026-02-15T17:00:00Z"),
      intakeStartsAt: new Date("2026-02-01T09:00:00Z"),
      nextStatus: "intake_scheduled"
    });
    let campaign = await readCampaign("owner-created-campaign");
    assert.equal(campaign.lifecycleStatus, "intake_scheduled");
    assert.equal(campaign.intakeStartsAt?.toISOString(), "2026-02-01T09:00:00.000Z");
    assert.equal(campaign.intakeEndsAt?.toISOString(), "2026-02-15T17:00:00.000Z");

    await changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "intake_open" });
    await changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "intake_closed" });
    await changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "review_in_progress" });

    console.log("campaign-check: block Review Complete until ready ideas have outcomes");
    await insertNonReadyReviewIdea("owner-created-campaign");
    await assert.rejects(
      () =>
        recordIdeaReviewOutcome(owner, "idea-not-ready-review-outcome", {
          nextState: "inactive_idea",
          reason: "Should fail before R&D review readiness."
        }),
      /ready for R&D review/
    );
    await insertReadyReviewIdea("owner-created-campaign");
    await assert.rejects(
      () => changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "review_complete" }),
      /Ready for R&D Review/
    );
    await recordIdeaReviewOutcome(owner, "idea-ready-review-blocker", {
      nextState: "potential_idea",
      reason: "Owner selected as a potential idea."
    });
    await changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "review_complete" });
    campaign = await readCampaign("owner-created-campaign");
    assert.equal(campaign.lifecycleStatus, "review_complete");

    console.log("campaign-check: ended campaign blocks intake and review decisions");
    await changeCampaignLifecycle(owner, "owner-created-campaign", { nextStatus: "ended" });
    assert.equal(await canSubmitIdea(employee, "owner-created-campaign"), false);
    await assert.rejects(
      () =>
        recordIdeaReviewOutcome(owner, "idea-ready-review-blocker", {
          nextState: "inactive_idea",
          reason: "Should fail after campaign ended."
        }),
      /ended/
    );

    console.log("campaign-check: audit events recorded");
    const eventTypes = await auditEventTypesFor("owner-created-campaign");
    assert(eventTypes.has("campaign.created"));
    assert(eventTypes.has("campaign.member.added"));
    assert(eventTypes.has("campaign.member.removed"));
    assert(eventTypes.has("campaign.lifecycle.changed"));
    assert(eventTypes.has("campaign.review_outcome.recorded"));

    console.log("campaign-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
