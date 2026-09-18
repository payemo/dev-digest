# PR list: aggregation shape

`GET /repos/:id/pulls` (`src/modules/pulls/routes.ts`) attaches three
per-PR fields computed on read: latest score, total successful-run cost, and
all-reviews findings (contract in
[server/specs/pr-cost-and-findings.md](../specs/pr-cost-and-findings.md)).
All three follow the same shape, chosen because the list is small enough
that it beats a denormalized column or a cache:

1. Collect `prIds` from the already-fetched PR rows.
2. One `IN (...)` query per relation (`reviews`, `findings`, `agent_runs`),
   filtered to `prIds` (and, for runs, `status = 'done'`).
3. Group the rows into a `Map<prId, T[]>` in JS.
4. Map each PR row to its DTO, reading its own bucket out of each `Map`.

This is 3 extra queries total regardless of how many PRs are listed (not
3 × N), and keeps the "what counts as a PR's total" policy in one place per
concept (`sumRunCosts` in `src/platform/run-cost.ts`, `findingRowToDto` in
`src/modules/reviews/helpers.ts`) instead of duplicated per read path.

## Score

`reviews` rows for the PR's ids, `kind = 'review'`, ordered
`createdAt DESC`. The **first** row seen per PR (newest) is its score;
`reviewIdsByPr` also collects every review id per PR for the findings step.

## Findings

`findings` rows `WHERE review_id IN (all review ids across all listed PRs)`,
grouped by `reviewId`, then `flatMap`'d per PR via `reviewIdsByPr`. This is
why findings are PR-wide, not latest-run-only — the grouping key is
"reviews belonging to this PR", not "the PR's most recent review".

## Cost

`agent_runs` rows `WHERE workspace_id = ? AND pr_id IN (...) AND status =
'done'`, summed with `sumRunCosts` (`src/platform/run-cost.ts`):
provider-reported `costUsd` wins verbatim when present; otherwise it's
derived from `model` + `tokensIn`/`tokensOut` via the `PriceBook`, never a
second model call. An empty per-PR bucket sums to `null`, not `0` — see
[pr-cost-and-findings.md](../specs/pr-cost-and-findings.md#cost_usd).

`status = 'done'` is applied in the SQL `WHERE`, not filtered in JS after the
fact — a failed run's row never even reaches `runsByPr`.
