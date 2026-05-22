# Verto Handoff

Next session focus: continue from business discovery into screen flow/spec planning for the Verto hackathon MVP.

## Canonical Sources

- `CONTEXT.md`: current domain language and resolved business decisions.
- `docs/QUESTION_MODE_RULES.md`: product-facing rules for Question Mode, derived from the local `$grill-with-docs` skill.
- `docs/REPO_PUBLICATION_POLICY.md`: private/public repository tracking policy.
- `docs/index.html`: readable business overview prototype/reference.
- `docs/research.html`: research notes and cited precedent.
- `docs/agents/*.md`: agent setup metadata.

## Suggested Skills

- `caveman`: required by repo instructions for terse work.
- `grill-with-docs`: use if continuing business/product decision discovery.
- `vercel-react-best-practices`: use if implementing React/Next.js.
- `build-web-apps:frontend-app-builder`: use if building the frontend MVP.

## Current Product

Verto is an AI-assisted innovation pipeline focused on quality under overload. It turns overwhelming employee idea intake into refined, explainable candidate sets for R&D review. Main product story is idea intake/refinement; campaign setup supports ground truth; Global Innovation Context is a supporting capability.

## Key Business Decisions

- Economic buyer: Head of Innovation / R&D leader.
- Champion: R&D Campaign Owner, also called an R&D Team Lead.
- R&D owns employee-facing topics and final decisions.
- R&D Managers own Company Context and Global Innovation Context approvals.
- R&D Campaign Owners own campaign setup, campaign AI question resolution, and Campaign Knowledge Report approval.
- R&D Team Members can answer AI questions and contribute draft changes directly into campaign setup, but those answers stay Pending Owner Approval until the R&D Campaign Owner approves them.
- AI suggests, clarifies, classifies, and explains; it does not replace R&D judgment.
- Employee identity is visible to R&D for collaboration after selection, but must not drive AI evaluation.
- Manager collaboration is real-world workflow after selection, not MVP demo core.

## Core Flows

- R&D campaign interview uses question mode to establish campaign common ground, intentional ambiguity, minimum review packet, out-of-scope patterns, and conflict resolution.
- Question Mode follows the rules in `docs/QUESTION_MODE_RULES.md`: ask one focused question at a time, recommend an answer when possible, challenge unclear terms against the glossary, inspect existing docs before asking, and record resolved decisions.
- Campaign setup prioritizes AI-guided conversation first. R&D can inspect a structured setup view, but stored changes still go through AI interpretation and are reflected in the campaign knowledge report.
- Campaign setup flow currently uses Topic, Intent, Review Packet, Rules & Memory, and Final Review. Publish is not a full setup step; Final Review contains the campaign knowledge report and the one-button open-intake action once hard blockers are resolved.
- Agent question queue is global across the whole campaign setup. It prioritizes setup hard blockers first, then setup warnings, then clarity questions. Non-blocking questions can be skipped or dismissed, but skipped assumptions remain visible in the campaign knowledge report.
- The owner attention queue is the R&D Campaign Owner's review list. It gathers Pending Owner Approval answers, AI-detected conflicts, setup hard blockers, warnings needing owner judgment, and proposed campaign context overrides. When an item is unclear, AI follows up with the R&D Campaign Owner in question mode until the decision is clear enough to record.
- Setup hard blockers prevent opening intake. Setup warnings do not block opening intake and remain visible in the campaign knowledge report.
- Manual/structured setup edits should not trigger live checking while R&D types. AI re-check runs after Save Draft or explicit AI check. AI check results appear inside the agent question queue.
- Campaign knowledge reports are campaign-specific HTML reports of what AI understands and will follow. They are not directly editable; corrections go through AI conversation.
- The R&D Campaign Owner may approve a campaign-only override when Company Context or Global Innovation Context conflicts with campaign intent. The override is recorded in the Campaign Knowledge Report. It does not change Company Context or Global Innovation Context unless the R&D Manager separately approves that broader change.
- Employee idea interview also uses question mode, but only when the idea lacks required detail.
- Employee clarification uses emailed conversation link. MVP uses secure magic link without login as demo simplification; enterprise version should use SSO, directory permissions, link expiry, and audit logging.
- Employee clarification hides internal criteria, scoring, related employee ideas, sensitive out-of-scope names, strategy notes, and Global Innovation Context.
- AI can stop employee interview early if idea clearly matches an R&D-marked out-of-scope pattern.
- Pre-R&D classification happens before R&D review: campaign fit, related variants, parked/out-of-scope/ready/needs-calibration states.
- Post-campaign R&D interview captures what R&D reviewed, advanced, prototyped, commercialized, parked, rejected, or marked out-of-scope, and why.
- Learnings can be campaign-specific, become part of Global Innovation Context, or both; R&D chooses scope.
- Campaign-specific exceptions should normally be considered for Global Innovation Context during the post-campaign R&D interview, not during ordinary live campaign setup.
- If an R&D Campaign Owner wants a campaign exception to become company-wide guidance, AI creates a Global Context Change Proposal for R&D Manager approval instead of changing Company Context or Global Innovation Context directly.
- When Company Context or Global Innovation Context changes, AI runs a Context Impact Check against active Campaign Context. If likely impact exists, active campaign owners may receive non-blocking Context Change Alerts. These are quality-of-life notices only: they do not block intake, require review, or overwrite Campaign Context.
- Company Context is optional reference context. Setup starts with company name, then R&D/admin chooses public web fetch or manual description/uploads. AI generates an HTML report, asks conflict/clarity questions when needed, and the report must be approved by an R&D Manager before use. MVP supports public sources and uploads only. If Company Context is not set up, company reference context is empty.
- Company Context is reference context, not an overwrite rule. If it conflicts with campaign setup, resolve inside AI Q&A and record the campaign-specific decision in the campaign knowledge report. General global idea-intake rules live in the Always-Open Campaign.
- Company Context setup is its own admin flow, linked from Always-Open Campaign setup. Always-Open shows whether Company Context is approved, missing, or needs approval, but does not own Company Context.

## MVP / Demo Notes

- Use Pingram as preferred real email sending service for clarification links unless implementation blocks appear.
- Historical track records can be scripted if useful, not required first demo.
- Company directory and commercialization outcomes can be simulated.
- Demo should show truthful process, not fixed idea counts or forced outcomes.
- Wow moment: vague R&D intent plus messy employee submissions become a documented, explainable candidate set R&D can act on.

## Open Decisions / Next Step

- Continue question-mode decision discovery from campaign setup / company context decisions, one question at a time.
- Screen flow is coherent enough to continue prototyping around Company Context setup and Always-Open Campaign setup.
- After screen flow, define MVP data model and AI workflows.
- Then create implementation spec and build.
