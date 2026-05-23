# ADR 0001: Use Next.js, MySQL, and Drizzle for the MVP app

## Status

Accepted

## Context

Verto's MVP must prove a production-shaped Idea Filter Pipeline, not only a static prototype. The demo needs real role rules, real LLM calls, real clarification email links, auditability, and browser-accessible magic links for employee clarification.

The product also needs a small team to move quickly. The implementation should keep deployment possible later without forcing hosted infrastructure into the first local demo.

## Decision

Build the MVP as a Next.js App Router application with TypeScript, bun, MySQL, and Drizzle ORM.

Use Docker Compose for local MySQL. Keep database migrations reviewable and ordered. Prefer Drizzle-generated SQL migrations that are inspected before use, with a simple SQL migration runner as a fallback if the Drizzle migration workflow blocks progress.

Keep domain writes, role checks, LLM calls, email sends, audit writes, and demo job execution server-side. Client components should handle forms, tabs, role switching, modals, and live interaction only.

Use seeded demo users and role switching with a signed JWT in an HTTP-only cookie for the MVP. Enforce role and membership permissions in server-side operations even though enterprise SSO is deferred.

Use one server-side LLM adapter for GLM-5-targeted real LLM calls. Use one server-side email adapter for clarification notices and reminders, with Pingram preferred unless implementation constraints force a swap.

## Consequences

- The first implementation target is a local demo that can still remain portable to Vercel later.
- MySQL stays the default unless a concrete MVP feature needs Postgres capabilities such as richer JSON querying, full-text search, vector search, or heavier analytics.
- Source truth, AI interpretations, workflow state, and audit truth must be stored separately so R&D can trust lineage.
- State-changing AI decisions must return structured output validated by the app before workflow state changes.
- LLM or email provider changes should be isolated behind adapters rather than spreading provider-specific code through domain logic.
- The MVP should not use Prisma, TypeORM, Sequelize, Ent, Bun ORM, a separate Go backend, blind schema push, or client-owned domain writes.

## Alternatives Considered

- Static prototype only: rejected because clarification links, role authority, audit state, and real LLM failure handling need a real web app boundary.
- Postgres first: deferred because current MVP data is ordinary relational application data, and MySQL is sufficient unless a concrete feature proves otherwise.
- Separate backend service: deferred because Next.js server routes/actions can own the MVP server boundary with less operational overhead.
- Enterprise SSO first: deferred because seeded role switching proves the authority model faster for the hackathon MVP.

