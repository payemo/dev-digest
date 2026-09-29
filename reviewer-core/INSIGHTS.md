# Insights — `@devdigest/reviewer-core`

Non-obvious decisions, gotchas, and learnings for this package that aren't
covered by [README.md](README.md) or [docs/](docs/). Append as they come up —
the `engineering-insights` skill knows the format.

## What Works

_Nothing yet._

## What Doesn't Work

_Nothing yet._

## Codebase Patterns

### 2026-09-29 — `assembly.specs` is the wrapped blocks WITHOUT the `## Project context` heading — the heading exists only inside `assembly.user`

`assemblePrompt` builds `specsBlock` as the `wrapUntrusted`-ed elements joined
by a blank line, pushes `` `## Project context\n${specsBlock}` `` into
`userSections`, and then records the bare `specsBlock` as `assembly.specs`. Same
shape for `skills`, `memory` and `repo_map`. So a consumer asserting that
`assembly.specs` contains the section heading, or a UI implying the recorded
slot IS the rendered section, is wrong — the heading is trusted framing the
engine owns and it lives only in the joined `user` message.
Evidence: `reviewer-core/src/prompt.ts` (`specsBlock`, `userSections`, the
`assembly` literal).

## Tool & Library Notes

_Nothing yet._

## Recurring Errors & Fixes

_Nothing yet._

## Open Questions

_Nothing yet._
