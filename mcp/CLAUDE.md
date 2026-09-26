# CLAUDE.md — `@devdigest/mcp`

## Stack

A local **MCP server** over **stdio**, exposing DevDigest to coding agents.
Built on `@modelcontextprotocol/sdk`'s low-level `Server` (not the high-level
helper) so the `tools/list` payload is ours to build and measure. It reaches
the API over **HTTP on `:3001`** and never opens a DB connection — workspace
scoping, run orchestration and grounding all live behind that HTTP boundary.
Run from **source** via `tsx`; this package never emits JS.

## Commands

- `npm run typecheck` — the only enforced static gate (no linter in this repo).
- `npm test` — vitest, fully hermetic. `fetch` is the one thing mocked, because
  it is the one piece of outside world this package has.
- `npm start` — run the server on stdio. Normally the MCP client launches it
  via the repo-root `.mcp.json`, not a human.

## Where things live

- `src/server.ts` — transport + request handlers. No business logic.
- `src/api.ts` — the **only** file that calls `fetch`.
- `src/resolve.ts` — `owner/name`, PR number and agent name → uuids.
- `src/format.ts` — every projection, page and cap. Pure, and the most tested.
- `src/errors.ts` — the failure texts. Pure.
- `src/constants.ts` — every budget, timeout and TTL, with its reasoning.
- `src/tools/` — one file per tool, plus `index.ts` (the registry) and
  `payload.ts` (the exact `tools/list` body, shared with its test).

## Naming

- Tool names are bare and snake_case: `list_agents`, not `devdigest_list_agents`.
  The client namespaces by server name (`mcp__devdigest__*`), so a prefix would
  be the word "devdigest" twice in every name, paid on every request.
- One tool per file, named after the tool (`run-agent-on-pr.ts`), default-
  exporting a `defineTool({...})`.

## Non-default conventions

- **`@devdigest/shared` is imported type-only.** `tsc` does not rewrite the
  alias into output and this is a long-lived runtime process, so a value import
  would fail to resolve at run time. Type imports are erased; keep it that way.
- **zod stays on 3.x.** The SDK accepts `^3.25 || ^4.0`, but its v4 path has
  dropped `.describe()` from emitted schemas without erroring — and a missing
  description degrades tool selection with nothing to catch it.
- **The standard output stream carries the JSON-RPC frame.** Diagnostics go to
  the error stream only. A stray write to the wrong stream kills the session
  rather than producing a visible log line.
- **Only the `tools` capability is advertised**, and **nothing happens during
  `initialize`** — no API probe, no warm-up. A client may drop a server that
  fails to start, so an unreachable API is reported on the first tool call.
- **`tools/list` has a budget: 1500 tokens**, enforced by
  `test/token-budget.test.ts` against a conservative character proxy. Treat a
  failure as a design signal, not a number to raise.
- **Arguments are flat primitives** — `repo`, `pr`, `agent` as separate values.
  `src/tools/payload.ts` can only describe primitives, so a nested shape fails
  loudly instead of reaching a tool signature.
- **Projections are allowlists.** Build output by picking fields, never by
  removing them, so a contract that grows a field cannot leak it.
- **Every failure names the next call.** A bare status code leaves an agent
  stuck; "call `list_agents`" does not.

## Gotchas

- `POST /pulls/:id/review` takes **`{agentId}` in camelCase**, unlike the
  snake_case wire everywhere else. Both of its body fields are optional and the
  body schema itself is optional, so a snake_case key is **not** rejected — it
  runs zero agents and returns 200 with an empty `reviews` array. That is why
  an empty `reviews` is treated as a failure, not as "no findings".
- `PrMeta.id` is optional in the contract; a listed PR without one is a named
  resolution failure, never an `undefined` in a URL.
- The PR **list** response embeds every agent's findings per PR. `resolvePull`
  projects to `{id, number}` immediately so that array never spreads further.
- `run_agent_on_pr` is the only tool that costs money. Its timeout result is
  deliberately not an error: the run continues server-side, and a retry would
  start a second billed pass.

## Do not touch

- **Never hand-edit `package-lock.json`** — change dependencies with `npm`.
  This package uses **npm**, not pnpm; a `pnpm-lock.yaml` here is a defect.
- Don't give this package DB access or import the server's `Container`. It is
  an HTTP client by design.
- Don't add a `build` script or publish it — it runs from source, like
  `reviewer-core`.
- Don't add tools casually. Five is the surface; every extra one is paid for in
  every request that never calls it.

## More

[README.md](README.md) · [INSIGHTS.md](INSIGHTS.md) ·
plan: [`docs/plans/lab04-devdigest-mcp.plan.md`](../docs/plans/lab04-devdigest-mcp.plan.md)
