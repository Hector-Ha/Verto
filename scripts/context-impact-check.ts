import assert from "node:assert/strict";

import { and, eq } from "drizzle-orm";

import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { answerSetupQuestion } from "../src/server/campaign-setup/service";
import { createSpecificCampaign } from "../src/server/campaigns/service";
import {
  approveCompanyContext,
  approveGlobalContextProposal,
  createCompanyContextDraft,
  createGlobalContextProposal,
  getContextManagementView,
  resolveContextChangeAlert,
  runContextImpactCheck
} from "../src/server/context/service";
import { closeDatabase, db } from "../src/server/db/client";
import {
  auditEvents,
  campaignSetupDecisions,
  campaignSetupQuestions,
  contextChangeAlerts,
  contextDocuments,
  globalContextChangeProposals
} from "../src/server/db/schema";
import type { LlmProvider } from "../src/server/llm/adapter";
import { runMigrations } from "../src/server/db/migrate";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

function impactProvider(): LlmProvider {
  return async (request) => {
    const prompt = request.messages.map((message) => message.content).join("\n");
    assert(prompt.includes("specific-campaign"), "impact prompt includes active specific campaign");
    assert(prompt.includes("setup-campaign"), "impact prompt includes draft setup campaign");
    assert(prompt.includes("context-no-impact"), "impact prompt includes no-impact draft campaign");

    return {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  arguments: JSON.stringify({
                    decisions: [
                      {
                        campaignId: "specific-campaign",
                        impactLevel: "active_alert",
                        recommendedResolution: "Confirm battery-reuse campaign keeps its existing manufacturing focus.",
                        summary: "New company circularity language may broaden reuse criteria for active campaign review."
                      },
                      {
                        campaignId: "setup-campaign",
                        impactLevel: "draft_hard_blocker",
                        recommendedResolution: "Resolve whether packaging reuse must prefer closed-loop suppliers before intake opens.",
                        summary: "Draft setup conflicts with new supplier reuse guidance."
                      },
                      {
                        campaignId: "context-no-impact",
                        impactLevel: "no_impact",
                        recommendedResolution: "No campaign owner action needed.",
                        summary: "Campaign scope already excludes the changed company context."
                      }
                    ]
                  }),
                  name: "record_context_impact_check"
                },
                id: "tool-call-context-impact",
                type: "function"
              }
            ]
          }
        }
      ],
      id: "chatcmpl-context-impact-test",
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

async function answerSetupBaseline(owner: Awaited<ReturnType<typeof sessionFor>>, questionId: string) {
  await answerSetupQuestion(owner, questionId, {
    answerText: "Owner baseline for context impact testing.",
    decisionTitle: "Context test baseline"
  });
}

async function main() {
  try {
    console.log("context-impact-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const manager = await sessionFor("rd-manager");
    const owner = await sessionFor("specific-campaign-owner");
    const teamMember = await sessionFor("rd-team-member");
    const employee = await sessionFor("employee");

    console.log("context-impact-check: manager creates and approves Company Context before use");
    const companyDraft = await createCompanyContextDraft(manager, {
      body: "Verto DemoCo wants circular manufacturing wins and supplier-visible reuse evidence.",
      sourceMetadata: {
        manualDescription: true,
        publicSources: ["https://example.com/demo-co/sustainability"]
      },
      title: "DemoCo circular manufacturing context"
    });
    await assert.rejects(
      () => createCompanyContextDraft(employee, { body: "Not allowed.", title: "Employee context attempt" }),
      /Only an R&D Manager/
    );
    await assert.rejects(() => approveCompanyContext(owner, companyDraft.contextId), /Only an R&D Manager/);
    await approveCompanyContext(manager, companyDraft.contextId);
    let managerView = await getContextManagementView(manager);
    assert.equal(managerView.companyContext?.status, "approved");
    assert.equal(managerView.companyContext.title, "DemoCo circular manufacturing context");

    console.log("context-impact-check: Global Context proposal requires manager approval before publish");
    const proposal = await createGlobalContextProposal(owner, {
      body: "Prefer reuse ideas with cross-campaign learning value and source trace.",
      rationale: "Retrospective pattern from prior reuse campaign.",
      title: "Prefer traceable reuse learnings"
    });
    assert.equal((await db.select().from(globalContextChangeProposals)).length, 1);
    assert.equal((await db.select().from(contextDocuments).where(eq(contextDocuments.contextType, "global_innovation"))).length, 0);
    await assert.rejects(() => approveGlobalContextProposal(owner, proposal.proposalId), /Only an R&D Manager/);
    const approvedProposal = await approveGlobalContextProposal(manager, proposal.proposalId);
    assert(approvedProposal.contextId, "approved proposal creates published global context");

    console.log("context-impact-check: impact check creates active alert, draft blocker, and no-impact audit");
    await createSpecificCampaign(manager, {
      id: "context-no-impact",
      name: "No Impact Context Campaign",
      ownerUserId: "specific-campaign-owner",
      publicPrompt: "Ideas for a narrow fixture-only experiment.",
      publicTitle: "Fixture Ideas"
    });
    const impact = await runContextImpactCheck(manager, companyDraft.contextId, { provider: impactProvider() });
    assert.deepEqual(impact, {
      activeAlertsCreated: 1,
      draftBlockersCreated: 1,
      draftWarningsCreated: 0,
      noImpactCount: 1
    });

    managerView = await getContextManagementView(manager);
    assert.equal(managerView.activeAlerts.length, 1);
    const [activeAlert] = managerView.activeAlerts;
    assert.equal(activeAlert.campaignId, "specific-campaign");
    assert.deepEqual(activeAlert.resolutionOptions, [
      "no_impact",
      "update_campaign_context",
      "campaign_context_override",
      "follow_up_question",
      "escalate_to_manager"
    ]);

    const draftBlockers = await db
      .select()
      .from(campaignSetupQuestions)
      .where(
        and(
          eq(campaignSetupQuestions.campaignId, "setup-campaign"),
          eq(campaignSetupQuestions.priority, "hard_blocker")
        )
      );
    assert.equal(draftBlockers.some((question) => question.questionText.includes("closed-loop suppliers")), true);

    const noImpactAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, "context.impact.no_impact"));
    assert.equal(noImpactAudits.some((event) => event.entityId === "context-no-impact"), true);

    console.log("context-impact-check: owner resolves alert as campaign override");
    await resolveContextChangeAlert(owner, activeAlert.id, {
      note: "Battery campaign remains intentionally manufacturing-focused for this intake.",
      resolutionType: "campaign_context_override"
    });
    const [overrideDecision] = await db
      .select()
      .from(campaignSetupDecisions)
      .where(
        and(
          eq(campaignSetupDecisions.campaignId, "specific-campaign"),
          eq(campaignSetupDecisions.isContextOverride, true)
        )
      );
    assert(overrideDecision.value.includes("manufacturing-focused"));
    const [resolvedAlert] = await db
      .select()
      .from(contextChangeAlerts)
      .where(eq(contextChangeAlerts.id, activeAlert.id));
    assert.equal(resolvedAlert.status, "resolved");

    console.log("context-impact-check: escalation is structured and owner-only");
    const secondImpact = await runContextImpactCheck(manager, approvedProposal.contextId, { provider: impactProvider() });
    assert.equal(secondImpact.activeAlertsCreated, 1);
    const ownerView = await getContextManagementView(owner);
    const escalationAlert = ownerView.activeAlerts.find((alert) => alert.campaignId === "specific-campaign");
    assert(escalationAlert, "owner can inspect campaign alert");
    await assert.rejects(
      () =>
        resolveContextChangeAlert(teamMember, escalationAlert.id, {
          note: "Contributor cannot resolve owner alert.",
          resolutionType: "no_impact"
        }),
      /Only the R&D Manager or Campaign Owner/
    );
    await resolveContextChangeAlert(owner, escalationAlert.id, {
      note: "Company-level guidance may be too broad for current R&D evidence.",
      resolutionType: "escalate_to_manager"
    });
    const escalationAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.eventType, "context.alert.escalated"));
    assert.equal(escalationAudits.length >= 1, true);

    console.log("context-impact-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
