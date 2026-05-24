import { closeDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { runClarificationExpiryJob } from "../src/server/clarifications/service";

async function main() {
  try {
    await runMigrations();
    const result = await runClarificationExpiryJob();
    console.log(`clarification-expiry-job: expired=${result.expiredCount} retry_required=${result.retryRequiredCount}`);
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
