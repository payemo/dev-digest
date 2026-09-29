# Registered cross-module specs

Catalog maintained at `specs/README.md` (a spec scoped to one package lives in
that package's own `<pkg>/specs/` instead).

| Spec | Scope | Status |
|---|---|---|
| `specs/01-conventions.md` | `server/` · `client/` · shared contracts | implemented (2026-09-21) |
| `specs/02-project-context.md` | `server/` · `client/` · `reviewer-core/` · shared contracts | implemented (2026-09-29) |

## What a spec is, here

A spec describes **what** and **why**, grounded enough to plan from, without
prescribing **how**: no file paths, no function/class names, no library
choices, no code. `implementation-planner` turns a spec into a Development
Plan; that plan — not the spec — is where implementation detail lives.

## Naming

One file per feature: `specs/NN-feature-name.md`, written in English. `NN` is
a suggested order, not an id anything references — a new spec takes the next
free number and is never renumbered.
