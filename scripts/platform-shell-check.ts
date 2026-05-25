import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { SESSION_COOKIE_NAME, createSessionToken } from "../src/server/auth/session";
import { closeDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
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

async function fetchPage(url: string, cookie?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      headers: cookie ? { cookie } : undefined,
      signal: controller.signal
    });
    const body = await response.text();
    assert(response.ok, `${url} returned ${response.status}`);
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function rootRenders(url: string) {
  try {
    const body = await fetchPage(url);
    return body.includes("Verto demo baseline") && body.includes("Primary workspace");
  } catch {
    return false;
  }
}

function findExistingDevServerUrl(output: string) {
  const match = output.match(/Another next dev server is already running[\s\S]*?Local:\s+(http:\/\/localhost:\d+)/);
  return match?.[1] ?? null;
}

async function startDevServer(port: number) {
  const targetUrl = `http://127.0.0.1:${port}`;
  if (await rootRenders(targetUrl)) {
    return { child: null, url: targetUrl };
  }

  const child = spawn(process.execPath, ["run", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)], {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      APP_BASE_URL: targetUrl,
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

  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await rootRenders(targetUrl)) {
      return { child, url: targetUrl };
    }

    const existingDevServerUrl = findExistingDevServerUrl(output);
    if (existingDevServerUrl && (await rootRenders(existingDevServerUrl))) {
      return { child, url: existingDevServerUrl };
    }

    await sleep(1000);
  }

  await stopProcessTree(child.pid);
  throw new Error(`Next.js root did not render expected platform shell. Server output:\n${output}`);
}

async function main() {
  let devServer: { child: ChildProcess | null; url: string } | null = null;

  try {
    console.log("platform-shell-check: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const port = Number(process.env.PLATFORM_SHELL_PORT ?? "3112");
    devServer = await startDevServer(port);

    console.log("platform-shell-check: verify overview tab");
    const overview = await fetchPage(devServer.url);
    assert.match(overview, /aria-label="Primary workspace"/);
    assert.match(overview, /aria-current="page" aria-label="Overview"/);
    assert.match(overview, /href="\/\?tab=intake"/);
    assert.match(overview, /<h2>Role Switcher<\/h2>/);
    assert.doesNotMatch(overview, /<h2>Campaign Controls<\/h2>/);

    console.log("platform-shell-check: verify employee intake tab");
    const employeeToken = createSessionToken({
      roleId: "employee",
      userId: "employee"
    });
    const intake = await fetchPage(`${devServer.url}/?tab=intake`, `${SESSION_COOKIE_NAME}=${employeeToken}`);
    assert.match(intake, /aria-current="page" aria-label="Intake"/);
    assert.match(intake, /<h2>Employee Intake<\/h2>/);
    assert.doesNotMatch(intake, /<h2>Role Switcher<\/h2>/);

    console.log("platform-shell-check: passed");
  } finally {
    await closeDatabase().catch(() => undefined);
    await stopProcessTree(devServer?.child?.pid);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
