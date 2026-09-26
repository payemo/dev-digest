# Insights — `@devdigest/web`

Non-obvious decisions, gotchas, and learnings for this package that aren't
covered by [README.md](README.md) or [docs/](docs/). Append as they come up —
the `engineering-insights` skill knows the format.

## What Works

_Nothing yet._

## What Doesn't Work

### 2026-09-25 — A route-local group header and a shared file-card header sharing `role="button"` + `aria-expanded` collapse into one RTL query

`SmartDiffGroups`' group header and `diff-viewer`'s `FileCard` header both
render `role="button"` + `aria-expanded`, so `getAllByRole("button")` mixes
both tiers and a positional slice (e.g. `.slice(0, 5)`) silently grabs file
cards instead of group headers. Wrap each group in a `<section aria-label={…}>`
landmark (role `region`) to give group headers a distinct, queryable tier.
Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffGroups/SmartDiffGroups.tsx`
vs `client/src/components/diff-viewer/FileCard/FileCard.tsx`.

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

### 2026-09-21 — `Markdown`'s headings/lists had no component overrides, so the global `h1..h4,p { margin: 0 }` reset zeroed their spacing

`vendor/ui/primitives/Markdown.tsx` only styled `p`/`strong`/`code`/`a`; a
rendered `###`/`- ` body fell back to UA-default heading/list styling on top
of `styles.css:205-211`'s margin reset, so headings sat flush against
surrounding text with no visual hierarchy. Any new element type passed
through react-markdown needs its own override here, not just a global CSS
tweak — the global reset zeroes `h1-h4`/`p` margins repo-wide on purpose.
Evidence: `client/src/vendor/ui/primitives/Markdown.tsx`;
`client/src/vendor/ui/styles.css:205-211`.

### 2026-09-24 — Vendored `Badge` accepts no `title`, so a tooltip needs a wrapping `<span title>`

`Badge`'s props are a closed inline type (`children`/`color`/`bg`/`icon`/`dot`/
`mono`/`style`) — passing `title` is a typecheck error, and rebuilding a
`vendor/ui` primitive to add one is forbidden. Wrap the badge instead. Same
family as the `SeverityBadge`-is-a-`<span>` vs `Chip`-is-a-`<button>` entry
above: what the primitive renders, and what it accepts, are both load-bearing.
Evidence: `client/src/vendor/ui/primitives/Badge.tsx:5-21`.

### 2026-09-25 — `FileCard`'s path span has `flex: 1`, so anything appended after it renders far-right, not adjacent

`s.filePath` in `diff-viewer/styles.ts` grows to fill the row, so a marker
meant to sit hard against the path (e.g. a finding-presence dot) needs its own
non-growing flex wrapper around path + marker, not a sibling element appended
after `filePath`.
Evidence: `client/src/components/diff-viewer/styles.ts` (`filePath`,
`pathWrap`); `client/src/components/diff-viewer/FileCard/FileCard.tsx`.

### 2026-09-25 — `SmartDiffGroups`' per-group collapse state resets whenever `DiffTab` swaps it out for the flat `DiffViewer`

`DiffTab` renders `showGrouped ? <SmartDiffGroups …> : <DiffViewer …>` — the
ternary unmounts `SmartDiffGroups` when the user picks "Original order", so
its collapse-state map (seeded from `DEFAULT_COLLAPSED_ROLES`) re-initializes
on the next "Smart order" click instead of persisting. Anything that needs
collapse state to survive the toggle must lift it into `DiffTab` (or a ref/
query param), not assume the component instance persists.
Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx`;
`client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffGroups/SmartDiffGroups.tsx`.

## Tool & Library Notes

### 2026-09-25 — `@testing-library/user-event` isn't an installed dependency here, despite the vendored `react-testing-library` skill mandating it over `fireEvent`

The skill's guidance and this package's actual `package.json` disagree; adding
the dependency for one test would touch `pnpm-lock.yaml` (forbidden for a
one-off — see this package's "Do not touch"). Use `fireEvent` — every existing
test in this package already does.
Evidence: `client/package.json` (no `@testing-library/user-event` dependency).

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

### 2026-09-21 — `jsdiff`'s `diffLines` compares each line WITH its trailing `\n`, false-diffing an otherwise-identical tail

Tokenizing includes the newline, so a body without a trailing `\n` and an
otherwise-identical body that has one produce non-matching last lines — the
whole tail renders as del+add instead of context. Normalize both inputs to
always end in `\n` before diffing.
Evidence: `client/src/app/skills/_components/SkillsWorkbench/_components/SkillEditor/_components/VersionsTab/_components/DiffModal/helpers.ts` (`withTrailingNewline`).

### 2026-09-21 — RTL's `getByDisplayValue`/`getByText` collapse newlines by default, so they can't find a multi-line `<textarea>` by its exact value

The default text normalizer collapses internal whitespace (including `\n`) to
a single space before matching, so `getByDisplayValue(multilineString)` fails
to find a textarea whose live `.value` is byte-identical to that string. Assert
on `document.querySelector("textarea").value` directly for multi-line content
(a Markdown skill body, a multi-line diff) instead of `getByDisplayValue`.
Evidence: `client/src/app/repos/[repoId]/conventions/_components/CreateSkillModal/CreateSkillModal.test.tsx`.

## Recurring Errors & Fixes

_Nothing yet._

## Open Questions

_Nothing yet._
