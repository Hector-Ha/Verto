"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import {
  classifyIdeaIntoGroups,
  rankSpecificCampaignGroups,
  updateIdeaClassificationAfterClarification
} from "./service";

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

export async function classifyIdeaIntoGroupsAction(formData: FormData) {
  const session = await requireSession();
  await classifyIdeaIntoGroups(session, readString(formData, "ideaId"));
  redirect("/?tab=intelligence");
}

export async function updateIdeaClassificationAfterClarificationAction(formData: FormData) {
  const session = await requireSession();
  await updateIdeaClassificationAfterClarification(session, readString(formData, "ideaId"));
  redirect("/?tab=intelligence");
}

export async function rankSpecificCampaignGroupsAction(formData: FormData) {
  const session = await requireSession();
  await rankSpecificCampaignGroups(session, readString(formData, "campaignId"));
  redirect("/?tab=intelligence");
}
