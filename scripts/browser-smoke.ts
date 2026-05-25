import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";

import { closeDatabase, db } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import {
  clarificationRequests,
  ideaReviewOutcomes,
  ideas,
  ideaStateHistory,
  reviewDigests
} from "../src/server/db/schema";
import { getClarificationLinkSecret } from "../src/server/env";
import { resetAndSeedDemoData } from "../src/server/seed/reset";

const execFileAsync = promisify(execFile);
const ideaTitle = `Browser smoke packaging loop ${Date.now()}`;

function requireRealProviderEnv() {
  const llmKey = process.env.NVIDIA_API_KEY ?? process.env.LLM_API_KEY;
  const emailKey = process.env.PINGRAM_API_KEY ?? process.env.EMAIL_API_KEY;

  if (!llmKey || llmKey.startsWith("replace-with")) {
    throw new Error("demo:browser-smoke requires NVIDIA_API_KEY or LLM_API_KEY for real AI decisions.");
  }
  if (!emailKey || emailKey.startsWith("replace-with")) {
    throw new Error("demo:browser-smoke requires PINGRAM_API_KEY or EMAIL_API_KEY for real clarification email.");
  }
}

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
    return response.ok && body.includes("Verto demo baseline") && body.includes("Role Switcher");
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

  for (let attempt = 0; attempt < 120; attempt += 1) {
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
  throw new Error(`Next.js root did not render expected demo shell. Server output:\n${output}`);
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL,
      headless: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playwright Chromium failed to launch.";
    throw new Error(`${message}\nRun: bunx playwright install chromium`);
  }
}

async function clickRole(page: Page, accessibleName: string) {
  const roleButton = page.getByRole("button", { name: accessibleName });
  if ((await roleButton.count()) === 0) {
    await page.getByRole("link", { name: "Overview" }).click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  }
  await expect(roleButton).toBeVisible({ timeout: 30_000 });
  if (await roleButton.isDisabled()) {
    return;
  }

  await roleButton.click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
}

async function openWorkspaceTab(page: Page, name: string) {
  await page.getByRole("link", { name }).click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
}

async function readIdeaIdByTitle(title: string) {
  const [idea] = await db
    .select({ id: ideas.id })
    .from(ideas)
    .where(eq(ideas.title, title))
    .orderBy(desc(ideas.createdAt))
    .limit(1);

  assert(idea, `idea ${title} exists after browser intake`);
  return idea.id;
}

function createMagicToken(requestId: string) {
  const signature = crypto.createHmac("sha256", getClarificationLinkSecret()).update(requestId).digest("base64url");

  return `${requestId}.${signature}`;
}

async function readClarificationToken(ideaId: string) {
  const [request] = await db
    .select({ id: clarificationRequests.id })
    .from(clarificationRequests)
    .where(eq(clarificationRequests.ideaId, ideaId))
    .orderBy(desc(clarificationRequests.createdAt))
    .limit(1);

  assert(request, `clarification request exists for ${ideaId}`);
  return createMagicToken(request.id);
}

async function readCurrentIdeaState(ideaId: string) {
  const [state] = await db
    .select({ workflowState: ideaStateHistory.workflowState })
    .from(ideaStateHistory)
    .where(and(eq(ideaStateHistory.ideaId, ideaId), eq(ideaStateHistory.isCurrent, true)))
    .limit(1);

  return state?.workflowState ?? null;
}

async function assertDigestGenerated() {
  const [digest] = await db.select({ id: reviewDigests.id }).from(reviewDigests).limit(1);
  assert(digest, "demo digest control generated at least one digest");
}

async function assertOutcomeRecorded(ideaId: string) {
  const [outcome] = await db
    .select({ outcome: ideaReviewOutcomes.outcome })
    .from(ideaReviewOutcomes)
    .where(eq(ideaReviewOutcomes.ideaId, ideaId))
    .limit(1);

  assert.equal(outcome?.outcome, "potential_idea");
  assert.equal(await readCurrentIdeaState(ideaId), "potential_idea");
}

async function submitIdeaThroughBrowser(page: Page) {
  await clickRole(page, "Employee Jordan Kim");
  await openWorkspaceTab(page, "Intake");
  await expect(page.getByRole("heading", { name: "Employee Intake" })).toBeVisible({ timeout: 30_000 });

  const intake = page.locator("section.intake-panel");
  const submitForm = intake.locator("form.control-form", { has: page.getByRole("heading", { name: "Submit idea" }) });
  await submitForm.locator('select[name="campaignId"]').selectOption("specific-campaign");
  await submitForm.locator('input[name="title"]').fill(ideaTitle);
  await submitForm
    .locator('textarea[name="originalText"]')
    .fill("Reusable totes could reduce one-way packaging between assembly cells, but the first pilot cell needs confirmation.");
  await submitForm.locator('textarea[name="problemOpportunity"]').fill("One-way packaging piles up during internal cell transfers.");
  await submitForm.locator('textarea[name="expectedBenefit"]').fill("Less packaging waste and fewer line-side disposal trips.");
  await submitForm.locator('textarea[name="evidenceExample"]').fill("Assembly cell A already stages returnable dunnage weekly.");
  await submitForm.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText(`${ideaTitle} was submitted as`)).toBeVisible({ timeout: 30_000 });

  return readIdeaIdByTitle(ideaTitle);
}

async function requestClarificationThroughBrowser(page: Page, ideaId: string) {
  await clickRole(page, "R&D Campaign Owner Sam Rivera");
  await openWorkspaceTab(page, "Review");
  await expect(page.getByRole("heading", { name: "Employee Clarifications" })).toBeVisible({ timeout: 30_000 });

  const clarificationCard = page
    .locator("article.campaign-control", { hasText: ideaTitle })
    .filter({ has: page.getByRole("button", { name: "Ask AI" }) });
  await expect(clarificationCard).toBeVisible({ timeout: 30_000 });
  await clarificationCard.getByRole("button", { name: "Ask AI" }).click({ timeout: 240_000 });
  await page.waitForLoadState("networkidle", { timeout: 240_000 }).catch(() => undefined);
  await expect(page.locator(`[id="clarification-idea-${ideaId}"]`)).toBeVisible({ timeout: 30_000 });
}

async function answerMagicLinkThroughBrowser(page: Page, serverUrl: string, ideaId: string) {
  const token = await readClarificationToken(ideaId);
  await page.goto(`${serverUrl}/clarifications/${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: "Idea clarification" })).toBeVisible({ timeout: 30_000 });
  await page.locator('textarea[name="answerText"]').fill(
    "Assembly cell A should be the first pilot area because operators already collect returnable dunnage there every Friday."
  );
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(page.getByText("Answer received")).toBeVisible({ timeout: 30_000 });
}

async function routeAndRecordOutcomeThroughBrowser(page: Page, serverUrl: string, ideaId: string) {
  await page.goto(serverUrl);
  await clickRole(page, "R&D Campaign Owner Sam Rivera");
  await openWorkspaceTab(page, "Intelligence");
  await expect(page.getByRole("heading", { name: "Pre-R&D Routing" })).toBeVisible({ timeout: 30_000 });

  const routingCard = page
    .locator("article.campaign-control", { hasText: ideaTitle })
    .filter({ has: page.getByRole("button", { name: "Route with AI" }) });
  await expect(routingCard).toBeVisible({ timeout: 30_000 });
  await routingCard.getByRole("button", { name: "Route with AI" }).click({ timeout: 240_000 });
  await page.waitForLoadState("networkidle", { timeout: 240_000 }).catch(() => undefined);

  await openWorkspaceTab(page, "Review");
  const reviewCard = page.locator(`[id="review-idea-${ideaId}"]`);
  await expect(reviewCard).toBeVisible({ timeout: 30_000 });
  await reviewCard.locator('input[name="reasonNote"]').fill("Browser smoke owner decision after employee clarification.");
  await reviewCard.getByRole("button", { name: "Record outcome" }).click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await assertOutcomeRecorded(ideaId);
}

async function runDemoControlThroughBrowser(page: Page, serverUrl: string) {
  await page.goto(serverUrl);
  await clickRole(page, "R&D Manager Morgan Lee");
  await openWorkspaceTab(page, "Operations");
  await expect(page.getByRole("heading", { name: "Demo Operations" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "AI Decision Log" })).toBeVisible({ timeout: 30_000 });

  const digestControl = page
    .locator("article.campaign-control", { hasText: "Generate digests" })
    .filter({ has: page.getByRole("button", { name: "Run" }) });
  await expect(digestControl).toBeVisible({ timeout: 30_000 });
  await digestControl.getByRole("button", { name: "Run" }).click();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await assertDigestGenerated();
}

async function main() {
  let browser: Browser | null = null;
  let devServer: { child: ChildProcess | null; url: string } | null = null;

  try {
    requireRealProviderEnv();

    console.log("browser-smoke: migrate and reset");
    await runMigrations();
    await resetAndSeedDemoData();

    const port = Number(process.env.BROWSER_SMOKE_PORT ?? "3110");
    devServer = await startDevServer(port);
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(30_000);

    console.log("browser-smoke: role switch and employee intake");
    await page.goto(devServer.url);
    const ideaId = await submitIdeaThroughBrowser(page);

    console.log("browser-smoke: owner requests clarification");
    await requestClarificationThroughBrowser(page, ideaId);

    console.log("browser-smoke: employee magic link answer");
    await answerMagicLinkThroughBrowser(page, devServer.url, ideaId);

    console.log("browser-smoke: route review board and owner decision");
    await routeAndRecordOutcomeThroughBrowser(page, devServer.url, ideaId);

    console.log("browser-smoke: protected demo controls and AI log");
    await runDemoControlThroughBrowser(page, devServer.url);

    console.log("browser-smoke: passed");
  } finally {
    await browser?.close().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
    await stopProcessTree(devServer?.child?.pid);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
