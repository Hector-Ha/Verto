<p align="center">
  <img src="public/icon.svg" alt="Verto logo" width="72" height="72" />
</p>

# Verto

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Status: Local MVP demo](https://img.shields.io/badge/Status-Local%20MVP%20demo-0f766e.svg)](#project-status)

Verto is an AI-assisted innovation pipeline for companies that receive more employee ideas than R&D teams can evaluate manually.

The core problem is **quality under overload**: refining vague submissions, preserving meaningful variants, asking for missing context, and routing only review-ready opportunities into R&D decision workflows.

> [!NOTE]
> Verto runs locally as a production-shaped MVP demo: Next.js App Router, Docker Compose MySQL, Drizzle migrations, seeded role switching, real LLM and email adapters, and vertical integration checks for each major workflow slice.

## Contents

- [What Verto Does](#what-verto-does)
- [Implemented MVP Slices](#implemented-mvp-slices)
- [Product Scope](#product-scope)
- [Core Workflows](#core-workflows)
- [Stack](#stack)
- [Getting Started](#getting-started)
- [Verify Locally](#verify-locally)
- [Environment Variables](#environment-variables)
- [Project Status](#project-status)
- [Roadmap](#roadmap)

## What Verto Does

Verto turns raw employee ideas into R&D-ready candidate sets.

- Collects employee ideas through an always-open General Campaign and time-boxed specific campaigns.
- Uses Question Mode to help R&D define campaign intent, review criteria, out-of-scope patterns, and intentional ambiguity.
- Keeps campaign setup in a generated Campaign Knowledge Report so AI decisions stay grounded and auditable.
- Sends focused employee clarification links when an idea lacks critical review information.
- Detects duplicates, related submissions, and meaningful variants without collapsing useful differences too early.
- Routes ideas into Ready for R&D Review, Future Opportunity, Inactive Idea, or Potential Idea outcomes.
- Shows R&D why ideas were ranked, routed, clarified, or grouped.

## Implemented MVP Slices

The current codebase ships the following closed MVP slices:

| Slice | Capability |
| --- | --- |
| Foundation | Next.js app scaffold, Docker Compose MySQL, Drizzle schema, reviewable SQL migrations, seed/reset, smoke check |
| Auth shell | Seeded demo users, signed JWT sessions, role switching, permission checks |
| Campaign lifecycle | Campaign creation, owner assignment, lifecycle gates, team membership |
| Campaign setup | Question Mode, setup blockers/warnings, Campaign Knowledge Report generation and approval |
| LLM adapter | Real GLM-5 calls with blocking retry state and audit-friendly decision logs |
| Employee intake | General Campaign and specific campaign submission, private drafts, lightweight first submit |
| Clarification flow | AI clarification batches, emailed magic links, employee answer pages |
| Clarification lifecycle | 30-day expiry, day-23 reminder job, assumption-based routing after expiry |
| Pre-R&D routing | Campaign fit, review packet readiness, related ideas, out-of-scope checks |
| Idea families | Duplicate/variant detection, family summaries, related idea context |
| R&D review board | Ready-for-R&D packets, rank reasons, owner outcomes, team recommendations |
| General Campaign | Review workspace, future/inactive storage, owner authority, routing rechecks |
| Classification groups | Specific campaign grouping, ranking, 100-group cap enforcement |
| Review digests | Daily specific-campaign and weekly General Campaign in-app digest jobs |
| Campaign end | Non-Potential idea return sweep, ended history, and retrospective proposals |
| Demo operations | Protected controls for time-based jobs, reset/reseed, sweeps, and AI decision logs |

Each slice has a matching `bun run *:check` script where noted in [Verify Locally](#verify-locally).

## Product Scope

Current scope is the **Idea Filter Pipeline**.

Verto helps ideas become clear enough for R&D judgment, then lets R&D select promising ideas as Potential Ideas. Potential Ideas leave the Verto pipeline and are expected to continue into prototyping or other work outside Verto.

Verto does **not** currently manage the full downstream idea-to-product lifecycle after selection.

## Core Workflows

### R&D Campaign Setup

R&D creates a campaign, answers AI-guided setup questions, reviews hard blockers and warnings, and approves the Campaign Knowledge Report before opening intake.

### Employee Idea Intake

Employees submit ideas to one visible destination: an Intake Open specific campaign or the always-visible General Campaign. The initial submission stays lightweight.

### Employee Clarification

When an idea is missing critical information, AI sends one focused clarification batch through an emailed magic link. The MVP uses a 30-day clarification window and one reminder around day 23.

### Pre-R&D Routing

Before R&D spends review time, AI checks campaign fit, minimum review packet completeness, related ideas, variants, out-of-scope patterns, and whether the idea needs clarification.

### R&D Review

R&D reviews generated packets with source traces, rank reasons, variant context, and owner-only outcome decisions. Relevant owners can mark ideas as Potential Ideas or return reviewed ideas to Future Opportunity or Inactive Idea.

### General Campaign And Classification

The General Campaign provides always-on intake plus review and storage views. Specific campaigns add classification groups, ranking, and a 100-group cap so R&D can compare related ideas without losing audit lineage.

## Stack

| Area | Decision |
| --- | --- |
| Framework | Next.js App Router with TypeScript |
| Package manager | bun |
| Database | MySQL through Docker Compose |
| ORM | Drizzle ORM |
| Styling | Plain CSS first |
| Auth | Seeded demo users with role switching |
| Session | Signed JWT in an HTTP-only cookie |
| LLM | Real LLM calls; initial model target: GLM-5 |
| Email | Real provider for clarification links; Pingram preferred |
| Deployment | Local demo first; Vercel portability preferred |

## Getting Started

### Prerequisites

- bun 1.3 or newer
- Docker Desktop with Docker Compose
- GLM-5 provider credentials for AI-driven flows
- Email provider credentials for clarification flows

### Install

```bash
bun install
```

### Start MySQL

```bash
docker compose up -d mysql
```

### Prepare The Database

```bash
bun run db:migrate
bun run db:reset
```

### Run Locally

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Reset Demo Data

```bash
bun run db:reset
```

## Verify Locally

Start with the foundation smoke check:

```bash
bun run smoke
```

The smoke script runs migrations, resets demo data twice, checks deterministic baseline counts, boots Next.js, and verifies the root route renders.

Workflow-specific integration checks:

| Command | Covers |
| --- | --- |
| `bun run auth:check` | Role switching and permission shell |
| `bun run campaign:lifecycle-check` | Campaign creation and lifecycle gates |
| `bun run campaign:setup-check` | Campaign setup Question Mode path |
| `bun run llm:check` | GLM-5 adapter and retry state |
| `bun run employee:intake-check` | Employee intake and private drafts |
| `bun run clarification:check` | Clarification email and magic-link flow |
| `bun run pre-rd:routing-check` | Pre-R&D routing and readiness |
| `bun run idea:family-check` | Variants, duplicates, and idea families |
| `bun run rd-review:board-check` | R&D review board and owner outcomes |
| `bun run general:campaign-check` | General Campaign review workspace |
| `bun run classification:groups-check` | Classification groups, ranking, and cap |
| `bun run review:digest-check` | In-app review digest cadence, access, replacement, and no email/push path |
| `bun run campaign:end-check` | Campaign-end sweep, late clarification routing, ended history, and retrospective proposals |
| `bun run demo:controls-check` | Protected demo controls, reset/reseed, AI log visibility, and campaign-end sweep |
| `bun run demo:browser-smoke` | Playwright browser path for role switch, intake, clarification link, review board, owner outcome, and demo controls |

Demo job triggers for time-based flows:

```bash
bun run clarification:reminders
bun run clarification:expire
bun run review:digest
```

Full real-provider vertical demo smoke:

```bash
bun run demo:vertical-smoke
bun run demo:browser-smoke
```

> [!IMPORTANT]
> `demo:vertical-smoke` and `demo:browser-smoke` use the real LLM and email adapters. Set `NVIDIA_API_KEY` or `LLM_API_KEY`, plus `PINGRAM_API_KEY` or `EMAIL_API_KEY`, before running them. If Chromium is not installed yet, run `bunx playwright install chromium`.

## Environment Variables

Local defaults are safe demo placeholders. Copy `.env.example` to `.env.local` only when overriding them.

```bash
DATABASE_URL=mysql://verto:verto@127.0.0.1:3307/verto
JWT_SECRET=replace-with-local-demo-secret
LLM_API_KEY=replace-with-provider-key
LLM_MODEL=GLM-5
EMAIL_PROVIDER=pingram
EMAIL_API_KEY=replace-with-email-provider-key
APP_BASE_URL=http://localhost:3000
CLARIFICATION_LINK_SECRET=replace-with-local-demo-secret
```

## Project Status

Verto is a runnable local MVP demo with the Idea Filter Pipeline implemented through classification groups, General Campaign review, and R&D review outcomes.

Known out-of-scope MVP items:

- Enterprise SSO
- Complex employee audience targeting
- Employee file uploads
- R&D internal notes
- Separate digest history page
- Full downstream prototype or commercialization tracking
- Postgres migration unless a concrete MVP feature requires it
- A separate Go backend

## Roadmap

1. Harden deployment portability for hosted MySQL and environment configuration.
2. Add production scheduler wiring for the demo job functions.
3. Expand hosted browser smoke coverage when deployment target is chosen.
