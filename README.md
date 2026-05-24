# Verto

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![Status: MVP scaffold](https://img.shields.io/badge/Status-MVP%20scaffold-0f766e.svg)](#project-status)

Verto is an AI-assisted innovation pipeline for companies that already receive more employee ideas than R&D teams can evaluate manually.

The core problem is **quality under overload**: refining vague submissions, preserving meaningful variants, asking for missing context, and routing only review-ready opportunities into R&D decision workflows.

> [!NOTE]
> Verto now has a runnable local MVP foundation: Next.js App Router, Docker Compose MySQL, Drizzle schema, reviewable migrations, deterministic seed/reset, and a smoke check.

## Contents

- [What Verto Does](#what-verto-does)
- [Product Scope](#product-scope)
- [Core Workflows](#core-workflows)
- [Stack](#stack)
- [Project Status](#project-status)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Roadmap](#roadmap)

## What Verto Does

Verto turns raw employee ideas into R&D-ready candidate sets.

- Collects employee ideas through an always-open General Campaign and time-boxed specific campaigns.
- Uses Question Mode to help R&D define campaign intent, review criteria, out-of-scope patterns, and intentional ambiguity.
- Keeps campaign setup in a generated Campaign Knowledge Report so AI decisions remain grounded and auditable.
- Sends focused employee clarification links when an idea lacks critical review information.
- Detects duplicates, related submissions, and meaningful variants without collapsing useful differences too early.
- Routes ideas into Ready for R&D Review, Future Opportunity, Inactive Idea, or Potential Idea outcomes.
- Shows R&D why ideas were ranked, routed, clarified, or grouped.

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

### Campaign Learning

After a campaign, R&D can run a lightweight retrospective to decide what should remain campaign-specific and what should become reusable Global Innovation Context.

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

## Project Status

Verto has its first runnable application slice in this repository.

Current assets include the local app scaffold, product direction, domain rules, technical MVP planning, and UI prototype notes. The live demo scope is the full documented MVP unless a feature is explicitly marked out of scope.

Known out-of-scope MVP items:

- Enterprise SSO.
- Complex employee audience targeting.
- Employee file uploads.
- R&D internal notes.
- Separate digest history page.
- Full downstream prototype or commercialization tracking.
- Postgres migration unless a concrete MVP feature requires it.
- A separate Go backend.

## Getting Started

### Prerequisites

- bun 1.3 or newer
- Docker Desktop with Docker Compose
- GLM-5 provider credentials for later AI slices
- Email provider credentials for later clarification slices

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

### Verify The Foundation

```bash
bun run smoke
```

The smoke script runs migrations, resets demo data twice, checks deterministic baseline counts, boots Next.js, and verifies the root route renders.

### Reset Demo Data

```bash
bun run db:reset
```

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

## Roadmap

1. Add seeded role switching with signed HTTP-only JWT sessions.
2. Build campaign setup with blockers, warnings, and Campaign Knowledge Report generation.
3. Add the LLM adapter and blocking retry state.
4. Implement General Campaign and specific campaign idea intake.
5. Add clarification email adapter and magic-link clarification pages.
6. Build R&D review board with source trace and owner-only outcome decisions.

