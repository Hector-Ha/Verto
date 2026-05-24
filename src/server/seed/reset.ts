import { pathToFileURL } from "node:url";

import { createMysqlConnection } from "../db/config";
import { seedDemoData } from "./seed";

const RESET_TABLES = [
  "clarification_requests",
  "ai_decision_logs",
  "audit_events",
  "idea_state_history",
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
