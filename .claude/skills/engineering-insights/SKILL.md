---
name: engineering-insights
description: >
  Captures a non-obvious engineering finding into the INSIGHTS.md of the package
  it belongs to — client, server, reviewer-core, e2e, or the repo root. Use
  proactively and mid-session the moment something is learned the hard way: a fix
  that took more than one attempt, a library or tool behaving unexpectedly, a
  convention inferred from the code, a dead end worth not repeating, a decision
  with a reason the diff will not show. Use again when wrapping up a session, and
  for "capture this", "add to insights", or "/engineering-insights".
---

Knowledge that dies with the session gets re-derived next session. This skill
moves one finding out of the conversation and into the file where the next agent working on that code will read it.

Write **as you go**, not only at the end — a wrap-up you have to remember is a
wrap-up you will skip.

## Where it goes

| Work that produced the finding | File |
|---|---|
| `client/**` | `client/INSIGHTS.md` |
| `server/**`, incl. `src/modules/repo-intel` and `src/vendor/shared` | `server/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| `scripts/`, `docker-compose.yml`, `.github/workflows/`, `.claude/`, root docs | `INSIGHTS.md` (root) |

Tie-breakers:

- `repo-intel` is server code — its findings go to `server/INSIGHTS.md`.
- `@devdigest/shared` lives in the server — contract findings go there, even
  when the symptom appeared in the client or reviewer-core.
- A finding that spans two packages is filed where the **cause** lives, not
  where the symptom surfaced.
- The root file is a last resort. See [The root file is on a budget](#the-root-file-is-on-a-budget).

## The bar

An entry must clear all four. If it fails one, don't write it — writing nothing
is a valid outcome, and a file of filler is worse than a short file.

1. **Non-obvious.** The test: *if anyone reading this code would already know
   it, don't write it.*
2. **Actionable cold.** An agent reads the entry with no other context and knows
   what to do or avoid, without re-investigating.
3. **Evidenced.** Cites a real `path/file.ts:line`, a command, or a verbatim
   error string.
4. **Not already documented.** Not in that package's `README.md`, `CLAUDE.md`,
   `docs/` or `specs/`. This file is for what those do *not* cover.

## Sections

Six, in this fixed order. Pick the one that fits; don't invent new ones.

- `## What Works` — an approach tried here and confirmed. Reuse it.
- `## What Doesn't Work` — a dead end or antipattern *in this repo*, and why it
  fails. Never skip this section on the grounds that nothing failed — negative
  findings save the most time, and this is the section most often left empty.
- `## Codebase Patterns` — a convention or architectural decision inferred from
  the code, plus the reason it exists.
- `## Tool & Library Notes` — a dependency, CLI or service behaving in a way its
  own docs don't lead you to expect.
- `## Recurring Errors & Fixes` — a concrete error message and its fix, so the
  next occurrence is a lookup instead of a debug session.
- `## Open Questions` — a real uncertainty left behind, including what was
  already ruled out.

## Entry format

Append under the right heading:

```markdown
### 2026-09-16 — Short claim, stated as a fact

Two to four lines: what happens, why it happens, what to do instead.
Evidence: `server/src/modules/repo-intel/indexer.ts:142`.
```

Rules:

- **Append-only.** Never rewrite or delete an existing entry. (One exception,
  for the root file only — see below.)
- **Read before you write.** Scan the target file for a duplicate first. If the
  finding is already there, add nothing. If it *corrects* an existing entry,
  append a new dated entry that names and supersedes the old one, and leave the
  old one in place.
- **One finding per entry.** Two findings, two entries.
- Create the section heading if the file lacks it, keeping the six in order.

## The root file is on a budget

`INSIGHTS.md` at the repo root holds only what no single package owns. It is
read rarely and must stay small, so it has stricter rules than the package
files:

- **Last resort, with a test.** Before writing there, ask: *would a session
  working in exactly one package need this?* If yes, it belongs to that
  package's file. Only a genuine no lands in the root file.
- **Two lines, hard.** One claim line, one line of consequence, plus evidence.
  Package files allow four; the root allows two.
- **Capped at 15 entries.** At the cap, appending is not allowed on its own.
  First either (a) move an entry that has since become package-scoped into that
  package's file, or (b) drop one that is obsolete — then append, and say which
  you did. This is the only sanctioned exception to append-only.
- **Never inlined.** Don't copy the root file's content into `CLAUDE.md`.
  `CLAUDE.md` is auto-loaded every session; `INSIGHTS.md` is read only when
  work is actually happening at that level. That separation is what keeps these
  files off the per-session context budget.

## When to fire

Proactively, the moment any of these happens — don't wait to be asked:

- a fix that took more than one attempt
- a library, CLI or service that didn't behave as its docs suggest
- a convention discovered by reading code rather than docs
- an approach tried and abandoned, with the reason it was abandoned
- a decision made for a reason the diff won't record
- a CI or test failure whose real cause wasn't in the error message
- at session wrap-up: one last pass for anything not yet captured

## Examples

*Illustrative — do not copy these into INSIGHTS.md.*

❌ `Promises can be tricky.`
✅ `Promise.all()` on the ingest pipeline times out past ~30 items. Use
`Promise.allSettled()` in batches of 10 for this module.
Evidence: `server/src/modules/repo-intel/indexer.ts:142`.

❌ `Be careful with the e2e tests.`
✅ Flow `04` assumes the seeded repo is the only repo in the DB — against a dev
DB with other imports it lands on the wrong repo and fails on a selector, not on
a clear assertion. Run `./scripts/e2e.sh` instead of debugging it.

❌ `Today we refactored the indexer and fixed the embeddings bug.` (session
narration — the git log already has this)
✅ The one durable fact from that session: `EMBEDDINGS_ENABLED=false` makes the
indexer skip the embed step silently, so an "indexed" repo can still have zero
vectors. Check `repo.indexed_at` *and* the chunk count before blaming retrieval.

## Boundaries

Does not: restate `README.md` or `CLAUDE.md`; record session narration; write an
entry without evidence; invent a finding to have something to write; edit code;
stage or commit anything. It appends to one `INSIGHTS.md` and reports which file
and section it wrote to.
