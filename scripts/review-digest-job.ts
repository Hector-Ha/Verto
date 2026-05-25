import { closeDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { runReviewDigestDemoJob } from "../src/server/review-digests/service";

async function main() {
  try {
    await runMigrations();
    const result = await runReviewDigestDemoJob();
    console.log(
      `review-digest-job: generated=${result.generatedCount} specific=${result.specificGeneratedCount} general=${result.generalGeneratedCount} items=${result.itemCount}`
    );
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
