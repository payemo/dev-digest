# Insights — `@devdigest/api`

Non-obvious decisions, gotchas, and learnings for this package that aren't
covered by [README.md](README.md) or [docs/](docs/) — `repo-intel` and the
`@devdigest/shared` contracts included. Append as they come up — the
`engineering-insights` skill knows the format.

## What Works

_Nothing yet._

## What Doesn't Work

### 2026-09-18 — Gate a seed's dependent-row insert on the dependent rows, not on "was the parent row just inserted"

`seedPr482Timeline()` was gated on `pr482IsNew` (true only when the PR row
itself was freshly inserted), so it silently no-op'd for any DB that already
had PR #482 — the rich timeline never landed. Gate on whether the PR has any
`agent_runs` row yet instead.
Evidence: `server/src/db/seed.ts` (the `existingRun` guard before `seedPr482Timeline`).

## Codebase Patterns

### 2026-09-19 — A `reviews` row only ever exists for a successful run

`insertReview` has exactly one call site, and it sits *inside* the `try`
block of `runOneAgent`, right before the success-path `completeAgentRun(status:
'done')` — the `catch` block (failure/cancellation) never reaches it. So a
`reviews` row implies its producing `agent_runs` row was `status: 'done'` at
insert time; joining `reviews.run_id → agent_runs.id` to filter on `status`
is a no-op and unnecessary when aggregating findings/scores by review.
Evidence: `server/src/modules/reviews/run-executor.ts:219` (insert) vs `:244`
(success) and `:300-311` (failure/cancel, no insert).

## Tool & Library Notes

_Nothing yet._

## Recurring Errors & Fixes

### 2026-09-18 — An integration test's fixture assumptions go stale silently when a shared seed changes

`run-cost.it.test.ts` asserted PR #482 sums to exactly `0.43` on the claim it
"has zero `agent_runs`" — but `seedPr482Timeline` (added later) gives it two
real `done` runs ($0.0012 + $0.0008), so the true sum is `0.432`. The test
kept passing at the wrong number until an unrelated `status='done'` filter
change perturbed the total enough to fail.
Evidence: `server/test/run-cost.it.test.ts`.

## Open Questions

_Nothing yet._
