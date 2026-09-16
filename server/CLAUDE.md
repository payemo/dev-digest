# CLAUDE.md — `@devdigest/api`

## Stack

Fastify 5 + Drizzle ORM over Postgres (pgvector). Zod contracts from
`src/vendor/shared` double as route schemas via `fastify-type-provider-zod`.
Node ESM (`type: module`), TypeScript 5.7, `tsx` in dev, Vitest + testcontainers
in tests.

## Commands

- `pnpm dev` — serve on `:3001`. `pnpm build` / `pnpm typecheck`.
- `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:generate` (Drizzle Kit).
- `pnpm test` — unit + integration. Unit is DB-free (adapters mocked); a
  `*.it.test.ts` file is DB-backed (real Postgres via testcontainers) and
  self-skips without Docker.

## Where things live

- `src/modules/<name>/routes.ts` — one feature module per domain (repos,
  pulls, reviews, agents, repo-intel, settings). Registered statically in
  `src/modules/index.ts`.
- `src/platform/` — `config.ts` (env → `AppConfig`), `container.ts` (DI).
- `src/adapters/` — ports (llm, github, git, ast-grep, secrets) + `mocks.ts`
  swapped in for tests.
- `src/db/` — Drizzle schema + migrations (schema has tables for lessons not
  yet built; they sit empty).
- `reviewer-core/` (sibling package) — actual prompt/grounding logic, wired
  via tsconfig path alias, not npm.

## Non-default conventions

- Routes validate via zod `params`/`body` schemas, not hand-rolled
  `Schema.parse(req.body)` in handlers — invalid input 422s before the handler
  runs.
- Secrets (LLM keys, `GITHUB_TOKEN`) are **not** in `AppConfig`. They live in
  `~/.devdigest/secrets.json` (mode `0600`) via `SecretsProvider`, with
  `process.env` as fallback. `GITHUB_TOKEN` is canonical, `GITHUB_PAT` a
  fallback. Never put a secret in git or the DB.
- Migrations are **not** run on boot — always `pnpm db:migrate` explicitly.
- A DB-backed test file must use the `*.it.test.ts` suffix or the unit/
  integration split breaks.

## Gotchas

- `REPO_INTEL_ENABLED` defaults `true`, but an **unindexed** repo silently
  degrades the prompt to diff-only — no error.
- Prompt-injection defense is the single `INJECTION_GUARD` text appended to
  every system prompt (`reviewer-core/prompt.ts`), not keyword scanning —
  don't add a denylist.
- Grounding is mandatory: a finding without a real diff-line citation is
  dropped, and the score is always recomputed from survivors — never trust the
  model's self-reported score.
- `EMBEDDINGS_ENABLED=false` by default means **zero** OpenAI calls even with
  a key set.

## Do not touch

- Don't add ad-hoc body parsing/validation in route handlers — the zod schema
  on the route is the single source of truth.
- Don't write secrets anywhere but `SecretsProvider`.

## More

[README.md](README.md) (request/DI flow, API map, env vars) ·
[docs/](docs/) · [specs/](specs/) · [INSIGHTS.md](INSIGHTS.md)
