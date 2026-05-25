"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import {
  reclassifyInactiveGeneralIdea,
  updateGeneralCampaignReviewPacket
} from "./service";

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}.`);
  }

  return value.trim();
}

function readReclassificationState(value: string) {
  if (value === "general_idea" || value === "ready_for_rd_review" || value === "future_opportunity") {
    return value;
  }

  throw new Error("Invalid General Campaign reclassification state.");
}

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Select a demo role first.");
  }

  return session;
}

export async function updateGeneralCampaignReviewPacketAction(formData: FormData) {
  const session = await requireSession();
  await updateGeneralCampaignReviewPacket(session, {
    packetText: readString(formData, "packetText")
  });
  redirect("/?tab=intake");
}

export async function reclassifyInactiveGeneralIdeaAction(formData: FormData) {
  const session = await requireSession();
  await reclassifyInactiveGeneralIdea(session, readString(formData, "ideaId"), {
    nextState: readReclassificationState(readString(formData, "nextState")),
    reason: readString(formData, "reason")
  });
  redirect("/?tab=intake");
}
