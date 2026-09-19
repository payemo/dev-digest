# Spec — Findings by severity (PR detail + PR list)

Feature behind the severity counters, the severity filter, and the two
read-only findings previews (PR list hover popover, PR-detail Timeline hover
tile). Severities are exactly `CRITICAL | WARNING | SUGGESTION`
(`server/src/vendor/shared/contracts/findings.ts`) — no fourth level.

## 1. Per-run severity counters (PR detail → Agent runs → Review runs)

Location: inside one expanded review-run card, under its verdict/score
banner — **not** at the "Review runs" section level and **not** PR-wide.

1. Open a PR → **Agent runs** tab → **Review runs** section.
2. Click a run's card to expand it.
3. Below the verdict banner (verdict, PR SCORE), a pill row reads
   `N CRITICAL · N WARNING · N SUGGESTION` — only severities actually present
   in that run are shown.
4. Clicking a pill filters the finding cards below it, in this same run, to
   that severity only. Clicking the active pill again clears the filter.
5. Every pill's number always equals the number of finding cards rendered
   below it in that run, including while "Hide low confidence" is toggled —
   both derive from the same pre-severity-filter list
   (`FindingsPanel/helpers.ts`'s `visibleFindings`).

Counting is a plain `Array.reduce`/group-by over already-fetched findings
(`countBySeverity` in `client/src/components/findings-summary`) — never an
LLM call, never re-fetched on filter toggle.

Implementation: `SeverityCounters` (chips) + `FindingsPanel` (owns both
`hideLow` and `severityFilter` state) —
`client/src/app/repos/[repoId]/pulls/[number]/_components/SeverityCounters/`,
`.../FindingsPanel/`.

## 2. Timeline tiles (PR detail → Agent runs → Timeline)

Each run tile in the Timeline shows the same severity icon+count badges via
the shared `FindingsSummary` component, scoped to that one run's findings —
but the tile itself is **not clickable** for findings. Hovering the badges
opens a read-only preview card (title "N findings in this run"; severity,
title, category, file:line, confidence, a 2-line rationale — no buttons).

Implementation: `RunHistory.tsx` passes `findingsByRun.get(r.run_id)` into
`<FindingsSummary>`; `findingsByRun` is built once in `FindingsTab.tsx` from
the already-fetched `ReviewRecord[]`.

## 3. PR list — FINDINGS column + popover

On the PR list (all PRs), a FINDINGS column shows severity icon+count badges
aggregated across **every review of that PR**, not just its latest run — so
a critical finding from an older run is never hidden behind a newer,
less-severe one. Hovering opens the same read-only popover
("N findings in this run" — see [client/INSIGHTS.md](../INSIGHTS.md) for why
that title stays even though the data is PR-wide: on the PR list, "this run"
and "this PR" coincide for every PR with a single review, and the shared
`FindingsSummary` component is the same one Timeline tiles use with a
genuinely single-run scope).

Aggregation happens server-side in `GET /repos/:id/pulls`
(`server/src/modules/pulls/routes.ts`) — one `IN` query over every review id
of every listed PR, `flatMap`'d per PR. See
[server/specs/pr-cost-and-findings.md](../../server/specs/pr-cost-and-findings.md).

## 4. Accept/Reject stays PR-detail-only

The popover on the PR list and the Timeline's hover tile are read-only by
design — no buttons. Accept/Reject only exist on the expanded review-run
card's `FindingCard` (PR detail page). The button previously labelled
"Dismiss" is now labelled **"Reject"** in the UI; the persisted action/field
stay `dismiss` / `dismissed_at` (`messages/en/prReview.json`).
