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

### 2026-09-21 — A nav item's display label has no single source of truth — the sidebar and the command palette each translate it differently

`vendor/ui/shell/NavItem.tsx` prints `item.label` and `Sidebar.tsx` prints
`grp.section` RAW (not through next-intl) straight from the literal strings in
`vendor/ui/nav.ts`. The command palette instead re-translates the same item via
`t(\`nav.${it.key}\`)` from `messages/en/shell.json`. Renaming a nav item means
editing both `nav.ts`'s literal and `shell.json`'s `nav.<key>` — there's no
single place that owns the label.
Evidence: `client/src/vendor/ui/shell/NavItem.tsx:54`;
`client/src/components/app-shell/hooks/useShellCommands.ts:24`.

### 2026-09-21 — Pre-scaffolded i18n copy in this repo can describe an intended design, not the actual pipeline — verify against reviewer-core before trusting it

`messages/en/skills.json`'s `file.bodyHint` and `preview.untrustedNotice`
(written before the Skills feature was implemented) claimed skill bodies are
"wrapped as untrusted data" — but `reviewer-core/src/prompt.ts`'s
`assemblePrompt` never wraps the skills block; it's injected as trusted
instructions. Don't treat scaffolded UI copy as a source of truth for a
security/trust claim — check the actual prompt-assembly code.
Evidence: `client/messages/en/skills.json` (`editor.config.vettingHint`, fixed
in the 2026-09-21 skills feature); `reviewer-core/src/prompt.ts:39-73`.

## Tool & Library Notes

### 2026-09-21 — `@devdigest/ui`'s `Donut` is built for money, not counts — `MetricCard`'s `suffix` is for a short unit, not a sentence

`charts/Donut.tsx` hardcodes `valuePrefix="$"` and `.toFixed(2)` on every
segment value — using it for an integer breakdown (e.g. findings by category)
renders "12.00" with a stray "$". Use `BarRow` (label + bar + a plain integer
suffix) for count data instead. Separately, `MetricCard`'s `suffix` prop
renders directly appended after the big value in the same row/font with no
gap — it's for "%"/"ms", not an explanatory phrase like "12 of 40 runs"; put
that in your own `<span>` below the card instead.
Evidence: `client/src/vendor/ui/charts/Donut.tsx` (`valuePrefix = "$"`);
`client/src/vendor/ui/charts/MetricCard.tsx` (the `suffix` span, same font row
as `value`).

## Recurring Errors & Fixes

_Nothing yet._

## Open Questions

_Nothing yet._
