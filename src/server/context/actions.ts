"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import {
  approveCompanyContext,
  approveGlobalContextProposal,
  contextAlertResolutionOptions,
  createCompanyContextDraft,
  createGlobalContextProposal,
  resolveContextChangeAlert,
  runContextImpactCheck
} from "./service";

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }

  return value.trim();
}

function readOptionalString(formData: FormData, name: string) {
  const value = formData.get(name);

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Select a demo role first.");
  }

  return session;
}

export async function createCompanyContextDraftAction(formData: FormData) {
  const session = await requireSession();
  const publicSources = readOptionalString(formData, "publicSources")
    ?.split("\n")
    .map((source) => source.trim())
    .filter(Boolean);

  await createCompanyContextDraft(session, {
    body: readString(formData, "body"),
    sourceMetadata: {
      manualDescription: true,
      publicSources: publicSources ?? []
    },
    title: readString(formData, "title")
  });
  redirect("/");
}

export async function approveCompanyContextAction(formData: FormData) {
  const session = await requireSession();
  await approveCompanyContext(session, readString(formData, "contextId"));
  redirect("/");
}

export async function createGlobalContextProposalAction(formData: FormData) {
  const session = await requireSession();
  await createGlobalContextProposal(session, {
    body: readString(formData, "body"),
    rationale: readString(formData, "rationale"),
    title: readString(formData, "title")
  });
  redirect("/");
}

export async function approveGlobalContextProposalAction(formData: FormData) {
  const session = await requireSession();
  await approveGlobalContextProposal(session, readString(formData, "proposalId"));
  redirect("/");
}

export async function runContextImpactCheckAction(formData: FormData) {
  const session = await requireSession();
  await runContextImpactCheck(session, readString(formData, "contextId"));
  redirect("/");
}

export async function resolveContextChangeAlertAction(formData: FormData) {
  const session = await requireSession();
  const resolutionType = readString(formData, "resolutionType");
  if (!contextAlertResolutionOptions.includes(resolutionType as (typeof contextAlertResolutionOptions)[number])) {
    throw new Error("Unsupported Context Change Alert resolution.");
  }

  await resolveContextChangeAlert(session, readString(formData, "alertId"), {
    note: readString(formData, "note"),
    resolutionType: resolutionType as (typeof contextAlertResolutionOptions)[number]
  });
  redirect("/");
}
