"use server";

import { redirect } from "next/navigation";

import { getCurrentSession } from "../auth/cookies";
import {
  assignIdeaRanking,
  recordReviewOutcome,
  recommendReviewOutcome,
  type ReviewOutcome
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
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim();
}

function readReviewOutcome(value: string): ReviewOutcome {
  if (value === "potential_idea" || value === "future_opportunity" || value === "inactive_idea") {
    return value;
  }

  throw new Error("Invalid review outcome.");
}

async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Select a demo role first.");
  }

  return session;
}

export async function assignIdeaRankingAction(formData: FormData) {
  const session = await requireSession();
  await assignIdeaRanking(session, readString(formData, "ideaId"), {
    rankPosition: Number(readString(formData, "rankPosition")),
    rankReasons: readString(formData, "rankReasons")
      .split("|")
      .map((reason) => reason.trim())
      .filter(Boolean)
  });
  redirect("/?tab=review");
}

export async function recommendReviewOutcomeAction(formData: FormData) {
  const session = await requireSession();
  await recommendReviewOutcome(session, readString(formData, "ideaId"), {
    nextState: readReviewOutcome(readString(formData, "nextState")),
    reasonNote: readOptionalString(formData, "reasonNote"),
    reasonTag: readString(formData, "reasonTag")
  });
  redirect("/?tab=review");
}

export async function recordReviewOutcomeAction(formData: FormData) {
  const session = await requireSession();
  const campaignContextId = readOptionalString(formData, "campaignContextId");
  await recordReviewOutcome(session, readString(formData, "ideaId"), {
    campaignContextId: campaignContextId ?? undefined,
    nextState: readReviewOutcome(readString(formData, "nextState")),
    reasonNote: readOptionalString(formData, "reasonNote"),
    reasonTag: readString(formData, "reasonTag")
  });
  redirect("/?tab=review");
}
