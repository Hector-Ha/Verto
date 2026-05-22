# Domain Docs

This repo uses a single-context domain documentation layout.

## Sources

- `CONTEXT.md` contains canonical business language.
- `docs/adr/` contains architectural decision records when a hard-to-reverse technical or product decision needs rationale.
- `docs/index.html` is the readable product documentation hub for the innovation pipeline concept.

## Consumer Rules

- Read `CONTEXT.md` before making domain-heavy product or architecture changes.
- Prefer terms already defined in `CONTEXT.md`.
- Add ADRs only for meaningful trade-offs that future contributors would not understand from code or docs alone.

