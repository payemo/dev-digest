---
name: implement
description: >
  Runs this repo's plan-execution pipeline against an existing Development
  Plan: implementer → architecture-reviewer (+ security-reviewer when
  triggered) → a bounded fix loop back through implementer → plan-verifier.
  Deliberately does NOT run spec-creator or implementation-planner — the plan
  passed in must already exist; write or revise it separately via those
  agents first, this skill only consumes the finished file. test-writer is
  not run by this pipeline (cost-saving default, 2026-09-29) — invoke it
  separately via the Agent tool when test coverage is needed for the plan's
  steps. Use for "/implement", "implement this plan", "run docs/plans/X
  through review", "execute this plan and verify it", "carry out the plan
  and check it". The review/fix loop is bounded by --max-fix-rounds (default
  3) so it can't run away.
---

# Implement pipeline

You are the orchestrator. You run in the **main thread** — not as a
subagent — because this skill needs to resume specific spawned agents by
name and talk to the user if `implementer` gets blocked. You never write
product code or a Development Plan yourself; every artifact is written by the
agent that owns that artifact type. Your own writes are limited to short
**Fix Plan** files (Phase 2) and the run summary you post at the end.

This is the narrower sibling of the `sdd` skill: `sdd` runs the whole
spec → plan → execute → review → verify pipeline; this skill starts **after**
a plan already exists, because this repo runs `spec-creator` and
`implementation-planner` manually (directly via the `Agent` tool) rather than
through an orchestrating skill.

## Args

```
/implement --plan <path> [--designs <path1,path2,...>]
           [--max-fix-rounds N] [--skip-security]
```

| Flag | Default | Meaning |
|---|---|---|
| `--plan` | — (required) | Path to the `docs/plans/<slug>.plan.md` to execute. |
| `--designs` | — | Comma-separated local file paths (mockups, screenshots) for any plan step touching `client/**` — handed to `implementer` for pixel-level detail beyond the plan's prose. Never a URL. |
| `--max-fix-rounds` | `3` | Hard cap on Phase 2's review→fix→re-review loop. |
| `--skip-security` | off | Don't run `security-reviewer` even if the diff trips the security lane. |

Validate `--plan` and every `--designs` path with a quick existence check
before spawning anything — fail fast on a typo'd path instead of discovering
it agents deep. If `--plan` is missing entirely, ask for the path and stop —
don't guess which plan under `docs/plans/` was meant.

## Resuming agents, not restarting them

If `implementer` reports `blocked` because a step's instructions conflict
with something it found in `CLAUDE.md`/`INSIGHTS.md`, or a step is genuinely
ambiguous, relay the specifics to the user verbatim, get a decision, then
**resume that exact `implementer` instance** via `SendMessage` (its name from
the `Agent` call, or `ListAgents` if you lost track) — never spawn a fresh
one, which would re-derive context it already has and burn tokens re-reading
`INSIGHTS.md`/`CLAUDE.md` for nothing.

## Phase 1 — Execution

1. Spawn `implementer` with the `--plan` path. It self-filters by the plan's
   `Owner` column if the plan's Execution mode is multi-agent (its own Step 0
   already does this — don't pre-filter steps yourself). If any step's files
   are under `client/**`, mention the relevant `--designs` paths in the same
   call.
2. Check its Verdict. `blocked` → stop the whole pipeline here and surface
   the blocker; don't run the reviewers against code that didn't finish.
   `partial` is fine *only* when every "Not done" item is listed as handed
   off to a named specialist (e.g. a step whose Owner is `test-writer`), not
   as blocked.
3. **No `test-writer` run here, by design.** If the plan's Steps table has
   rows owned by `test-writer`, they'll show up in `implementer`'s report as
   handed off, not done — note them in your own final summary as
   "test coverage not run (skill default)" rather than silently dropping
   them. If the user wants that coverage now, say so and name the manual
   step: spawn `test-writer` directly with the plan's `Owner: test-writer`
   rows as its target list.

## Phase 2 — Review & bounded fix loop

1. Decide which reviewers apply to this diff:
   - `architecture-reviewer` — only if `server/**` or `reviewer-core/**`
     changed (it's backend-only by design; skip it for a client-only plan).
   - `security-reviewer` — only if the diff's *added lines* trip
     [`pr-self-review/routing.md`](../pr-self-review/routing.md)'s security
     lane (env vars, secret/token/password, `child_process`, raw SQL, a new
     public route, `dangerouslySetInnerHTML`, outbound fetch to a non-fixed
     URL), and `--skip-security` wasn't passed.
   - Neither applies → Phase 2 is a no-op, go straight to Phase 3.
2. Run the applicable reviewer(s) **in parallel** (one message, multiple
   `Agent` calls) — both are read-only and independent, no reason to
   serialize them.
3. Filter findings to `CRITICAL`/`WARNING`. `SUGGESTION`-only results don't
   block the loop — carry them into the final summary as non-blocking notes,
   per these agents' own "an empty findings list is a good outcome" stance;
   don't manufacture a fix round to chase taste.
4. No `CRITICAL`/`WARNING` → loop ends, go to Phase 3.
5. Otherwise, **you** write a short Fix Plan at
   `docs/plans/<plan-slug>-fix-round-<N>.plan.md` (`<plan-slug>` = the input
   `--plan` file's own basename minus `.plan.md`), reusing
   `implementation-planner`'s template but abbreviated: one Step per finding,
   `Files` = the finding's `file:lines`, `Change` = "address: <rationale>",
   `Constraint` = the cited rule, `Owner: implementer`, `Done when`: "the
   reviewer no longer reports this finding on a re-scan." `Execution mode:
   single agent`. Don't route this through `implementation-planner` — it's a
   mechanical translation of an existing findings table, not a planning
   decision.
6. Spawn `implementer` on that fix-plan path. It runs its own scoped
   verification per its Verification section (touched packages only).
7. Re-run the *same* reviewer(s) from step 2 — they naturally re-scan the
   current diff against `$BASE`, no special handling needed.
8. Compare this round's findings to the previous round's:
   - An **identical** finding (same rule, same file:lines) surviving a fix
     attempt is the same "don't retry blindly" signal as `implementer`'s own
     "same test fails twice" stop condition — escalate that specific finding
     to the user instead of spending another round on it.
   - Genuinely new findings (the fix introduced a different violation) count
     as a fresh round.
9. Stop at `--max-fix-rounds` regardless of outcome (default 3) and report
   what's still open — this loop exists because the user explicitly wants
   fix iterations, but it must be bounded or it burns tokens without limit.

## Phase 3 — Plan verification

Run `plan-verifier` against the **original** `--plan` file, not the
fix-plan(s) — its scope discipline already ignores anything that doesn't
trace to a named step or explicit requirement, so the fix-plans don't need
special handling here. Mention their existence and round count in your own
summary instead.

`Not done`, or a deviation it marks unjustified → stop and hand it to the
user rather than looping back into `implementer` automatically; a plan-level
gap this late is a structural question, not something to auto-patch.

## Phase 4 — Summary

Post one summary: the input plan path, fix-plan paths and round count (if
any), reviewer verdicts, `plan-verifier` verdict, and which plan steps (if
any) were owned by `test-writer` and therefore not covered by this run. Point
at the `pr-self-review` skill as the next manual step before `gh pr create`
— don't invoke it yourself; opening a PR is a separate, explicit action the
user takes.

## Hard constraints

- Never write product code or a Development Plan — only Fix Plan files
  (Phase 2) and this run's own summary.
- Never spawn `spec-creator` or `implementation-planner` — this skill starts
  from an existing plan file; a request that actually needs a new or revised
  plan belongs to `sdd` or to those agents run directly, not here.
- Never spawn `test-writer` — that omission is this skill's whole point;
  name the gap in the summary instead of silently closing it or silently
  ignoring it.
- Never resume the wrong agent instance.
- Never loop Phase 2 past `--max-fix-rounds`, and never re-run a fix attempt
  against a finding that already survived one unchanged.
- Never invoke `gh pr create` or the `pr-self-review` skill's blocking run
  yourself — name it as the next step, don't execute it.
