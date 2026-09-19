# Insights — `@devdigest/web`

Non-obvious decisions, gotchas, and learnings for this package that aren't
covered by [README.md](README.md) or [docs/](docs/). Append as they come up —
the `engineering-insights` skill knows the format.

## What Works

_Nothing yet._

## What Doesn't Work

_Nothing yet._

## Codebase Patterns

### 2026-09-18 — SeverityBadge is a `<span>`, Chip is a `<button>` — don't query one as the other

`FindingsSummary`'s read-only badges use `SeverityBadge` (non-interactive
`<span>`); `SeverityCounters`' clickable pills use `Chip` (`<button>`). An RTL
query like `getByRole("button", { name: /CRITICAL/ })` silently matches the
wrong component depending on which one is under test.
Evidence: `client/src/components/findings-summary/FindingsSummary.tsx:60` vs
`client/src/app/repos/[repoId]/pulls/[number]/_components/SeverityCounters/SeverityCounters.tsx`.

### 2026-09-18 — FindingsSummary's hover card must be `position: fixed`, not `absolute`

The PR-list table clips overflow, so an absolutely-positioned popover would
get cut off; positioning `fixed` off the trigger's `getBoundingClientRect()`
escapes the clip.
Evidence: `client/src/components/findings-summary/FindingsSummary.tsx:94-96`.

### 2026-09-18 — Severity pill counts must be tallied from the same pre-filter stage as the cards shown below them

Tallying from raw findings desyncs the pill number from the actual card count
once "hide low confidence" is toggled. Tally after the confidence filter and
before the severity filter instead.
Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:34-39`.

## Tool & Library Notes

_Nothing yet._

## Recurring Errors & Fixes

_Nothing yet._

## Open Questions

_Nothing yet._
