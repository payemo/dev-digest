# Development Plan: `devdigest-mcp` (L04) — a local MCP server exposing DevDigest to coding agents

**Branch:** `lab04-devdigest-mcp` · **Date:** 2026-09-26
**Packages touched:** **new** `mcp/` (`@devdigest/mcp`) · root docs (`CLAUDE.md`, `README.md`, `TESTING.md`, `.mcp.json`) · `.github/workflows/mcp.yml` · `.claude/skills/pr-self-review/routing.md`
**Estimated steps:** 16 · **Migration required:** no · **Contract change:** no
**Source touched under `server/src`, `client/src`, `reviewer-core/src`, `e2e/`:** none

## Goal

After this is implemented, a fifth standalone package `mcp/` (`@devdigest/mcp`,
npm, stdio transport) exposes DevDigest to any MCP-capable coding agent. It
advertises exactly five tools — `list_agents`, `run_agent_on_pr`,
`get_conventions`, `get_findings`, `get_blast_radius` — addressed with **flat
semantic arguments** (`repo: "owner/name"`, `pr: 42`, `agent: "<name>"`), never a
nested object and never a uuid. It talks HTTP to the already-running local API at
`http://127.0.0.1:3001`; it never opens a DB connection and adds no `server/`
module.

`run_agent_on_pr` is a single blocking call that creates the run, waits for it,
and returns `{verdict, score, findings}` — `POST /pulls/:id/review` is already
synchronous, so there is no poll loop and no second billed agent turn. The whole
`tools/list` payload stays under a **1500-token budget asserted by a hermetic
test**, only the `tools` capability is advertised, and `initialize` does no work
at all. Every failure returns text naming the next call to make.
`get_blast_radius` ships as a deliberate non-error stub — the real
implementation reads `repo-intel`'s symbol graph and is the other half of L04.
`.mcp.json` at the repo root registers the server so `/mcp` in Claude Code finds
it with no per-developer setup.

## Inputs read

| File | What it constrained |
|---|---|
| `CLAUDE.md:10-21` (Layout) | "Four standalone packages" + the folder table — both gain `mcp/`; no root `package.json`, no workspace |
| `CLAUDE.md:42` (Commands) | `reviewer-core`/`e2e` use **npm**, not pnpm — the new package joins that group |
| `CLAUDE.md:53-55` | No linter anywhere; `typecheck` is the only enforced static gate — no `lint` script |
| `CLAUDE.md:99-101` | Never add a root `package.json` or hoist deps |
| `CLAUDE.md:104-107` | `@devdigest/shared` is the one contract source — `mcp/` aliases it, never retypes it |
| `CLAUDE.md:128-131` (Gotchas) | CI path filters encode cross-package aliases — `mcp.yml` must also trigger on `server/src/vendor/shared/**` |
| `CLAUDE.md:133-135` | The untracked `openrouter-api-key` at the root is not gitignored — never `git add -A` |
| `CLAUDE.md:147-152` | Never hand-edit a lockfile — `mcp/package-lock.json` comes from `npm install` only |
| `server/CLAUDE.md:14-18` | `pnpm build` does **not** rewrite `@devdigest/*` aliases in output → a long-lived runtime process must import `@devdigest/shared` **type-only** |
| `server/CLAUDE.md:53-55` | Zod schemas validate at the edge, never a hand-rolled parse — same discipline for tool input schemas |
| `server/INSIGHTS.md` (2026-09-25) | A grep-based purity gate trips on a doc comment that merely names the grepped token |
| `reviewer-core/CLAUDE.md:11-15` | `npm run typecheck` doubles as `build`; the package never emits JS — the model `mcp/` copies |
| `reviewer-core/tsconfig.json:21-26` | The `paths` block to copy, **including the `zod` self-pin** that stops two zod copies colliding at type-check time |
| `e2e/package.json`, `e2e/tsconfig.json` | The standalone-package template (private, `type: module`, `tsx`, `tsc --noEmit`) |
| `TESTING.md:8-24` | Testing is typological; mock the outside world — here that means `fetch`, the only outside world this package has |
| `TESTING.md:78-95` | `*.it.test.ts` is a **server-only** lane marker; CI is path-filtered per package |
| `.github/workflows/reviewer-core.yml` | The verbatim npm-package workflow template, incl. the alias-dependency comment |
| root `INSIGHTS.md` (2026-09-16) | `!**/INSIGHTS.md` must be the **last** entry of every `paths:` list |
| `.claude/skills/claude-api/shared/token-counting.md:7-10` | **Never `tiktoken`** for a Claude count — undercounts 15-20%. Authoritative is `messages.count_tokens`; CI uses a documented char proxy |
| `.claude/skills/onion-architecture/SKILL.md:3-6` | Frontmatter scopes it to `server/` and `reviewer-core` — it does **not** bind `mcp/` |
| `server/src/vendor/shared/contracts/review-api.ts:41-44` | `POST /pulls/:id/review` returns persisted reviews **once the synchronous run completes** |
| `server/src/modules/reviews/routes.ts:30-47` | Body is `{agentId}` or `{all:true}`; the route is rate-limited **10/min** |
| `server/src/modules/_shared/context.ts:15-19` | `LocalNoAuthProvider` — the local API needs no auth header |

## Architectural constraints binding this change

- **`mcp/` is a fifth standalone package with its own `package.json` and
  `package-lock.json`, installed with npm.** The pnpm/npm split puts a new
  non-server, non-client package in the **npm** group; an `mcp/pnpm-lock.yaml`
  is a CRITICAL finding.
- **It talks HTTP to `:3001`, never SQL.** Direct DB access would fork business
  logic: workspace scoping lives in `getContext`
  (`server/src/modules/_shared/context.ts:15-19`), run orchestration in
  `ReviewService`, grounding in `reviewer-core`. Re-entering below the HTTP layer
  bypasses all three.
- **`@devdigest/shared` is imported `import type` only.** `server/CLAUDE.md:14-18`
  records that `tsc` does not rewrite `@devdigest/*` aliases into output; this is
  a long-lived runtime daemon, so a *value* import is a live
  `ERR_MODULE_NOT_FOUND`. Type-only imports are fully erased. No third physical
  copy of `vendor/shared` is created.
- **The `zod` self-pin in `paths` is load-bearing.** `reviewer-core/tsconfig.json`
  pins `zod` → its own `node_modules` precisely because a package aliasing into
  `server/src` otherwise type-checks against *two* zod copies. `mcp/` has its own
  zod (the SDK needs it) and hits the same problem.
- **zod stays on v3.** Verified 2026-09-26: `@modelcontextprotocol/sdk@1.30.1`
  declares `zod: '^3.25 || ^4.0'`. The repo declares `^3.24.1` but actually
  resolves to **3.25.76** (confirmed in `server/node_modules`), so `mcp/`
  declares `^3.25.76` — the same physical version, stated unambiguously so the
  SDK peer range cannot be satisfied by a stale 3.24.x. The zod-v4 path is
  avoided because it has shipped `w._parse is not a function` and, worse,
  silently drops `.describe()` from emitted JSON Schema — degrading tool
  selection with no error and no failing test.
- **A new tsconfig `paths` entry without a matching CI path filter is CRITICAL.**
  `mcp/tsconfig.json` aliases `../server/src/vendor/shared`, so
  `.github/workflows/mcp.yml` must list `server/src/vendor/shared/**`.
- **`!**/INSIGHTS.md` last in every `paths:` list** — GitHub applies patterns in
  order; a negation before an inclusion is silently undone.
- **The local API needs no auth header** and binds loopback by default
  (`API_HOST` 127.0.0.1, `API_PORT` 3001). The MCP server sends no credential and
  **must not invent one**. Local only: no HTTP/SSE transport, no remote auth.
- **stdout belongs to JSON-RPC.** Anything else on stdout corrupts the frame. All
  diagnostics to `process.stderr`.
- **`onion-architecture` does not bind this package.** The layering imposed on
  `mcp/src` — transport file, HTTP client file, pure formatter, one file per tool
  — is this plan's own rule, stated as such.

## Design decisions

### D1 — `run_agent_on_pr` is blocking, because the API is already blocking

`POST /pulls/:id/review` returns `{pr_id, runs, reviews}` and the contract's own
doc comment says the reviews are returned "once the (synchronous) run completes"
(`review-api.ts:41-44`); the handler awaits `service.runReview(...)` before
returning (`reviews/routes.ts:33-47`). A poll loop would be strictly worse —
extra billed agent turns for information already in the first response.

**Timeout: 120 s** via `AbortSignal.timeout`. On timeout the review **keeps
running server-side** — aborting the HTTP request does not cancel it. The tool
returns a **non-error** result telling the agent to call `get_findings` shortly
and **not** to re-run: a re-run burns a second LLM pass and walks into the 10/min
rate limit (`reviews/routes.ts:36`).

### D2 — Flat, semantic arguments; uuids never cross the tool boundary

Three separate primitives — `repo: string` (`"owner/name"`), `pr: number`,
`agent: string`. Models make more schema errors on nested objects, and a uuid is
unguessable without an extra round trip.

| Semantic id | Endpoint | Match on | Yields |
|---|---|---|---|
| `repo` | `GET /repos` | `Repo.full_name`, case-insensitive | `Repo.id` |
| `pr` | `GET /repos/:id/pulls` | `PrMeta.number` | `PrMeta.id` |
| `agent` | `GET /agents` | `Agent.name`, case-insensitive; prefer `enabled` on a tie | `Agent.id` |

**Cache:** process-local `Map`, 60 s for repos and agents, 30 s for a repo's PR
list. One non-optional rule: **a lookup miss must re-fetch once, bypassing the
cache, before reporting not-found** — otherwise a repo imported 10 seconds ago is
reported missing, and the suggested next call returns the same stale answer.

### D3 — The four silent traps

Each one fails with **no error message** if ignored.

1. **`POST /pulls/:id/review` takes `{agentId}` — camelCase**, unlike the
   snake_case wire everywhere else (`RunRequest`, `platform.ts:293-296`). Both
   fields are optional and the body schema is `.optional()`, so a snake_case
   `{agent_id}` does **not** 422 — it runs zero agents and returns an empty
   `reviews` array.
2. **`Agent.system_prompt`** (`knowledge.ts:198-213`) — thousands of tokens and a
   prompt-injection surface. Excluded from **both** output modes by an
   **allowlist** projection (`pick`, never `omit`), so a future contract field
   cannot leak in by accident.
3. **`PrMeta.findings`** (`platform.ts:202-207`) — the PR *list* endpoint embeds
   every agent's findings per PR. The resolver reads that response only to map
   `number → id` and must project to `{id, number}` immediately; a repo with 30
   reviewed PRs would otherwise put hundreds of findings into a lookup step.
4. **`PrMeta.id` is `nullish()`** (`platform.ts:185`) — a matched PR with no id is
   a named resolution failure, not an `undefined` crash.

### D4 — Concise structured responses

`response_format: concise|detailed` on the read tools. `concise` findings →
`{severity, file, line, title}`; `detailed` adds `category`, `confidence` and a
truncated `rationale`. `evidence`, `trifecta_components` and `evidence_snippet`
are returned by **neither**. Defaults: `limit` 20 (findings) / 25 (conventions),
`offset` 0; every truncated list ends with a footer naming the exact next call.
`MAX_RESPONSE_CHARS = 12000` is the final backstop for a case no per-field rule
anticipated.

### D5 — An error leads somewhere

| Situation | `isError` | Text says |
|---|---|---|
| Unknown `agent` | `true` | "Agent 'foo' not found. Configured: X, Y, Z. Call `list_agents` for the full list." |
| Unknown `repo` | `true` | "Repository 'a/b' is not imported. Imported: …. Add it in the DevDigest studio first." |
| Unknown `pr` | `true` | "PR #42 not found in a/b. Open PRs: #40, #41, #45." |
| API unreachable | `true` | "Can't reach the DevDigest API at `<url>`. Start it with `./scripts/dev.sh`, then retry." |
| Rate-limited (429) | `true` | "The review endpoint allows 10 runs per minute. Wait ~60s, then retry — do not loop." |
| `run_agent_on_pr` timed out | **`false`** | "Still running server-side after 120s. Wait ~60s and call `get_findings(repo, pr)`. **Do not call `run_agent_on_pr` again.**" |
| `get_blast_radius` stub | **`false`** | What it will return once built, that it needs the repo Indexed via `repo-intel`, and "**Do not retry; report this to the user.**" |

The last two rows are the point. `isError: true` signals that *retrying might
work*. For a not-yet-implemented tool and for a timeout whose work is already in
flight, retrying is exactly wrong.

### D6 — Five names, no prefix

`list_agents`, `run_agent_on_pr`, `get_conventions`, `get_findings`,
`get_blast_radius`. No `devdigest_` prefix: the MCP client namespaces by server
name (`mcp__devdigest__list_agents` in Claude Code), so a prefix is the string
"devdigest" twice in every name, paid on every request.

`run_agent_on_pr` is the **only write tool**; the other four are pure reads, and
its description says so.

### D7 — The startup budget: ≤1500 tokens for the whole `tools/list`

Measured externally: GitHub's MCP server ships ≈17.6K tokens of tool
definitions; a five-server setup ≈55K; tool-selection accuracy degrades past
~30-50 tools. Anthropic's Tool Search / `defer_loading` cuts ~85% (55K → 8.7K),
but it is a **client-side** setting — this server cannot enable it. Its only
obligation under a deferred regime is that each tool's `name` + `description` is
independently sufficient to match a search query, without the input schema and
without the other four for context.

Two further rules: **advertise only the `tools` capability** (a client pulls
`resources`/`prompts` into context at startup too), and **do no work at
`initialize`** — the API being down is reported on the first tool call, not as a
startup failure, because a server that fails to initialize is one the client may
drop entirely.

**How the budget is asserted.** `messages.count_tokens` is the only accurate
Claude count and `tiktoken` is explicitly wrong for Claude
(`token-counting.md:7-10`) — but it needs a network call and an API key, which a
hermetic test cannot have. So: **CI gate** asserts
`JSON.stringify(toolsListResult).length <= 5250` (1500 tokens at a conservative
3.5 chars/token for mixed JSON + English, with the ratio stated in a comment);
**authoritative check** is `messages.count_tokens` run manually once per
description change, recorded in `mcp/INSIGHTS.md` beside the proxy so the ratio
can be re-derived rather than re-guessed.

### D8 — Module layout

```
mcp/
  package.json          @devdigest/mcp — private, type: module, npm
  package-lock.json     generated by `npm install`, never hand-edited
  tsconfig.json         paths: @devdigest/shared → ../server/src/vendor/shared, + zod self-pin
  vitest.config.ts      the same aliases, mirrored
  README.md             Mermaid: editor → stdio → mcp → HTTP :3001 → API
  CLAUDE.md             per-package rules
  INSIGHTS.md           the measured token count and the SDK/zod finding
  src/
    server.ts           McpServer + StdioServerTransport; registers tools/index.ts
    api.ts              the ONLY file that calls fetch
    resolve.ts          repo/pr/agent → uuid, TTL cache, candidate-listing misses
    format.ts           concise|detailed projections, limit/offset, footers, char ceiling
    errors.ts           the actionable-error builders
    constants.ts        budgets, defaults, timeouts, TTLs
    tools/
      index.ts          the declarative registry — one array, iterated by server.ts
      list-agents.ts  run-agent-on-pr.ts  get-conventions.ts  get-findings.ts  get-blast-radius.ts
  test/
    token-budget.test.ts  format.test.ts  resolve.test.ts  tools.test.ts
```

`format.ts` is the most heavily tested file: every token-discipline rule lives
there, and it is pure — no `fetch`, no SDK import, no clock — so its tests need
no mocks. `tools/index.ts` is **declarative**: each tool file default-exports
`{ name, title, description, inputSchema, readOnly, handler }` and `server.ts`
loops over the array, so a sixth tool is one file plus one entry and the budget
test covers it automatically.

## Steps

### Step 1 — Verify the MCP SDK's zod peer range before writing any tool
- **Files:** none (inspection only)
- **Status: DONE 2026-09-26.** `@modelcontextprotocol/sdk@1.30.1` declares
  `zod: '^3.25 || ^4.0'`. zod 3 is accepted → proceed. The repo declares
  `^3.24.1` but resolves to **3.25.76**; `mcp/` declares `^3.25.76` so the SDK
  peer range cannot be satisfied by a stale 3.24.x.
- **Done when:** the resolved SDK version and its zod range are recorded in
  `mcp/INSIGHTS.md` (Step 15).

### Step 2 — Scaffold the package
- **Files:** `mcp/package.json`, `mcp/tsconfig.json`, `mcp/vitest.config.ts`
- **Change:** modelled on `e2e/package.json` and `reviewer-core/package.json`.
  `"name": "@devdigest/mcp"`, `private`, `"type": "module"`. Scripts: `start`
  (`tsx src/server.ts`), `typecheck` (`tsc --noEmit -p tsconfig.json`), `test`
  (`vitest run`). **No `build`** — this package never emits JS. Deps:
  `@modelcontextprotocol/sdk@^1.30.1`, `zod@^3.25.76`. devDeps: `@types/node`,
  `tsx@^4.19.2`, `typescript@^5.7.2`, `vitest@^2.1.8`. `tsconfig.json` copies
  `reviewer-core/tsconfig.json`'s `paths` block **verbatim**, including the zod
  self-pin. Install with **`npm install`**.
- **Done when:** `cd mcp && npm run typecheck` exits 0 on a placeholder
  `src/server.ts`; `mcp/package-lock.json` exists; `mcp/pnpm-lock.yaml` does not.

### Step 3 — `constants.ts`
- **Change:** every budget, timeout and TTL in one file, each with the reasoning
  in a comment: `DEFAULT_API_URL`, `REVIEW_TIMEOUT_MS = 120_000`,
  `HTTP_TIMEOUT_MS = 15_000`, `TOOLS_LIST_CHAR_BUDGET = 5250`,
  `MAX_RESPONSE_CHARS = 12_000`, `MAX_RATIONALE_CHARS = 400`,
  `DEFAULT_FINDINGS_LIMIT = 20`, `DEFAULT_CONVENTIONS_LIMIT = 25`,
  `MAX_CANDIDATES_IN_ERROR = 20`, and the three cache TTLs.
- **Done when:** no magic number from this list appears anywhere else in `src/`.

### Step 4 — `api.ts`: the only file that calls `fetch`
- **Change:** base URL from `DEVDIGEST_API_URL` read once at module load. One
  generic `request<T>(path, init, timeoutMs)` using `AbortSignal.timeout`, which
  distinguishes three failure classes for `errors.ts` — `unreachable`,
  `timeout`, `http` (carrying status and the parsed error message) — and never
  throws a raw `fetch` error upward. No auth header. Typed wrappers:
  `listRepos`, `listPulls`, `listAgents`, `listConventions`, `runReview`,
  `reviewsForPull`. **Trap D3.1 is commented at `runReview`.**
- **Done when:** `npm run typecheck` passes and
  `grep -rn "from '@devdigest/shared'" mcp/src | grep -v "import type"` is empty.

### Step 5 — `errors.ts`
- **Change:** one pure builder per D5 row, each ending with the **concrete next
  call** — a tool name with its arguments, or a shell command. Candidate lists
  capped at `MAX_CANDIDATES_IN_ERROR` with a `"… and N more"` tail, so an error
  cannot itself blow the budget.
- **Done when:** tests assert each builder names the next call, and that a
  50-candidate list is capped.

### Step 6 — `format.ts`
- **Change:** `paginate`, `truncationFooter`, `formatAgents` (**allowlist**
  projection — D3.2), `formatFindings(mode)`, `formatVerdict`,
  `formatConventions(mode)`, `capResponse`, and `toResult()` — the single place a
  payload becomes an MCP result, so no tool can bypass the ceiling.
- **Constraint:** pure. Its only imports are `./constants.js` and type-only
  contract types.
- **Done when:** `format.test.ts` green, including the assertion that a
  serialized `formatAgents` output contains no system-prompt text.

### Step 7 — `resolve.ts`
- **Change:** `resolveRepo`, `resolvePull`, `resolveAgent`, each returning
  `{ ok: true, id } | { ok: false, result }` where `result` is an already-built
  error carrying the real candidate list. Case-insensitive; `repo` tolerates a
  trailing `.git` and a pasted `https://github.com/` prefix. `resolvePull`
  projects to `{id, number}` immediately (D3.3) and returns a named failure when
  the matched PR's `id` is null (D3.4). TTL cache with the forced
  cache-bypassing re-fetch on a miss (D2).
- **Done when:** `resolve.test.ts` covers a case-differing slug, a pasted URL, an
  unknown agent naming `list_agents`, a PR found only after the forced re-fetch,
  and a matched PR with `id: null`.

### Step 8 — The four read tools
- **Change:** each default-exports `{ name, title, description, inputSchema,
  readOnly: true, handler }`.
  - **`list_agents`** — input schema `{}`, **zero arguments**: this is where an
    agent learns a valid `agent` value, so it must cost nothing to call.
  - **`get_conventions`** — `{ repo, limit?, offset? }`. Reads
    `GET /repos/:id/conventions` and returns **approved candidates only**.
    `GET /repos/:id/conventions/skill-draft` is deliberately **not** used: it
    400s when no candidate is approved, turning a normal state into an error.
  - **`get_findings`** — `{ repo, pr, agent?, response_format?, limit?, offset? }`.
    Reports the **latest** review, with the optional `agent` filter to pick a
    specific one. An empty `reviews` array is **not** an error: a normal result
    saying no review has run yet and naming `run_agent_on_pr` as the next call.
  - **`get_blast_radius`** — `{ repo, pr }`. Returns a **normal** result (D5)
    and makes **no HTTP call at all**, so it cannot fail.
- **Constraint:** a tool file holds its schema, description and orchestration —
  no `fetch`, no projection logic.
- **Done when:** `tools.test.ts` green and `grep -rn "fetch(" mcp/src/tools` empty.

### Step 9 — `run_agent_on_pr`: the one write tool
- **Change:** input `{ repo: string, pr: int, agent: string }` — all three
  **required**, `readOnly: false`. The handler does D1's three steps behind one
  call: resolve all three ids; `POST /pulls/:id/review` with body **`{ agentId }`**
  (camelCase — D3.1) under `REVIEW_TIMEOUT_MS`; project `reviews[0]` into
  `{verdict, score, summary, findings, footer}`. Failure paths per D5. A 200 with
  an **empty** `reviews` array is an explicit error result — that is the
  observable symptom of D3.1 and of a failed run.
- **Constraint:** exactly one `POST`. No polling, no retry, no second request on
  timeout.
- **Done when:** tests cover the happy path returning `{verdict, findings}` and
  not the raw API body; a timeout returning `isError: false` with text containing
  `get_findings` and a do-not-re-run instruction; a 429; and an unknown agent
  never issuing the `POST` (asserted on the stub's call count).

### Step 10 — `tools/index.ts` + `server.ts`
- **Change:** `TOOLS` as one exported array — the single registration point and
  the single input to the budget test. `server.ts` constructs
  `new McpServer({ name: 'devdigest', … }, { capabilities: { tools: {} } })` —
  **only `tools`** — loops `TOOLS`, and connects a `StdioServerTransport`. **No
  work before or during `connect`.** Every handler is wrapped so an unexpected
  throw becomes a result rather than a crash: an MCP server that exits takes the
  agent's whole session with it. Diagnostics to stderr only.
- **Done when:** `npm run typecheck` passes; the stdout/`resources`/`prompts`
  greps are empty; and piping a single `initialize` JSON-RPC line in **with the
  API stopped** emits exactly one JSON-RPC line — proving `initialize` does no work.

### Step 11 — Write the five descriptions against the deferred-loading rule
- **Change:** each `description` must be (1) self-sufficient with the name alone,
  naming the domain nouns an agent would search for; (2) an outcome, not an
  endpoint; (3) explicit about where each argument comes from (`agent` → "a name
  from `list_agents`"); (4) clear that `run_agent_on_pr` is the billed write; and
  (5) ≤600 characters, with each `.describe()` ≤120.
- **Done when:** the budget test passes with ≥15% headroom, and each description,
  read with the other four covered, still answers "would a search for 'review a
  PR' find this?".

### Step 12 — The test suite
- **Change:**
  - **`token-budget.test.ts`** — builds the exact `tools/list` result from
    `TOOLS`, asserts the char budget and **prints the actual number** so a
    regression is visible before it is a failure. Also: exactly five tools; the
    names are exactly D6's with no prefix; every schema field carries a
    `.describe()` **in the emitted schema** (the guard against the zod-4 silent
    drop); no input schema contains a nested object or array of objects.
  - **`format.test.ts`** — the heaviest file: no system-prompt text in serialized
    agent output; `concise` findings have exactly four keys; neither mode emits
    `evidence`/`trifecta_components`; rationale truncation; `capResponse` on a
    50 KB payload; pagination boundaries; footer correctness; every error builder.
  - **`resolve.test.ts`**, **`tools.test.ts`** — per Steps 7-9.
- **Constraint:** all DB-free and network-free; `fetch` is the only mock.
  `*.it.test.ts` is the server's DB-lane marker and must **not** appear here.
- **Done when:** `cd mcp && npm test` green and `npm run typecheck` exits 0.

### Step 13 — `.mcp.json` and the CI workflow
- **Change:** `.mcp.json` at the root registering one stdio server named
  `devdigest` (the client namespaces by it), carrying only a loopback URL and no
  secret, committed so every developer gets it with no setup.
  `.github/workflows/mcp.yml` copied from `reviewer-core.yml`, with `paths:` =
  `mcp/**`, **`server/src/vendor/shared/**`**, the workflow itself, and
  `!**/INSIGHTS.md` **last**; Node 22, `npm ci` → `typecheck` → `test`. A header
  comment explains the alias dependency, as `reviewer-core.yml` does.
- **Done when:** both `paths:` lists end with `!**/INSIGHTS.md`; the workflow
  parses; the three CI commands pass locally.

### Step 14 — Manual end-to-end verification
- **Change:** with `./scripts/dev.sh` up:
  1. `npx @modelcontextprotocol/inspector npx tsx mcp/src/server.ts` — exactly
     five tools with the D6 names, **only** the `tools` capability, and no
     `system_prompt` anywhere in `list_agents`.
  2. `get_findings` on a seeded PR; `get_conventions` on the seeded repo;
     `get_blast_radius` → non-error containing "do not retry"; `list_agents` with
     a **stopped** API → the unreachable text.
  3. `run_agent_on_pr` once, on a small PR — confirm it blocks, then returns
     `{verdict, findings}` and nothing else.
  4. Claude Code `/mcp` → `devdigest` connected, tools as `mcp__devdigest__*`.
  5. `grep -rn "console\.log\|process\.stdout\|as unknown as\|: any" mcp/src` empty.
- **Constraint:** sub-step 3 is the only step that spends money. Run it **once**,
  on the smallest available PR.
- **Done when:** all five pass and the `messages.count_tokens` measurement is
  recorded for Step 15 (**never `tiktoken`**).

### Step 15 — The package's own docs
- **Change:** `README.md` (the five tools in a table + a Mermaid diagram
  `editor → stdio → @devdigest/mcp → HTTP :3001 → @devdigest/api → Postgres`);
  `CLAUDE.md` in the same section order as `reviewer-core/CLAUDE.md`, stating npm
  not pnpm, type-only shared and why, the stdout rule, `tools`-only +
  no-work-at-`initialize`, the token budget and its test, zod 3, that
  `system_prompt` is never returned, and that `run_agent_on_pr` is the only
  billed write; `INSIGHTS.md` seeded with the Step 1 SDK/zod finding, the
  measured token count beside the char proxy, and the four D3 traps.
- **Constraint:** phrase the purity rules **without spelling out the exact token
  a grep gate searches for** — a `grep -rn "console.log"` gate fails equally on a
  doc comment saying "never console.log" as on a real call (`server/INSIGHTS.md`,
  2026-09-25). Use the `engineering-insights` skill rather than hand-writing
  entries.
- **Done when:** the three files exist and Step 14's greps still return empty.

### Step 16 — Repo-level docs, routing, and the pre-PR gate
- **Change:** `CLAUDE.md` — "Four **standalone packages**" → "Five", an `mcp/`
  row in the folder table, `[mcp](mcp/CLAUDE.md)` in the per-package list, and
  `mcp/` added to the npm group. `README.md` — the same table row. `TESTING.md` —
  "four independent packages" → "five", a suite-map row, and `cd mcp && npm test`
  in the "Running locally" block. `routing.md` — add `mcp/**` to the "No lane"
  list with one sentence noting the cross-cutting content lanes still apply;
  without it every `mcp/` file silently lands in `uncovered_files` and a reader
  cannot tell whether that is intentional. Then run `pr-self-review`.
- **Constraint:** Conventional Commits with a new scope — `feat(mcp): …`. Before
  staging, check for the untracked `openrouter-api-key` at the root — **not** in
  `.gitignore`, so never `git add -A`.
- **Done when:** both CI commands exit 0 and `pr-self-review` writes a verdict
  with no CRITICAL (the expected `RULE-LESSON` WARNING is acknowledged, not
  "fixed" — see Risks).

## Contract changes

**None.** No file under `server/src/vendor/shared` or `client/src/vendor/shared`
is touched. `mcp/` consumes the existing contracts **by tsconfig path alias,
type-only**, pointing at the server copy exactly as `reviewer-core` does. No
third physical copy of `vendor/shared` is created. Types read: `Repo`, `PrMeta`,
`ApiErrorBody` (`platform.ts`); `Agent`, `ConventionCandidate` (`knowledge.ts`);
`Finding`, `Severity`, `Verdict` (`findings.ts`); `ReviewRecord`,
`FindingRecord`, `ReviewRunResponse` (`review-api.ts`).

## Migration

**None.** No table, no column, no query — only HTTP calls to endpoints that
already exist. Nothing under `server/src/db/**` is touched.

## Test plan

| Suite | Command (verbatim) | Covers |
|---|---|---|
| mcp | `cd mcp && npm run typecheck` | Steps 2-11, incl. the shared alias and the zod self-pin |
| mcp | `cd mcp && npm test` | Steps 5-9, 11 via Step 12 — budget, formatter, resolver, tool handlers, `fetch` stubbed |
| mcp (budget) | `cd mcp && npm test -- token-budget` | Step 11 — `tools/list` ≤ budget, five tools, no prefix, every field described, no nested argument |
| manual | `npx @modelcontextprotocol/inspector npx tsx mcp/src/server.ts` | Step 14 |
| manual | Claude Code `/mcp` | Step 14 — `.mcp.json` registration, `mcp__devdigest__*` names |
| manual, billed **once** | `run_agent_on_pr` on a small real PR | Step 9 — the blocking path end to end |
| contract sync (unchanged) | `diff -r client/src/vendor/shared server/src/vendor/shared` | proves no contract changed |

Testing is **typological** — the *kinds* of breakage per layer, not coverage.
`fetch` is the only outside world this package has. CI is path-filtered per
package, so **no other suite runs** on an `mcp/`-only diff — which is exactly why
`mcp.yml` must itself trigger on `server/src/vendor/shared/**`.

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| A value import from `@devdigest/shared` sneaks in and the process dies with `ERR_MODULE_NOT_FOUND` outside `tsx` | 4 | Step 4's grep gate; the rule restated in `mcp/CLAUDE.md` |
| `Agent.system_prompt` leaks into a model's context — thousands of tokens and an injection surface | 6 | Allowlist (`pick`) projection, so a new contract field cannot appear by accident; a test asserts the serialized output contains no system-prompt text |
| `PrMeta.findings` leaks through the resolver | 7 | `resolvePull` projects to `{id, number}` before anything else touches the response |
| A snake_case `{agent_id}` body silently runs zero agents — no 422, no error | 4, 9 | Commented at the wrapper; Step 9 treats a 200 with empty `reviews` as an explicit error, not "no findings" |
| `tools/list` creeps past the budget as descriptions improve | 11, 12 | A failing test, not a guideline; the test prints the count so drift is visible early |
| The 3.5 chars/token proxy drifts from real tokens | 12, 14, 15 | Step 14 measures with `messages.count_tokens` (never `tiktoken`) and Step 15 records it beside the proxy |
| The timeout path invites a re-run — a second billed pass into the 10/min limit | 9 | The timeout result is `isError: false` and its text forbids re-running; asserted on both the flag and the text |
| The blast-radius stub returns `isError: true` and a model loops on it | 8 | Normal result ending "Do not retry; report this to the user."; asserted on the flag, zero fetches, and the literal phrase |
| A stale cache reports a just-imported repo or PR as missing | 7 | The forced cache-bypassing re-fetch on a miss, asserted in `resolve.test.ts` |
| Something writes to stdout and corrupts the JSON-RPC frame — the failure mode is a dead session, not a log line | 10, 14 | The grep gate is a done-condition in two steps; the Inspector run surfaces it immediately |
| The tsconfig alias ships without the CI path filter (CRITICAL) | 2, 13 | Both land in the same change; Step 13 checks both `paths:` lists |
| `!**/INSIGHTS.md` is not last in `mcp.yml` and the exclusion is silently undone | 13 | Copied position-for-position from `reviewer-core.yml` |
| An `mcp/pnpm-lock.yaml` appears because pnpm is muscle memory in this repo | 2 | CRITICAL rule; Step 2's done-condition asserts which lockfile exists |
| `RULE-LESSON` (WARNING) fires — `pr-self-review` names "MCP server" as a lesson feature | 16 | Expected and correct: lesson homework on `lab04-devdigest-mcp`, the same shape as the merged `lab03-intent-layer`. WARNING, not CRITICAL, so the `gh pr create` hook does not block. **Acknowledge it in the PR description; do not "fix" it by deleting the rule** |

## Out of scope

- **Blast Radius itself** — `get_blast_radius` ships as a stub. The real
  implementation reads `repo-intel`'s symbol and import graph and is the other
  half of L04.
- HTTP/SSE transport, remote hosting, OAuth, any auth header — local stdio only.
- Tool Search / `defer_loading` support: **client** settings on a Messages API
  request; a server cannot enable them. The only server-side obligation is Step 11.
- MCP `resources` and `prompts` capabilities — deliberately not advertised (D7).
- Polling or SSE progress for `run_agent_on_pr`: `/runs/:id/events` exists, but
  consuming it means extra billed agent turns for data the blocking response
  already carries.
- Tools for anything else the API exposes — importing a repo, creating or editing
  an agent, accept/dismiss on a finding, run traces, settings. Five tools is the
  whole surface; "don't wrap every endpoint" is the point.
- Any `server/`, `client/`, `reviewer-core/` or `e2e/` source change.
- A `build` script or published artifact for `mcp/` — like `reviewer-core`, it is
  run from source.
