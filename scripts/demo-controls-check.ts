import assert from "node:assert/strict";

import { eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { getDemoSnapshot } from "../src/server/db/queries";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { aiDecisionLogs, campaigns } from "../src/server/db/schema";
import {
  getDemoOperationsView,
  runDemoOperation
} from "../src/server/demo-operations/service";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function campaignStatus(campaignId: string) {
  const [campaign] = await db
    .select({ lifecycleStatus: campaigns.lifecycleStatus })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  assert(campaign, `${campaignId} exists`);
  return campaign.lifecycleStatus;
}

async function main() {
  try {
    console.log("demo-controls-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const manager = await sessionFor("rd-manager");
    const owner = await sessionFor("specific-campaign-owner");
    const employee = await sessionFor("employee");

    console.log("demo-controls-check: controls are protected and visible to R&D");
    await assert.rejects(() => runDemoOperation(employee, { operation: "review_digest" }), /R&D demo operators/);
    const managerView = await getDemoOperationsView(manager);
    assert(managerView.canRunDemoOperations);
    assert(managerView.operations.some((operation) => operation.id === "clarification_reminders"));
    assert(managerView.operations.some((operation) => operation.id === "campaign_end_sweep"));
    assert(managerView.campaignEndOptions.some((campaign) => campaign.campaignId === "specific-campaign"));

    console.log("demo-controls-check: job controls call shared domain functions");
    const reminders = await runDemoOperation(manager, { operation: "clarification_reminders" });
    assert.equal(reminders.operation, "clarification_reminders");
    const expiry = await runDemoOperation(manager, { operation: "clarification_expiry" });
    assert.equal(expiry.operation, "clarification_expiry");
    const digest = await runDemoOperation(manager, { operation: "review_digest" });
    assert.equal(digest.operation, "review_digest");
    assert.equal(typeof digest.summary.generatedCount, "number");

    console.log("demo-controls-check: General Campaign recheck records inspectable AI state");
    const recheck = await runDemoOperation(manager, { operation: "general_recheck" });
    assert.equal(recheck.operation, "general_recheck");
    assert.equal(typeof recheck.summary.routedCount, "number");
    assert.equal(typeof recheck.summary.retryRequiredCount, "number");
    const logsAfterRecheck = await getDemoOperationsView(manager);
    assert(logsAfterRecheck.aiDecisionLogs.some((log) => log.status === "retry_required" || log.status === "succeeded"));
    const rawAiLogs = await db.select().from(aiDecisionLogs);
    assert(rawAiLogs.some((log) => log.status === "retry_required" || log.status === "succeeded"));

    console.log("demo-controls-check: scheduled gates and campaign-end sweep run from controls");
    await db
      .update(campaigns)
      .set({
        intakeEndsAt: new Date("2026-01-20T17:00:00Z"),
        intakeStartsAt: new Date("2026-01-10T09:00:00Z"),
        lifecycleStatus: "intake_scheduled"
      })
      .where(eq(campaigns.id, "specific-campaign"));
    const schedule = await runDemoOperation(owner, {
      now: new Date("2026-01-21T09:00:00Z"),
      operation: "scheduled_open_close"
    });
    assert.equal(schedule.operation, "scheduled_open_close");
    assert.equal(await campaignStatus("specific-campaign"), "intake_closed");

    await db.update(campaigns).set({ lifecycleStatus: "review_in_progress" }).where(eq(campaigns.id, "specific-campaign"));
    const sweep = await runDemoOperation(owner, {
      campaignId: "specific-campaign",
      now: new Date("2026-01-22T09:00:00Z"),
      operation: "campaign_end_sweep"
    });
    assert.equal(sweep.operation, "campaign_end_sweep");
    assert.equal(await campaignStatus("specific-campaign"), "ended");

    console.log("demo-controls-check: reset baseline is repeatable");
    const reset = await runDemoOperation(manager, { operation: "reset_baseline" });
    assert.equal(reset.operation, "reset_baseline");
    let snapshot = await getDemoSnapshot();
    assert.equal(snapshot.userCount, 5);
    assert.equal(snapshot.campaignCount, 3);
    const reseed = await runDemoOperation(manager, { operation: "reseed_baseline" });
    assert.equal(reseed.operation, "reseed_baseline");
    snapshot = await getDemoSnapshot();
    assert.equal(snapshot.userCount, 5);
    assert.equal(snapshot.ideaCount, 1);

    console.log("demo-controls-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
