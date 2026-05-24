import assert from "node:assert/strict";

import type { LlmProvider } from "../src/server/llm/adapter";
import { DEMO_PERSONAS, type DemoPersonaId } from "../src/server/auth/personas";
import { createSessionToken, getSessionFromToken } from "../src/server/auth/session";
import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { clarificationRequests } from "../src/server/db/schema";
import { resetAndSeedDemoData } from "../src/server/seed/reset";
import {
  getEmployeeClarificationView,
  getIdeaClarificationReview,
  requestEmployeeClarification,
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
    const sent = await requestEmployeeClarification(owner, "idea-general-material-exchange", {
      appBaseUrl: "http://localhost:3000",
      emailProvider,
      provider: clarificationQuestionProvider("What production team would use the material exchange first?")
    });

    assert.equal(sent.status, "sent");
    assert.equal(sent.questionText, "What production team would use the material exchange first?");
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "employee@verto.demo");
    assert.match(sentEmails[0].html, /http:\/\/localhost:3000\/clarifications\//);

    const requests = await db.select().from(clarificationRequests);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].status, "pending");
    assert.equal(requests[0].requestText, "What production team would use the material exchange first?");
    assert.equal(requests[0].answerText, null);

    console.log("clarification-check: magic link hides internal labels and captures answer");
    const employeeView = await getEmployeeClarificationView(sent.token);
    assert(employeeView, "clarification link resolves");
    assert.equal(employeeView.canAnswer, true);
    assert.equal(employeeView.ideaTitle, "Reusable lab material exchange");
    assert.equal(employeeView.requestText, "What production team would use the material exchange first?");
    const renderedEmployeeView = JSON.stringify(employeeView).toLowerCase();
    assert.equal(renderedEmployeeView.includes("general_idea"), false);
    assert.equal(renderedEmployeeView.includes("ready_for_rd_review"), false);
    assert.equal(renderedEmployeeView.includes("future_opportunity"), false);
    assert.equal(renderedEmployeeView.includes("inactive_idea"), false);
    assert.equal(renderedEmployeeView.includes("potential_idea"), false);

    await submitClarificationAnswer(sent.token, {
      answerText: "Maintenance should try it first because they already track leftover lab material.",
      supportingLink: "https://example.com/material-owner"
    });
    const answeredView = await getEmployeeClarificationView(sent.token);
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

    console.log("clarification-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
