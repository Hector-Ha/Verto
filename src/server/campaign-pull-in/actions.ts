"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import { runCampaignIdeaPullIn } from "./service";

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

export async function runCampaignIdeaPullInAction(formData: FormData) {
  const session = await requireSession();
  await runCampaignIdeaPullIn(session, readString(formData, "campaignId"));
  redirect("/");
}
