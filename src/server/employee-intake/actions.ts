"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import { deleteIdeaDraft, saveIdeaDraft, submitIdea, submitIdeaDraft } from "./service";

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

function readIdeaFields(formData: FormData) {
  return {
    campaignId: readString(formData, "campaignId"),
    evidenceExample: readOptionalString(formData, "evidenceExample"),
    expectedBenefit: readOptionalString(formData, "expectedBenefit"),
    originalText: readString(formData, "originalText"),
    problemOpportunity: readOptionalString(formData, "problemOpportunity"),
    supportingLink: readOptionalString(formData, "supportingLink"),
    title: readString(formData, "title")
  };
}

function redirectWithReceipt(ideaId: string) {
  redirect(`/?tab=intake&submittedIdeaId=${encodeURIComponent(ideaId)}`);
}

export async function saveIdeaDraftAction(formData: FormData) {
  const session = await requireSession();
  await saveIdeaDraft(session, {
    ...readIdeaFields(formData),
    draftId: readOptionalString(formData, "draftId") ?? undefined
  });
  redirect("/?tab=intake");
}

export async function deleteIdeaDraftAction(formData: FormData) {
  const session = await requireSession();
  await deleteIdeaDraft(session, readString(formData, "draftId"));
  redirect("/?tab=intake");
}

export async function submitIdeaAction(formData: FormData) {
  const session = await requireSession();
  const receipt = await submitIdea(session, readIdeaFields(formData));
  redirectWithReceipt(receipt.ideaId);
}

export async function submitIdeaDraftAction(formData: FormData) {
  const session = await requireSession();
  const receipt = await submitIdeaDraft(session, readString(formData, "draftId"));
  redirectWithReceipt(receipt.ideaId);
}
