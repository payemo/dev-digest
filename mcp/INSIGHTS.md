# Insights — `@devdigest/mcp`

Non-obvious decisions, gotchas, and learnings for this package that aren't
covered by [README.md](README.md) or [CLAUDE.md](CLAUDE.md). Append as they come
up — the `engineering-insights` skill knows the format.

## What Works

### 2026-09-26 — The `tools/list` payload is 3889 chars ≈ 1111 tokens, 26% under budget

Five tools with full descriptions and described arguments cost far less than
feared; the budget (1500 tokens / 5250 chars at 3.5 chars per token) is
comfortable, so descriptions did not have to be compressed into uselessness.
Evidence: `test/token-budget.test.ts` prints it on every run.

### 2026-09-27 — Supersedes the 2026-09-26 entry: `tools/list` is now 4291 chars ≈ 1226 tokens, 18% under budget

Replacing the `get_blast_radius` stub with a real implementation (flat args,
allowlisted response, a real description) spent 402 of the previous 1361-char
headroom. Budget is still comfortable (18% remaining vs. 26% before), but the
margin for a sixth tool or another argument is smaller than the prior entry
suggests.
Evidence: `test/token-budget.test.ts` output, `mcp/src/tools/get-blast-radius.ts`.

## What Doesn't Work

### 2026-09-26 — `McpServer.registerTool` and `zodToJsonSchema` both blow TS instantiation depth on an open `ZodRawShape`

Storing five heterogeneous tools in one array means their schema type is
`ZodObject<ZodRawShape>`, and both the SDK's `ToolCallback` inference and
`zod-to-json-schema`'s generic expand that into `TS2589`. Explicit type
arguments do not help — the expansion itself is what is deep.
Evidence: replaced by the low-level `Server` plus `src/tools/payload.ts`.

## Codebase Patterns

### 2026-09-26 — A hand-written schema converter makes "flat arguments" structural

`src/tools/payload.ts` understands string/number/boolean/enum and throws on
anything else, so a nested argument cannot reach a tool signature by accident —
and the emitted schema carries no dialect declaration or validation bounds,
which general-purpose converters add at real startup cost.

### 2026-09-26 — `isError` is advice to retry, so two results deliberately omit it

A `run_agent_on_pr` timeout (the run continues server-side) and the
`get_blast_radius` stub both return `isError: false`. Marking either as an error
invites a retry that is respectively expensive and impossible.

## Tool & Library Notes

### 2026-09-26 — `@modelcontextprotocol/sdk@1.30.1` accepts `zod ^3.25 || ^4.0`; this package pins 3.25.76

The repo declares `zod@^3.24.1` but resolves to 3.25.76, which satisfies the
SDK. `mcp/package.json` states `^3.25.76` outright so a resolver cannot pick a
3.24.x that would not. zod 4 is avoided: its SDK path has dropped `.describe()`
from emitted schemas silently, degrading tool selection with no failing test.

## Recurring Errors & Fixes

### 2026-09-26 — `POST /pulls/:id/review` takes camelCase `{agentId}` and fails silently on snake_case

`RunRequest`'s fields are optional and the body schema is itself optional, so a
snake_case `agent_id` is not rejected — it runs zero agents and returns 200 with
an empty `reviews`. There is no error to catch, so an empty `reviews` is treated
as a failed run. Evidence: `server/src/vendor/shared/contracts/platform.ts:293`.

## Open Questions

### 2026-09-26 — Whether every MCP client resolves `.mcp.json`'s relative `args` against the repo root

`.mcp.json` uses `["tsx", "mcp/src/server.ts"]`. If a client resolves that
against its own working directory instead, the fallback is an absolute path plus
an explicit `cwd`. Confirm via `/mcp` in Claude Code and record the answer here.
