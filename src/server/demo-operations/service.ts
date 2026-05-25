import { and, desc, eq } from "drizzle-orm";

import type { DemoSession } from "../auth/session";
import { endCampaignWithSweep } from "../campaign-end/service";
import { runScheduledCampaignGateJob } from "../campaigns/service";
import { runClarificationExpiryJob, runClarificationReminderJob } from "../clarifications/service";
import { db } from "../db/client";
import {
  aiDecisionLogs,
  campaignMemberships,
  campaigns
} from "../db/schema";
import { runGeneralCampaignRoutingRecheck } from "../pre-rd-routing/service";
import { runReviewDigestDemoJob } from "../review-digests/service";
import { resetAndSeedDemoData } from "../seed/reset";

export type DemoOperationId =
  | "campaign_end_sweep"
  | "clarification_expiry"
  | "clarification_reminders"
  | "general_recheck"
  | "reset_baseline"
  | "reseed_baseline"
  | "review_digest"
  | "scheduled_open_close";

type DemoOperationInput = {
  campaignId?: string | null;
  now?: Date;
  operation: DemoOperationId;
};

export const demoOperations: Array<{
  description: string;
  id: DemoOperationId;
  label: string;
}> = [
  {
    description: "Send due day-23 employee clarification reminders.",
    id: "clarification_reminders",
    label: "Run reminders"
  },
  {
    description: "Expire overdue clarification links and route by real AI assumption flow.",
    id: "clarification_expiry",
    label: "Expire clarifications"
  },
  {
    description: "Apply owner-approved scheduled campaign open and close gates.",
    id: "scheduled_open_close",
    label: "Run schedule"
  },
  {
    description: "Recheck unreviewed General Campaign ideas against current packet.",
    id: "general_recheck",
    label: "Recheck General"
  },
  {
    description: "Generate latest in-app review digests.",
    id: "review_digest",
    label: "Generate digests"
  },
  {
    description: "End selected campaign and return non-Potential ideas to General Campaign.",
    id: "campaign_end_sweep",
    label: "End campaign"
  },
  {
    description: "Reset demo data back to deterministic seed baseline.",
    id: "reset_baseline",
    label: "Reset baseline"
  },
  {
    description: "Recreate deterministic seed data for a clean demo run.",
    id: "reseed_baseline",
    label: "Reseed baseline"
  }
];

function assertDemoOperator(session: DemoSession) {
  if (session.role.id === "employee") {
    throw new Error("Only R&D demo operators can run protected demo controls.");
  }
}

function assertManagerForBaseline(session: DemoSession) {
  if (session.role.id !== "rd_manager") {
    throw new Error("Only the R&D Manager can reset or reseed the demo baseline.");
  }
}

function requireCampaignId(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error("Campaign is required for campaign-end sweep.");
  }

  return trimmed;
}

export async function runDemoOperation(session: DemoSession, input: DemoOperationInput) {
  assertDemoOperator(session);
  const now = input.now ?? new Date();

  if (input.operation === "reset_baseline" || input.operation === "reseed_baseline") {
    assertManagerForBaseline(session);
    await resetAndSeedDemoData();

    return {
      operation: input.operation,
      summary: {
        baselineReady: true
      }
    };
  }

  if (input.operation === "clarification_reminders") {
    return {
      operation: input.operation,
      summary: await runClarificationReminderJob({ now })
    };
  }

  if (input.operation === "clarification_expiry") {
    return {
      operation: input.operation,
      summary: await runClarificationExpiryJob({ now })
    };
  }

  if (input.operation === "scheduled_open_close") {
    return {
      operation: input.operation,
      summary: await runScheduledCampaignGateJob(session, { now })
    };
  }

  if (input.operation === "general_recheck") {
    return {
      operation: input.operation,
      summary: await runGeneralCampaignRoutingRecheck(session, { now })
    };
  }

  if (input.operation === "review_digest") {
    return {
      operation: input.operation,
      summary: await runReviewDigestDemoJob({ now })
    };
  }

  if (input.operation === "campaign_end_sweep") {
    return {
      operation: input.operation,
      summary: await endCampaignWithSweep(session, requireCampaignId(input.campaignId), { now })
    };
  }

  throw new Error("Unknown demo operation.");
}

export async function getDemoOperationsView(session: DemoSession) {
  if (session.role.id === "employee") {
    return {
      aiDecisionLogs: [],
      campaignEndOptions: [],
      canRunDemoOperations: false,
      operations: []
    };
  }

  const [campaignRows, aiLogRows] = await Promise.all([
    db
      .select({
        campaignId: campaigns.id,
        lifecycleStatus: campaigns.lifecycleStatus,
        publicTitle: campaigns.publicTitle
      })
      .from(campaigns)
      .innerJoin(
        campaignMemberships,
        and(eq(campaignMemberships.campaignId, campaigns.id), eq(campaignMemberships.userId, session.user.id))
      )
      .where(eq(campaigns.type, "specific"))
      .orderBy(campaigns.publicTitle),
    db
      .select({
        createdAt: aiDecisionLogs.createdAt,
        id: aiDecisionLogs.id,
        model: aiDecisionLogs.model,
        outputSummary: aiDecisionLogs.outputSummary,
        purpose: aiDecisionLogs.purpose,
        status: aiDecisionLogs.status
      })
      .from(aiDecisionLogs)
      .orderBy(desc(aiDecisionLogs.createdAt))
      .limit(12)
  ]);
  const campaignEndOptions = Array.from(
    new Map(campaignRows.map((campaign) => [campaign.campaignId, campaign])).values()
  );

  return {
    aiDecisionLogs: aiLogRows,
    campaignEndOptions,
    canRunDemoOperations: true,
    operations: demoOperations
  };
}
