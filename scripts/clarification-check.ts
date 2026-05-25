import assert from "node:assert/strict";

import type { LlmProvider } from "../src/server/llm/adapter";
import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { aiDecisionLogs, clarificationRequests, ideaStateHistory } from "../src/server/db/schema";
import { resetAndSeedDemoData } from "../src/server/seed/reset";
import {
  getEmployeeClarificationView,
  getIdeaClarificationReview,
  requestEmployeeClarification,
  runClarificationExpiryJob,
  runClarificationReminderJob,
  submitClarificationAnswer,
  type ClarificationEmailProvider
} from "../src/server/clarifications/service";

function clarificationQuestionProvider(questionText: string): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  questionText,
                  rationale: "R&D needs one focused employee detail before review."
                }),
                name: "record_employee_clarification_question"
              },
              id: "tool-call-1",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-clarification-test",
    model: "moonshotai/kimi-k2.6",
    object: "chat.completion"
  });
}

function assumptionRoutingProvider(): LlmProvider {
  return async () => ({
    choices: [
      {
        message: {
          tool_calls: [
            {
              function: {
                arguments: JSON.stringify({
                  assumptions:
                    "The material exchange likely has operational value, but no production owner or adoption path was confirmed.",
                  rationale:
                    "This is reasonable because the original submission names waste reduction evidence but lacks the missing owner detail requested before timeout.",
                  routingDecision: "future_opportunity"
                }),
                name: "record_assumption_based_routing"
              },
              id: "tool-call-assumption-routing",
              type: "function"
            }
          ]
        }
      }
    ],
    id: "chatcmpl-assumption-routing-test",
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

async function main() {
  try {
    console.log("clarification-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const owner = await sessionFor("general-campaign-owner");
    const sentEmails: Array<{ html: string; subject: string; to: string }> = [];
    const emailProvider: ClarificationEmailProvider = async (message) => {
      sentEmails.push({
        html: message.html,
        subject: message.subject,
        to: message.to.email
      });

      return {
        messages: ["queued"],
        trackingId: "email-track-1"
      };
    };

    console.log("clarification-check: create and send focused clarification");
    const sentAt = new Date("2026-01-01T12:00:00.000Z");
    const sent = await requestEmployeeClarification(owner, "idea-general-material-exchange", {
      appBaseUrl: "http://localhost:3000",
      emailProvider,
      now: sentAt,
      provider: clarificationQuestionProvider("What production team would use the material exchange first?")
    });

    assert.equal(sent.status, "sent");
    assert.equal(sent.questionText, "What production team would use the material exchange first?");
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "employee@verto.demo");
    assert.match(sentEmails[0].html, /http:\/\/localhost:3000\/clarifications\//);
    assert.match(sentEmails[0].html, /January 31, 2026/);

    const requests = await db.select().from(clarificationRequests);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].status, "pending");
    assert.equal(requests[0].requestText, "What production team would use the material exchange first?");
    assert.equal(requests[0].answerText, null);

    console.log("clarification-check: magic link hides internal labels and captures answer");
    const employeeView = await getEmployeeClarificationView(sent.token, sentAt);
    assert(employeeView, "clarification link resolves");
    assert.equal(employeeView.canAnswer, true);
    assert.equal(employeeView.expiresAt.toISOString(), "2026-01-31T12:00:00.000Z");
    assert.equal(employeeView.ideaTitle, "Reusable lab material exchange");
    assert.equal(employeeView.requestText, "What production team would use the material exchange first?");
    const renderedEmployeeView = JSON.stringify(employeeView).toLowerCase();
    assert.equal(renderedEmployeeView.includes("general_idea"), false);
    assert.equal(renderedEmployeeView.includes("ready_for_rd_review"), false);
    assert.equal(renderedEmployeeView.includes("future_opportunity"), false);
    assert.equal(renderedEmployeeView.includes("inactive_idea"), false);
    assert.equal(renderedEmployeeView.includes("potential_idea"), false);

    console.log("clarification-check: day-23 reminder sends once");
    const reminderRun = await runClarificationReminderJob({
      appBaseUrl: "http://localhost:3000",
      emailProvider,
      now: new Date("2026-01-24T12:01:00.000Z")
    });
    assert.equal(reminderRun.sentCount, 1);
    assert.equal(sentEmails.length, 2);
    assert.match(sentEmails[1].subject, /Reminder/);
    assert.match(sentEmails[1].html, /January 31, 2026/);
    assert.match(sentEmails[1].html, /http:\/\/localhost:3000\/clarifications\//);
    const secondReminderRun = await runClarificationReminderJob({
      appBaseUrl: "http://localhost:3000",
      emailProvider,
      now: new Date("2026-01-24T12:02:00.000Z")
    });
    assert.equal(secondReminderRun.sentCount, 0);
    assert.equal(sentEmails.length, 2);

    await submitClarificationAnswer(sent.token, {
      answerText: "Maintenance should try it first because they already track leftover lab material.",
      now: sentAt,
      supportingLink: "https://example.com/material-owner"
    });
    const answeredView = await getEmployeeClarificationView(sent.token, sentAt);
    assert(answeredView, "answered clarification still resolves");
    assert.equal(answeredView.answered, true);
    assert.equal(answeredView.canAnswer, false);
    assert.equal(answeredView.supportingLink, "https://example.com/material-owner");

    console.log("clarification-check: R&D users with campaign access can inspect source material");
    const review = await getIdeaClarificationReview(owner, "idea-general-material-exchange");
    assert.equal(review.length, 1);
    assert.equal(review[0].answerText, "Maintenance should try it first because they already track leftover lab material.");
    assert.equal(review[0].supportingLink, "https://example.com/material-owner");
    assert.equal(review[0].submitterEmail, "employee@verto.demo");
    const employee = await sessionFor("employee");
    await assert.rejects(
      () => getIdeaClarificationReview(employee, "idea-general-material-exchange"),
      /Only R&D users with campaign access/
    );
    await assert.rejects(
      () =>
        requestEmployeeClarification(owner, "idea-general-material-exchange", {
          appBaseUrl: "http://localhost:3000",
          emailProvider,
          provider: clarificationQuestionProvider("Can we ask a second question?")
        }),
      /Clarification batch already exists/
    );

    console.log("clarification-check: email provider failure records retry without sent claim");
    await resetAndSeedDemoData();
    const failed = await requestEmployeeClarification(owner, "idea-general-material-exchange", {
      appBaseUrl: "http://localhost:3000",
      emailProvider: async () => {
        throw new Error("email provider down");
      },
      provider: clarificationQuestionProvider("Which production constraint would block this exchange?")
    });
    assert.equal(failed.status, "retry_required");
    const failedRequests = await db.select().from(clarificationRequests);
    assert.equal(failedRequests.length, 1);
    assert.equal(failedRequests[0].emailStatus, "retry_required");
    assert.equal(failedRequests[0].emailTrackingId, null);
    assert.equal(failedRequests[0].sentAt, null);
    assert.match(failedRequests[0].emailError ?? "", /email provider down/);

    console.log("clarification-check: expiry job records assumption-based routing and blocks resend");
    await resetAndSeedDemoData();
    const expiring = await requestEmployeeClarification(owner, "idea-general-material-exchange", {
      appBaseUrl: "http://localhost:3000",
      emailProvider,
      now: sentAt,
      provider: clarificationQuestionProvider("What production team would use the material exchange first?")
    });
    assert.equal(expiring.status, "sent");
    const afterExpiry = new Date("2026-02-01T12:00:00.000Z");
    const expiredLinkView = await getEmployeeClarificationView(expiring.token, afterExpiry);
    assert(expiredLinkView, "expired clarification still shows read-only context");
    assert.equal(expiredLinkView.expired, true);
    assert.equal(expiredLinkView.canAnswer, false);
    await assert.rejects(
      () =>
        submitClarificationAnswer(expiring.token, {
          answerText: "Late answer after expiry.",
          now: afterExpiry
        }),
      /expired/
    );

    const expiryRun = await runClarificationExpiryJob({
      now: afterExpiry,
      provider: assumptionRoutingProvider()
    });
    assert.equal(expiryRun.expiredCount, 1);
    assert.equal(expiryRun.retryRequiredCount, 0);

    const expiredRequests = await db.select().from(clarificationRequests);
    assert.equal(expiredRequests.length, 1);
    assert.equal(expiredRequests[0].status, "expired");
    assert.equal(expiredRequests[0].expiredAt?.toISOString(), afterExpiry.toISOString());
    assert.equal(expiredRequests[0].assumptionRoutingDecision, "future_opportunity");
    assert.match(expiredRequests[0].assumptionText ?? "", /operational value/);
    assert.match(expiredRequests[0].assumptionReason ?? "", /reasonable/);

    const stateRows = await db.select().from(ideaStateHistory);
    const currentState = stateRows.find((row) => row.isCurrent);
    assert.equal(currentState?.workflowState, "future_opportunity");
    assert.match(currentState?.reason ?? "", /Assumption-Based Routing/);

    const assumptionLogs = await db.select().from(aiDecisionLogs);
    const assumptionLog = assumptionLogs.find((row) => row.purpose === "employee_clarification.assumption_routing");
    assert.equal(assumptionLog?.status, "succeeded");
    assert.match(assumptionLog?.outputSummary ?? "", /future_opportunity/);

    const expiredReview = await getIdeaClarificationReview(owner, "idea-general-material-exchange");
    assert.equal(expiredReview[0].status, "expired");
    assert.equal(expiredReview[0].assumptionRoutingDecision, "future_opportunity");
    assert.match(expiredReview[0].assumptionReason ?? "", /reasonable/);

    await assert.rejects(
      () =>
        requestEmployeeClarification(owner, "idea-general-material-exchange", {
          appBaseUrl: "http://localhost:3000",
          emailProvider,
          now: afterExpiry,
          provider: clarificationQuestionProvider("Can we send another clarification?")
        }),
      /Clarification batch already exists/
    );

    console.log("clarification-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
