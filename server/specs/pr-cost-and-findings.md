# Spec — `GET /repos/:id/pulls` list-endpoint contract

The PR list endpoint attaches three read-time-computed fields to each `PrMeta`
row, all `nullish` in the zod contract
(`server/src/vendor/shared/contracts/platform.ts`). None require an LLM call.

## `score`

The **latest** review's score for that PR (`kind: 'review'` rows only,
newest `createdAt` first). `null` when the PR has never been reviewed.

## `cost_usd`

The sum of `effectiveRunCost` (see
[server/docs/pr-list-aggregation.md](../docs/pr-list-aggregation.md)) across
every `agent_runs` row for that PR with `status = 'done'` — **successful
runs only**. Failed, cancelled, or in-flight runs never contribute, even if
one somehow carries a provider-reported `costUsd`.

- No successful runs → `null` (the list renders a dash, matching the SCORE
  and FINDINGS columns' "no data" convention — never a misleading `$0.00`).
- At least one successful run → a number, even if every priced run rounds to
  `0` (e.g. a free/local model).

## `findings`

For **each unique agent** that has run on the PR, only that agent's **most
recent** run's findings count — then those per-agent latest counts are
**summed across every agent**. A repeated run of the same agent no longer
stacks its stale findings on top of its newer ones; only its last run
contributes (e.g. General Reviewer run 3 times → only run 3's findings
count, not runs 1+2+3 combined).

This is *not* the same as "the single latest review overall": scoping to
one PR-wide latest review hid critical findings from an earlier, more-severe
*different* agent's review behind a newer but less-severe one (e.g. PR #482:
a Security Reviewer run with 2 `CRITICAL` findings, followed later by a
Performance Reviewer run with only `WARNING`/`SUGGESTION` findings — "latest
run only" showed 2 findings and dropped both criticals). Per-agent scoping
avoids that regression: Security Reviewer and Performance Reviewer are
different agents, so each one's own latest (here, only) run is counted
independently and both contribute to the sum, regardless of run order.

Consumers group this flat list by `severity` client-side
(`countBySeverity`, a plain reduce — see
[client/specs/pr-findings-severity.md](../../client/specs/pr-findings-severity.md))
to drive the FINDINGS column's badges and its hover popover.

## Non-goals

- No pagination or filtering of `findings` at the list endpoint — a PR with
  many agents returns each agent's latest-run findings; the client's popover
  scrolls.
- No caching layer — all three fields are computed fresh on every list read
  (see the aggregation shape in
  [pr-list-aggregation.md](../docs/pr-list-aggregation.md) for why that's
  cheap enough not to need one at this scale).
