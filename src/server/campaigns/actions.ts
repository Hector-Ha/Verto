"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import {
  addCampaignTeamMember,
  changeCampaignLifecycle,
  changeCampaignOwner,
  createSpecificCampaign,
  isCampaignLifecycleStatus,
  removeCampaignTeamMember
} from "./service";

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }

  return value.trim();
}

function readOptionalDate(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${name}.`);
  }

  return date;
}

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Select a demo role first.");
  }

  return session;
}

export async function createCampaignAction(formData: FormData) {
  const session = await requireSession();
  await createSpecificCampaign(session, {
    name: readString(formData, "name"),
    ownerUserId: readString(formData, "ownerUserId"),
    publicPrompt: readString(formData, "publicPrompt"),
    publicTitle: readString(formData, "publicTitle")
  });
  redirect("/");
}

export async function changeCampaignOwnerAction(formData: FormData) {
  const session = await requireSession();
  await changeCampaignOwner(session, readString(formData, "campaignId"), readString(formData, "ownerUserId"));
  redirect("/");
}

export async function addCampaignTeamMemberAction(formData: FormData) {
  const session = await requireSession();
  await addCampaignTeamMember(session, readString(formData, "campaignId"), readString(formData, "userId"));
  redirect("/");
}

export async function removeCampaignTeamMemberAction(formData: FormData) {
  const session = await requireSession();
  await removeCampaignTeamMember(session, readString(formData, "campaignId"), readString(formData, "userId"));
  redirect("/");
}

export async function changeCampaignLifecycleAction(formData: FormData) {
  const session = await requireSession();
  const nextStatus = readString(formData, "nextStatus");
  if (!isCampaignLifecycleStatus(nextStatus)) {
    throw new Error("Invalid lifecycle status.");
  }

  await changeCampaignLifecycle(session, readString(formData, "campaignId"), {
    intakeEndsAt: readOptionalDate(formData, "intakeEndsAt"),
    intakeStartsAt: readOptionalDate(formData, "intakeStartsAt"),
    nextStatus
  });
  redirect("/");
}
