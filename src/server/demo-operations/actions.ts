"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import { runDemoOperation, type DemoOperationId } from "./service";

const demoOperationIds = [
  "campaign_end_sweep",
  "clarification_expiry",
  "clarification_reminders",
  "general_recheck",
  "reset_baseline",
  "reseed_baseline",
  "review_digest",
  "scheduled_open_close"
] as const;

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

function readDemoOperation(value: string): DemoOperationId {
  if ((demoOperationIds as readonly string[]).includes(value)) {
    return value as DemoOperationId;
  }

  throw new Error("Invalid demo operation.");
}

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Select a demo role first.");
  }

  return session;
}

export async function runDemoOperationAction(formData: FormData) {
  const session = await requireSession();
  const operation = readDemoOperation(readString(formData, "operation"));

  await runDemoOperation(session, {
    campaignId: readOptionalString(formData, "campaignId"),
    operation
  });
  redirect("/");
}
