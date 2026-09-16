# CLAUDE.md — `@devdigest/reviewer-core`

## Stack

Pure TypeScript, zero DB/GitHub/filesystem access — the only side effect is
an LLM call through an **injected** `LLMProvider`, which is what makes it
mock-testable. Consumed as TS **source** by `server` via a tsconfig path
alias (`@devdigest/reviewer-core` → `./src`), never as a built/published
package.

## Commands

- `npm run typecheck` — also doubles as `build` (this package never emits
  JS; there's nothing else to build).
- `npm test` — vitest, fully hermetic, stubbed `LLMProvider`. No keys, no
  network.

## Where things live

- `src/prompt.ts` — `assemblePrompt()`, `wrapUntrusted()` + `INJECTION_GUARD`.
- `src/llm/` — `LLMProvider` + `openrouter.ts`, and `structured.ts` (Zod →
  JSON Schema, parse-with-repair).
- `src/grounding.ts` — `groundFindings()` / `groundingSummary()`, the
  mandatory citation gate.
- `src/review/run.ts` — orchestrates a single-pass run end to end.
- `src/index.ts` — the package's entire public surface; contracts
  (`Review`, `Finding`, `Verdict`) come from `@devdigest/shared`, not here.

## Non-default conventions

- Never add a DB/GitHub/filesystem call in this package — if a feature needs
  one, it belongs in `server` and gets passed in as data or via
  `LLMProvider`.
- `assemblePrompt` accepts optional slots (`skills`, `memory`, `specs`,
  `callers`) that later course lessons feed — in the starter they're simply
  omitted, don't stub them out.

## Gotchas

- The score is **always** recomputed from the findings that survive
  grounding — never trust or pass through the model's self-reported score.
- `INJECTION_GUARD` (one shared trusted-vs-untrusted rule in the system
  prompt) is the entire prompt-injection defense — don't add keyword/denylist
  scanning on top of it.

## Do not touch

- Don't give this package a real network/DB dependency — everything external
  goes through the injected `LLMProvider`.

## More

[README.md](README.md) (pipeline, public API) ·
[docs/](docs/) · [specs/](specs/) · [INSIGHTS.md](INSIGHTS.md)
