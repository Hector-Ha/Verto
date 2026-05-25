import { closeDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { runClarificationReminderJob } from "../src/server/clarifications/service";

async function main() {
  try {
    await runMigrations();
    const result = await runClarificationReminderJob();
    console.log(`clarification-reminder-job: sent=${result.sentCount} retry_required=${result.retryRequiredCount}`);
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
