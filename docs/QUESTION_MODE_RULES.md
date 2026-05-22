# Question Mode Rules

Question Mode is the product-facing name for the AI decision interview pattern used in campaign setup, owner review, employee clarification, and post-campaign retrospectives.

This behavior is derived from the local `$grill-with-docs` agent skill. The skill source in this workspace is `C:\Users\Admin\.agents\skills\grill-with-docs\SKILL.md`.

## Core Rules

- Ask one focused question at a time.
- Provide a recommended answer when possible.
- Resolve dependent decisions one branch at a time.
- If the answer can be found in existing docs or system state, inspect those sources instead of asking.
- Challenge terms that conflict with the canonical glossary.
- Sharpen vague or overloaded language into precise product terms.
- Use concrete scenarios to expose edge cases and unclear authority boundaries.
- Cross-check claims against existing docs or implementation when available.
- Record resolved domain terms in `CONTEXT.md` as they are decided.
- Keep `CONTEXT.md` as domain language, not implementation spec or scratchpad.

## Product Translation

- R&D Campaign Owner sees clear decisions, not agent-internal jargon.
- AI explains why each question matters.
- AI can recommend a default, but R&D authority decides.
- AI follows up when an answer is vague, contradictory, or lacks enough evidence.
- AI records the final resolved decision and keeps unresolved assumptions visible.
- AI should not silently merge context or override authority boundaries.

## Where Used

- R&D Campaign Interview
- Agent Question Queue
- Owner Attention Queue
- Employee Idea Interview
- Post-Campaign R&D Interview
