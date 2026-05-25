import { pathToFileURL } from "node:url";

import { createMysqlConnection } from "../db/config";
import { seedDemoData } from "./seed";

const RESET_TABLES = [
  "retrospective_global_context_proposals",
  "campaign_retrospectives",
  "returned_idea_lineage",
  "review_digest_items",
  "review_digests",
  "idea_campaign_associations",
  "general_campaign_review_packets",
  "campaign_knowledge_reports",
  "campaign_setup_decisions",
  "campaign_setup_answers",
  "campaign_setup_questions",
  "clarification_requests",
  "idea_routing_decisions",
  "idea_review_outcomes",
  "idea_review_recommendations",
  "idea_classification_group_members",
  "idea_classification_groups",
  "idea_rankings",
  "idea_review_summaries",
  "idea_family_members",
  "idea_families",
  "context_change_alerts",
  "context_impact_checks",
  "global_context_change_proposals",
  "context_documents",
  "ai_decision_logs",
  "audit_events",
  "idea_state_history",
  "idea_drafts",
  "ideas",
  "campaign_memberships",
  "user_roles",
  "campaigns",
  "roles",
  "users"
] as const;

export async function resetDemoData() {
  const connection = await createMysqlConnection();

  try {
    await connection.beginTransaction();
    for (const tableName of RESET_TABLES) {
      await connection.execute(`DELETE FROM ${tableName}`);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

export async function resetAndSeedDemoData() {
  await resetDemoData();
  await seedDemoData();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  resetAndSeedDemoData()
    .then(() => {
      console.log("reset: demo baseline ready");
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
