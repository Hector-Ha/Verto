# Verto Technical MVP Plan

## Goal

Build the hackathon MVP as a simple production-shaped web app, not a throwaway static prototype. The app should prove the core Verto loop with real role rules, real LLM calls, real clarification email links, and auditable idea state changes.

The first target is a local demo. Deployment can be considered later only if it stays easy and does not distract from proving the MVP flow.

## Stack Decision

- Framework: Next.js with TypeScript.
- Database access: Drizzle ORM with MySQL.
- Package manager: bun.
- App model: Next.js App Router.
- Runtime shape: normal web app with Next.js routes/server actions so employee clarification magic links work in a browser.
- Styling: plain CSS first; avoid adding a component system unless implementation speed requires it.
- Server responsibility: domain writes, role checks, LLM calls, email sends, audit writes, and migration execution stay server-side.

## Deployment Portability

- First target remains local demo.
- Keep Vercel deployment possible if it stays easy.
- Next.js is the preferred deployment path for Vercel if deployment becomes useful.
- Deployment later will require a hosted MySQL database and deployed environment variables. Local MySQL is only for local demo.

## Database Decision

- Default MVP database: MySQL.
- MVP environment: local MySQL first, run through Docker Compose.
- Use MySQL when the data model remains ordinary relational app data: users, roles, campaigns, ideas, idea states, clarification links, AI decisions, audit events, and source traces.
- Use Postgres only if implementation needs heavier relational features, stronger JSON/query ergonomics, richer full-text search, vector search, or more complex analytics during the MVP.
- Do not introduce Postgres just because it is more powerful. Keep MySQL unless a concrete MVP feature needs Postgres.

## Local Infrastructure

- Use Docker Compose for local MySQL.
- Keep database setup repeatable for future agents and demo resets.
- Next.js app should run locally with bun and connect to the Docker Compose database through `DATABASE_URL`.
- Seed/reset scripts should assume the Docker Compose database is available.

## Data Access

- Use Drizzle ORM for TypeScript application queries and model mapping.
- Use Drizzle Kit to generate SQL migration files when useful, but inspect and commit the generated SQL before applying it.
- Prefer reviewed SQL migration files over `drizzle-kit push` for schema changes.
- Do not use blind automatic schema push as the source of demo truth.
- If Drizzle migration workflow becomes awkward, fall back to a tiny SQL migration runner with a `schema_migrations` table while keeping Drizzle for typed queries.
- Do not use Prisma, TypeORM, Sequelize, Ent, or Bun ORM for the MVP.
- Keep database writes server-side only.
- Record immutable source material separately from AI-generated interpretations.
- Store audit events for authority-sensitive changes: campaign gate changes, owner approvals, idea routing changes, clarification sends/answers, context changes, AI retries, and review outcomes.
- Provide a reset/seed command so the local demo can be repeated quickly.

## Server Boundary

- MVP server: Next.js server routes/actions.
- Next.js owns role/session checks, domain operations, background/demo triggers, LLM calls, email sends, audit writes, and migration scripts.
- Client components should call server actions or API routes rather than owning domain writes directly.
- Keep domain logic in server-side modules, not React components.

## Auth And Role Switching

- MVP uses seeded demo users and role switching, not enterprise SSO.
- Role switching should issue a signed JWT for the selected seeded user.
- Store the JWT in an HTTP-only cookie for browser flows.
- The Next.js server validates the JWT and enforces permissions on every write route and authority-sensitive read route.
- JWT claims should include user ID, role, and expiry. Role-specific campaign authority should still be checked against database membership/ownership where relevant.
- Use `JWT_SECRET` locally and in any deployed environment.
- This is a demo auth mechanism. Real SSO and enterprise identity controls are deferred.

## State And Audit Truth

Verto needs to separate what happened from what AI or R&D thinks about it.

- Source truth: original employee submission, clarification answer, R&D-approved campaign setup, and owner review decisions.
- AI interpretation: summaries, classifications, rank reasons, suggested routing, and explanations.
- Workflow state: where the idea is now, such as Needs Employee Clarification, Ready for R&D Review, Future Opportunity, Inactive Idea, or Potential Idea.
- Audit truth: who or what changed state, when it changed, what source/context version was used, and why.

This matters because R&D must be able to trust lineage during the demo. AI can interpret source material, but it should not overwrite the source.

## Core MVP Modules

- Role switching: seeded demo users for R&D Manager, General Campaign Owner, Specific Campaign Owner, R&D Team Member, and Employee.
- Campaign setup: AI question mode, manual/structured setup view, setup blockers, warnings, and generated Campaign Knowledge Report.
- Employee intake: General Campaign always visible; specific campaigns visible only when Intake Open.
- Clarification flow: AI-created clarification batch, emailed magic link, 30-day expiry, day-23 reminder, expired read-only page.
- Idea routing: Ready for R&D Review, Needs Employee Clarification, Future Opportunity, Inactive Idea, Potential Idea, and campaign-end sweep.
- General Campaign: owner authority, minimum review packet, direct review, idea ranking, future/inactive storage, pull-in to specific campaigns, rechecks, and classification cap audit.
- R&D review: review packets, source trace, AI rank reasons, owner-only outcome decisions, optional reason notes.
- Demo AI decision log: developer/demo-only record for important explanations that have no product UI surface.

## LLM Integration

- All MVP AI behavior must use real LLM calls.
- Initial MVP model target: GLM-5.
- LLM provider and API access details can be finalized during implementation as long as the app uses real LLM calls and no fake decision fallback.
- Create one server-side LLM adapter used by campaign setup, clarification generation, summaries, ranking, routing, rechecks, and context impact checks.
- No scripted fallback decisions.
- On LLM failure, show a blocking retry state for that AI step and leave existing data unchanged until retry succeeds.
- Store prompt purpose, model, input references, output summary, decision result, and failure/retry status in audit or demo decision logs.
- Conversation text may stream freely when AI is talking with R&D or an employee.
- State-changing AI decisions must return structured output validated by the app before any workflow state changes.
- Invalid or incomplete structured output should become a blocking retry state, not a partial state update.
- Store raw LLM response plus parsed structured decision when the AI result affects routing, ranking, clarification, recheck, duplicate/variant handling, or review readiness.

## Email Integration

- Use a real email provider for employee clarification links.
- Preferred provider: Pingram, unless implementation constraints force a change.
- Keep provider behind a server-side email adapter so provider swap does not touch business flow code.
- MVP email scope: clarification send and one reminder. No R&D owner email digests.
- Concrete provider credentials, sender details, and test recipient setup should be handled when implementation reaches email integration.

## Demo Operations

The MVP should include scripts or admin/demo actions to trigger time-based and background operations without waiting in real time.

- Send clarification reminder.
- Expire clarification links.
- Run campaign scheduled open/close.
- Run General Campaign recheck.
- Run in-app digest generation.
- Run campaign-end sweep.
- Reset and reseed demo data.

These triggers are for local demo control. They should call the same server logic as scheduled jobs would use later.

Demo operation architecture:

- Implement each operation as a server-side job function in shared modules.
- Expose local commands through `bun run demo:*` scripts.
- Expose protected admin/demo routes or buttons for live demo control when useful.
- Do not build a real scheduler for the first MVP.
- Later deployment can call the same job functions from Vercel Cron or another scheduler.

## Next.js Implementation Rules

- Fetch data in server components or server functions where possible.
- Avoid client-side request waterfalls; start independent server work in parallel.
- Keep business operations behind server actions/API routes, not in frontend code.
- Authenticate and authorize every write route, even with seeded role switching.
- Keep LLM, email, and database clients server-only.
- Use explicit transactions for state changes that write source, workflow state, and audit records together.
- Keep SQL migrations reviewable and ordered.
- Keep demo scripts calling the same service functions as server/admin actions where practical.
- Return compact view models to the frontend instead of exposing whole source/audit records by default.
- Keep route handlers thin: parse request, authorize, call service, return response.
- Use client components only for forms, tabs, role switcher, modals, and live interaction.

## Environment Variables

- `DATABASE_URL`
- `JWT_SECRET`
- `LLM_API_KEY`
- `LLM_MODEL` (default target: `GLM-5`)
- `EMAIL_PROVIDER`
- `EMAIL_API_KEY`
- `APP_BASE_URL`
- `CLARIFICATION_LINK_SECRET`

## First Implementation Slice

1. Scaffold Next.js TypeScript app with Drizzle, Docker Compose MySQL, and reviewable SQL migrations.
2. Add database schema and seed demo roles/users.
3. Add role switcher/session mechanism and server permission checks.
4. Implement campaign setup shell/API with hard blocker/warning model.
5. Add real LLM adapter and blocking retry state.
6. Add employee idea submission to General Campaign and one specific Intake Open campaign.
7. Add clarification email adapter and magic-link clarification page.
8. Add R&D review board with source trace and owner-only outcome decisions.

This slice starts after the business and technical docs are settled enough to build from.

## Deferred

- Enterprise SSO.
- Complex audience targeting.
- Employee file uploads.
- R&D internal notes.
- Separate digest history page.
- Full downstream prototype/commercialization tracking.
- Postgres migration unless a concrete MVP feature makes MySQL insufficient.
- Go backend unless the project later needs a separate compiled service.
