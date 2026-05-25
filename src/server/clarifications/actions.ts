"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import { requestEmployeeClarification, submitClarificationAnswer } from "./service";

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }

  return value.trim();
}

function readOptionalString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
}

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Select a demo role first.");
  }

  return session;
}

export async function requestEmployeeClarificationAction(formData: FormData) {
  const session = await requireSession();
  await requestEmployeeClarification(session, readString(formData, "ideaId"));
  redirect("/?tab=review");
}

export async function submitClarificationAnswerAction(formData: FormData) {
  const token = readString(formData, "token");
  await submitClarificationAnswer(token, {
    answerText: readString(formData, "answerText"),
    supportingLink: readOptionalString(formData, "supportingLink")
  });
  redirect(`/clarifications/${encodeURIComponent(token)}?answered=1`);
}
