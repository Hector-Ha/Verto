# How To Use Verto

This guide walks through the happy path for the local Verto MVP demo: an employee submits an idea, R&D clarifies and routes it, and an owner records the review outcome.

> [!IMPORTANT]
> The full AI and email path needs real provider keys. Use `NVIDIA_API_KEY` or `LLM_API_KEY`, plus `PINGRAM_API_KEY` or `EMAIL_API_KEY`, when you want to run the real clarification and routing flow.

## 1. Start The Demo

Install dependencies, start MySQL, migrate, seed, and boot the app.

```bash
bun install
docker compose up -d mysql
bun run db:migrate
bun run db:reset
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 2. Know The Workspace

Verto opens as a role-aware workspace with six tabs.

| Tab | Use it for |
| --- | --- |
| Overview | Switch demo persona and confirm permission boundaries |
| Intake | Submit employee ideas, save drafts, and manage General Campaign review packet |
| Review | Inspect clarification batches, review digests, and R&D review packets |
| Campaigns | Create campaigns, move lifecycle gates, and approve setup knowledge |
| Intelligence | Run pre-R&D routing, campaign pull-in, classification, and family grouping |
| Operations | Run demo jobs, reset/reseed data, and inspect AI decision logs |

## 3. Happy Flow

### Step 1: Switch To Employee

1. Open **Overview**.
2. Select **Employee Jordan Kim** in the Role Switcher.
3. Open **Intake**.

Expected result: **Employee Intake** appears with General Campaign and open specific campaign destinations.

### Step 2: Submit An Idea

1. In **Submit idea**, choose **Battery Reuse Ideas**.
2. Enter a short title, description, expected benefit, and evidence example.
3. Select **Submit**.

Expected result: Verto shows a submission confirmation and stores the idea as an employee submission.

### Step 3: Request Clarification

1. Open **Overview**.
2. Switch to **R&D Campaign Owner Sam Rivera**.
3. Open **Review**.
4. In **Employee Clarifications**, find the submitted idea.
5. Select **Ask AI**.

Expected result: Verto creates one clarification batch and sends the employee magic link through the configured email provider.

### Step 4: Answer The Magic Link

1. Open the emailed clarification link.
2. Answer the focused employee questions.
3. Submit the clarification.

Expected result: Verto records the answer and keeps internal R&D labels hidden from the employee page.

### Step 5: Route The Idea

1. Return to the main app as **R&D Campaign Owner Sam Rivera**.
2. Open **Intelligence**.
3. In **Pre-R&D Routing**, find the clarified idea.
4. Select **Route with AI**.

Expected result: Verto routes the idea to **Ready for R&D Review** when the campaign fit and review packet are complete.

### Step 6: Record Review Outcome

1. Open **Review**.
2. In **R&D Review Board**, find the ready packet.
3. Select an outcome, such as **Mark Potential Idea**.
4. Add an optional reason note.
5. Select **Record outcome**.

Expected result: the idea becomes a **Potential Idea** and leaves the Verto idea-filter pipeline.

### Step 7: Inspect Operations

1. Open **Overview**.
2. Switch to **R&D Manager Morgan Lee**.
3. Open **Operations**.
4. Review **AI Decision Log**.
5. Run **Generate digests** if you want a fresh in-app digest.

Expected result: manager-only operations are available, and AI decisions remain auditable.

## 4. Fast Verification Commands

Run these checks when you want to prove the happy path still works.

```bash
bun run smoke
bun run platform:shell-check
bun run auth:check
bun run employee:intake-check
bun run demo:browser-smoke
```

> [!NOTE]
> `demo:browser-smoke` exercises the full browser path and needs real LLM and email keys. If Chromium is missing, run `bunx playwright install chromium`.

## 5. Screenshot Checklist

Use these screenshots for demos, docs, or review handoff.

| Screenshot | Where to capture | What it should show |
| --- | --- | --- |
| Workspace overview | **Overview** as R&D Manager | Role switcher, permission boundary, baseline counts |
| Employee intake | **Intake** as Employee | Submit idea form and destination picker |
| Clarification queue | **Review** as R&D Campaign Owner | Submitted idea available for **Ask AI** |
| Employee magic link | `/clarifications/[token]` | Employee-safe question page with no internal labels |
| Routing workspace | **Intelligence** as R&D Campaign Owner | **Route with AI** action and routing history |
| Review board | **Review** as R&D Campaign Owner | Ready packet and outcome controls |
| Operations log | **Operations** as R&D Manager | AI Decision Log and protected demo jobs |

Recommended capture style:

1. Reset demo data before screenshots: `bun run db:reset`.
2. Use a desktop viewport around `1440 x 1000` so the tabbed workspace is visible.
3. Capture only one workflow step per image.
4. Keep browser URL visible when showing magic-link or tab-specific screenshots.
5. Avoid showing real API keys, email inboxes, or provider dashboards.

## 6. Reset Between Demo Runs

Use either the manager-only **Operations** tab or the CLI.

```bash
bun run db:reset
```

After reset, start again from **Overview** and switch to the persona needed for the next step.
