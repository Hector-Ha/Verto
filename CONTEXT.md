# Verto Context

## Domain Summary

Verto is an AI-assisted innovation pipeline for companies that collect more employee ideas than R&D teams can evaluate manually. The core business problem is quality under overload, not low engagement.

The product is not only a ticket queue. It is an idea refinery that helps R&D teams define campaign context, collect employee ideas, clarify vague submissions, preserve meaningful variants, and route refined opportunities toward review. The economic buyer is the Head of Innovation or R&D leader, and the internal champion is the R&D Campaign Owner.

The product name is Verto, from Latin-style language meaning transformation or turning. The name reflects transforming raw employee ideas into R&D-ready candidate sets.

Verto's center of gravity is idea intake and refinement. Campaign setup support is important because it gives AI evaluation ground truth, while Global Innovation Context is a supporting capability rather than the main product story.

## Canonical Terms

### Campaign

A campaign is an active or long-running innovation theme owned by R&D. It gives the system enough business context to route and evaluate ideas. A campaign may be lightweight, incomplete, intentionally vague, evolving, or fully detailed when the business need requires precision.

### Always-Open Campaign

An always-open campaign is a long-term, indefinite campaign that receives general employee ideas outside time-boxed R&D requests. Ideas submitted here have lower priority until R&D connects them to a current campaign or business need. The always-open campaign is also where general global idea-intake rules should live because it accepts any idea; ordinary campaign setup remains campaign-specific.

### R&D Manager

An R&D Manager is the authority for Company Context and Global Innovation Context. The R&D Manager can publish those contexts directly, approve or reject proposed changes from R&D members, and decide whether a campaign-specific learning should become reusable company-wide guidance.

### R&D Campaign Owner

An R&D Campaign Owner, also called an R&D Team Lead, is the authority for a specific campaign. The R&D Campaign Owner owns campaign setup, resolves campaign-specific AI questions, approves the Campaign Knowledge Report, and decides whether campaign intake can open.

### R&D Team Member

An R&D Team Member contributes campaign knowledge, evidence, answers, and proposed context changes. An R&D Team Member can help build drafts, but needs approval from the relevant authority before their changes become AI-usable context.

### Pending Owner Approval

Pending owner approval is the state for a campaign setup answer, context edit, or supporting evidence contributed by an R&D Team Member before the R&D Campaign Owner approves it. Pending owner approval content can shape a draft and be reviewed by AI for conflicts, but it is not AI-usable campaign ground truth until the R&D Campaign Owner approves it.

### Question Mode

Question mode is the AI-guided interaction pattern for resolving unclear context. AI asks one focused question at a time, explains why the answer matters, recommends a default answer when possible, follows up when the answer is vague or conflicting, and records the resolved decision.

### R&D Campaign Interview

The R&D campaign interview is an AI-guided discussion with R&D that establishes common ground for a campaign. It uses question mode to resolve ambiguity, explore unknown unknowns, and record decisions. The interview confirms whether campaign language should stay broad or become explicit, defines the campaign-specific minimum review packet, and gives AI enough documented ground truth to evaluate employee ideas.

### Campaign Setup

Campaign setup is the R&D-owned flow for creating or completing the ground truth AI will use to evaluate employee ideas for a campaign. Setup prioritizes AI-guided conversation, but R&D may inspect the same information through a structured view. Stored setup decisions must go through AI interpretation and end in a campaign-specific knowledge report.

### Agent Question Queue

The agent question queue is the global list of campaign setup questions AI asks R&D during setup. It is not limited to the current setup area. Questions are prioritized by launch impact: hard blockers first, then warnings, then clarity questions. R&D may skip or dismiss non-blocking questions, but unresolved assumptions must remain visible in the campaign knowledge report.

### Owner Attention Queue

The owner attention queue is the R&D Campaign Owner's review list for a campaign. It contains pending owner approval items, AI-detected conflicts, setup hard blockers, warnings that need owner judgment, and proposed campaign context overrides. It helps the R&D Campaign Owner approve, reject, edit, or escalate draft changes before they become AI-usable campaign ground truth. When an item is unclear, AI should use question mode to follow up with the R&D Campaign Owner until the decision is clear enough to record.

### Setup Hard Blocker

A setup hard blocker is an unresolved setup issue that prevents R&D from opening employee intake because AI cannot safely or coherently apply the campaign ground truth. Hard blockers must be resolved before intake opens.

### Setup Warning

A setup warning is an unresolved issue that may reduce AI confidence or require caution but does not prevent R&D from opening intake. Warnings stay visible in the campaign knowledge report.

### Structured Setup View

The structured setup view is a form-like way for R&D to inspect campaign setup fields such as topic, intent, review packet, and rules. It is not a separate source of truth. Changes that should be stored still go through AI conversation and are reflected in the campaign knowledge report.

### Campaign Knowledge Report

A campaign knowledge report is the campaign-specific HTML report of what AI understands and will follow for that campaign. It is similar in role to a context document, but presented in a human-readable format so R&D can review it without reading a raw wall of text. The report is generated from setup state and should not be edited directly; corrections go through AI conversation.

### Campaign Context Override

A campaign context override is a campaign-specific decision that intentionally differs from Company Context or Global Innovation Context. The R&D Campaign Owner can approve an override for their campaign, and the override must be recorded in the Campaign Knowledge Report. A campaign context override does not change Company Context or Global Innovation Context unless the R&D Manager separately approves that broader change.

### Employee Idea Interview

The employee idea interview is an AI-guided discussion with the idea submitter before R&D review. It uses question mode to ask focused follow-up questions, clarify vague claims, and produce a more complete idea packet. The interview is opened only when more detail is needed, usually through an emailed link to a conversation preloaded with the relevant campaign docs, related idea context, and evaluation rules. The interaction should feel like a focused one-on-one clarification with a manager, not a public status workflow. The interview should stop early when the system has enough documented evidence to classify the idea as matching an R&D-marked out-of-scope pattern.

### Intentional Ambiguity

Intentional ambiguity is campaign vagueness R&D has confirmed on purpose. It is allowed, but it must be documented so AI evaluation does not treat it as missing information.

### Idea Variant

An idea variant is an idea that shares a similar core need with another idea but differs in a way that may affect customer value, feasibility, cost, risk, supply, operations, or positioning. Variants should not be merged as duplicates without R&D review.

### Parked Opportunity

A parked opportunity is an idea that may be valuable but does not currently fit an active campaign. It remains available for future campaigns instead of being rejected.

### R&D-Out-of-Scope Pattern

An R&D-out-of-scope pattern is a documented rejection pattern or rule created by R&D. If a submitted idea clearly matches one of these patterns, AI can classify it as R&D-out-of-scope without continuing the employee interview.

### Pre-R&D Classification

Pre-R&D classification is the AI step that happens before an idea is presented to R&D. It assigns the idea to a campaign, identifies related ideas and variants, checks documented out-of-scope patterns, and decides whether the idea is ready for review or needs more employee clarification.

### Minimum Review Packet

A minimum review packet is the campaign-specific set of information an idea must contain before R&D reviews it. It is defined during the R&D campaign interview, not hardcoded globally. AI uses the minimum review packet to decide whether an employee idea needs a clarification interview.

### R&D Track Record

An R&D track record is historical evidence from prior campaigns, selected ideas, rejected ideas, parked ideas, and final campaign outcomes. When R&D cannot define enough campaign ground truth up front, AI should ask for relevant track records, synthesize patterns, and continue the R&D campaign interview until common ground exists.

### Campaign Learning Loop

The campaign learning loop uses R&D's end-of-campaign selections and decisions to improve future campaign setup. The system suggests potential ideas, but R&D decides which ideas to review, prototype, commercialize, park, reject, or mark out of scope. After each campaign, AI should summarize what R&D did with the ideas, run a post-campaign R&D interview when needed, and revise future campaign interviews and minimum review packet suggestions from that evidence. Campaign-specific exceptions should normally be considered for Global Innovation Context during the post-campaign R&D interview, not during ordinary live campaign setup.

### Post-Campaign R&D Interview

The post-campaign R&D interview uses question mode after a campaign ends or reaches a meaningful decision point. It confirms which ideas R&D reviewed, advanced, prototyped, commercialized, parked, rejected, or marked out of scope, then captures why those decisions happened so the knowledge can contribute to future campaigns.

### Global Innovation Context

Global innovation context is cross-campaign R&D learning, reusable judgment patterns, and company-wide innovation guidance that can inform future campaign setup and idea evaluation. A learning can remain campaign-specific, become part of Global Innovation Context, or both. R&D chooses the scope when post-campaign learnings are captured. AI may suggest that a pattern should become global or remain campaign-specific, but R&D decides how broadly the learning applies.

### Global Context Change Proposal

A global context change proposal is a suggested change to Company Context or Global Innovation Context. It usually comes from post-campaign retrospective evidence, not ordinary live campaign setup. A global context change proposal may be suggested by AI or requested by an R&D Campaign Owner, but it requires R&D Manager approval before it changes published Company Context or Global Innovation Context.

### Context Change Alert

A context change alert is a non-blocking notice shown to R&D Campaign Owners when Company Context or Global Innovation Context changes in a way that may affect an active campaign. It helps campaign owners review possible impact as a quality-of-life aid. It does not require review, block intake, or overwrite Campaign Context because Campaign Context has stronger authority inside its campaign.

### Company Context

Company context is optional reference context about the company, created from public web sources and R&D-provided uploads or descriptions. It must be approved by an R&D Manager before use. Company context informs AI during setup but does not overwrite campaign-specific decisions. If company context conflicts with campaign setup, AI should resolve the conflict through the agent question queue and record the campaign-specific decision in the campaign knowledge report. If Company Context is not set up, company reference context is empty.

### Context Conflict

A context conflict happens when Company Context, Global Innovation Context, Campaign Context, or current campaign intent point in different directions. AI should surface the conflict during the R&D campaign interview and ask R&D to confirm which context governs the campaign. The R&D Campaign Owner may approve a campaign context override for the current campaign, but only the R&D Manager can change the published Company Context or Global Innovation Context. AI should not auto-reject an idea from Global Innovation Context when the current campaign may intentionally override it.

### Demo Story

The hackathon demo should show the process truthfully rather than cap outcomes to fixed counts. It should demonstrate R&D campaign setup, R&D interview, employee idea submission, clarification when needed, variant detection, out-of-scope handling when applicable, pre-R&D classification, R&D selection authority, and post-campaign learning. The number of filtered, parked, reviewed, prototyped, or commercialized ideas should emerge from the scenario.

### MVP Demo Fidelity

The MVP demo should use a real email sending service for employee clarification links, with Pingram as the preferred provider unless implementation constraints force a change. Historical track records may be scripted if useful, but are not required for the first demo. Company directory data and commercialization outcomes may be simulated.

### Demo Clarification Access

For the hackathon demo, employee clarification conversations may use secure magic links without login to reduce friction. This is a demo simplification. In a real enterprise deployment, clarification access should use company identity controls such as SSO, employee directory permissions, link expiry, and audit logging.

### Demo Wow Moment

The demo wow moment is showing AI turn vague R&D intent and messy employee submissions into a documented, explainable candidate set R&D can act on. The output should make campaign common ground, minimum review packet, related variants, ready candidates, parked ideas, out-of-scope matches, and classification reasoning visible to R&D.

### Employee Clarification Link

An employee clarification link is an emailed link to an AI conversation created when a submitted idea needs more detail. The conversation is preloaded with the context the AI needs to evaluate the idea, including relevant campaign ground truth, documented ambiguity, related ideas, and out-of-scope patterns. Employees do not need a status dashboard for the default flow.

### Employee Clarification Visibility

During employee clarification, the employee should see their submitted idea, the public campaign topic or context, focused AI questions, and optional examples of useful detail. The system should hide internal R&D criteria, scoring, ranking, related employee ideas, sensitive out-of-scope rule names, campaign strategy notes, and Global Innovation Context.

### Employee Identity In R&D Review

R&D should see the employee identity associated with an idea because selected ideas may require managers or R&D owners to work closely with the submitter to develop the concept. Employee identity should not drive AI evaluation, classification, ranking, or out-of-scope handling.

### Manager Collaboration

Manager collaboration is part of the intended real-world business workflow after an idea is selected. A manager may help the employee develop the idea, validate operational reality, or approve time spent on the concept. This is business context, not a required MVP demo actor.

### Quality Under Overload

Quality under overload is the main business pain. The company already receives thousands of employee ideas, so the product should not optimize primarily for more submissions. It should improve idea clarity, relevance, differentiation, and review readiness before R&D spends time on them.

### R&D Knowledge View

The R&D knowledge view is the product-facing way R&D inspects campaign ground truth, idea classifications, decisions, ambiguity, variants, and out-of-scope patterns. The exact format is intentionally unresolved. It may become an HTML view, dashboard, structured report, cards, graph, or mixed interface. The requirement is readability and navigation for R&D, not raw markdown walls.
