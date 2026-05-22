# Repository Publication Policy

Verto should support two publication targets:

- Private repository: `https://github.com/Hector-Ha/_verto`; canonical project history, including full domain docs, `AGENTS.md`, `CONTEXT.md`, prototypes, handoff notes, and internal planning docs.
- Public repository: `https://github.com/Hector-Ha/Verto`; sanitized public code/history, excluding private docs by default. Public docs should include `README.md` and only documents explicitly approved for public tracking later.

## Recommended Setup

Use the private repository as the canonical source of truth. Publish public work through a separate public mirror or an orphan public branch so private docs never enter public Git history.

Do not rely on `.gitignore` alone for secrecy. `.gitignore` prevents new accidental adds, but it does not remove files already committed to history.

## Safer Public Mirror Flow

1. Work in the private repository.
2. Track all internal docs in the private repository.
3. Export or copy only allowlisted public files into a separate public repository.
4. Push the public repository to the public remote.

This is safer than attaching a public remote to the same full-history repository because accidental `git push --all` or tag pushes could expose private branches.

## Single Local Repo Alternative

If one local repository must use two remotes:

- Use `private` remote for the full private branch.
- Use a separate orphan `public` branch for public history.
- Configure push refspecs so the public remote only receives the public branch.
- Never push private branches or tags to the public remote.
- Keep public branch docs allowlisted, not denylisted.

This is workable but easier to misuse than a separate public mirror.

## Public Docs Rule

Public repository tracks:

- `README.md`
- Any docs explicitly approved for public tracking later

Public repository does not track by default:

- `AGENTS.md`
- `CONTEXT.md`
- `docs/`
- prototypes, handoff notes, internal planning, and agent metadata
