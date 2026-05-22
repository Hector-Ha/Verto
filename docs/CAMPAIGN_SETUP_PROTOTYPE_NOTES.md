# Campaign Setup Prototype Notes

Question: what screen flow should R&D use to set up a campaign before employee ideas are evaluated?

Prototype location: `docs/campaign-setup-prototype.html?variant=A`

Variants:

- A: Modern balanced overview. Best if dashboard should mix C's stats clarity with A's section coverage while reducing clutter through a hero summary, compact tiles, and quieter panels.
- B: Attention first. Best if dashboard should lead with the top three blockers, then stats and work entry points.
- C: Stats first. Best if dashboard should feel more like pipeline health reporting, with urgent actions in a separate band.

Pending verdict:

- Chosen direction: Variant A, dashboard overview. Keep SaaS overview shell and campaign setup as a primary workflow inside broader innovation pipeline context.
- Useful pieces from other variants:
- Business-flow decisions discovered:
  - Equipment constraint needs R&D policy: hard out-of-scope for current campaign, parked for future capital planning, or ask employee for a no-equipment variant first.
  - Overview dashboard should not be a work surface. It should show stats, quick links, and attention-routing items. Most work should happen after clicking into the relevant screen. Only extremely urgent actions belong directly on the dashboard, and those should require one or two clicks.
  - Overview dashboard sections: Stats Overview, Needs Attention, and Active Campaigns. Quick Links are unresolved. Recent Activity should be removed for now. Avoid embedded interviews, textareas, and setup editors on the dashboard.
  - Needs Attention should show only pipeline-blocking or time-sensitive R&D judgment items: blocked campaign setup, ready ideas waiting past threshold, stalled or expiring employee clarifications, context conflicts affecting classification, out-of-scope patterns needing confirmation, or many needs-clarification ideas suggesting packet calibration problems. Cap dashboard attention items at three, ordered by urgency.
  - Stats Overview should show Active Campaigns, Ideas In Pipeline, Ready For R&D, Needs Clarification, and Blocked By R&D. The Blocked By R&D stat should read as more alert-like than the other four.
  - Quick Links are unresolved and may not be needed. Do not treat them as mandatory dashboard content yet.
  - Active Campaigns should be compact campaign status only: show 3-5 campaigns max, each with campaign name, status, and one meaningful signal such as blocked state, ready idea count, clarification volume, or review aging. Clicking the campaign opens campaign detail. Avoid campaign management tables and inline controls on dashboard.
  - Recent Activity should not appear on the dashboard for now. R&D does not need a feed of how AI and employees work together. If needed, dashboard should show engagement signals and final outcomes instead, such as ideas AI promoted, high-ranking candidate packets, or review-ready outcomes.
- Outcome Summary should not appear on the overview dashboard for now. Aggregating outcomes across many campaigns may be misleading or unnecessary. Do not add sections just to fill space.
- Clicking a blocked campaign setup item from Needs Attention should open Campaign Detail > Setup tab, focused directly on unresolved R&D questions. Dashboard routes to the work screen; it does not solve setup inline.
- Campaign Detail > Setup tab currently means an existing draft campaign that needs completion before employee intake opens. The same flow can support a brand-new campaign, but new campaign starts empty while existing draft starts with known context and unresolved questions.

Campaign setup screen direction: continue from checklist-first direction. Show setup structure before asking R&D to act.

Campaign setup screen prototype variants:

- A: Focus panel. Checklist remains visible while current blocked item is prominent.
- B: Three-column. Preferred current direction. Dense operator layout with stages, current setup content, and open questions. Add the blocked-question section from Variant A, but present answers in an application-style agent question panel similar to Codex: question header, selectable answer choices, progress footer, Auto-answer, and Next.
  - Refinements: employee preview should be a button that opens a preview, not an always-visible panel. Replace Open Questions with Blockers Queue when multiple questions matter. Replace editable textareas with read-only summaries plus Edit buttons so setup feels less form-heavy.
- Current component set for all campaign setup variants: hero, setup stages, current stage summary, Preview employee view button, agent question panel, and Blockers Queue.
- Layout experiment variants now keep the same component set and only change structure:
  - A: Two-column. Setup context on left, decisions on right.
  - B: Three-column. Stages, current stage, and decisions all visible at once.
  - C: Tabs. Chosen current direction. Setup categories as tabs, active tab contains all decision components.
  - D: Board. Each component becomes a board lane.
  - E: Matrix. Table-first scan with full components below for action.
- Preview employee view should open a modal later, not render inline on the setup screen.
- Setup flow page prototype created with 5 pages: Topic, Intent, Review Packet, Rules & Memory, Publish. Each page keeps the same shell, setup flow navigation, and agent-question pattern so R&D can compare the basic flow before choosing exact UI.
- Agent question panel should sit full-width near the top, above the Topic/Intent/Review Packet/Rules & Memory/Publish tabs, so R&D can answer quickly before browsing setup details.
- Information-only panels such as Submission Visibility, What AI Will Use, AI Behavior, and Memory Scope are not useful enough as standalone dashboard/setup sections. Remove them unless they become editable decisions, preview context, or direct consequences of an R&D answer.
- Campaign setup should prioritize AI setup first. R&D uses a question-mode chatbox to fill required information and dive deeper into campaign settings, then can switch to Manual setup when direct field editing is faster.
- Manual setup should use real text fields and textareas for human-set fields such as campaign name, employee prompt, internal intent, and review packet details.
- Publish is no longer a full setup step. Replace it with Final Review: a knowledge report view showing what AI knows and will follow for the campaign, plus a one-button Open intake action after blockers clear.
- R&D can open intake when warnings remain, as long as hard blockers are resolved. Hard blockers stop launch. Warnings stay visible in Final Review / Knowledge Report but do not block Open intake.
- Manual setup edits should trigger AI re-check, but not while R&D is typing. AI re-check runs only after Save Draft or when R&D explicitly clicks a manual AI check button. If R&D leaves with unsaved manual changes, show a modal asking whether to save draft. If R&D chooses not to save, discard unsaved progress and do not run AI check.
- After AI checks saved manual edits, conflicts become hard blockers only when they affect launch correctness. Otherwise they are warnings. R&D can accept AI fix, edit manually, or mark conflict as intentional ambiguity. Intentional ambiguity is recorded in the Knowledge Report. Hard blockers must be resolved before Open intake.
- Do not show an explicit Leave page button in setup. Normal navigation can trigger unsaved-change handling later.
- AI check results should appear inside the Agent has questions for you chatbox, not as a separate standalone conflict panel. The agent question queue should prioritize blockers first, then warnings, then clarity questions. It can stockpile questions and let R&D answer them in order, lightly bypassing strict one-question-at-a-time when batching setup questions is more efficient.
- Agent question queue is global for the whole campaign setup, not scoped only to the current tab. It should prioritize all setup blockers across the campaign and show which setup area each question belongs to. Answering a question may move R&D to the relevant tab if needed.
- After R&D answers a global queue question from another setup area, automatic tab switching is not required. It may be nice to offer a link to view the affected tab, but it is optional.
- R&D can skip or ignore non-blocking questions in the global agent queue. Hard blockers cannot be skipped if R&D wants to open intake. Warnings can be dismissed, deferred, or marked not relevant. Clarity questions can be skipped if R&D accepts lower AI confidence. Skipped or dismissed items should appear in Knowledge Report under known unresolved assumptions.
- Knowledge Report should not allow direct editing. Since setup changes are primarily made through AI chat, corrections to report content should route through AI chat as well. The report is generated from setup state, not a separate editable source of truth.
- Manual setup should exist but be reframed as a structured view. It shows campaign fields in a form-like layout for scanning, but changes that should be stored still go through AI chat. The HTML Knowledge Report is the AI-readable/human-readable campaign knowledge store, similar in role to `CONTEXT.md` but presented as HTML so humans can review it more comfortably than a wall of text.
- Campaign HTML Knowledge Report is campaign-specific only. Global memory is plugged into setup as context, not written from ordinary campaign setup. Global rules should live in the Always-Open Campaign, which accepts any idea.
- Always-Open Campaign should use the same setup structure but with lighter requirements. It accepts any idea, routes and preserves context, and should allow R&D/admins to plug in information about the company.
- Company Context setup starts with company name. Then R&D/admin chooses whether AI should fetch public information online or whether they prefer to add company context themselves. Manual add path should provide a long description field plus upload option. AI then creates an HTML report of what it understands about the company. During report generation, AI may ask conflict or clarity questions. If R&D answers, incorporate the answer. If not, accept the report as-is and mark unresolved conflicts/clarity gaps in the report.
- Company Context MVP should only support public web sources and R&D/admin uploads. Authenticated/internal integrations are out of scope for now.
- Generated Company Context HTML report must be approved by R&D/admin before it becomes usable campaign context. Company Context setup is optional. If not set up, global rule/context is empty.
- Company Context setup/approval should go through an R&D Manager. One-time limited access may let another person contribute information, but final approval belongs to the R&D Manager.
- Company Context is reference context, not an overwrite rule. Campaign owners do not need a separate workflow to request global context changes during live campaign setup. If Company Context conflicts with campaign setup, handle the conflict inside the AI Q&A session and record the campaign-specific decision in the campaign Knowledge Report. Campaign-specific exceptions should usually become Global Context Change Proposals during the post-campaign retrospective.
- When Company Context conflicts with campaign intent, AI should ask in the Agent Q&A and default to a campaign-specific decision for that campaign. Company Context informs, campaign setup governs the current campaign, Always-Open governs general intake, and conflict resolution is recorded in the campaign Knowledge Report.
- Company Context setup should be its own admin flow, linked from Always-Open Campaign setup. Always-Open Campaign should show Company Context state such as approved, missing, or needs approval, but should not own Company Context.
- R&D Manager can start Company Context setup directly. Others can start or contribute to a draft only with limited access. Limited contributors may add descriptions, upload docs, or answer assigned AI questions, but cannot approve or make Company Context usable.
- C: Tabs. Setup categories are tabs with blocked questions beside the active tab.
- D: Board. Setup categories are lanes showing unresolved work at once.
- E: Matrix. Fast-scanning table with setup area, status, issue, and action.
