"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import { routeIdeaBeforeRdReview, runCampaignRoutingRecheck, runGeneralCampaignRoutingRecheck } from "./service";

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

export async function routeIdeaBeforeRdReviewAction(formData: FormData) {
  const session = await requireSession();
  await routeIdeaBeforeRdReview(session, readString(formData, "ideaId"));
  redirect("/?tab=intelligence");
}

export async function runCampaignRoutingRecheckAction(formData: FormData) {
  const session = await requireSession();
  await runCampaignRoutingRecheck(session, readString(formData, "campaignId"));
  redirect("/?tab=intelligence");
}

export async function runGeneralCampaignRoutingRecheckAction() {
  const session = await requireSession();
  await runGeneralCampaignRoutingRecheck(session);
  redirect("/?tab=intelligence");
}
