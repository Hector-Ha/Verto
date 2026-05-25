import assert from "node:assert/strict";

import { and, eq, like } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { changeCampaignLifecycle } from "../src/server/campaigns/service";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { auditEvents, ideaDrafts, ideas } from "../src/server/db/schema";
import { resetAndSeedDemoData } from "../src/server/seed/reset";
import {
  deleteIdeaDraft,
  getEmployeeIntakeView,
  saveIdeaDraft,
  submitIdea,
  submitIdeaDraft
} from "../src/server/employee-intake/service";

async function sessionFor(personaId: DemoPersonaId) {
  const persona = DEMO_PERSONAS.find((candidate) => candidate.id === personaId);
  assert(persona, `${personaId} persona exists`);
  const token = createSessionToken({ roleId: persona.roleId, userId: persona.userId });
  const session = await getSessionFromToken(token);
  assert(session, `${personaId} session resolves`);
  return session;
}

async function readIdea(ideaId: string) {
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId)).limit(1);
  assert(idea, `${ideaId} idea exists`);
  return idea;
}

async function countEmployeeDrafts() {
  return (await db.select({ id: ideaDrafts.id }).from(ideaDrafts)).length;
}

async function countDraftAuditEvents() {
  return (
    await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityType, "idea_draft"), like(auditEvents.eventType, "idea_draft.%")))
  ).length;
}

function assertReceiptHasNoInternalLabels(receipt: Record<string, unknown>) {
  const keys = Object.keys(receipt);
  assert.equal(keys.includes("status"), false);
  assert.equal(keys.includes("rank"), false);
  assert.equal(keys.includes("outcome"), false);
  const rendered = JSON.stringify(receipt).toLowerCase();
  assert.equal(rendered.includes("ready_for_rd_review"), false);
  assert.equal(rendered.includes("future_opportunity"), false);
  assert.equal(rendered.includes("inactive_idea"), false);
  assert.equal(rendered.includes("potential_idea"), false);
}

async function main() {
  try {
    console.log("employee-intake-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const employee = await sessionFor("employee");
    const owner = await sessionFor("specific-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");

    console.log("employee-intake-check: show General Campaign and only Intake Open specific campaigns");
    let view = await getEmployeeIntakeView(employee);
    assert.deepEqual(
      view.destinations.map((destination) => destination.campaignId),
      ["general-campaign", "specific-campaign"]
    );
    assert.equal(view.destinations.find((destination) => destination.campaignId === "general-campaign")?.previewTitle, "General Ideas");
    assert.equal(view.destinations.some((destination) => destination.campaignId === "setup-campaign"), false);
    await changeCampaignLifecycle(owner, "specific-campaign", { nextStatus: "intake_closed" });
    view = await getEmployeeIntakeView(employee);
    assert.deepEqual(
      view.destinations.map((destination) => destination.campaignId),
      ["general-campaign"]
    );
    await resetAndSeedDemoData();

    console.log("employee-intake-check: keep drafts private and out of R&D counts");
    const draft = await saveIdeaDraft(employee, {
      campaignId: "general-campaign",
      evidenceExample: "Operations team has monthly leftover inventory.",
      expectedBenefit: "Lower material spend before new purchase orders.",
      originalText: "A cross-team exchange could list leftover lab materials before teams reorder.",
      problemOpportunity: "Usable material gets discarded after short experiments.",
      supportingLink: "https://example.com/material-log",
      title: "Shared lab material exchange"
    });
    view = await getEmployeeIntakeView(employee);
    assert.equal(view.drafts.some((candidate) => candidate.id === draft.draftId), true);
    assert.equal(view.ideaCount, 1);
    assert.equal(await countEmployeeDrafts(), 1);
    assert.equal(await countDraftAuditEvents(), 0);
    await assert.rejects(() => getEmployeeIntakeView(teamMember), /Only employees can use intake/);

    console.log("employee-intake-check: delete drafts without creating submission or audit state");
    await deleteIdeaDraft(employee, draft.draftId);
    view = await getEmployeeIntakeView(employee);
    assert.equal(view.drafts.some((candidate) => candidate.id === draft.draftId), false);
    assert.equal(view.ideaCount, 1);
    assert.equal(await countEmployeeDrafts(), 0);
    assert.equal(await countDraftAuditEvents(), 0);

    console.log("employee-intake-check: submit draft with immutable source and preview snapshot");
    const specificDraft = await saveIdeaDraft(employee, {
      campaignId: "specific-campaign",
      evidenceExample: "Two lines already separate reusable cells manually.",
      expectedBenefit: "Reduce waste and replacement spend.",
      originalText: "We can sort battery cells with enough charge for fixture testing instead of sending them to waste.",
      problemOpportunity: "Reusable cells are being discarded too early.",
      supportingLink: "https://example.com/battery-fixture",
      title: "Reuse battery cells for fixture testing"
    });
    const receipt = await submitIdeaDraft(employee, specificDraft.draftId);
    assert.equal(receipt.title, "Reuse battery cells for fixture testing");
    assert.match(receipt.confirmationText, /Reuse battery cells for fixture testing|idea-/);
    assertReceiptHasNoInternalLabels(receipt);
    const submittedIdea = await readIdea(receipt.ideaId);
    assert.equal(submittedIdea.campaignId, "specific-campaign");
    assert.equal(submittedIdea.submitterUserId, employee.user.id);
    assert.equal(submittedIdea.originalText, "We can sort battery cells with enough charge for fixture testing instead of sending them to waste.");
    assert.equal(submittedIdea.problemOpportunity, "Reusable cells are being discarded too early.");
    assert.equal(submittedIdea.expectedBenefit, "Reduce waste and replacement spend.");
    assert.equal(submittedIdea.evidenceExample, "Two lines already separate reusable cells manually.");
    assert.equal(submittedIdea.supportingLink, "https://example.com/battery-fixture");
    assert.equal(submittedIdea.previewVersion, 1);
    assert.equal(submittedIdea.previewTitle, "Battery Reuse Ideas");
    assert.match(submittedIdea.previewPrompt ?? "", /battery materials/i);
    await assert.rejects(
      () =>
        saveIdeaDraft(employee, {
          campaignId: "specific-campaign",
          draftId: specificDraft.draftId,
          originalText: "Mutation after submit should not touch source.",
          title: "Changed after submit"
        }),
      /Draft not found/
    );
    assert.equal((await readIdea(receipt.ideaId)).originalText, submittedIdea.originalText);
    view = await getEmployeeIntakeView(employee);
    assert.equal(view.drafts.some((candidate) => candidate.id === specificDraft.draftId), false);

    console.log("employee-intake-check: enforce one visible destination per submission");
    await assert.rejects(
      () =>
        submitIdea(employee, {
          campaignId: "",
          originalText: "Missing destination should fail.",
          title: "No destination"
        }),
      /destination/
    );
    await assert.rejects(
      () =>
        submitIdea(employee, {
          campaignId: "setup-campaign",
          originalText: "Setup campaigns are not employee-visible destinations.",
          title: "Closed destination"
        }),
      /not open for employee intake/
    );
    await assert.rejects(
      () =>
        submitIdea(teamMember, {
          campaignId: "general-campaign",
          originalText: "R&D users cannot submit employee ideas.",
          title: "Wrong role"
        }),
      /Only employees can submit ideas/
    );
    const directReceipt = await submitIdea(employee, {
      campaignId: "general-campaign",
      originalText: "A small label on shared tooling could prevent duplicate orders.",
      title: "Shared tooling labels"
    });
    assert.equal(directReceipt.title, "Shared tooling labels");
    assertReceiptHasNoInternalLabels(directReceipt);

    console.log("employee-intake-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
