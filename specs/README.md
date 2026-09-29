# Specs

Top-level catalog for **cross-module specs** — a feature whose scope spans
more than one package (`server/`, `client/`, `reviewer-core/`, `e2e/`,
`mcp/`, or the shared contracts). A spec scoped to a single package lives in
that package's own `<pkg>/specs/` instead — see that package's `CLAUDE.md`.

## Role in the pipeline

`spec-creator` writes the spec — before any plan exists, from a requirement,
an issue, or a rough ask, investigating with `researcher` subagents wherever
the requirement itself doesn't say enough. `implementation-planner` then
reads it as its **input**, not something it produces itself, and turns it
into a Development Plan. `doc-writer` can also add or update a spec here,
but only *retrospectively* — writing up something already built that never
had one. A spec written by `spec-creator` is prescriptive (what to build); one
backfilled by `doc-writer` is descriptive (what got built) — don't confuse
the two, and say which kind a given file is if it isn't obvious from its
`Status`.

## What belongs in a spec — and what doesn't

A spec describes **what** and **why**, grounded enough to plan from, without
prescribing **how** to build it:

- Goal, scope, and the requirements a build must satisfy.
- Workflow diagrams — a request's path through the system, a state machine.
- Service-to-service communication — who calls whom, over what, in what
  order.
- Contracts, where they're load-bearing for the design — a shape, an event
  payload, an API surface — without pinning them to a specific file or type
  name in the codebase.
- **No implementation detail:** no file paths, no function/class names, no
  library choices, no code. That's `implementation-planner`'s job once this
  spec exists, not this one's.

## Naming and numbering

One file per feature: `specs/NN-feature-name.md`. `NN` is a two-digit
sequence number, reusing this repo's existing convention from
[`e2e/docs/flow-format.md`](../e2e/docs/flow-format.md)'s `specs/NN-name.flow.json`
files — **a suggested order, not an id anything references**: a new spec
takes the next free number in this directory and never slots in between
existing ones or gets renumbered to make room. Written in **English**,
regardless of the language the requirement was given in.

## Register the new file

Whoever writes here — `spec-creator` or `doc-writer` — adds a row to the
catalog below in the same pass. An unregistered spec is effectively invisible
to `implementation-planner`, which reads this table first.

## Catalog

| Spec | Scope | Status |
|---|---|---|
| [01-conventions.md](01-conventions.md) | `server/` · `client/` · shared contracts | implemented (2026-09-21) |
