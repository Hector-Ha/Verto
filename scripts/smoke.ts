import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { closeDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { getDemoSnapshot } from "../src/server/db/queries";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

const execFileAsync = promisify(execFile);

async function stopProcessTree(pid: number | undefined) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/pid", String(pid), "/t", "/f"]).catch(() => undefined);
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

async function rootRenders(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    return response.ok && body.includes("Verto demo baseline") && body.includes("General Ideas");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function findExistingDevServerUrl(output: string) {
  const match = output.match(/Another next dev server is already running[\s\S]*?Local:\s+(http:\/\/localhost:\d+)/);
  return match?.[1] ?? null;
}

async function waitForRenderedRoot(port: number) {
  const url = `http://127.0.0.1:${port}`;
  if (await rootRenders(url)) {
    return;
  }

  const child = spawn(process.execPath, ["run", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (await rootRenders(url)) {
        return;
      }

      const existingDevServerUrl = findExistingDevServerUrl(output);
      if (existingDevServerUrl && (await rootRenders(existingDevServerUrl))) {
        return;
      }

      await sleep(1000);
    }

    throw new Error(`Next.js root did not render expected demo shell. Server output:\n${output}`);
  } finally {
    await stopProcessTree(child.pid);
  }
}

async function main() {
  try {
    console.log("smoke: migrate");
    await runMigrations();

    console.log("smoke: reset demo data twice");
    await resetAndSeedDemoData();
    await resetAndSeedDemoData();

    console.log("smoke: verify deterministic baseline");
    const snapshot = await getDemoSnapshot();
    assert.equal(snapshot.userCount, 5);
    assert.equal(snapshot.roleCount, 5);
    assert.equal(snapshot.campaignCount, 3);
    assert.equal(snapshot.ideaCount, 1);
    assert(snapshot.campaigns.some((campaign) => campaign.id === "general-campaign" && campaign.lifecycleStatus === "always_open"));
    assert(snapshot.campaigns.some((campaign) => campaign.id === "specific-campaign" && campaign.lifecycleStatus === "intake_open"));
    assert(snapshot.campaigns.some((campaign) => campaign.id === "setup-campaign" && campaign.lifecycleStatus === "setup_review"));

    console.log("smoke: boot Next.js route");
    const port = Number(process.env.SMOKE_PORT ?? "3107");
    await waitForRenderedRoot(port);

    console.log("smoke: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
