---
name: sdd
description: >
  Runs this repo's Spec Driven Development pipeline end to end: spec-creator
  → implementation-planner → implementer + test-writer (multi-agent execution)
  → architecture-reviewer (+ security-reviewer when triggered) → a bounded
  fix loop back through implementer → plan-verifier. Accepts any combination
  of an existing spec file, a freeform requirements prompt, and design/mockup
  image paths — at least one is required. Use for "/sdd", "run the SDD
  workflow", "run this through the full pipeline", "start spec driven
  development". Stops at two checkpoints (after the spec, after the plan)
  unless --yolo is passed; the review/fix loop is bounded by --max-fix-rounds
  (default 3) so it can't run away.
---

# SDD pipeline

You are the orchestrator. You run in the **main thread** — not as a
subagent — because this skill needs to talk to the user between phases and
resume specific spawned agents by name. You never write product code, a
spec, or a Development Plan yourself; every artifact is written by the agent
that owns that artifact type. Your own writes are limited to short **Fix
Plan** files (Phase 4) and the run summary you post at the end.

## Args

```
/sdd [--spec <path>] [--prompt "<text>"] [--designs <path1,path2,...>]
     [--yolo] [--max-fix-rounds N] [--skip-security]
```

At least one of `--spec` / `--prompt` / `--designs` is required. If none is
given, ask what the user has (spec file? requirements? mockups?) and stop —
don't guess a scope.

| Flag | Default | Meaning |
|---|---|---|
| `--spec` | — | Path to an existing `<pkg>/specs/NN-*.md` or `specs/NN-*.md`. |
| `--prompt` | — | Freeform requirement text, handed to `spec-creator` as the request (or as the revision note, if `--spec` is also given). |
| `--designs` | — | Comma-separated file paths (mockups, screenshots, exported frames). Never a URL you'd need to fetch — local files only. |
| `--yolo` | off | Skip the two human checkpoints (Phase 1 end, Phase 2 end). Agents' own clarifying-question stops still apply — this flag doesn't silence *them*, only your own gates. |
| `--max-fix-rounds` | `3` | Hard cap on Phase 4's review→fix→re-review loop. |
| `--skip-security` | off | Don't run `security-reviewer` even if the diff trips the security lane. |

Validate `--spec` and every `--designs` path with a quick existence check
before spawning anything — fail fast on a typo'd path instead of discovering
it three agents deep.

## Resuming agents, not restarting them

`spec-creator` and `implementation-planner` both stop and ask clarifying
questions when their input is thin. When that happens: relay the questions to
the user verbatim, get an answer, then **resume that exact agent** via
`SendMessage` (its name from the `Agent` call, or `ListAgents` if you lost
track) — never spawn a fresh instance, which would re-derive context it
already has and burn tokens re-reading `INSIGHTS.md`/`CLAUDE.md` for nothing.
The same rule applies inside Phase 4 if a reviewer's findings are ambiguous
enough that you need to ask the user before writing the fix plan.

## Phase 1 — Spec

- **`--spec` only, no `--prompt`/`--designs`:** read it directly, skip
  `spec-creator` entirely. Sanity-check it has the shape from
  `spec-creator.md`'s template (Functional requirements table,
  Traceability, Self-check all ticked) — if it looks hand-written and thin,
  say so and offer to route it through `spec-creator` anyway rather than
  planning off an ungrounded doc.
- **`--spec` plus `--prompt`/`--designs`:** this is a revision. Spawn
  `spec-creator` with: *"Revise the spec at `<path>`. Read it first. Fold in
  this new requirement: `<prompt>`. Read these design files directly (they
  render as images) and account for what they show:
  `<design paths>`. Remember you rewrite the whole file, never patch."*
- **No `--spec`:** spawn `spec-creator` fresh with the prompt as the request
  and the design paths passed the same way — *"Read these design files
  directly and fold what they show into the requirements: `<paths>`."*
  `spec-creator` has `Read`, which renders images natively; you don't need to
  describe the images yourself, just hand over paths.
- If only `--designs` was given (no prompt text), tell `spec-creator` to
  infer the requirement from what's visible and use its own Step 0 to ask
  the user to confirm that reading rather than guessing silently.

**Keep the original `--designs` paths around** (in your own running summary,
not written anywhere) — `spec-creator` distills them into prose requirements,
but a frontend step in the plan later still benefits from `implementer`
looking at the actual mockup for pixel-level detail. Re-hand them to
`implementer` in Phase 3 for any step touching `client/**`.

**Checkpoint 1** (skip if `--yolo`): once `spec-creator` returns a path,
read the file, show the user a short synopsis (Goal, FR count, Open
questions) and ask for go-ahead before planning. A revision request here
goes back to `spec-creator` via `SendMessage` — you never hand-edit the spec
file yourself.

## Phase 2 — Plan

Spawn `implementation-planner` with the approved spec's path. Tell it up
front: *"This run always executes multi-agent — `implementer` owns code
steps, `test-writer` owns test steps, `architecture-reviewer` (and
`security-reviewer` if its lane triggers) run as review passes after
implementation. Record Execution mode: multi-agent; you don't need to ask
about it."* This skips a clarifying round-trip the planner would otherwise
always make (its own Step 2 says "always ask" — you're answering it up front
because this skill's whole point is the multi-agent shape).

Relay any other clarifying questions and its *Recommendation* section to the
user as usual; resume via `SendMessage` on an answer, don't restart.

**Checkpoint 2** (skip if `--yolo`): show the plan's summary (step count,
packages touched, migration/contract flags) and ask for go-ahead before
execution starts — this is the cheapest point to redirect scope, before any
code exists. A revision goes back to `implementation-planner` via
`SendMessage`.

## Phase 3 — Execution

1. Spawn `implementer` with the plan's path. It self-filters by the plan's
   `Owner` column (its own Step 0 already does this — don't pre-filter steps
   yourself). If any step's files are under `client/**`, mention the
   relevant `--designs` paths in the same call so it can check pixel-level
   detail directly, not just the spec's prose description.
2. Check its Verdict. `blocked` → stop the whole pipeline here and surface
   the blocker; don't run `test-writer` or the reviewers against code that
   didn't finish. `partial` is fine *only* when every "Not done" item is
   listed as handed off to a named specialist, not as blocked.
3. Spawn `test-writer` **after** `implementer` finishes, not in parallel —
   it can't meaningfully test code that doesn't exist yet. Note:
   `test-writer`'s own contract (unlike `implementer`'s) doesn't read a
   plan's `Owner` column itself — it expects "a named file, module,
   component, or behaviour." So extract the `Owner: test-writer` rows from
   the plan's Steps and Test plan tables yourself, and hand `test-writer` an
   explicit target list plus the plan path for context. (This is a real gap
   in `test-writer.md` relative to `implementer.md`/`architecture-reviewer.md`
   — worth closing there directly at some point so this translation step
   isn't needed; flagging it here rather than silently working around it
   forever.)

## Phase 4 — Review & bounded fix loop

1. Decide which reviewers apply to this diff:
   - `architecture-reviewer` — only if `server/**` or `reviewer-core/**`
     changed (it's backend-only by design; skip it for a client-only plan).
   - `security-reviewer` — only if the diff's *added lines* trip
     [`pr-self-review/routing.md`](../pr-self-review/routing.md)'s security
     lane (env vars, secret/token/password, `child_process`, raw SQL, a new
     public route, `dangerouslySetInnerHTML`, outbound fetch to a non-fixed
     URL), and `--skip-security` wasn't passed.
   - Neither applies → Phase 4 is a no-op, go straight to Phase 5.
2. Run the applicable reviewer(s) **in parallel** (one message, multiple
   `Agent` calls) — both are read-only and independent, no reason to
   serialize them.
3. Filter findings to `CRITICAL`/`WARNING`. `SUGGESTION`-only results don't
   block the loop — carry them into the final summary as non-blocking notes,
   per these agents' own "an empty findings list is a good outcome" stance;
   don't manufacture a fix round to chase taste.
4. No `CRITICAL`/`WARNING` → loop ends, go to Phase 5.
5. Otherwise, **you** write a short Fix Plan at
   `docs/plans/<slug>-fix-round-<N>.plan.md`, reusing
   `implementation-planner`'s template but abbreviated: one Step per
   finding, `Files` = the finding's `file:lines`, `Change` = "address:
   <rationale>", `Constraint` = the cited rule, `Owner: implementer`,
   `Done when`: "the reviewer no longer reports this finding on a re-scan."
   `Execution mode: single agent`. Don't route this through
   `implementation-planner` — it's a mechanical translation of an existing
   findings table, not a planning decision.
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

## Phase 5 — Plan verification

Run `plan-verifier` against the **original** Development Plan from Phase 2,
not the fix-plan(s) — its scope discipline already ignores anything that
doesn't trace to a named step or explicit requirement, so the fix-plans
don't need special handling here. Mention their existence and round count in
your own summary instead.

`Not done`, or a deviation it marks unjustified → stop and hand it to the
user rather than looping back into `implementer` automatically; a plan-level
gap this late is a structural question, not something to auto-patch.

## Phase 6 — Summary

Post one summary: spec path, plan path, fix-plan paths and round count (if
any), reviewer verdicts, `plan-verifier` verdict, test status per package.
Point at the `pr-self-review` skill as the next manual step before `gh pr
create` — don't invoke it yourself; opening a PR is a separate, explicit
action the user takes.

## Hard constraints

- Never write product code, a spec file, or a Development Plan — only Fix
  Plan files (Phase 4) and this run's own summary.
- Never resume the wrong agent instance — an answer to `spec-creator`'s
  question goes to `spec-creator`, never folded silently into the next
  phase's prompt to a different agent.
- Never skip Checkpoint 1/2 silently — either they ran, or `--yolo` was
  explicitly passed.
- Never loop Phase 4 past `--max-fix-rounds`, and never re-run a fix attempt
  against a finding that already survived one unchanged.
- Never invoke `gh pr create` or the `pr-self-review` skill's blocking run
  yourself — name it as the next step, don't execute it.
