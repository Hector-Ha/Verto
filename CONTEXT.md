# Verto Context

## Domain Summary

Verto is an AI-assisted innovation pipeline for companies that collect more employee ideas than R&D teams can evaluate manually. The core business problem is quality under overload, not low engagement.

The product is not only a ticket queue. It is an idea refinery that helps R&D teams define campaign context, collect employee ideas, clarify vague submissions, preserve meaningful variants, and route refined opportunities toward review. The economic buyer is the Head of Innovation or R&D leader, and the internal champion is the R&D Campaign Owner.

The product name is Verto, from Latin-style language meaning transformation or turning. The name reflects transforming raw employee ideas into R&D-ready candidate sets.

Verto's center of gravity is idea intake and refinement. Campaign setup support is important because it gives AI evaluation ground truth, while Global Innovation Context is a supporting capability rather than the main product story.

The current product scope is the Idea Filter Pipeline. Verto helps ideas become clear enough for R&D judgment, then lets R&D select promising ideas as potential ideas. Potential ideas leave the Verto pipeline and are, by default, ideas R&D intends to prototype or otherwise work on outside Verto. Verto does not yet manage the full idea-to-product pipeline after selection.

## Canonical Terms

### Campaign

A campaign is an active or long-running innovation theme owned by R&D. It gives the system enough business context to route and evaluate ideas. A campaign may be lightweight, incomplete, intentionally vague, evolving, or fully detailed when the business need requires precision.

### Campaign Lifecycle

Campaign lifecycle is the business status path for a specific time-boxed campaign. The canonical current-scope statuses are Draft, Setup In Progress, Setup Review, Ready To Open, Intake Scheduled, Intake Open, Intake Closed, Review In Progress, Review Complete, Retrospective, and Ended. Intake Paused is a planned future lifecycle status, but it is out of current scope. Retrospective should stay lightweight: it is a minimal Question Mode session that asks what campaign learning, if any, should become Global Innovation Context. Only the R&D Campaign Owner can start the campaign retrospective for a specific campaign. Any proposed Company Context or Global Innovation Context change still becomes a Global Context Change Proposal and requires R&D Manager approval. The General Campaign does not use this lifecycle because it is always open and long-running.

Retrospective is optional for ending a campaign. After Review Complete, the R&D Campaign Owner can move directly to Ended without running a retrospective. AI should offer a small retrospective Question Mode, but the owner can skip it. If skipped, no Global Innovation Context proposal is created from that campaign at that time, while existing decisions and lineage remain recorded. The R&D Campaign Owner can later start the retrospective from the ended campaign history if needed.

Ended campaigns remain searchable and visible in campaign history. R&D can inspect setup, the final Campaign Knowledge Report, idea lineage, outcomes, and whether retrospective was skipped or completed. Ended campaigns do not accept new idea intake, pull new ideas from the General Campaign, or receive new review decisions except for the R&D Campaign Owner starting the optional retrospective later. If an employee clarification answer arrives after the campaign has ended, the answer should become source material on the shared idea in the General Campaign and should be evaluated under General Campaign rules, not the ended campaign. Ended campaigns should not be reopened in current scope. If R&D wants to continue the same theme, they should create a new campaign using the ended campaign as track record evidence or cloned setup context, while the ended campaign remains unchanged.

Campaign lifecycle gates are owner-controlled. R&D Team Members can contribute during setup and review, and AI can recommend status changes with reasons, but only the R&D Campaign Owner can approve business gate changes such as Ready To Open, Intake Open, Intake Closed, Review Complete, Retrospective, and Ended. Scheduled automation may move a campaign from Intake Scheduled to Intake Open, or from Intake Open to Intake Closed at the approved intake end date, only when the R&D Campaign Owner already approved that schedule. When scheduled intake time ends, new submissions stop, existing submitted ideas keep processing, existing employee clarification links stay active until their own 30-day expiry, and R&D can still review ready ideas. AI should not independently open, close, or end a specific campaign outside owner-approved gates or schedules.

R&D can review ideas that are Ready for R&D Review while campaign intake is still open. Review In Progress means the formal review phase after intake closes, not the first moment R&D is allowed to inspect or decide on an idea. AI can keep ranking or reranking ideas and groups during intake when agreed triggers happen, while lower-ranked ideas remain visible and R&D judgment remains final.

When intake closes, the campaign should move to Review In Progress if any unreviewed ideas that are Ready for R&D Review remain. If there are no ideas Ready for R&D Review but some ideas are still in clarification or routing, the campaign should stay Intake Closed until those finish. If all ideas are already handled, the R&D Campaign Owner can approve Review Complete. Review Complete is an owner-approved business gate because it means R&D is done with that campaign's review work.

Before Review Complete, every idea that is Ready for R&D Review in that campaign must have an explicit outcome: Potential Idea, returned to Future Opportunity, or returned to Inactive Idea. If any Ready for R&D Review idea has no outcome, AI should block Review Complete and show the R&D Campaign Owner which ideas still need a decision. Ideas still in clarification or routing are not Ready for R&D Review and follow the separate campaign-end return rules.

### Campaign Intake Audience

Campaign intake audience is the employee group allowed to submit ideas to a campaign. In the MVP, specific campaigns default to all seeded or demo employees, and the product does not need complex audience targeting by department, team, or location. The R&D Campaign Owner still chooses the employee-facing title and context before opening intake. Employee department or team may appear in review packets when already known, but it should not decide who can submit in the MVP. Restricted campaign audience can be added in a future version.

### Employee Submission Portal

The employee submission portal is the employee-facing place to submit ideas. In the MVP, the General Campaign is always visible for submission. Specific campaigns are visible for submission only when their lifecycle status is Intake Open. Intake Scheduled, Ready To Open, setup, closed, review, and ended campaigns should not be shown for employee submission in the MVP. Employees cannot submit to a specific campaign before intake opens or after intake closes. If no specific campaign is open, employees can still submit to the General Campaign.

### Employee-Facing Campaign Preview

An employee-facing campaign preview is the public campaign information an employee sees before submitting an idea. It should show the campaign title, short employee-facing context or prompt, optional examples of useful ideas, and submission deadline when relevant. It should not show the internal minimum review packet, out-of-scope rule names, ranking criteria, Global Innovation Context, or R&D strategy notes. The R&D Campaign Owner can edit a specific campaign's public title, prompt, or examples after intake opens. General Campaign Owners can edit the General Campaign public title, prompt, and examples; the R&D Manager can also edit because the R&D Manager is the default General Campaign owner. In the MVP, preview-only edits do not trigger AI consistency checks or routing rechecks. Existing submitted ideas keep the employee-facing preview version that existed when they were submitted for audit, while new submissions use the new preview version. Preview versioning should be stored for audit and source trace only in the MVP; there is no dedicated preview version history UI or diff UI. The General Campaign should also have a minimal public preview, such as General Ideas, a short prompt to submit ideas that do not fit a current campaign, optional examples, and no deadline.

### Employee Idea Draft

An employee idea draft is a private pre-submission idea saved by an employee before they click Submit. It belongs only to that employee. R&D cannot see it, AI does not process it, it does not count as a submission, and it has no clarification link. R&D should not see draft counts because that would leak employee intent or interest. Only submitted ideas count. A draft becomes a real idea only after the employee submits it. A draft for a specific campaign should stay until the employee deletes it, submits it, or that campaign closes intake. A General Campaign draft should stay until the employee deletes or submits it. Deleted drafts should leave no R&D-facing, AI-facing, campaign, review, stats, or product audit record because they were never submitted ideas. If a specific-campaign draft becomes unavailable because intake closed, the MVP should not send an email or push notification. If the employee is viewing it, the product should show that campaign intake closed; the employee can manually create a General Campaign idea if still relevant.

### Always-Open Campaign

An always-open campaign, also called a general campaign, is a long-term, indefinite campaign that receives general employee ideas outside time-boxed R&D requests. Ideas submitted here have lower priority until R&D connects them to a current campaign or business need. The always-open campaign is also where general global idea-intake rules should live because it accepts any idea; ordinary campaign setup remains campaign-specific. Ideas that do not fit a current campaign should return to the always-open campaign as either future opportunities or inactive ideas. Future opportunities and inactive ideas both live under the always-open campaign as separate views.

### General Idea

A general idea is a temporary intake and routing state for a new idea submitted to the always-open campaign. It means the idea is waiting in the general campaign pipeline and has not reached a final routing outcome. AI should route a general idea to needs employee clarification, future opportunity, inactive idea, lowest-priority general campaign review, or later into a specific campaign when it becomes Ready for R&D Review for that campaign. When no specific campaign exists, AI should route general ideas using Company Context, Global Innovation Context, and always-open campaign rules rather than inventing campaign-specific criteria.

### General Campaign Minimum Review Packet

A general campaign minimum review packet is the broad set of information a general idea must contain before R&D can review it directly from the always-open campaign. It exists because R&D may act on general ideas even when no specific campaign is active. General campaign review has the lowest review priority. AI should use Company Context, Global Innovation Context, and always-open campaign rules to decide whether the idea matches company vision enough for general review, should become a future opportunity, should become an inactive idea, or needs employee clarification. General Campaign owners can manage this packet because they have broad authority inside the General Campaign. Changes to this packet should trigger routing recheck for unreviewed General Campaign ideas only.

### R&D Manager

An R&D Manager is the authority for Company Context and Global Innovation Context. The R&D Manager can publish those contexts directly, approve or reject proposed changes from R&D members, and decide whether a campaign-specific learning should become reusable company-wide guidance. An R&D Manager can create any specific campaign and assign or change its R&D Campaign Owner. Changing the owner after setup starts requires an R&D Manager. For the General Campaign, the R&D Manager also acts as the default R&D Campaign Owner. Only an R&D Manager can add or remove R&D Campaign Owners for the General Campaign. A non-manager R&D Campaign Owner of the General Campaign has broad authority inside the General Campaign similar to an R&D Manager, but cannot manage General Campaign owner membership.

### R&D Campaign Owner

An R&D Campaign Owner, also called an R&D Team Lead, is the authority for a specific campaign. The R&D Campaign Owner owns campaign setup, resolves campaign-specific AI questions, approves the Campaign Knowledge Report, and decides whether campaign intake can open. An existing R&D Campaign Owner can create a new specific campaign only when assigning themself as that campaign's owner. Once assigned, the owner controls setup and lifecycle gates unless an R&D Manager changes ownership. The R&D Campaign Owner can add or remove R&D Team Members for their own campaign.

### R&D Team Member

An R&D Team Member contributes campaign knowledge, evidence, answers, and proposed context changes. An R&D Team Member can help build drafts, including a draft or proposed campaign, but needs approval from the relevant authority before their changes become AI-usable context. A proposed campaign from an R&D Team Member needs R&D Manager approval or assigned R&D Campaign Owner approval before it becomes real setup ground truth. After being added to a campaign, an R&D Team Member can see the campaign R&D workspace, including setup, the Campaign Knowledge Report, AI questions, draft answers, idea groups, rankings, review packets, variants, employee identity shown in review packets, and future or inactive returns for that campaign. They can recommend or draft actions, but cannot approve the Campaign Knowledge Report, open or close intake, end the campaign, mark a potential idea, return reviewed ideas to future opportunity or inactive idea, approve owner-only context overrides, or manage membership. Removing an R&D Team Member from a campaign stops future access and contribution, but keeps their past draft history and audit trail.

### Campaign Team Membership

Campaign team membership controls which R&D Team Members can access and contribute to a specific campaign's R&D workspace. The R&D Campaign Owner can add or remove team members for their own campaign, and an R&D Manager can also add or remove members when needed. R&D Team Members cannot manage membership. Membership changes should preserve past contribution history and audit records.

### Pending Owner Approval

Pending owner approval is the state for a campaign setup answer, context edit, or supporting evidence contributed by an R&D Team Member before the R&D Campaign Owner approves it. Pending owner approval content can shape a draft and be reviewed by AI for conflicts, but it is not AI-usable campaign ground truth until the R&D Campaign Owner approves it.

### Question Mode

Question mode is the AI-guided interaction pattern for resolving unclear context. AI asks one focused question at a time, explains why the answer matters, recommends a default answer when possible, follows up when the answer is vague or conflicting, and records the resolved decision.

### Scoped AI Context

Scoped AI context is the RAG-style rule that AI should retrieve only context relevant to the current decision. For campaign-specific idea evaluation, AI should use the current campaign's context, relevant idea source material, and only the minimal related context needed for that decision. It should not feed unrelated campaigns or the whole knowledge base into every AI call. Active campaigns should not directly reroute ideas from one active campaign to another. Cross-campaign reuse should happen through the General Campaign.

### AI Decision Explanation

An AI decision explanation is the reason AI gives for an important decision, such as ranking, routing, clarification need, context impact, or recheck result. R&D should be able to understand important AI decisions where the product exposes them. In the MVP, explanations should appear in the app only where already specified, such as rank reasons or assumption-based routing. If no in-app surface has been specified for a decision, the explanation should be captured in a demo AI decision log instead of adding new UI.

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

The employee idea interview is an AI-guided discussion with the idea submitter before R&D review. It uses question mode to ask one focused clarification batch, clarify vague claims, and produce a more complete idea packet. The interview is opened automatically when AI decides more detail is needed, usually through an emailed link to a conversation preloaded with the relevant campaign docs, related idea context, and evaluation rules. R&D does not manually send freeform clarification messages through Verto in the MVP, and the R&D Campaign Owner does not approve the questions before AI sends them. R&D users with campaign access can inspect the sent clarification batch later as source and audit material. The interaction should feel like a focused one-on-one clarification with a manager, not a public status workflow. Employee clarification should allow text answers and an optional supporting link. Employee file uploads are not required for MVP clarification. Supporting links do not need validation in the MVP. AI should fetch or read a link later only when needed for clarification, routing, or review evidence. AI should use a supporting link as evidence only when it is relevant and understandable. If the link is inaccessible or unclear during the open clarification batch, AI may ask about it inside that same batch; after the batch is answered or expired, AI should mark the evidence as unavailable instead of starting another employee follow-up round. The interview should stop early when the system has enough documented evidence to classify the idea as matching an R&D-marked out-of-scope pattern.

Anonymous idea submission is not part of the MVP. R&D needs employee identity for potential follow-up after selection, and clarification links need a known submitter. AI must still not use employee identity for ranking, filtering, or routing.

Employees may submit more than one idea to the same campaign. Each submission should become a separate idea record unless AI detects it is clearly a duplicate or variant of an existing idea. Variants should be linked, not merged.

The initial idea submission should stay lightweight. Required fields are a short idea title and a free-text idea description. Optional fields may include the problem or opportunity addressed, expected benefit, rough evidence or example, and a supporting link. Employees should not be forced to answer R&D-grade questions up front; AI can ask one clarification batch later when the relevant campaign minimum review packet needs more detail. Employee file uploads are future scope unless implementation time allows; MVP should support links first. Supporting links should not block submission, and MVP does not need link validation at submission time.

Each employee submission should choose one visible destination: one Intake Open specific campaign or the General Campaign. Employees should not choose multiple campaigns for the same idea in the MVP, and should not need to understand routing rules. If an employee submits to an active specific campaign, AI should not automatically detach the idea from that campaign or route it away just because it appears to fit another campaign or the General Campaign better. It stays associated with the submitted campaign until R&D makes an explicit outcome decision or the campaign reaches Ended and the campaign-end sweep returns remaining non-Potential ideas to the General Campaign. If the employee submits the same idea separately to another campaign, duplicate and variant rules handle it.

After submitting an idea, the employee should see a simple confirmation with the idea title or reference ID and a note that AI or R&D may ask follow-up questions if needed. The MVP should not provide an employee-facing status tracking page, routing label, result label, rank, review outcome, or promise that R&D will review the idea.

Employees should not directly edit their original idea after submission in the MVP. If AI needs more information, the employee clarifies through the clarification link instead.

R&D should not edit an employee's original submitted idea text. The original submission should remain immutable for audit. R&D can mark outcomes, approve campaign-specific clarity, and make review decisions.

### R&D-Facing Idea Summary

An R&D-facing idea summary is an AI-generated summary of an employee idea for R&D review. It is separate from the immutable original submission. It should cite or trace back to the original submission and any employee clarifications so R&D can inspect source material when needed. It is internal R&D review material and should not be visible to employees. R&D should not directly edit the summary; if it is wrong, any R&D user with review packet access can ask AI to regenerate the summary with traceability. Summary regeneration is a text-only action, does not require owner approval, and should not affect routing or ranking. Regenerated summaries should keep lightweight version history, including prior summary versions, who requested regeneration, when, and a brief AI reason. R&D should respect employee answers that came through user clarification and should not override clarified source meaning. If R&D believes AI misunderstood the source, the correction should be framed as an AI interpretation issue, not a change to the employee's answer.

If the same employee submits the exact same idea more than once, AI should keep both submission records for audit, mark the newer submission as a duplicate of the older idea, and avoid creating multiple review packets.

If different employees submit the same or very similar idea, AI should treat them as related submissions or variants rather than a pure duplicate. The system should keep each employee's submission record, link them under one idea family, and create one review packet that shows multiple submitters or repeated signal.

### Idea Family

An idea family is a linked set of related submissions or variants that should be reviewed together. It preserves each submission record while preventing duplicate review work. An idea family can show repeated signal, variant differences, and multiple submitters inside one review packet. R&D may see employee names in an idea family as contact context before selecting a potential idea, but AI must not use employee identity for ranking, filtering, or routing.

### Intentional Ambiguity

Intentional ambiguity is campaign vagueness R&D has confirmed on purpose. It is allowed, but it must be documented so AI evaluation does not treat it as missing information.

### Idea Variant

An idea variant is an idea that shares a similar core need with another idea but differs in a way that may affect customer value, feasibility, cost, risk, supply, operations, or positioning. Variants should not be merged as duplicates without R&D review.

### Future Opportunity

A future opportunity is an idea that may be valuable but does not currently fit an active campaign. It remains available for future campaigns instead of being rejected. If an idea seems aligned with Company Context or Global Innovation Context but not with the current campaign, it should usually become a future opportunity in the always-open campaign.

### Idea Reuse

Idea reuse means the same idea record can be associated with multiple campaigns over time instead of being copied. When an idea moves from a campaign to the always-open campaign and later fits another campaign, the system should preserve the original idea identity, lineage, employee contribution history, and campaign-specific evaluations.

### R&D-Out-of-Scope Pattern

An R&D-out-of-scope pattern is a documented rejection pattern or rule created by R&D. If a submitted idea clearly matches one of these patterns, AI can classify it as R&D-out-of-scope without continuing the employee interview.

### Pre-R&D Routing

Pre-R&D routing is the AI step that happens before an idea is presented to R&D. It assigns the idea to a campaign, identifies related ideas and variants, checks documented out-of-scope patterns, and decides whether the idea is ready for review, a future opportunity, inactive, out of scope, or needs more employee clarification. For an idea submitted directly to an active specific campaign, pre-R&D routing should not automatically remove the idea from that campaign even when AI thinks the idea has poor fit or better fit elsewhere. Rerouting away from the submitted campaign happens only through an explicit R&D outcome decision or when the specific campaign reaches Ended and the campaign-end sweep returns remaining non-Potential ideas to the General Campaign. If Campaign B starts while Campaign A intake is active, Campaign B should pull matching ideas from the General Campaign only. It should not take ideas directly from Campaign A. When Campaign A ends, leftover ideas return to the General Campaign, then Campaign B may pull matching ideas from the General Campaign through normal campaign idea pull-in.

### Idea Classification

Idea classification is AI grouping of ideas into meaningful categories or clusters, such as vegan food ideas, packaging ideas, CPU upgrade ideas, or RAM upgrade ideas. Idea classification can be campaign-specific, global across company ideas, or both. It helps R&D scan themes, compare related ideas, and understand idea volume by topic. AI should create, choose, assign, and routinely manage groups that fit the campaign and available idea set so R&D can review them. R&D may rename, merge, or split groups when needed, but that should not be the normal workflow. An idea may belong to multiple groups, and AI should choose one primary group for dashboard counting based on the campaign context. Idea classification can happen first on raw submissions as a rough grouping, then become stronger after employee clarification. If clarification changes the idea meaning, AI may move the idea to a different group and record why. Idea classification is different from pre-R&D routing, which decides workflow state and review readiness.

### General Campaign Classification

General campaign classification is AI-managed grouping for General Campaign ideas. It is mainly for filtering and discovery, not review ranking. Groups should represent ideas that are fundamentally similar, and AI should fit ideas into existing groups before creating new groups. General Campaign classification should have a default cap of 100 groups to prevent category explosion, configurable later by General Campaign owners. When the cap is full and a truly unique idea needs a new group, AI should first pick the smallest existing group by idea count, redistribute those ideas into the remaining groups where they fit, remove that group, and create the new group. This does not require General Campaign Owner approval by default. AI should keep an audit log when it dissolves a group, including old group name, reason, moved ideas, destination groups, timestamp, and context version. AI should not send push notifications for General Campaign group dissolution.

### Idea Group

An idea group is an AI-managed review lens that collects related ideas so R&D can scan and review them together. The idea remains the primary artifact; the group name is less important than helping R&D find, compare, and review relevant ideas. Idea groups should behave mostly like filters or views, not taxonomy objects R&D must maintain.

### Single-Idea Group

A single-idea group is an idea group containing one idea. AI may create one when the idea is unusually valuable, novel, outside existing groups, part of a low-volume campaign, or important enough that the R&D Campaign Owner should not miss it. Otherwise, ordinary lone ideas should remain in broader emerging-theme or other groups until more related ideas appear.

### Emerging Themes Group

An emerging themes group is a visible, low-priority idea group for ideas that do not yet justify a stronger group or useful single-idea group. It should remain available for R&D scanning and rank above out-of-scope idea groups, but below stronger campaign-fit idea groups.

### Inactive Ideas View

The inactive ideas view is the separate R&D-facing view under the always-open campaign for ideas AI routed away from normal campaign review. These ideas are not useful under current known context, but they are kept for audit, search, and reclassification. R&D-out-of-scope is a reason inside inactive ideas, not a separate final bucket, and should appear at the very bottom of the inactive ideas list. The main review page should show a summary count and top reasons, but out-of-scope groups should not compete with viable idea groups in the main review flow. The inactive ideas view should group ideas by reason, show matched evidence or rules, and allow R&D to reclassify an idea when AI got it wrong.

### Future Opportunities View

The future opportunities view is the separate R&D-facing view for ideas that may be valuable later but do not fit the current campaign. It is distinct from the inactive ideas view because future opportunities are not rejected. Ideas saved from current campaigns live in the always-open campaign, also called the general campaign, with lineage back to the campaign that saved them. They remain discoverable for future campaign setup, trend review, and long-term opportunity planning. A future opportunity returns to active campaign work only when AI or R&D later finds enough campaign fit and clarity for it to satisfy the new campaign's minimum review packet. Until then, it stays in future opportunities.

### Returned Idea Lineage

Returned idea lineage is the retained link between an idea in the always-open campaign and the campaign it came from. When an idea returns to the always-open campaign as a future opportunity or inactive idea, the system should keep the original campaign, reason it did not fit, context version used, routing outcome, related ideas, and related groups so R&D can audit or revive it later.

### Campaign Idea Pull-In

Campaign idea pull-in is the AI step that finds existing ideas from the always-open campaign when a new campaign opens or is set up. It should look at future opportunities first, then General Campaign ideas that are Ready for R&D Review, and associate matching ideas with the new campaign using idea reuse rather than copying them. Pulled ideas should stay as one shared idea record in the General Campaign with an association to the pulling campaign. Inactive ideas should not be pulled unless a recheck has moved them out of inactive first. If AI determines an existing idea matches the campaign, it can enter campaign routing without R&D Campaign Owner pre-approval, similar to a newly submitted idea.

AI should pull a reused idea into a campaign only when the existing information is enough to establish campaign fit and qualifies the idea for that campaign's routing. If there is not enough information to establish fit in the first place, AI should not pull the idea from the General Campaign. After a reused idea is pulled, AI may ask the employee for more clarification only to enrich the campaign review packet when the idea is within the reused idea clarification window and the employee is still active. If extra clarification does not arrive, the idea should stay in the pulling campaign and use existing information with lower-confidence or assumption markers where needed. Missing extra clarification should not send the idea back to the General Campaign or mark it as Needs Critical Clarity.

### Reused Idea Clarification

Reused idea clarification is follow-up for an idea pulled from the always-open campaign into a later campaign. AI should not bother the original submitter by default when the idea is old or the submitter is no longer active in the company. Reused idea clarification may be sent when the idea is within the reused idea clarification window and the original employee is still active. It should follow the same one clarification batch, 30-day clarification timeout, and one day-23 reminder rules as other employee clarification. If a reused idea is missing critical information and cannot be clarified through an allowed source, it should not enter normal R&D review.

### Reused Idea Clarification Window

The reused idea clarification window is the maximum age of a reused idea where AI may ask the original employee for clarification. The default window is six months from original submission, and it may become configurable later. If the idea is older than the window or the employee is no longer active, AI should not send employee clarification for that reused idea.

### Idea Group Summary

An idea group summary is the R&D-facing overview shown before reviewing individual ideas in a group. It explains what ties the ideas together, how many ideas are included, which candidates look strongest, repeated patterns, major variants, common missing information, and any out-of-scope risk.

### Idea Group Ranking

Idea group ranking is AI's ordering of idea groups based on expected benefit to the R&D Campaign Owner. Ranking helps the owner review groups from top to bottom while still allowing exploration. Ranking should consider campaign fit, potential value, number and quality of ideas, urgency, evidence strength, novelty, feasibility signals, and unresolved risk. Ranking changes do not need separate explanation by default. General Campaign review should not use group ranking because its broad intake can create too many groups.

### Idea Group Rerank Trigger

An idea group rerank trigger is an event that justifies recalculating idea group ranking. Reranking should happen on meaningful batch, time, or context events rather than whenever the owner opens the review board. Valid triggers include a campaign reaching its review threshold, a scheduled daily or weekly in-app review digest, a major Campaign Context change, enough new ideas arriving to shift group priority, or campaign time running out. A clarification answer that makes one idea Ready for R&D Review should update that idea's board placement immediately, but should not force a full group rerank unless one of the normal rerank triggers applies.

### Idea Ranking

Idea ranking is AI's subjective ordering of ideas based on expected value to the campaign or company. It should use documented context and visible judgment criteria rather than a rigid formula, employee seniority, or popularity. In specific campaigns, it may order ideas within an idea group so R&D can inspect the strongest candidate packets first. In General Campaign review, AI should rank ideas directly rather than ranking groups because the broader intake may create too many groups. General Campaign idea ranking should consider fit with Company Context, fit with Global Innovation Context, expected business or R&D value, novelty, feasibility signal, evidence quality, and urgency or strategic timing. Repeated signal from multiple employees may lightly raise confidence or urgency, but should not become popularity voting. AI should show 2-4 short reasons for each idea's rank and should not show an exact numeric score by default. Idea ranking should not hide lower-ranked ideas or replace R&D judgment.

### Potential Idea

A potential idea is the selected final state for an idea that has successfully passed out of the Idea Filter Pipeline. R&D can select a potential idea from a specific campaign review or from General Campaign review. By default, it means R&D selected the idea for prototyping or other work outside Verto. It is not a pinned rank or AI ranking override. R&D should choose one lightweight fixed system reason tag when marking an idea as potential, with an optional note. MVP reason tags can include high value, strong fit, novel, quick prototype, strategic timing, or customer/employee pain. Once marked as potential, the idea should leave normal review queues and rankings. It remains searchable with lineage and outcome history, but no longer competes with unreviewed ideas. Potential ideas should be excluded from future campaign pull-in. Verto should not reopen a potential idea back into the Idea Filter Pipeline; whether the later prototype or work succeeds is outside current scope.

Only the relevant owner can mark an idea as potential: the R&D Campaign Owner for a specific campaign, or a General Campaign Owner for General Campaign review. An R&D Team Member can recommend marking an idea as potential, but owner approval is required.

General Campaign review may still select a shared idea as potential while specific campaign review is pending. If any associated campaign or the General Campaign marks a shared idea as potential, the idea should be unplugged from other campaign routing and review queues because it has left the Idea Filter Pipeline globally. Other associated campaign owners should not receive a notification by default. If they later open the idea or history, they should see that it was marked as potential elsewhere.

Employees should not receive an automatic Verto notification when their idea is marked as potential in the MVP. R&D may contact the employee separately outside Verto if they want to prototype or work on the idea with them.

Employees should not receive automatic Verto notifications when their idea becomes a future opportunity or inactive idea in the MVP. Verto should not create employee-facing rejection or internal status messaging for idea outcomes.

### Unused Reviewed Idea

An unused reviewed idea is an idea R&D reviewed but did not mark as a potential idea. It should return to the General Campaign as either a future opportunity or an inactive idea, depending on whether it may be useful later under known context. These are the only return choices for reviewed ideas that are not selected as potential ideas. R&D should choose one lightweight fixed system reason tag when returning an unused reviewed idea, with an optional note. MVP reason tags can include not now, insufficient value, poor fit, too unclear, out of scope, or duplicate/covered. AI does not need to suggest the return destination or reason tag by default.

Only the relevant owner can return an unused reviewed idea to future opportunity or inactive idea: the R&D Campaign Owner for a specific campaign, or a General Campaign Owner for General Campaign review. An R&D Team Member can recommend the return decision, but owner approval is required.

For shared ideas associated with multiple campaigns, returning an unused reviewed idea to future opportunity or inactive idea is campaign-context-specific. That return decision should not block another associated campaign from reviewing the same shared idea unless the idea becomes a potential idea elsewhere. The shared idea record should keep all campaign-specific outcomes in lineage.

If R&D thinks an employee answer is wrong, unrealistic, or impractical, that judgment belongs in the R&D review decision or reason tag. It should not rewrite the employee's answer or source meaning.

### R&D Internal Notes

R&D internal notes are out of scope for the MVP hackathon version. The MVP should rely on review decisions, fixed reason tags, optional reason notes, and owner approvals instead of implementing a separate internal note feature.

### Optional Reason Note

An optional reason note is a small text field attached to an R&D review decision or reason tag. It is decision metadata, not a separate internal note feature. It does not need search, collaboration, AI summarization, or standalone note management in the MVP.

### Unreviewed Campaign-End Idea

An unreviewed campaign-end idea is an idea from a specific campaign that was Ready for R&D Review but never reviewed before the campaign ended. It should return to the General Campaign as a future opportunity by default, with lineage back to the ended campaign and the reason tag not reviewed before campaign ended. If the idea is clearly poor fit under broader known context, the R&D Campaign Owner can return it as an inactive idea instead.

### Campaign-End Sweep

Campaign-end sweep is the cleanup step that runs when a specific campaign reaches Ended. No non-potential idea should remain orphaned inside an ended campaign. Ideas that were Ready for R&D Review but never reviewed return to the General Campaign as future opportunities by default, with lineage and reason tag not reviewed before campaign ended, unless the R&D Campaign Owner chooses inactive idea for clearly poor broader fit. Ideas in needs employee clarification return to the General Campaign and keep the same 30-day clarification timer. If the employee answers after the campaign ended but before the clarification link expires, AI should evaluate the answer under General Campaign rules and route the shared idea as a General Campaign item: future opportunity, inactive idea, or Ready for R&D Review in General Campaign. If that late clarification makes the idea Ready for R&D Review in General Campaign, AI should update the General Campaign board and counts immediately, but notify General Campaign owners only through the next scheduled in-app digest. Unfinished routing or candidate work returns to the General Campaign with lineage and current best status. Potential ideas do not return because they already left the Idea Filter Pipeline globally.

### Single Idea Review

Single idea review means each idea should produce one R&D review packet and be reviewed once within a campaign context, even when it appears in multiple idea classification groups. Classification groups are filters and scanning aids; they should not duplicate the idea into multiple review tasks. A shared idea associated with multiple campaigns may be reviewed once per campaign context because each campaign may have different review criteria. If any associated campaign marks it as a potential idea, it exits all campaign queues.

### Routing Recheck

A routing recheck is the AI re-evaluation of unreviewed idea workflow state after Campaign Context changes, General Campaign Minimum Review Packet changes, or direct General Campaign dependency changes. New submissions use the updated context immediately, and unreviewed ideas that have not yet been presented to R&D should be rechecked. Already reviewed R&D decisions remain tied to the context version that existed when R&D reviewed them. If recheck changes an idea's routing state, AI should record the old reason, new reason, and context version that caused the change. For specific campaigns, Company Context or Global Innovation Context changes should not trigger routing recheck until the R&D Campaign Owner resolves any context change alert in a way that changes Campaign Context or records a campaign context override. Campaign Context changes do not reset employee clarification limits for the same specific campaign. If an employee already answered the campaign's clarification batch, AI should recheck using that answer, current context, and reasonable assumptions, or ask the R&D Campaign Owner in question mode. For the General Campaign, Company Context or Global Innovation Context changes should directly recheck unreviewed General Campaign ideas, future opportunities, and inactive ideas because General Campaign uses those contexts to decide company fit.

### Recheck Employee Notification

A recheck employee notification is an employee-facing message caused by a routing recheck. By default, recheck changes should remain internal to R&D. Employees should only be contacted when the recheck creates a need for clarification, or when a separate campaign communication decision requires employee notification. Moving an idea to ready for R&D or R&D-out-of-scope should not automatically notify the employee in the MVP.

### Needs Employee Clarification

Needs employee clarification is a pre-review state for an idea that lacks required detail and can still be clarified by the employee. When AI routes an idea to needs employee clarification, AI should automatically create the clarification batch, send the employee clarification notice, and open the 30-day timer. R&D does not manually send the notice in the MVP, and owner approval is not required before AI sends it. The sent questions, send time, expiry time, and later employee answer should remain visible to R&D users with campaign access as source and audit material. MVP does not need an R&D early-close or cancel path for a sent clarification link; strong scoped context and the one-batch rule should make clarification good enough for the hackathon version. Once sent, the clarification follows the normal employee answer or 30-day expiry path. The MVP allows one clarification batch per idea per campaign context. Campaign Context changes do not allow another employee clarification batch inside the same specific campaign. AI should ask the needed focused questions once, then route using the employee answer plus reasonable assumptions if the answer is still imperfect. After an employee answers, AI should evaluate whether the answer satisfies the critical parts of the minimum review packet. If enough critical information exists, the idea may become Ready for R&D Review with noncritical unknowns or assumptions shown, and AI should update the review board immediately so the idea appears in the correct queue or group. The R&D board should show a small source trace explaining why the idea became Ready for R&D Review, mapping the relevant employee clarification answer to the minimum review packet item it satisfied. This source trace should not become a large explanation UI and should not require owner approval. This immediate placement update should not force a full group rerank unless a normal rerank trigger applies. If critical information is still missing, AI should not ask a second employee clarification batch and should not place the idea in normal R&D review. It should route the idea to future opportunity if still promising, or inactive idea if weak or poor fit, with a recorded reason such as insufficient clarity after clarification. If the same shared idea is later pulled into a different campaign context, that later campaign may ask its own one clarification batch only when the reused idea clarification rules allow it. The 30-day clarification timeout applies to all ideas in needs employee clarification. The clarification email and page should show the exact expiry date so the employee knows when the link closes. If an idea stays there for 30 days without being filled, AI should close the clarification link, judge the idea based on its current state and reasonable assumptions, then route it to future opportunity or inactive idea. AI should visibly record assumption-based routing, including what was assumed and why. After the timeout, the clarification link should no longer be accessible, so there is no late employee response path for that link. R&D should not resend a new clarification link for the same timed-out clarification in the MVP. If a specific campaign ends while an idea is in needs employee clarification, the idea should return to the General Campaign and remain in needs employee clarification until the same 30-day timeout or employee response resolves it. If that response arrives after the specific campaign has ended, AI should evaluate it under General Campaign rules only.

### Awaiting Clarification Queue

The awaiting clarification queue is the R&D-visible holding lane for ideas currently in needs employee clarification. It should appear as a separate queue or count, not inside ranked review groups and not mixed with ideas that are Ready for R&D Review. R&D users with campaign access can inspect the initial idea, what AI asked, the expiry date, and any answer once it arrives. AI should provisionally rank or sort this queue using only the initial submitted idea and available pre-clarification context. That preliminary rank is for scanning and triage only; it is lower confidence than Ready for R&D Review ranking and cannot be used to mark Potential Idea, Future Opportunity, or Inactive Idea until clarification is answered or expires.

### Employee Clarification Timeout Message

An employee clarification timeout message is the employee-facing explanation of what happens if clarification is not provided by the expiry date. It should gently say that the idea may be routed based on the information already provided. It should not expose internal labels such as future opportunity, inactive idea, or assumption-based routing.

### Clarification Reminder

A clarification reminder is the single reminder sent to an employee before a clarification link expires. It should be sent around day 23 of the 30-day clarification window. The system should not send repeated reminders for the same clarification request.

### Expired Clarification Page

An expired clarification page is the read-only page shown when an employee opens a clarification link after the 30-day timeout. It should state that the clarification link has expired, show the idea title or reference and expiry date, and include no form fields, no resubmit button, and no request-new-link action.

### Assumption-Based Routing

Assumption-based routing is routing performed by AI when clarification did not arrive and the system must decide from the idea's current state plus reasonable assumptions. It should be visibly recorded on the idea, including what AI assumed, why those assumptions were reasonable, and which routing decision they supported. Ideas routed through assumption-based routing should be treated as lower confidence in ranking than similarly valuable fully clarified ideas, but they should not be hidden.

### General Campaign Recheck Notification

A general campaign recheck notification is an owner-facing notice caused by General Campaign routing recheck. By default, General Campaign recheck should store audit history and update counts or views without immediate notification. AI should notify General Campaign owners through a scheduled in-app digest only in the MVP. The MVP should not send R&D owner digest email or push notifications; email is reserved for employee clarification links.

### Scheduled In-App Review Digest

A scheduled in-app review digest is an R&D-facing summary shown inside Verto, not an email or push notification. In the MVP, digest cadence should not be configurable. Active specific campaigns should use a daily in-app digest, and the General Campaign should use a weekly in-app digest. R&D Team Members with access to the relevant campaign workspace can read the same digest as the R&D Campaign Owner, but digest-linked actions that require owner authority remain owner-only. For General Campaign, General Campaign Owners see the owner digest; R&D Team Members see the digest only if they have access to the General Campaign workspace. Digest content should stay compact and actionable: new ideas that became Ready for R&D Review, ideas still Awaiting Clarification near expiry, major routing changes, and rerank summary only when rerank happened. The digest should not be a long AI essay. Each digest item should link to the relevant idea, queue, source trace, or routing detail. Digest items should not be individually dismissible in the MVP because the digest is a generated summary, not a task inbox. Items should disappear naturally when the next digest replaces the old one or when the linked state changes. MVP should show the latest digest only and should not include a separate digest history page; underlying events remain available through idea records, routing history, source traces, and audit logs.

### Minimum Review Packet

A minimum review packet is the campaign-specific set of information an idea must contain before R&D reviews it. It is defined during the R&D campaign interview, not hardcoded globally. AI uses the minimum review packet to decide whether an employee idea needs a clarification interview. An idea that lacks critical minimum review packet information is not Ready for R&D Review and should not be placed in normal R&D review. Noncritical unknowns may be shown as unknowns or assumptions when the idea otherwise satisfies the minimum review packet.

### Ready for R&D Review Idea

A Ready for R&D Review idea, sometimes shortened internally to a review-ready idea, is an idea that has enough campaign-specific clarity to satisfy the minimum review packet. It is an information gate, not a quality judgment, rank, selection, or claim that the idea is good. Candidate ideas from the always-open campaign may enter campaign routing, but they become normal R&D review work only after they are Ready for R&D Review. Ideas that are not Ready for R&D Review remain in pre-R&D routing, future opportunities, or inactive ideas until a valid source supplies enough clarity or AI determines they should not proceed.

### Needs Critical Clarity

Needs critical clarity is a future opportunity reason for an idea that may be relevant but lacks information required by the campaign's minimum review packet. It should be treated as a future opportunity and should not create separate effects, owner attention, normal R&D review work, or review group ranking impact. The R&D Campaign Owner can supply or approve the missing campaign-specific clarity. R&D Team Members can draft that clarity, but AI should not promote the idea to Ready for R&D Review or reroute it into normal R&D review until the R&D Campaign Owner approves the draft.

### R&D Track Record

An R&D track record is historical evidence from prior campaigns, potential ideas, rejected ideas, future opportunities, and known later outcomes when R&D provides them. When R&D cannot define enough campaign ground truth up front, AI should ask for relevant track records, synthesize patterns, and continue the R&D campaign interview until common ground exists.

### Campaign Learning Loop

The campaign learning loop uses R&D's end-of-campaign filter decisions to improve future campaign setup. Potential idea is the happy-path selected final state, and unused reviewed ideas return to the General Campaign as future opportunities or inactive ideas. After each campaign, AI should summarize those filter decisions and support a lightweight retrospective Question Mode session when the R&D Campaign Owner starts one. That session can identify what should stay campaign-specific and what may deserve a Global Context Change Proposal. Campaign-specific exceptions should normally be considered for Global Innovation Context during the post-campaign retrospective, not during ordinary live campaign setup. Managing later prototype or commercialization work is outside the current Idea Filter Pipeline scope.

### Post-Campaign R&D Interview

The post-campaign R&D interview uses Question Mode after a campaign ends or reaches a meaningful decision point. It should be minimal: confirm which ideas R&D reviewed, marked as potential, saved as future opportunities, returned as inactive, or marked out of scope, then ask what learning should stay campaign-specific and what may be proposed for Global Innovation Context. Only the R&D Campaign Owner can start this retrospective for a specific campaign. Later product outcomes may be recorded when R&D provides them, but managing that downstream product pipeline is outside the current scope.

### Global Innovation Context

Global innovation context is cross-campaign R&D learning, reusable judgment patterns, and company-wide innovation guidance that can inform future campaign setup and idea evaluation. A learning can remain campaign-specific, become part of Global Innovation Context, or both. R&D chooses the scope when post-campaign learnings are captured. AI may suggest that a pattern should become global or remain campaign-specific, but R&D decides how broadly the learning applies.

### Global Context Change Proposal

A global context change proposal is a suggested change to Company Context or Global Innovation Context. It usually comes from post-campaign retrospective evidence, not ordinary live campaign setup. A global context change proposal may be suggested by AI or requested by an R&D Campaign Owner, but it requires R&D Manager approval before it changes published Company Context or Global Innovation Context.

### Context Impact Check

A context impact check is the AI comparison that runs after a published Company Context or Global Innovation Context change. It compares the changed context against active and draft Campaign Context and determines whether the change is likely to affect campaign setup, classification, review packets, out-of-scope handling, or documented assumptions. If AI records No Impact, no alert is shown and the result is stored for audit only. Likely impact on an active campaign creates a Context Change Alert. Likely impact on a draft campaign becomes setup work in the Agent Question Queue or setup review.

### Draft Context Impact

Draft context impact is likely impact from a Company Context or Global Innovation Context change on a campaign that has not opened intake yet. It can become a setup warning when the campaign can still launch coherently, or a setup hard blocker when the change creates an unresolved contradiction in launch-critical campaign ground truth, review packet requirements, or out-of-scope handling.

### Context Change Alert

A context change alert is a non-blocking notice shown to R&D Campaign Owners when a context impact check finds that a Company Context or Global Innovation Context change is likely to affect an active campaign. It helps campaign owners review possible impact as a quality-of-life aid. It does not require review, block intake, or overwrite Campaign Context because Campaign Context has stronger authority inside its campaign. In the Owner Attention Queue, context change alerts rank below setup hard blockers but above setup warnings. A context change alert should not automatically block an active campaign after intake has opened, though AI may recommend that the R&D Campaign Owner close intake early when a severe contradiction appears.

### Context Change Alert Resolution

A context change alert resolution is the R&D Campaign Owner's recorded answer to a context change alert. The owner may mark No Impact, update Campaign Context, create a campaign context override, ask AI to follow up in question mode, or escalate to the R&D Manager when the owner believes the Company Context or Global Innovation Context change may be wrong. No Impact means the change is irrelevant to the campaign or already covered by existing Campaign Context. A campaign context override means the change is relevant and accepted as true, but the campaign intentionally follows different guidance.

### Company Context

Company context is optional reference context about the company, created from public web sources and R&D-provided uploads or descriptions. It must be approved by an R&D Manager before use. Company context informs AI during setup but does not overwrite campaign-specific decisions. If company context conflicts with campaign setup, AI should resolve the conflict through the agent question queue and record the campaign-specific decision in the campaign knowledge report. If Company Context is not set up, company reference context is empty.

### Context Conflict

A context conflict happens when Company Context, Global Innovation Context, Campaign Context, or current campaign intent point in different directions. AI should surface the conflict during the R&D campaign interview and ask R&D to confirm which context governs the campaign. The R&D Campaign Owner may approve a campaign context override for the current campaign, but only the R&D Manager can change the published Company Context or Global Innovation Context. AI should not auto-reject an idea from Global Innovation Context when the current campaign may intentionally override it.

### Demo Story

The hackathon demo should show the process truthfully rather than cap outcomes to fixed counts. It should demonstrate R&D campaign setup, R&D interview, employee idea submission, clarification when needed, variant detection, out-of-scope handling when applicable, pre-R&D classification, R&D selection authority, and post-campaign learning. The number of inactive, future opportunity, reviewed, or potential ideas should emerge from the scenario.

### MVP Demo Fidelity

The MVP demo should use a real email sending service for employee clarification links, with Pingram as the preferred provider unless implementation constraints force a change. Concrete provider credentials, sender details, and test recipients can be defined during implementation. Historical track records may be scripted if useful, but are not required for the first demo. Company directory data and later product outcomes may be simulated if needed.

All behavior settled in this context and all existing documented behavior that still makes sense should be treated as MVP scope unless explicitly marked out of scope. The live demo scope is the full documented MVP, not a narrowed single-path demo. The known exception is R&D internal notes, which are out of scope for the MVP hackathon version. MVP clarification questions should focus on gaps not already covered by existing docs.

The hackathon MVP should use seeded demo users and role switching instead of full enterprise authentication. It should still enforce role permissions in app logic. Seeded roles should include R&D Manager, General Campaign Owner, Specific Campaign Owner, R&D Team Member, and Employee. Real SSO can come later.

All AI behavior in the hackathon MVP should use real LLM calls. The initial MVP model target is GLM-5, while provider and API access details can be finalized during implementation. This includes R&D campaign interviews, employee clarification, idea summary generation, ranking explanations, General Campaign rechecks, context impact checks, and classification decisions. Seed data may exist, but AI decisions and explanations should not be deterministic scripted substitutes.

If a real LLM call fails during the MVP, the product should show a blocking retry state for that AI step. It should not create a fake or scripted fallback decision. Existing data should remain unchanged until the real AI step succeeds.

The hackathon MVP should keep a demo AI decision log for important AI explanations that do not already have a specified in-app surface. The log is developer/demo-only, not an R&D product surface and not employee-facing.

General Campaign behavior is a main MVP feature, not a future-only enhancement. The hackathon MVP should include General Campaign owner authority, General Campaign Minimum Review Packet, direct General Campaign review, idea-level ranking, Future Opportunity and Inactive Idea storage, pull-in to specific campaigns, General Campaign dependency rechecks, and capped General Campaign classification with audit logging. If General Campaign classification is implemented, the 100-group cap should be enforced in the data or AI logic, not only shown as documentation. The live demo does not need to exhaustively create 100 groups; it can show a seeded example or audit log entry that proves cap enforcement and group dissolution behavior.

The MVP should include minimal General Campaign owner membership management UI: show the R&D Manager as the default General Campaign owner, allow R&D Managers to add or remove General Campaign owners, and prevent non-manager General Campaign owners from managing owner membership. Complex permission administration beyond this is not required.

### Demo Clarification Access

For the hackathon demo, employee clarification conversations may use secure magic links without login to reduce friction. This is a demo simplification. In a real enterprise deployment, clarification access should use company identity controls such as SSO, employee directory permissions, link expiry, and audit logging.

### Demo Wow Moment

The demo wow moment is showing AI turn vague R&D intent and messy employee submissions into a documented, explainable candidate set R&D can act on. The output should make campaign common ground, minimum review packet, related variants, ready candidates, future opportunities, out-of-scope matches, and classification reasoning visible to R&D.

### Employee Clarification Link

An employee clarification link is an emailed link to an AI conversation created and sent automatically when AI decides a submitted idea needs more detail. The conversation is preloaded with the context the AI needs to evaluate the idea, including relevant campaign ground truth, documented ambiguity, related ideas, and out-of-scope patterns. Employees do not need a status dashboard for the default flow and should not be able to access internal idea status, review outcomes, ranking, or routing labels.

### Employee Clarification Visibility

During employee clarification, the employee should see their submitted idea, the public campaign topic or context, focused AI questions, optional examples of useful detail, optional supporting link input, and clarification deadline details. The system should hide internal R&D criteria, scoring, ranking, review outcomes, routing status, related employee ideas, sensitive out-of-scope rule names, campaign strategy notes, Global Innovation Context, and internal labels such as Potential Idea, Future Opportunity, Inactive Idea, and Assumption-Based Routing.

### Employee Identity In R&D Review

R&D should see the employee identity associated with an idea because potential ideas may require managers or R&D owners to work closely with the submitter outside the current Idea Filter Pipeline. Employee identity should not drive AI evaluation, classification, ranking, or out-of-scope handling.

Employee managers should not appear in the MVP idea review packet. Manager collaboration may happen outside Verto after selection, but it is not part of the current review packet.

Employee department or team may appear in the idea review packet when already available, but only as context for R&D. AI should not use department or team for ranking, filtering, or routing unless the campaign context explicitly asks for department-specific ideas.

### Manager Collaboration

Manager collaboration is part of the intended real-world business workflow after an idea is selected. A manager may help the employee develop the idea, validate operational reality, or approve time spent on the concept. This is business context, not part of the MVP review packet or a required MVP demo actor.

### Quality Under Overload

Quality under overload is the main business pain. The company already receives thousands of employee ideas, so the product should not optimize primarily for more submissions. It should improve idea clarity, relevance, differentiation, and review readiness before R&D spends time on them.

### R&D Knowledge View

The R&D knowledge view is the product-facing way R&D inspects campaign ground truth, idea classifications, decisions, ambiguity, variants, and out-of-scope patterns. The exact format is intentionally unresolved. It may become an HTML view, dashboard, structured report, cards, graph, or mixed interface. The requirement is readability and navigation for R&D, not raw markdown walls.
