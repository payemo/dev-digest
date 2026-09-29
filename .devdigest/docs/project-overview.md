# DevDigest — project overview

Local-first AI pull-request review, and the course starter template: a
minimal-but-working tool that imports a PR and runs an agent review on it.

Five standalone packages, no monorepo workspace — each has its own
`package.json` and lockfile; cross-package code is shared through tsconfig
path aliases, never published/built modules:

| Folder           | Package                    | What it is                                  | Port |
|------------------|----------------------------|----------------------------------------------|------|
| `server/`        | `@devdigest/api`           | Fastify 5 + Drizzle/Postgres (pgvector)      | 3001 |
| `client/`        | `@devdigest/web`           | Next.js 15 App Router (the studio)           | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure engine: diff → prompt → LLM → findings  | —    |
| `e2e/`           | `@devdigest/e2e`           | Deterministic browser e2e (agent-browser)    | —    |
| `mcp/`           | `@devdigest/mcp`           | Local MCP server (stdio) for coding agents   | —    |

`server/src/vendor/shared` (`@devdigest/shared`) holds the Zod contracts every
package consumes by alias.

## Review flow

Add a repo → server clones it and `repo-intel` indexes it → import PRs from
GitHub → open a PR and run a review → `reviewer-core` assembles a prompt from
the diff, the repo map, and (this feature) the repository's attached project
context, calls the LLM, validates every finding against the real diff (the
grounding gate drops anything that can't cite a real line), and persists
structured findings with a severity and score.

## Enforced conventions a reviewing agent should know

- Onion architecture in `server/`: routes → service → repository, ports vs
  adapters; `reviewer-core` stays pure (no network, no DB).
- `typecheck` is the only static-analysis gate — no linter is configured.
- A finding without a real diff-line citation is dropped; the model's
  self-reported score is never trusted.
- Migrations never run on boot — schema changes ship as an explicit,
  generated Drizzle migration.
