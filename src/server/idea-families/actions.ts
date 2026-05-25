"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import { analyzeIdeaFamilyForIdea, regenerateIdeaFamilySummary } from "./service";

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
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

export async function analyzeIdeaFamilyAction(formData: FormData) {
  const session = await requireSession();
  await analyzeIdeaFamilyForIdea(session, readString(formData, "ideaId"));
  redirect("/?tab=intelligence");
}

export async function regenerateIdeaFamilySummaryAction(formData: FormData) {
  const session = await requireSession();
  await regenerateIdeaFamilySummary(session, readString(formData, "familyId"));
  redirect("/?tab=intelligence");
}
