"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import {
  answerSetupQuestion,
  approveCampaignKnowledgeReport,
  approveSetupAnswer,
  editPendingSetupAnswer,
  generateCampaignKnowledgeReport,
  rejectSetupAnswer
} from "./service";

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }

  return value.trim();
}

function readBoolean(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Select a demo role first.");
  }

  return session;
}

export async function answerSetupQuestionAction(formData: FormData) {
  const session = await requireSession();
  await answerSetupQuestion(session, readString(formData, "questionId"), {
    answerText: readString(formData, "answerText"),
    decisionTitle: readString(formData, "decisionTitle"),
    isContextOverride: readBoolean(formData, "isContextOverride"),
    isIntentionalAmbiguity: readBoolean(formData, "isIntentionalAmbiguity")
  });
  redirect("/");
}

export async function editPendingSetupAnswerAction(formData: FormData) {
  const session = await requireSession();
  await editPendingSetupAnswer(session, readString(formData, "answerId"), {
    answerText: readString(formData, "answerText")
  });
  redirect("/");
}

export async function approveSetupAnswerAction(formData: FormData) {
  const session = await requireSession();
  await approveSetupAnswer(session, readString(formData, "answerId"));
  redirect("/");
}

export async function rejectSetupAnswerAction(formData: FormData) {
  const session = await requireSession();
  await rejectSetupAnswer(session, readString(formData, "answerId"), {
    reason: readString(formData, "reason")
  });
  redirect("/");
}

export async function generateCampaignKnowledgeReportAction(formData: FormData) {
  const session = await requireSession();
  await generateCampaignKnowledgeReport(session, readString(formData, "campaignId"));
  redirect("/");
}

export async function approveCampaignKnowledgeReportAction(formData: FormData) {
  const session = await requireSession();
  await approveCampaignKnowledgeReport(session, readString(formData, "reportId"));
  redirect("/");
}
