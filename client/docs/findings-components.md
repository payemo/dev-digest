# Findings component map

How the findings-by-severity UI (see
[specs/pr-findings-severity.md](../specs/pr-findings-severity.md)) is
composed, and why state lives where it does.

## Components

```
client/src/components/findings-summary/FindingsSummary.tsx   (shared, cross-route)
client/src/app/repos/[repoId]/pulls/[number]/_components/
  SeverityCounters/SeverityCounters.tsx     (one run's clickable pills)
  FindingsPanel/FindingsPanel.tsx           (owns filter state + list)
  FindingCard/FindingCard.tsx               (one finding, Accept/Reject)
  RunHistory/RunHistory.tsx                 (Timeline tiles)
client/src/app/repos/[repoId]/pulls/_components/
  PRRow/PRRow.tsx                           (PR list row, FINDINGS column)
```

`FindingsSummary` (`src/components/findings-summary/`, not under any one
route's `_components/`) is the one component both `RunHistory` and `PRRow`
render — badges + a `position: fixed` hover popover, both read-only. It is
shared precisely because the PR list's FINDINGS column and the PR detail
Timeline's tile-hover preview must look and behave identically; duplicating
the popover markup per call site would let them drift.

`SeverityCounters` is a **different** component from `FindingsSummary`,
despite both showing severity + count: `SeverityCounters` renders `Chip`
(a `<button>`, click-to-filter) for exactly one run, always visible when that
run's card is expanded. `FindingsSummary` renders `SeverityBadge` (a `<span>`,
never clickable) and is only ever a hover trigger. See
[client/INSIGHTS.md](../INSIGHTS.md) for the test-query gotcha this split
causes.

## Why `FindingsPanel` owns the filter state

`hideLow` (confidence toggle) and `severityFilter` both live in
`FindingsPanel`, not in `ReviewRunAccordion` or `FindingsTab` above it. Two
reasons:

1. Filtering must stay scoped to **one run** — a card's pills only ever
   affect the findings listed in that same card (criterion: severity
   counters live inside "Review runs", not at the PR level). Lifting the
   state any higher would either leak it across runs or require threading a
   run id through every setter.
2. The counters must always match the cards below them, including while
   `hideLow` is on. `FindingsPanel` computes both from the same
   `visibleFindings(findings, hideLow, …)` call
   (`FindingsPanel/helpers.ts`) — one confidence-filtered list feeds the
   count (with `severityFilter: null`) and the rendered list (with the real
   filter). Splitting `hideLow` and `severityFilter` across two components
   would risk them drifting.

## Data flow for the two previews

- **Timeline hover**: `FindingsTab.tsx` builds `findingsByRun: Map<run_id,
  FindingRecord[]>` once from the already-fetched reviews, and passes it to
  `RunHistory`, which looks up each tile's own findings — no extra fetch.
- **PR-list hover**: the server aggregates across every review of the PR
  (see [server docs](../../server/docs/pr-list-aggregation.md)) and returns
  it as `PrMeta.findings`; `PRRow` renders it as-is.
