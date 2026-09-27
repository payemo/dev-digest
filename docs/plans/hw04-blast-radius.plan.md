# Development Plan: Blast Radius (HW04) — show what else in the repo a PR's diff can reach

**Branch:** `hw04-blast-radius-feature` · **Date:** 2026-09-27
**Packages touched:** server · client · mcp
**Estimated steps:** 17 · **Migration required:** no · **Contract change:** no
(`server/src/vendor/shared` is **not** edited — see *Contract changes*)

## Goal

After this is implemented, a reviewer on the PR **Overview** tab can see what
else in the repository the diff can reach. A new `GET /pulls/:id/blast` endpoint
reads the index `repo-intel` already built at clone time and returns, for every
symbol declared in the PR's changed files: who calls it (`file:line` plus the
calling function's name) and which HTTP endpoints / scheduled jobs depend on
those callers. A new `BlastRadiusCard` renders that as a stat row, a collapsible
per-symbol tree with GitHub blob links and endpoint/cron chips, and an
alternative hand-rolled three-column graph view. The MCP tool
`get_blast_radius` stops being a stub and returns the same data over HTTP.
There is **no LLM call, no re-parsing, no new table, no migration, no new
dependency, and no change to `@devdigest/shared`**.

## Inputs read

| File | What it constrained |
|---|---|
| `CLAUDE.md:100-122` (Non-default conventions) | No workspace; pnpm for `server`/`client`, **npm** for `mcp`; `@devdigest/shared` is the one contract source; `*.it.test.ts` is the lane split; testing is typological; grounding is mandatory |
| `CLAUDE.md:139-160` (Do not touch) | No hand-edited migration, no lockfile edit — this plan needs neither |
| `CLAUDE.md:46-48` | **No linter exists**; `typecheck` is the enforced static gate, so every step's done-condition names `typecheck`/`test`, never `lint` |
| `server/CLAUDE.md:36-49` (Naming) | Module split `routes.ts`/`service.ts`/`repository.ts`/`helpers.ts`; zod contracts are PascalCase const + same-named inferred type; camelCase column → snake_case wire |
| `server/CLAUDE.md:53-55` | Routes validate via zod `params`/`response` schemas, never a hand-rolled `Schema.parse` in the handler |
| `server/CLAUDE.md:61-62`, `TESTING.md:88-91` | A DB-backed test file must carry the `*.it.test.ts` suffix |
| `server/CLAUDE.md:66-67` | "`REPO_INTEL_ENABLED` defaults true, but an **unindexed** repo silently degrades — no error." That is precisely the state the card's degraded badge must make visible |
| `server/INSIGHTS.md:100-112` | Cross-module dependency on another module's **Service** goes through a `Container` getter — which is why `repoIntel` is reached as `Container['repoIntel']` and never `new RepoIntelService(...)` |
| `server/INSIGHTS.md:124-131` | A grep-based purity gate trips on a doc comment that merely *names* the forbidden token — so `blast/helpers.ts`'s purity comment must not spell out `container`/`drizzle`/`db/schema` |
| `client/CLAUDE.md:30-35` | Route-local `_components/<PascalCase>/` with `<Name>.tsx` + `index.ts` + `<Name>.test.tsx` (+ `styles.ts`/`constants.ts`/`helpers.ts` as needed) |
| `client/CLAUDE.md:42-44` | API DTO fields stay snake_case; local props/state camelCase |
| `client/CLAUDE.md:48-49` | Never `fetch` from a component — one TanStack Query hook per server call |
| `client/CLAUDE.md:56-58` | Client tests mock `fetch`, so only the server suite can catch a response-shape regression |
| `client/CLAUDE.md:62-63` | Don't duplicate a `src/vendor/ui` primitive — hence `MonoLink`, not a hand-rolled `<a>` |
| `client/INSIGHTS.md:13-21` | A route-local collapsible header and `FileCard`'s header both render `role="button"` + `aria-expanded`; wrap each group in `<section aria-label>` so the tiers stay queryable. Applied to the per-symbol rows (Step 10) |
| `client/INSIGHTS.md:25-32` | `Badge` is a `<span>`, `Chip` is a `<button>` — endpoint/cron chips are read-only, the Tree/Graph toggle is interactive |
| `client/INSIGHTS.md:81-88` | Vendored `Badge` takes no `title` — a tooltip needs a wrapping `<span title>` |
| `client/INSIGHTS.md:112-118` | `@testing-library/user-event` is **not** installed; use `fireEvent` (adding it would touch `pnpm-lock.yaml`) |
| `mcp/CLAUDE.md:22-30` | `src/api.ts` is the only file that calls `fetch`; `format.ts` owns every projection/cap; `constants.ts` owns every budget |
| `mcp/CLAUDE.md:41-43` | `@devdigest/shared` is imported **type-only** in this package (the alias is not rewritten into output) |
| `mcp/CLAUDE.md:53-62` | `tools/list` has a 1500-token budget; arguments are flat primitives; projections are allowlists; every failure names the next call |
| `mcp/CLAUDE.md:81-89` | npm not pnpm; five tools is the surface (this replaces a stub, it adds none) |
| `mcp/INSIGHTS.md:9-14` | Baseline `tools/list` = 3889 chars ≈ 1111 tokens, 26% (1361 chars) of headroom — the budget this change spends |
| `mcp/INSIGHTS.md:35-39` | `isError` is advice to retry; the stub deliberately returns `isError: false`. The replacement keeps that for "repo not indexed" |
| `INSIGHTS.md:16-21` (root) | `!**/INSIGHTS.md` must stay last in a workflow `paths:` list — checked: no workflow edit is needed (see *Risks*) |
| `TESTING.md:8-24`, `67-84` | Typological testing; the verbatim per-package commands used in the *Test plan* |
| `.claude/skills/pr-self-review/routing.md:12-74` | The lane lookup reproduced in *Skills the implementer will apply* |
| `.claude/skills/onion-architecture/SKILL.md:97-114` (decision table) | Endpoint → `routes.ts`; use case → `service.ts`; pure transform/DTO mapper → `helpers.ts`; wiring/lifetime → `platform/container.ts` |
| `.claude/skills/frontend-code-organization/SKILL.md:99-121` | What a component folder may contain, and the `styles.ts`/`constants.ts`/`helpers.ts` thresholds |
| `.claude/skills/frontend-code-organization/SKILL.md:150-168` | User-facing strings live in `messages/<locale>/<area>.json`, never in a `constants.ts`; a `constants.ts` may hold the **key**; colours map to CSS custom properties, never a hex |
| `.claude/skills/frontend-code-organization/SKILL.md:185-203` | Network → a TanStack Query hook in `src/lib/hooks/<domain>.ts`; deriving/formatting → `helpers.ts`; orchestration → the component |

## Architectural constraints binding this change

- **All the data already exists; this feature only reads and maps it.**
  `repoIntel.getBlastRadius(repoId, changedFiles)` returns `changedSymbols`, a
  flat `callers` list, `impactedEndpoints`, and per-caller-file `factsByFile` —
  source: `server/src/modules/repo-intel/service.ts:220-304` (fallback path) and
  `:315-391` (persistent path); the `BlastResult` shape at
  `server/src/modules/repo-intel/types.ts:74-87`. One call per request; nothing
  is re-parsed and nothing is written.
- **The facade never throws.** No usable index → empty arrays plus
  `degraded: true` and a `reason`
  (`server/src/modules/repo-intel/service.ts:228-234, 237, 247`). The only
  reason `getBlastRadius` actually emits today is `'no_data'`; the wider union
  `flag_off | index_failed | index_partial | repo_too_large | no_data` is
  declared at `server/src/modules/repo-intel/types.ts:27-32` and other facade
  methods use more of it. **The UI must therefore handle any member, not just
  the one currently produced** — see **D2**.
- **`repoIntel` is reached through the container, never constructed ad hoc.**
  `container.repoIntel` is a lazy getter that honours a test override
  (`server/src/platform/container.ts:126-130`; the override is declared at
  `:52-53`). `server/INSIGHTS.md:100-112` is explicit that another module's
  Service is consumed through a `Container` getter. The one exception it names —
  a module's own `routes.ts` constructing a local instance for job-handler
  registration (`server/src/modules/repo-intel/routes.ts:25-31`) — does not
  apply here.
- **A lesson feature is its own module registered in `modules/index.ts`**, and
  that file names `blast` as a per-lesson module by design — source:
  `server/src/modules/index.ts:25`; the registry shape at `:29-41`.
- **The route template is `smart-diff/routes.ts`**: `async function
  xRoutes(appBase: FastifyInstance)`, `.withTypeProvider<ZodTypeProvider>()`,
  the service constructed **once above the handlers**,
  `schema: { params: IdParams, response: { 200: ... } }`, `getContext` first in
  every handler — source: `server/src/modules/smart-diff/routes.ts:23-35`;
  `IdParams` at `server/src/modules/_shared/schemas.ts:11`.
- **The PR lookup is the only workspace scope check.**
  `reviewRepo.getPull(workspaceId, prId)` → `PullRow | undefined`
  (`server/src/modules/reviews/repository.ts:31-33`), and `PullRow` carries
  `repoId` + `headSha` (`server/src/db/rows.ts:15`;
  `server/src/db/schema/pulls.ts:12,20`). `repo-intel`'s own tables carry **no**
  `workspace_id` (`server/src/modules/repo-intel/routes.ts:37-41`), so tenancy
  must be enforced before the facade is touched — exactly as it is here.
- **Changed file paths come from `getPrFiles(prId)`**
  (`server/src/modules/reviews/repository.ts:39-41`), exposed by the
  cross-cutting `container.reviewRepo` getter
  (`server/src/platform/container.ts:105-107`).
- **A service must not name another module's repository class.**
  `no-cross-module-repository` fires on `^src/modules/([^/]+)/` →
  `^src/modules/([^/]+)/repository` with `pathNot: '^src/modules/$1/'`
  (`server/.dependency-cruiser.cjs:246-259`, severity `warn`), and `import type`
  does not escape it because `tsPreCompilationDeps: true`
  (`.dependency-cruiser.cjs:300`) keeps type-only imports in the graph. Both
  dependencies are therefore typed by **indexed access** —
  `Container['reviewRepo']`, `Container['repoIntel']` — the idiom already in use
  at `server/src/modules/smart-diff/service.ts:24` and
  `server/src/modules/reviews/service.ts:31`.
- **`helpers.ts` is pure and may not import the container.**
  `no-container-in-helpers` (severity **error**,
  `server/.dependency-cruiser.cjs:133-140`) and `no-schema-in-helpers` (severity
  **error**, `:124-132`). So `blast/helpers.ts` imports the `BlastResult` type
  directly from `../repo-intel/types.js` (type-only) and **not**
  `Container['repoIntel']`.
- **`no-fastify-outside-edge`** (severity **error**,
  `server/.dependency-cruiser.cjs:193-201`, `HTTP_EDGE` at `:60-65`) — only
  `routes.ts` may name Fastify. That is why the response schema lives in its own
  `blast/schemas.ts` rather than in `routes.ts`: `service.ts` and `helpers.ts`
  need the type, and importing it from `routes.ts` would point an inner layer at
  the HTTP edge.
- **Depcruise baseline is clean and is a gate, not a suggestion.** Measured at
  plan time: `no dependency violations found (170 modules, 561 dependencies
  cruised)`. A `warn` counts as a regression, because the graph is clean today.
- **`@devdigest/shared` is the one contract source and the client keeps a
  physically identical copy** (`CLAUDE.md:107-110`; verified at plan time:
  `diff -r client/src/vendor/shared server/src/vendor/shared` is silent). This
  plan **edits neither copy** — see **D1**.
- **Never `fetch` from a component**; one TanStack Query hook per server call in
  `client/src/lib/hooks/*` — `client/CLAUDE.md:48-49`; frontend-code-organization
  `SKILL.md:185-190`.
- **Query keys are built by the factory, never by hand.**
  `client/src/lib/hooks/keys.ts:1-19` exists precisely because two hand-built
  copies of a key string drifted; the new key is added to `reviewKeys`.
- **`next-intl` namespaces need no registration.**
  `client/src/i18n/request.ts:16-25` reads every `messages/en/*.json` and merges
  it as `{ [basename]: ... }`, so `blast.json` is **already** available as
  `useTranslations("blast")`. Nothing to wire.
- **User-facing strings live in `client/messages/en/blast.json`**, never in a
  `constants.ts` (frontend-code-organization `SKILL.md:160-163`); colours are CSS
  custom properties, never hex (`SKILL.md:164-166`). `en` is the only locale.
- **`mcp/src/api.ts` is the only file in that package that calls `fetch`**
  (`mcp/CLAUDE.md:23` and the file's own header comment), contracts there are
  imported **type-only** (`mcp/CLAUDE.md:41-43`), and the `tools/list` payload
  must stay under `TOOLS_LIST_CHAR_BUDGET = 5250`
  (`mcp/src/constants.ts:34`), asserted by `mcp/test/token-budget.test.ts`.
- **No new dependency anywhere.** The graph view is hand-rolled inline SVG/CSS;
  adding a charting library would touch `client/pnpm-lock.yaml`
  (`CLAUDE.md:148-152`, `client/CLAUDE.md:64-65`).

## Skills the implementer will apply

Lookup per `.claude/skills/pr-self-review/routing.md`.

| Path to be touched | Lane | Skills (per routing.md) |
|---|---|---|
| `server/src/modules/blast/routes.ts` (new) | backend + cross-cutting | fastify-best-practices, onion-architecture, zod (routing.md:14); **security** — the added lines declare a new public route (routing.md:68) |
| `server/src/modules/blast/service.ts` (new) | backend | onion-architecture (routing.md:16) |
| `server/src/modules/blast/helpers.ts` (new) | backend | onion-architecture (routing.md:16) |
| `server/src/modules/blast/schemas.ts` (new) | backend + cross-cutting | onion-architecture — no exact row; nearest is routing.md:16 (a non-route file under `server/src/modules/**`). **zod** by content (routing.md:69 — a new schema) |
| `server/src/modules/index.ts` (edit) | backend | fastify-best-practices, onion-architecture (routing.md:15 — plugin registration) |
| `server/test/blast-helpers.test.ts`, `server/test/blast-service.test.ts`, `server/test/blast.it.test.ts` (new) | backend | **none** — `RULE-IT-SUFFIX` only (routing.md:25) |
| `client/src/lib/hooks/keys.ts`, `client/src/lib/hooks/reviews.ts` (edit) | frontend | react-best-practices, frontend-code-organization (routing.md:39) |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/**` (**new folder**) | frontend | react-best-practices, frontend-code-organization — *placement is the point* (routing.md:37, :43) |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` (edit) | frontend | react-best-practices, frontend-code-organization (routing.md:37) |
| `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit) | frontend | next-best-practices, frontend-code-organization (routing.md:36 — a Next file convention) |
| `client/messages/en/blast.json` (edit) | frontend | frontend-code-organization — strings live here, never in constants (routing.md:41) |
| `client/**/BlastRadiusCard.test.tsx` (new) | frontend | react-testing-library (routing.md:42) |
| `mcp/src/api.ts`, `mcp/src/format.ts`, `mcp/src/constants.ts`, `mcp/src/tools/get-blast-radius.ts`, `mcp/test/**` | **no lane** | none — `mcp/**` is uncovered by design (routing.md:52), so it gets `repo-rules.md` only and is listed in `uncovered_files`. `mcp/CLAUDE.md` + `mcp/INSIGHTS.md` are the governing documents instead |
| `docs/plans/hw04-blast-radius.plan.md` (this file) | **no lane** | none — `docs/**` is uncovered by design (routing.md:52); it contains no Mermaid block, so the routing.md:57-58 exception does not apply |

Cross-cutting lanes checked and **not** triggered: `typescript-expert`
(routing.md:70) — after **D2** there is no conditional type, no `any`, no
`as unknown as`, no new `.d.ts`; the only `as` in the plan is a test-fixture cast
in a `server/test/**` file, which has no lane. `drizzle-orm-patterns`
(routing.md:17, :71) — this plan adds **no** query at all and touches no
repository file. `postgresql-table-design` (routing.md:20) — no schema file is
touched. `next-best-practices` is triggered only by the one-line prop addition in
`page.tsx`.

**`dataviz` considered and not routed.** Its trigger list includes the word
"graph", but it is not in `routing.md`'s map, so `pr-self-review` will not run
it. Its one substantive overlap — chart colours must come from the design
system — is already binding here through frontend-code-organization
`SKILL.md:164-166` ("colours are CSS custom properties, never hex"), which the
graph view obeys.

---

## Design decisions (settled here so no step re-litigates them)

### D1 — `degraded`/`reason` ride on a **route-local** schema that extends `BlastRadius`; `brief.ts` is not touched

The tension: P2 requires the route response to validate against the shared
`BlastRadius` contract **and** requires `degraded` + `reason` to reach the UI —
but `BlastRadius` has neither field
(`server/src/vendor/shared/contracts/brief.ts:52-57`).

**(a) Widen `BlastRadius` in `brief.ts` — rejected.** `BlastRadius` is not a
standalone response: it is composed into `PrBrief` in the same file
(`brief.ts:4-5` names it as a PR-Brief building block), so widening it changes a
second contract's shape for a field that has nothing to do with a brief. It is
also the more expensive edit: `vendor/shared` is a **physical copy** in both
`server/` and `client/` with CI enforcing `diff -r`, so every contract edit is a
two-copy hand-sync. And `contracts/*` may import zod **only**
(`core-stays-pure`, severity error, `server/.dependency-cruiser.cjs:204-214`),
so the degraded reason union — which lives in
`server/src/modules/repo-intel/types.ts:27-32`, server-internal by design —
would have to be duplicated into shared as well.

**(b) A route-local extension — chosen.** `server/src/modules/blast/schemas.ts`
declares:

```ts
export const BlastRadiusResponse = BlastRadius.extend({
  degraded: z.boolean().optional(),
  reason: z.string().optional(),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;
```

- `BlastRadius` itself is **unchanged**, so `PrBrief` is unaffected and no
  vendored copy moves — `RULE-CONTRACT-SYNC` and `RULE-CONTRACT-BREAK`
  (routing.md:23) are satisfied vacuously.
- Because it `.extend()`s, every `changed_symbols`/`downstream`/`summary` value
  is validated by the *same* sub-schemas `BlastRadius` uses, which is what P2's
  "validates against `BlastRadius`" asks for. Step 6 additionally asserts
  `BlastRadius.parse(body)` succeeds on the live response, so the claim is
  tested, not argued.
- Route-local zod schemas already have precedent here —
  `server/src/modules/agents/routes.ts:11,14,33,46` and
  `server/src/modules/skills/routes.ts:27,32`. Those are declared inline in
  `routes.ts`; this one gets its **own file** because `service.ts` and
  `helpers.ts` need the type, and importing it from `routes.ts` would make an
  inner layer depend on the HTTP edge (`no-fastify-outside-edge`,
  `server/.dependency-cruiser.cjs:193-201`). No depcruise rule matches
  `^src/modules/[^/]+/schemas\.ts$`.
- The **client** consequence: the extra two fields are not in
  `@devdigest/shared`, so the hook declares a local interface extending the
  shared `BlastRadius` type. That is an established pattern here —
  `client/src/lib/hooks/repo-intel.ts:13-25` declares `RepoIntelState` locally
  with exactly this rationale ("kept local — not in `@devdigest/shared`, since
  repo-intel types live server-side").

**Implementer trap, load-bearing.** `useSmartDiff` validates its response by
passing the shared schema to `api.get`
(`client/src/lib/hooks/reviews.ts:176`). **Do not pass the bare `BlastRadius`
schema** to `api.get` for this endpoint: zod objects strip unknown keys, so
`degraded`/`reason` would be silently deleted from the parsed result and the
degraded badge would never render. Step 8 passes a client-local extended schema
instead.

### D2 — `reason` is `z.string()` on the wire, `DegradedReason` inside the server

A closed `z.enum([...])` of the five reasons was the first instinct. It is
rejected: the route declares `response: { 200: ... }`, so a reason value outside
the enum makes Fastify's response serialization **fail and 500** — on the one
code path whose entire contract is "never throws"
(`server/src/modules/repo-intel/types.ts:15-22`). Duplicating the union in
`schemas.ts` would also need a drift guard (a conditional type), which would pull
the whole change into the `typescript-expert` lane (routing.md:70) to buy
nothing.

So: `reason: z.string().optional()` at the boundary. Type safety is not lost
where it matters — the service assigns `result.reason`, which is
`DegradedReason | undefined` (`server/src/modules/repo-intel/types.ts:86`), so
TypeScript still rejects a typo server-side. The **client** maps the five known
reasons to labels via `REASON_LABEL_KEY` and falls back to
`degraded.reason.unknown` for anything else, so a new reason degrades to a
generic label instead of a blank badge.

### D3 — `downstream` carries **one entry per changed-symbol name, including zero-caller ones**, and it is the render order

`DownstreamImpact` (`brief.ts:44-50`) is keyed by `symbol` — a bare name. The
facade returns callers as one **flat** list tagged with `viaSymbol`
(`server/src/modules/repo-intel/types.ts:63-72`). The mapping is therefore: group
`callers` by `viaSymbol`, and emit an entry for **every** unique name in
`changedSymbols`, even when its caller list is empty.

Why include the empty ones rather than only symbols that have callers:

1. The card renders one row **per changed symbol**; if `downstream` held only the
   symbols with callers, the client would have to join two arrays by name and
   invent an order for the remainder. One ordered array is one render loop.
2. `blast.json`'s `noDownstream` is `"{count} changed symbol(s), no downstream
   callers found."` — it takes a **count**, which confirms the intended empty
   state is "symbols exist, callers do not", not "nothing at all".
3. `changed_symbols` stays the authoritative declaration list (name + file +
   kind) and is what the stat row counts; `downstream` is the render list.

**Order** (P3's "sort symbols by rank descending"): `maxRank` descending, then
caller count descending, then symbol name ascending. `BlastCallerRow.rank` is the
*caller file's* `file_rank` percentile
(`server/src/modules/repo-intel/types.ts:70-71`), so a symbol's rank is the
maximum over its callers; a symbol with no callers has `maxRank = 0` and sinks to
the bottom naturally. The two tiebreakers exist because the ripgrep fallback path
sets every `rank` to `0` (`server/src/modules/repo-intel/service.ts:283`), and
without them the order would be whatever the map iterated.

**Known limitation, recorded not fixed:** two changed symbols with the same *name*
in *different* files collapse into one `downstream` entry, because the contract
keys on the name alone. The union of their callers is correct; the attribution to
a single declaring file is not. Listed under *Risks*.

### D4 — The declaring file is excluded in `helpers.ts`, defensively, because the facade's guarantee is uneven

The brief this plan was written from states the facade "already drops the
declaring file from a symbol's own callers". **Verified: that is true on one path
and only structurally true on the other.**

- Ripgrep fallback: an explicit filter, `if (r.fromPath === sym.file) continue;`
  (`server/src/modules/repo-intel/service.ts:272`).
- Persistent path: `getResolvedCallers` has **no such filter** — its `WHERE` is
  `references.declFile IN (declFiles) AND references.toSymbol IN (names)`
  (`server/src/modules/repo-intel/repository.ts:524-529`). Self-file callers are
  excluded only *because* `decl_file` is resolved through the import graph — a
  reference resolves to file `F` only when `from_path` **imports** `F`
  (`server/src/modules/repo-intel/repository.ts:406-422`), and a file does not
  import itself.

That is a guarantee of the resolver, not an assertion anyone wrote down. So the
grouping helper drops any caller whose `file` equals a declaring file **of that
same symbol name**, and Step 2 asserts it. Note the precise predicate: a caller
file that merely happens to be *another* changed file is a legitimate caller
(file A in the PR calling a symbol declared in file B in the PR) and must be
kept.

### D5 — Per-symbol endpoints/crons come only from `factsByFile`; the flat `impactedEndpoints` is never attributed to a symbol

`factsByFile` is present only on the persistent path
(`server/src/modules/repo-intel/service.ts:376-388`; documented as such at
`types.ts:79-84`). The fallback path returns `impactedEndpoints` as a flat
repo-wide union with no per-file attribution
(`service.ts:288-294, 300`) — and no cron equivalent at all.

**Decision:** `endpoints_affected` / `crons_affected` are built **only** from
`factsByFile[callerFile]`. When `factsByFile` is absent, every group gets `[]`.
Attaching a flat union to a particular symbol would be a claim the data does not
support, and **grounding is mandatory in this repo** (`CLAUDE.md:121-124`: a
finding without a real citation is dropped). The fallback path always sets
`degraded: true` (`service.ts:232, 301-302`), so the card already explains the
gap with its degraded badge rather than showing a fabricated chip.

Union semantics: dedupe, then **sort ascending** so the output is byte-stable
regardless of caller iteration order — which is what makes the unit test and the
MCP response assertable.

### D6 — `summary` is built by string interpolation in `helpers.ts`

The contract requires `summary: string` (`brief.ts:55`). It is produced by
deterministic interpolation over the counts — **no model call**, which is P2's
explicit requirement. It is an API field consumed by MCP, **not** UI copy, so
frontend-code-organization §5 (strings belong in `messages/`) does not apply and
plain English in the server is correct; `NotFoundError('Pull request not found')`
(`server/src/modules/smart-diff/service.ts:30`) is the existing precedent for
server-side English. The card renders its own labels from `blast.json` and does
not display `summary`.

Exact form, asserted verbatim in Step 2:

```
<S> changed symbol(s), <C> caller(s) in <F> file(s), <E> endpoint(s), <K> cron(s).
```

plus, when `degraded`, the suffix
` Index incomplete (<reason>) — results may be missing callers.`
(and `Index incomplete (<reason>) — no call graph available.` when there are no
changed symbols at all).

### D7 — `MAX_CALLERS_PER_SYMBOL` is a **global** cap of 20 on the persistent path; this plan does not change it

`server/src/modules/repo-intel/constants.ts:29-30` documents
`MAX_CALLERS_PER_SYMBOL = 20` as a "caller fan-out cap **per changed symbol**",
but `server/src/modules/repo-intel/service.ts:386` applies it as
`callers.slice(0, MAX_CALLERS_PER_SYMBOL)` over the **whole flat list**, after a
global `rank`-descending sort (`service.ts:372`). So a PR touching many symbols
can surface at most 20 caller rows in total, and low-ranked symbols can lose all
of theirs.

That is a `repo-intel` bug-or-misnomer, not a `blast` one. **Out of scope** —
fixing it changes prompt fuel for the reviewer path too, which this homework must
not touch. Consequences for this plan: the `callers` stat is `<= 20`; the
per-symbol caller counts are whatever the facade returned, never re-derived; and
the integration test asserts no number that depends on the cap. Also note
`BFS_DEPTH = 2` (`server/src/modules/repo-intel/constants.ts:49`) is **not** used
by `getBlastRadius` at all — it is read only by `getCriticalPaths`
(`service.ts:686`), so it is not a constraint on this feature.

### D8 — `repoIntel` is captured once at plugin load, like `reviewRepo`

`blast/routes.ts` does
`new BlastService(app.container.reviewRepo, app.container.repoIntel)` above the
handlers, mirroring `server/src/modules/smart-diff/routes.ts:25`. This forces the
lazy `get repoIntel()`; its only side effect is
`new RepoIntelRepository(container.db)`
(`server/src/modules/repo-intel/service.ts:104-106`), so there is nothing to
defer. Container overrides still work, because `buildApp` builds the container
**before** registering the feature modules (`server/src/app.ts:35-44` and the
plugin-order comment at `:36-39`) — which is what makes Step 6's
`overrides.repoIntel` fake reach the route.

### D9 — The card sits between `IntentCard` and the PR body

`OverviewTab` renders `<IntentCard>` then the description
(`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:14-30`),
with a comment explaining that derived intent goes *above* the author's prose
because it answers "what is this for". Blast radius answers "what can it reach" —
the same class of derived context, one question later. So: intent → blast → body.

### D10 — Read-only chips are `Badge`s; the Tree/Graph toggle is a `Chip` pair

`client/INSIGHTS.md:25-32` — `Badge` renders a `<span>`, `Chip` a `<button>`.
Endpoint and cron chips are labels and must not be announced as interactive, so
they are `Badge`s (the `IntentCard` risk-chip precedent,
`IntentCard.tsx:113-122`). The Tree/Graph control genuinely *is* interactive, so
it is two `Chip`s with `active` on the current mode inside a
`<div role="group" aria-label>` — `Chip`'s `active` state already paints the
filled/unfilled pair (`client/src/vendor/ui/primitives/Chip.tsx:34-37`). Do not
build a segmented control from scratch (`client/CLAUDE.md:62-63`).

Crons are made "visually distinct" (P3) by icon + colour, not by a new
primitive: `<Badge mono icon="Clock" color="var(--info)">` versus
`<Badge mono color="var(--accent-text)">` for endpoints. `Clock` is in the icon
registry (`client/src/vendor/ui/icons.tsx`).

### D11 — Caller links use `MonoLink`, and degrade to plain text without a repo slug

`MonoLink` with `href` already renders an
`<a target="_blank" rel="noopener noreferrer">` with `onClick` stopPropagation
(`client/src/vendor/ui/primitives/MonoLink.tsx:25-40`) — stronger than the
`rel="noreferrer"` the change request asked for, and reusing it satisfies
`client/CLAUDE.md:62-63`. The `href` is
`githubBlobUrl(repoFullName, headSha, file, line)`
(`client/src/lib/github-urls.ts:22-37`) — a **blob** link at the head sha, not a
diff link, because a caller file is by definition not in the PR's diff.

`repoFullName` can be `null` on the PR detail page
(`client/src/app/repos/[repoId]/pulls/[number]/page.tsx:75`). When it is, render
the `file:line` as a plain `<span className="mono">` — **not** `MonoLink` without
`href`, which falls back to a `<button>`
(`client/src/vendor/ui/primitives/MonoLink.tsx:42-53`) and would announce a dead
control.

### D12 — The resync CTA is a plain `Button`, not `EmptyState`'s

`EmptyState`'s CTA hardcodes `icon="Plus"`
(`client/src/vendor/ui/primitives/EmptyState.tsx:58-60`), which is wrong for a
re-index action. The degraded state renders its own
`<Button kind="tertiary" size="sm" icon="RefreshCw" loading={resync.isPending}>`
next to the badge, wired to `useResyncRepoIntel(repoId)`
(`client/src/lib/hooks/repo-intel.ts:41-50`). `EmptyState` is still used for the
*no changed symbols* and *error* states, without a CTA.

### D13 — MCP: `get_blast_radius` gains `limit`/`offset`, not a second tool

The tool surface stays at five (`mcp/CLAUDE.md:87-89`); the stub is *replaced*.
Two flat numeric arguments are added so a wide blast radius is paged rather than
guillotined: `capResponse` truncates mid-JSON and its footer says "narrow the
query with limit/offset" (`mcp/src/format.ts:133-139`) — advice that is a lie
unless the tool actually has those arguments. Paging reuses `paginate` +
`truncationFooter` (`mcp/src/format.ts:29-42`) over the `downstream` array, the
same shape `get_findings` uses (`mcp/src/tools/get-findings.ts:60-61`).
Budget check: headroom is 1361 chars (`mcp/INSIGHTS.md:9-14`) and the change is a
longer description plus two described args, roughly 350 chars — Step 16
re-measures.

### D14 — MCP: "repo not indexed" is a normal result, not an error

When the response is `degraded` **and** has no downstream data, the tool returns
a plain `text()` naming the next action ("open the repo in the DevDigest studio
and run Re-analyze, then retry"), with `isError` left false. That is
`get_findings`'s "no review yet" branch exactly
(`mcp/src/tools/get-findings.ts:50-57`) and preserves the property
`mcp/INSIGHTS.md:35-39` records: `isError` is advice to retry, and retrying
cannot index a repository. A `degraded` response that *does* carry data gets a
`note` field instead, and the data.

---

## Steps

### Step 1 — Server: the route-local response schema
- **Files:** `server/src/modules/blast/schemas.ts` (new)
- **Change:** export `BlastRadiusResponse` as a const **and** its inferred type
  under the same name (`server/CLAUDE.md:41-44`):
  `BlastRadius.extend({ degraded: z.boolean().optional(), reason: z.string().optional() })`.
  Imports: `zod` and `{ BlastRadius } from '@devdigest/shared'` — nothing else.
  A file-header comment records **D1** (why this extends rather than edits
  `brief.ts`: `BlastRadius` is composed into `PrBrief`, and the two vendored
  copies are physical duplicates) and **D2** (why `reason` is `z.string()` and
  not a closed enum).
  Deliberately **no** `blast/constants.ts`: every cap this feature obeys already
  lives in `server/src/modules/repo-intel/constants.ts`, and
  frontend-code-organization's rule against scaffolding empty files applies to
  the server module layout too.
- **Constraint:** the shared contract at
  `server/src/vendor/shared/contracts/brief.ts:52-57` is **read, never
  written** — and neither is its client copy.
- **Done when:** `cd server && pnpm typecheck` passes;
  `BlastRadiusResponse.parse({ changed_symbols: [], downstream: [], summary: '' })`
  succeeds, and the same object plus `degraded: true, reason: 'no_data'`
  round-trips with both fields retained; and
  `git diff --name-only -- server/src/vendor/shared client/src/vendor/shared`
  is empty.

### Step 2 — Server: the mapping test table, written before the mapper
- **Files:** `server/test/blast-helpers.test.ts` (new)
- **Change:** a hermetic unit test over `toBlastRadiusResponse(result: BlastResult)`,
  modelled on `server/test/smart-diff-service.test.ts:1-17`'s header style (state
  what the pure function decides, then flat cases). It builds `BlastResult`
  literals by hand — no container, no DB, no mocks. Minimum cases:

  | Case | Asserts |
  |---|---|
  | two symbols, callers on both | `downstream` has one entry per symbol name; each caller maps to `{name: row.symbol, file: row.file, line: row.line}` |
  | a symbol with **zero** callers | still gets a `downstream` entry, with `callers: []` (**D3**) |
  | a caller row whose `file` **is** the declaring file of its `viaSymbol` | dropped (**D4**) |
  | a caller row whose `file` is a *different* changed file | **kept** (**D4**'s precise predicate) |
  | duplicate caller rows (same file + symbol + line) | deduped |
  | `factsByFile` with the same endpoint on two caller files of one symbol | `endpoints_affected` contains it once, and the array is sorted ascending (**D5**) |
  | `factsByFile` carrying crons | `crons_affected` populated and sorted; endpoints and crons never cross-contaminate |
  | `factsByFile` **absent** (fallback path) with a non-empty `impactedEndpoints` | every `endpoints_affected` and `crons_affected` is `[]` (**D5**) |
  | ranks 90 / 10 / none | `downstream` ordered `maxRank` desc, then caller count desc, then name asc (**D3**) |
  | `degraded: true, reason: 'no_data'` | both fields present on the output; `summary` carries the degraded suffix (**D6**) |
  | `degraded` absent | neither key is present on the output object (`'degraded' in out === false`) |
  | fully empty `BlastResult` | `changed_symbols: []`, `downstream: []`, and the "no call graph available" summary |
  | any produced object | `BlastRadiusResponse.parse(out)` **and** `BlastRadius.parse(out)` both succeed |
  | one `summary` case | asserted **verbatim** against **D6**'s format string |
- **Constraint:** hermetic, so it must **not** carry the `.it.test.ts` suffix
  (`TESTING.md:88-91`). It is written and run **before** Step 3 and is expected
  to fail only on the missing import — that ordering is the point.
- **Done when:** the file exists with every row above and
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` fails on the
  missing `toBlastRadiusResponse` import and on nothing else.

### Step 3 — Server: the pure mapping helper
- **Files:** `server/src/modules/blast/helpers.ts` (new)
- **Change:** export `toBlastRadiusResponse(result: BlastResult): BlastRadiusResponse`,
  plus the smaller pure functions it composes from (export one only if Step 2
  asserts it directly):
  1. `changed_symbols` — `result.changedSymbols` picked field by field
     (`{ name, file, kind }`), **allowlist, not a spread**, so a future field on
     `BlastChangedSymbol` cannot leak onto the wire.
  2. a `name -> Set<declaringFile>` map from `changedSymbols`, used to drop
     self-file callers (**D4**).
  3. group the surviving `result.callers` by `viaSymbol`, preserving the facade's
     already-rank-descending order
     (`server/src/modules/repo-intel/service.ts:372`) and deduping on
     `file|symbol|line`.
  4. per group, union `result.factsByFile?.[callerFile]?.endpoints` and `.crons`
     across that group's caller files; dedupe; sort ascending (**D5**).
  5. emit one `DownstreamImpact` per unique changed-symbol name — including
     zero-caller names — ordered by `maxRank` desc, caller count desc, name asc
     (**D3**).
  6. `summary` by interpolation (**D6**). **No model call, no I/O, no clock, no
     randomness.**
  7. `degraded`/`reason`: spread on **only** when `result.degraded === true`;
     both keys absent otherwise.
  Imports: `type { BlastResult } from '../repo-intel/types.js'` and
  `type { BlastRadiusResponse } from './schemas.js'` — both type-only.
- **Constraint:** `no-container-in-helpers` and `no-schema-in-helpers` are
  severity **error** (`server/.dependency-cruiser.cjs:124-140`), so this file
  imports neither the container nor `db/schema`/`drizzle-orm`. Per
  `server/INSIGHTS.md:124-131`, the purity doc comment must **not** spell out the
  tokens `container`, `drizzle` or `db/schema` — describe the rule ("no wiring,
  no data access, no HTTP") so the grep gate below tests the code and not the
  prose.
- **Done when:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  is green on `blast-helpers.test.ts` including every row of Step 2's table;
  `cd server && pnpm typecheck` passes; and
  `grep -nE "container|drizzle|db/schema" server/src/modules/blast/helpers.ts`
  returns nothing.

### Step 4 — Server: `BlastService`
- **Files:** `server/src/modules/blast/service.ts` (new),
  `server/test/blast-service.test.ts` (new)
- **Change:**
  ```ts
  export class BlastService {
    constructor(
      private repo: Container['reviewRepo'],
      private intel: Container['repoIntel'],
    ) {}

    async forPull(workspaceId: string, prId: string): Promise<BlastRadiusResponse> {
      // The PR lookup IS the workspace scope check — repo-intel's tables carry
      // no workspace_id, so nothing downstream can re-check it.
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull) throw new NotFoundError('Pull request not found');

      const files = await this.repo.getPrFiles(prId);
      const result = await this.intel.getBlastRadius(pull.repoId, files.map((f) => f.path));
      return toBlastRadiusResponse(result);
    }
  }
  ```
  `getBlastRadius` is called **exactly once** and never throws
  (`server/src/modules/repo-intel/service.ts:220-304`), so there is no try/catch
  and no second call. An empty `files` list is passed straight through — the
  facade already returns a degraded empty result for it
  (`server/src/modules/repo-intel/service.ts:223, 237`).
  The hermetic test uses two hand-rolled fakes (no container, no DB), following
  `server/test/smart-diff-service.test.ts:53-60`'s `buildService` shape, and
  asserts: a PR with files calls `getBlastRadius` once with
  `(pull.repoId, [paths...])`; a degraded facade result yields a response with
  `degraded: true`; an unknown `prId` rejects with `NotFoundError`; and a PR with
  **zero** `pr_files` resolves rather than throwing.
- **Constraint:** both dependencies are typed by **indexed access** —
  `Container['reviewRepo']`, `Container['repoIntel']` — never the concrete
  `ReviewRepository` / `RepoIntelService` classes, because naming a class creates
  a `blast -> <module>/repository` edge that trips `no-cross-module-repository`,
  and `import type` does not escape it
  (`server/.dependency-cruiser.cjs:246-259` plus `:300`). Precedent:
  `server/src/modules/smart-diff/service.ts:24`. Do **not** write
  `new RepoIntelService(container)` — `server/INSIGHTS.md:100-112` requires the
  `Container` getter (`server/src/platform/container.ts:126-130`). Services hold
  no SQL and no Fastify (`no-db-in-service`, `no-fastify-in-service`, both
  severity error, `server/.dependency-cruiser.cjs:106-123`). Consume
  `getPrFiles`'s return type **by inference only**: there is no `PrFileRow` in
  `server/src/db/rows.ts:12-21`, and importing `db/schema` to name it is an
  error-severity violation.
- **Done when:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  is green on `blast-service.test.ts`; `cd server && pnpm typecheck` passes; and
  `grep -nE "drizzle|db/schema|RepoIntelService|ReviewRepository" server/src/modules/blast/service.ts`
  returns nothing.

### Step 5 — Server: the route and its registration
- **Files:** `server/src/modules/blast/routes.ts` (new),
  `server/src/modules/index.ts` (edit)
- **Change:** a default Fastify plugin copying
  `server/src/modules/smart-diff/routes.ts:23-35`:
  ```ts
  export default async function blastRoutes(appBase: FastifyInstance) {
    const app = appBase.withTypeProvider<ZodTypeProvider>();
    const service = new BlastService(app.container.reviewRepo, app.container.repoIntel);

    app.get(
      '/pulls/:id/blast',
      { schema: { params: IdParams, response: { 200: BlastRadiusResponse } } },
      async (req) => {
        const { workspaceId } = await getContext(app.container, req);
        return service.forPull(workspaceId, req.params.id);
      },
    );
  }
  ```
  Then in `server/src/modules/index.ts`: one import
  (`import blast from './blast/routes.js';`, next to the `smartDiff` import at
  line 10) and one entry `blast,` in the `modules` record (lines 29-41). A
  file-header comment states that this is the per-lesson `blast` module the
  registry already anticipates (`server/src/modules/index.ts:25`), that it makes
  **no** model call and reads **no** new table, and that the endpoint is
  deliberately not another handler on `pulls/routes.ts`.
- **Constraint:** routes hold no logic and never import `drizzle-orm`/`db/schema`;
  the service is constructed **once above the handlers**, not per request;
  validation is the route's zod schema, never a hand-rolled parse
  (`server/CLAUDE.md:53-55`); `getContext`
  (`server/src/modules/_shared/context.ts`) is the first line of the handler and
  the only workspace-scoping seam. `response: { 200: BlastRadiusResponse }` is
  what makes P2's "the response validates against the contract" true at
  **runtime**, not only at compile time. **D8** covers why capturing
  `app.container.repoIntel` at plugin load is safe.
- **Done when:** `GET /pulls/<uuid>/blast` returns 200 for a seeded PR; a non-uuid
  `:id` returns **422** before the handler runs; a uuid belonging to another
  workspace returns **404**;
  `grep -nE "drizzle|db/schema" server/src/modules/blast/routes.ts` is empty; and
  `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` still
  reports **0 violations** (baseline: 170 modules, 561 dependencies).

### Step 6 — Server: the integration test
- **Files:** `server/test/blast.it.test.ts` (new)
- **Change:** a DB-backed test following `server/test/smart-diff.it.test.ts:1-33`
  (self-skips without Docker via `dockerAvailable()` from `test/helpers/pg.js`).
  `buildApp` is given
  `overrides: { git: new MockGitClient(), github: new MockGitHubClient(), secrets: new MockSecretsProvider(), repoIntel: new FakeRepoIntel(...) }`,
  where `FakeRepoIntel implements RepoIntel` and throws from every method except
  `getBlastRadius` — the exact idiom at
  `server/test/conventions.it.test.ts:22-55`. Asserts:
  1. the live response validates against **both** `BlastRadiusResponse` and the
     shared `BlastRadius` (P2's contract claim, **D1**);
  2. the fake's `getBlastRadius` was called with the seeded PR's `repoId` and its
     real `pr_files` paths — i.e. workspace resolution and file lookup are really
     wired, which the hermetic test cannot prove;
  3. a degraded fake result surfaces `degraded: true` and its `reason` **through**
     the response schema (this is the test that would have caught the
     zod-strips-unknown-keys trap of **D1**);
  4. a non-uuid `:id` → **422**; a uuid from another workspace → **404**;
  5. **no LLM override is injected**, deliberately — a regression that adds a
     model call to this path fails here by reaching a real provider rather than
     passing quietly (the `server/test/smart-diff.it.test.ts:13-15` precedent;
     see `server/INSIGHTS.md:42-52` for why that matters).
- **Constraint:** the `.it.test.ts` suffix is mandatory or the file runs in the
  hermetic lane and fails (`TESTING.md:88-91`, `server/CLAUDE.md:61-62`).
- **Done when:** `cd server && pnpm exec vitest run .it.test` is green on
  `blast.it.test.ts` with Docker available, and self-skips with a warning without
  it.

### Step 7 — Client: the i18n strings
- **Files:** `client/messages/en/blast.json` (edit)
- **Change:** keep every existing key (`stat.symbols`, `stat.callers`,
  `stat.endpoints`, `stat.crons`, `view.tree`, `view.graph`, `callerCount`,
  `noDownstream`, `graph.empty`, `graph.ariaLabel` — all used as-is) and **add**:
  - `heading` — the `SectionLabel` text for the card.
  - `empty` / `emptyHint` — the PR declares no symbols the index knows.
  - `error` — the query failed.
  - `view.ariaLabel` — the `role="group"` label on the Tree/Graph pair.
  - `degraded.badge` — the badge text.
  - `degraded.hint` — the wrapper `<span title>` text (**D10** and
    `client/INSIGHTS.md:81-88`).
  - `degraded.reason.flagOff`, `.indexFailed`, `.indexPartial`, `.repoTooLarge`,
    `.noData`, `.unknown` — the five `DegradedReason` members
    (`server/src/modules/repo-intel/types.ts:27-32`) plus the fallback **D2**
    requires.
  - `degraded.resync` / `degraded.resyncing` — the re-analyze button labels.
  - `symbol.declaredIn` — `"declared in {file}"`.
  - `graph.legend.symbol`, `.caller`, `.endpoint` — the hand-rolled graph's
    legend.
  - `graph.more` — `"+{count} more"` for nodes past the graph's row cap.
  No key is removed and no existing value changes, so nothing else reading this
  namespace can break.
- **Constraint:** every user-facing string in this feature lives here, never in a
  `constants.ts` (frontend-code-organization `SKILL.md:160-163`); keys are dotted
  camelCase (`client/CLAUDE.md:40-41`). **No registration step exists** —
  `client/src/i18n/request.ts:16-25` already merges every `messages/en/*.json` by
  filename, so `useTranslations("blast")` works the moment the file changes. Note
  `client/messages/en/brief.json:4` already has `block.blast: "Blast radius"`:
  that belongs to the future PR-Brief block and is a **different** namespace — do
  not reuse or move it.
- **Done when:** `node -e "JSON.parse(require('fs').readFileSync('client/messages/en/blast.json','utf8'))"`
  succeeds and every key named above is present.

### Step 8 — Client: the query key and the hook
- **Files:** `client/src/lib/hooks/keys.ts` (edit),
  `client/src/lib/hooks/reviews.ts` (edit)
- **Change:**
  - `keys.ts`: add `blast: (prId) => ["pr-blast", prId] as const` to the
    `reviewKeys` factory (`client/src/lib/hooks/keys.ts:12-19`). Do **not**
    hand-build the key at any call site — that duplication is exactly what the
    factory's header comment records as having drifted before
    (`client/src/lib/hooks/keys.ts:1-10`).
  - `reviews.ts`: next to `useSmartDiff`
    (`client/src/lib/hooks/reviews.ts:173-179`), add
    ```ts
    export interface PrBlastRadius extends BlastRadius {
      degraded?: boolean;
      reason?: string;
    }

    const PrBlastRadiusSchema = BlastRadiusSchema.extend({
      degraded: z.boolean().optional(),
      reason: z.string().optional(),
    });

    export function usePrBlastRadius(prId: string | null | undefined) {
      return useQuery({
        queryKey: reviewKeys.blast(prId),
        queryFn: () => api.get<PrBlastRadius>(`/pulls/${prId}/blast`, PrBlastRadiusSchema),
        enabled: !!prId,
      });
    }
    ```
    `BlastRadius` joins this file's existing `@devdigest/shared` value-import
    (aliased `BlastRadiusSchema`, matching the `SmartDiff as SmartDiffSchema`
    convention at `client/src/lib/hooks/reviews.ts:11-15`) and its type-import
    list (`:16-25`); `z` is already imported at `:7`.
- **Constraint:** **Do not pass the bare shared `BlastRadius` schema to
  `api.get`** — zod strips unknown keys, which would silently delete
  `degraded`/`reason` and make the degraded badge unreachable (**D1**'s
  implementer trap). The client-local `PrBlastRadius` interface follows the
  established `RepoIntelState` pattern
  (`client/src/lib/hooks/repo-intel.ts:13-25`). One hook per server call, in
  `src/lib/hooks/*` — never `fetch` from a component (`client/CLAUDE.md:48-49`;
  frontend-code-organization `SKILL.md:185-190`). No barrel edit is needed:
  `client/src/lib/hooks/index.ts` already does `export * from "./reviews"`.
- **Done when:** `cd client && pnpm typecheck` passes, and
  `grep -rn '"pr-blast"' client/src` matches **only** `keys.ts`.

### Step 9 — Client: the card's `constants.ts`, `styles.ts` and `helpers.ts`
- **Files:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/constants.ts` (new),
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/styles.ts` (new),
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/helpers.ts` (new)
- **Change:**
  - `constants.ts` — lookup maps and layout numbers only, **never English text**:
    `REASON_LABEL_KEY: Record<string, string>` mapping each `DegradedReason`
    string to its `blast.json` **key**, with an `unknown` fallback (**D2**);
    `ENDPOINT_COLOR = "var(--accent-text)"`, `CRON_COLOR = "var(--info)"`,
    `DEGRADED_COLOR = "var(--warn)"`, `GRAPH_NODE_COLOR` per column — all CSS
    custom properties, **no hex** (frontend-code-organization
    `SKILL.md:164-166`); `EXPANDED_BY_DEFAULT = 1` (only the first symbol row
    starts open); `GRAPH` (column x offsets, row height, node width,
    `MAX_GRAPH_ROWS`).
  - `styles.ts` — a single exported object `s`, entries
    `satisfies CSSProperties` or functions of props (frontend-code-organization
    `SKILL.md:113-117`). Follows `IntentCard/styles.ts`.
  - `helpers.ts` — **pure, no React import** (frontend-code-organization
    `SKILL.md:120-121` — "if it imports from `react`, it is not a helper"):
    - `statCounts(data: PrBlastRadius)` → `{ symbols, callers, endpoints, crons }`
      where `symbols = changed_symbols.length`, `callers` is the **sum** of
      `downstream[].callers.length`, and `endpoints`/`crons` are the sizes of the
      **unions** across `downstream` (an endpoint reachable from two symbols
      counts once).
    - `declaringFileOf(changed_symbols, name)` → the first matching `file` or
      `null` (the **D3** name-collision caveat is documented here).
    - `graphRows(data, max)` → `{ symbol, callers, endpoints, overflow }[]` for
      the SVG, capped at `MAX_GRAPH_ROWS`.
- **Constraint:** `constants.ts` may hold a *key*, never the English text
  (frontend-code-organization `SKILL.md:160-163`). Types may ride along in
  `constants.ts` rather than forcing a `types.ts` (`SKILL.md:167-169`). Do not
  scaffold an empty file — each of these three exists because it has content
  (`SKILL.md:111`).
- **Done when:** `cd client && pnpm typecheck` passes;
  `grep -nE "#[0-9a-fA-F]{3,6}"` over the new `constants.ts` and `styles.ts`
  returns nothing; and `grep -n 'from "react"'` over the new `helpers.ts` returns
  nothing.

### Step 10 — Client: `BlastRadiusCard`
- **Files:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx` (new),
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/index.ts` (new, a one-line re-export)
- **Change:** a `"use client"` component modelled on
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx:1-156`.
  Props: `{ prId: string | null; repoId: string; repoFullName: string | null; headSha: string }`.
  It calls `useTranslations("blast")`, `usePrBlastRadius(prId)` and
  `useResyncRepoIntel(repoId)` and renders, inside a `<Card>` with
  `<SectionLabel icon="Workflow">{t("heading")}</SectionLabel>`:
  - **loading** → three `<Skeleton>`s, like `IntentCard.tsx:44-55`.
  - **error** → `<EmptyState icon="AlertTriangle" title={t("error")} />`, no CTA.
  - **degraded** (any state, in `SectionLabel`'s `right` slot) →
    `<span title={t("degraded.hint")}><Badge icon="AlertTriangle" color="var(--warn)">...</Badge></span>`
    naming the reason via
    `t(REASON_LABEL_KEY[data.reason] ?? "degraded.reason.unknown")`, plus the
    `Button icon="RefreshCw"` of **D12** wired to `resync.mutate()`. The wrapping
    `<span title>` is mandatory: `Badge` accepts no `title`
    (`client/INSIGHTS.md:81-88`).
  - **no changed symbols** → `<EmptyState title={t("empty")} body={t("emptyHint")} />`
    (plus the degraded row above it, when degraded).
  - **stat row**, always when there is data: `N symbols / N callers /
    N endpoints / N crons` from `statCounts`, each label from `blast.json`'s
    `stat.*`, the numbers in `className="tnum"`.
  - **Tree | Graph** segmented pair: two `Chip`s with `active` on the current
    mode, inside `<div role="group" aria-label={t("view.ariaLabel")}>` (**D10**).
    Mode is local state, defaulting to `tree`.
  - **tree mode** — one row per `downstream` entry, each wrapped in
    `<section aria-label={entry.symbol}>`; the header is
    `role="button" tabIndex={0} aria-expanded` with Enter/Space handling, a
    `ChevronRight` rotated by an open/closed style, the symbol name, a muted
    `t("symbol.declaredIn", { file })`, and, pushed right,
    `t("callerCount", { count })`. Open state is a `Record<string, boolean>`
    seeded so only the **first** entry is open (`EXPANDED_BY_DEFAULT`). When open:
    the callers as `MonoLink` `file:line` links (**D11**) each followed by the
    caller function name, then the endpoint `Badge`s and cron `Badge`s (**D10**).
    An entry with `callers.length === 0` renders nothing in its body beyond its
    chips.
  - **whole-card empty** — when every entry has zero callers, render
    `t("noDownstream", { count: data.changed_symbols.length })` instead of a blank
    box (the message's own `{count}` confirms this reading, **D3**).
  - **graph mode** — a hand-rolled
    `<svg role="img" aria-label={t("graph.ariaLabel")}>` laying out three columns
    (changed symbol → caller symbols → endpoints) from `graphRows`, connected by
    `<line>`s, with a legend of three `Badge`s from `graph.legend.*` and
    `t("graph.more", { count })` for the overflow. `t("graph.empty")` when there is
    nothing to draw. Positions come from `GRAPH` in `constants.ts`; colours from
    the tokens there. **No charting library.**
  - `index.ts` → `export { BlastRadiusCard } from "./BlastRadiusCard";`
- **Constraint:** the `<section aria-label>` wrapper around each collapsible row
  is a direct application of `client/INSIGHTS.md:13-21` — without it, these
  headers and `diff-viewer`'s `FileCard` headers are indistinguishable to a
  `getAllByRole("button")` query and to assistive tech. Read-only chips are
  `Badge` (a `<span>`), the mode toggle is `Chip` (a `<button>`) —
  `client/INSIGHTS.md:25-32`. Every string comes from `t(...)`; no English literal
  appears in this file. Orchestration (which hook, which state, which handler) is
  the component's job; deriving stays in `helpers.ts` (frontend-code-organization
  `SKILL.md:191-199`). Do not rebuild a vendored primitive
  (`client/CLAUDE.md:62-63`).
- **Done when:** `cd client && pnpm typecheck` passes;
  `grep -nE "fetch\(|useQuery\(" BlastRadiusCard.tsx` returns nothing (the
  network lives in the hook); and `grep -nE "#[0-9a-fA-F]{3,6}" BlastRadiusCard.tsx`
  returns nothing.

### Step 11 — Client: put the card on the Overview tab
- **Files:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx` (edit),
  `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit, one line)
- **Change:** widen `OverviewTabProps` from `{ prId, prBody }` to
  `{ prId, prBody, repoId, repoFullName, headSha }` and render
  `<BlastRadiusCard ...>` **between** `<IntentCard>` and the description section
  (**D9**), with a short comment saying why that order. In
  `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:129`, change
  `<OverviewTab prId={prId} prBody={pr.body} />` to also pass `repoId={repoId}`
  (from `useParams`, `page.tsx:31`), `repoFullName={repoFullName}` (`page.tsx:75`)
  and `headSha={pr.head_sha}` (already used for `DiffTab` at `page.tsx:166`).
- **Constraint:** pages stay thin — this is prop plumbing only, no logic added to
  `page.tsx` (frontend-code-organization §4). `headSha` and `repoFullName` already
  exist on that page; nothing new is fetched.
- **Done when:** `cd client && pnpm typecheck` passes and `cd client && pnpm test`
  is still green on the existing `OverviewTab` / page tests.

### Step 12 — Client: the component test
- **Files:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.test.tsx` (new)
- **Change:** mock at the `@/lib/hooks/*` seam — **never** `fetch`, never inside
  the component — exactly as
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.test.tsx:30-34`
  does, mocking `usePrBlastRadius` from `@/lib/hooks/reviews` and
  `useResyncRepoIntel` from `@/lib/hooks/repo-intel`. Render inside
  `<NextIntlClientProvider locale="en" messages={{ blast: messages }}>` with
  `messages` imported from `client/messages/en/blast.json`
  (`IntentCard.test.tsx:71-74`). Cases:
  1. **loading** → skeletons, and none of the stat labels.
  2. **populated** → the four stat labels; one `<section>` per changed symbol
     (queried as `getAllByRole("region")` per `client/INSIGHTS.md:13-21`, **not**
     by slicing `getAllByRole("button")`); only the **first** row expanded;
     clicking a collapsed header expands it; a caller renders as a link whose
     `href` is the `githubBlobUrl` blob URL at the head sha (assert `/blob/` and
     `#L`, i.e. **not** a diff link); an endpoint chip and a cron chip are both
     present and distinguishable.
  3. **no callers** → the `noDownstream` text with the symbol count, and no blank
     box.
  4. **degraded** → the degraded badge naming the mapped reason, and a resync
     button that calls the mutation's `mutate` when clicked; plus an **unknown**
     reason string falling back to `degraded.reason.unknown` (**D2**).
  5. **graph mode** → clicking the `view.graph` chip renders the element whose
     `aria-label` is `graph.ariaLabel`; with no callers it renders `graph.empty`.
- **Constraint:** use `fireEvent`, **not** `userEvent` —
  `@testing-library/user-event` is not a dependency of this package and adding it
  would touch `pnpm-lock.yaml` (`client/INSIGHTS.md:112-118`). Remember this suite
  mocks the network, so it cannot catch a real response-shape change — that is
  Step 6's job (`client/CLAUDE.md:56-58`).
- **Done when:** `cd client && pnpm test` is green on `BlastRadiusCard.test.tsx`.

### Step 13 — MCP: the API call
- **Files:** `mcp/src/api.ts` (edit)
- **Change:** add, next to `reviewsForPull`:
  ```ts
  /** The route extends the shared BlastRadius with two optional degraded fields;
   *  they live in the server's blast module, not in @devdigest/shared. */
  export type BlastRadiusResponse = BlastRadius & { degraded?: boolean; reason?: string };

  export function blastRadius(prId: string): Promise<ApiResult<BlastRadiusResponse>> {
    return request<BlastRadiusResponse>(`/pulls/${encodeURIComponent(prId)}/blast`);
  }
  ```
  `BlastRadius` joins this file's existing **type-only** import list from
  `@devdigest/shared`. Default `HTTP_TIMEOUT_MS` — this endpoint makes no model
  call, so it must not use `REVIEW_TIMEOUT_MS`.
- **Constraint:** `src/api.ts` is the **only** file in this package that calls
  `fetch` (`mcp/CLAUDE.md:23`), and `@devdigest/shared` must stay a **type-only**
  import because `tsc` does not rewrite the alias into output
  (`mcp/CLAUDE.md:41-43`). `encodeURIComponent` on the id, matching every other
  function in the file. No new dependency; this package uses **npm**
  (`mcp/CLAUDE.md:81-83`).
- **Done when:** `cd mcp && npm run typecheck` passes and
  `grep -rn "fetch(" mcp/src` shows `fetch(` only in `mcp/src/api.ts`.

### Step 14 — MCP: the projection
- **Files:** `mcp/src/format.ts` (edit), `mcp/src/constants.ts` (edit)
- **Change:**
  - `constants.ts`: add `DEFAULT_BLAST_SYMBOL_LIMIT = 10` and
    `MAX_BLAST_CALLERS_PER_SYMBOL = 5`, each with its reasoning comment, next to
    `DEFAULT_FINDINGS_LIMIT` / `DEFAULT_CONVENTIONS_LIMIT`
    (`mcp/src/constants.ts:48-49`).
  - `format.ts`: add a pure `formatBlastRadius(entries, opts)` building output by
    **allowlist** — `{ symbol, declared_in, callers, endpoints_affected,
    crons_affected }` per entry, callers rendered as `"file:line (name)"` strings
    and capped at `MAX_BLAST_CALLERS_PER_SYMBOL` with a `"+N more callers"`
    marker. It must **not** spread the input object, so a field added to
    `DownstreamImpact` later cannot leak (`mcp/CLAUDE.md:59-60`). Pure — no fetch,
    no env, no clock, so its test needs no mocks (see `format.ts`'s own header
    comment).
- **Constraint:** every projection and cap lives in `format.ts`; every budget
  lives in `constants.ts` (`mcp/CLAUDE.md:25-27`).
- **Done when:** `cd mcp && npm run typecheck` passes and `cd mcp && npm test` is
  green on `mcp/test/format.test.ts` (Step 16 adds its cases).

### Step 15 — MCP: replace the `get_blast_radius` stub
- **Files:** `mcp/src/tools/get-blast-radius.ts` (rewrite)
- **Change:** keep the `defineTool` shape and `readOnly: true`; replace the prose
  handler with a real call, following `mcp/src/tools/get-findings.ts` end to end:
  1. `const resolved = await resolveRepoAndPull(repo, pr); if (!resolved.ok) return resolved.result;`
     (`mcp/src/resolve.ts:153-162`) — an unknown repo or PR is already a named
     failure that names the next call.
  2. `const res = await api.blastRadius(resolved.prId); if (!res.ok) return fromFailure(res.failure);`
  3. **repo not indexed** — `res.data.degraded && res.data.downstream.length === 0`
     → a plain `text(...)` with no `isError`, naming the next action: open the repo
     in the DevDigest studio and run Re-analyze, then retry (**D14**, mirroring
     `mcp/src/tools/get-findings.ts:50-57`).
  4. otherwise
     `paginate(res.data.downstream, limit ?? DEFAULT_BLAST_SYMBOL_LIMIT, offset ?? 0)`
     plus `truncationFooter(page, 'get_blast_radius', ...)`, then `toResult({...})`
     with `pull_request` (the **normalised** slug via `normalizeRepoSlug`),
     `summary`, the symbol/caller counts, `downstream: formatBlastRadius(page.page)`,
     the optional truncation `note`, and an `index_note` when `degraded` is true but
     data exists.
  `shape: { repo: repoArg, pr: prArg, limit, offset }` — flat primitives only,
  each with a `.describe()` (`mcp/CLAUDE.md:56-58`). The `description` says
  **when** to call it (before judging the risk of a change, or to decide what to
  test), states that it reads DevDigest's code index with no model call, and says
  it reports plainly when the repo is not indexed. Keep it under 600 characters
  (`mcp/test/token-budget.test.ts`'s description assertion).
  `mcp/src/tools/index.ts` needs **no** edit — the tool keeps its name and file
  and stays fifth in `TOOLS`.
- **Constraint:** the description is what a model matches on, so every argument
  keeps a description or tool selection degrades invisibly
  (`mcp/CLAUDE.md:44-46`, and the emitted-schema assertion in
  `mcp/test/token-budget.test.ts`). Every failure names the next call
  (`mcp/CLAUDE.md:61-62`). Tool count stays at five (`mcp/CLAUDE.md:87-89`). The
  `isError: false` property `mcp/INSIGHTS.md:35-39` records is **preserved** by
  **D14**, for a different reason (unindexed repo) than the stub's.
- **Done when:** `cd mcp && npm run typecheck` passes, and
  `grep -n "not implemented" mcp/src/tools/get-blast-radius.ts` returns nothing.

### Step 16 — MCP: the tests, including the token budget
- **Files:** `mcp/test/fixtures.ts` (edit), `mcp/test/tools.test.ts` (edit),
  `mcp/test/format.test.ts` (edit)
- **Change:**
  - `fixtures.ts`: add a `blast(over = {})` helper returning a minimal valid
    blast-response-shaped object, in the style of the existing helpers
    (`mcp/test/fixtures.ts:12-24`).
  - `tools.test.ts`: **replace** the stub's `describe('get_blast_radius')` block
    (`mcp/test/tools.test.ts:171-182`) with:
    (a) happy path — `mockFetch({ ...resolution, 'GET /pulls/pr-1/blast': blast() })`,
    asserting the body contains the symbol name, a `file:line` caller and the
    endpoint, and that `calls` includes `GET /pulls/pr-1/blast` (the stub's "makes
    no network call" assertion becomes the opposite claim);
    (b) degraded + empty → `result.isError` is false and the body names Re-analyze
    (**D14**);
    (c) unknown PR → `pullNotFound`, with **no** `/blast` call recorded;
    (d) a transport failure → `fromFailure`'s advice.
  - `format.test.ts`: `formatBlastRadius` is an allowlist (an extra field on the
    input must not appear in the output) and caps callers per symbol.
  - `token-budget.test.ts` is **not edited** — it must keep passing. Baseline
    3889 / 5250 chars (`mcp/INSIGHTS.md:9-14`); the new description plus two
    described arguments spends roughly 350, leaving about 1000 chars of headroom.
    The test prints the figure on every run; record the new one.
- **Constraint:** hermetic — `fetch` is the one thing stubbed
  (`mcp/CLAUDE.md:17-18`), via `mockFetch` from `mcp/test/http.ts`. A budget
  failure is a design signal, not a number to raise (`mcp/CLAUDE.md:53-55`).
- **Done when:** `cd mcp && npm test` is green (all files), the budget test prints
  a char count `<= 5250`, and its "exactly the five tools, unprefixed" assertion
  still passes unchanged.

### Step 17 — Pre-PR gate and the human deliverables
- **Files:** none (no source change)
- **Change:** run, in order:
  `cd server && pnpm typecheck`;
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`;
  `cd server && pnpm exec vitest run .it.test`;
  `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs`;
  `cd client && pnpm typecheck`; `cd client && pnpm test`;
  `cd mcp && npm run typecheck`; `cd mcp && npm test`;
  then `diff -r client/src/vendor/shared server/src/vendor/shared` (must be
  silent — this plan changes neither copy). Then invoke
  [`pr-self-review`](../../.claude/skills/pr-self-review/SKILL.md): a `PreToolUse`
  hook denies `gh pr create` while a CRITICAL stands or the verdict is stale
  (`CLAUDE.md:131-137`). Append what was learned to the right `INSIGHTS.md` via
  the `engineering-insights` skill — the **D4** finding about `getResolvedCallers`
  having no self-file filter and the **D7** finding about
  `MAX_CALLERS_PER_SYMBOL` being applied globally both belong in
  `server/INSIGHTS.md`.
- **Constraint:** the commit message is Conventional Commits with a scope in use —
  `feat(blast): ...` (`CLAUDE.md:82-85`). Before staging, check for the untracked
  `openrouter-api-key` file at the repo root: it is **not** in `.gitignore`, so
  never `git add -A` (`CLAUDE.md:136-138`). No linter exists — `typecheck` plus
  `depcruise` plus the suites are the whole gate (`CLAUDE.md:46-48`).
- **Done when:** every command above exits 0 (the server integration lane may
  self-skip without Docker), `pr-self-review` writes a verdict with no CRITICAL,
  and the PR description names the decisions a reviewer must check — **D1**
  (degraded vs contract), **D2** (`reason` as a string), **D3** (zero-caller
  entries in `downstream`), **D5** (no endpoints on the degraded path) and **D7**
  (the global caller cap left alone).

---

## Contract changes

**None.** `server/src/vendor/shared/contracts/brief.ts` is **read, not
written** — `BlastRadius` (`:52-57`), `DownstreamImpact` (`:44-50`),
`BlastCaller` (`:37-42`) and `ChangedSymbol` (`:30-35`) are consumed exactly as
they are. `client/src/vendor/shared/contracts/brief.ts` is therefore also
untouched, so `RULE-CONTRACT-SYNC` and `RULE-CONTRACT-BREAK` (routing.md:23) are
satisfied vacuously; `diff -r client/src/vendor/shared server/src/vendor/shared`
is silent at plan time and must stay silent (Step 17).

The two additional wire fields `degraded`/`reason` live on a **route-local**
`BlastRadiusResponse` in `server/src/modules/blast/schemas.ts`, which
`.extend()`s the shared schema — see **D1** for why widening `brief.ts` was
rejected (`BlastRadius` is a `PrBrief` building block; `vendor/shared` is a
two-copy physical duplicate; `DegradedReason` is a server-internal type and
`contracts/*` may import zod only). The client mirrors the two optional fields in
a local interface, the pattern `client/src/lib/hooks/repo-intel.ts:13-25` already
established for a server-side-only state type.

## Migration

**None.** This feature adds no table and no column, and reads nothing new: the
symbol graph, resolved references, `file_rank` and `file_facts` rows already exist
and are written by the `repo-intel` indexer at clone time
(`server/src/modules/repo-intel/pipeline/full.ts:160-250`). Nothing under
`server/src/db/schema/**` or `server/src/db/migrations/**` is touched, so
`pnpm db:generate` is **not** run and the "never hand-edit a migration" rule
(`CLAUDE.md:141-147`, `server/CLAUDE.md:79-83`) is satisfied vacuously. No
lockfile moves in any package, because no dependency is added.

## Test plan

| Suite | Command (verbatim from TESTING.md) | Covers which step |
|---|---|---|
| server-unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | Steps 2, 3, 4 — the mapping table (grouping, dedupe, rank ordering, declaring-file exclusion, endpoint/cron union and sort, the `factsByFile`-absent case, degraded passthrough, the verbatim `summary`), and the service wiring against two hand-rolled fakes |
| server-integration | `cd server && pnpm exec vitest run .it.test` | Steps 5, 6 — `BlastRadiusResponse.parse` **and** `BlastRadius.parse` of the live response, `getBlastRadius` called once with the real `repoId` + `pr_files` paths, `degraded`/`reason` surviving serialization, 422 on a non-uuid id, 404 across workspaces |
| server | `cd server && pnpm typecheck` | Steps 1, 3-5 |
| architecture | `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` | Steps 3-5 — no `blast -> <module>/repository` edge (`no-cross-module-repository`), no container or `db/schema` in `helpers.ts`, no Drizzle/Fastify in `service.ts`, `blast/` added to **no** exception list. Baseline at plan time: **0 violations (170 modules, 561 dependencies)** |
| client | `cd client && pnpm test` | Steps 10, 12 — loading / populated / no-callers / degraded / unknown-reason / graph-mode, the blob-URL assertion, and the `role="region"` query tier |
| client | `cd client && pnpm typecheck` | Steps 8-11 — the hook, the local extended schema, the widened `OverviewTab` props |
| mcp | `cd mcp && npm test` | Steps 13-16 — the tool's happy path, the not-indexed non-error path, the unknown-PR path, the allowlist projection, and the **unchanged** `tools/list` budget test |
| mcp | `cd mcp && npm run typecheck` | Steps 13-15 |
| vendor sync | `diff -r client/src/vendor/shared server/src/vendor/shared` | Step 17 — must stay silent; this plan edits neither copy |

**The architecture gate is not a linter.** `CLAUDE.md:46-48` states that no linter
is configured and `typecheck` is the enforced static gate; `depcruise` sits
alongside it as a *layering* gate and is the only thing that catches the
`no-cross-module-repository` trap of Step 4. A `warn`-severity finding counts as a
regression, because the graph is clean today.

Conventions that bind here: the DB-backed file **must** be `*.it.test.ts` or it
runs in the hermetic lane and fails (`TESTING.md:88-91`); testing is
typological — one happy path plus the edge that matters per layer, not coverage
chasing (`TESTING.md:8-24`); client tests mock `fetch`, so only the server suites
can catch a response-shape regression (`client/CLAUDE.md:56-58`); `mcp` runs on
**npm**, `server`/`client` on pnpm (`CLAUDE.md:105-107`). CI path filters already
cover every file this plan touches — `server/**` and `client/**` for their own
workflows, `mcp/**` for `mcp.yml` (`.github/workflows/mcp.yml:13-17`) — so **no
workflow edit is needed**, and root `INSIGHTS.md:16-21`'s "`!**/INSIGHTS.md` stays
last" rule is not put at risk.

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| **`degraded`/`reason` silently stripped by zod** if the bare shared `BlastRadius` schema is passed to `api.get` — the badge would never appear and nothing would fail | 8 | **D1**'s implementer trap is restated in the step; Step 8 passes a locally extended schema, Step 6 asserts the fields survive serialization server-side, Step 12 asserts the badge renders |
| **A closed `reason` enum 500s the endpoint** the day `repo-intel` emits a new `DegradedReason` — on the one path contracted to never throw | 1 | **D2**: `reason` is `z.string().optional()` on the wire; the narrow `DegradedReason` type still guards the server side, and the client falls back to `degraded.reason.unknown` |
| **Someone edits `brief.ts`** to add the two fields, changing `PrBrief`'s shape and forcing a two-copy vendored sync | 1 | **D1** records the rejection with reasons; Step 1's done-condition greps `git diff --name-only` over both vendor trees; Step 17 re-runs `diff -r` |
| **A self-file caller leaks into a symbol's own callers** — the facade's guarantee is an explicit filter on one path and only a structural consequence of import-graph resolution on the other | 3 | **D4**: `helpers.ts` filters defensively on (`viaSymbol`, declaring file) and Step 2 asserts both the drop **and** that a *different* changed file is still kept |
| **The flat `impactedEndpoints` gets attributed to a symbol** on the fallback path, fabricating a dependency claim | 3 | **D5**: `endpoints_affected`/`crons_affected` come only from `factsByFile`; Step 2 has a dedicated `factsByFile`-absent case asserting `[]`. Grounding is mandatory (`CLAUDE.md:121-124`) |
| **`blast/service.ts` names `ReviewRepository` or `RepoIntelService`**, adding the module graph's first cross-module repository edge — and `import type` does not help | 4 | **D8**/Step 4 use indexed-access types (`Container['reviewRepo']`, `Container['repoIntel']`), the `smart-diff/service.ts:24` idiom; Step 5 and the Test plan make `depcruise` a gate against a clean 0-violation baseline |
| **`db/schema` imported to name the `pr_files` row shape** — there is no `PrFileRow` in `server/src/db/rows.ts:12-21` | 4 | Step 4 consumes `getPrFiles`'s return type by inference only; `no-db-in-service` / `no-schema-in-helpers` are severity **error**, so this fails the gate outright rather than warning |
| **The `helpers.ts` purity grep gate trips on its own doc comment** | 3 | `server/INSIGHTS.md:124-131` recorded this exact failure for `smart-diff/helpers.ts`; Step 3's constraint forbids spelling out `container`/`drizzle`/`db/schema` in the prose |
| **Per-symbol caller rows look truncated or missing** because `MAX_CALLERS_PER_SYMBOL = 20` is applied **globally**, not per symbol (`repo-intel/service.ts:386` vs the constant's own doc at `repo-intel/constants.ts:29-30`) | — | **D7**: recorded as a `repo-intel` defect, explicitly out of scope; no test asserts a number that depends on the cap, and the finding goes to `server/INSIGHTS.md` in Step 17 |
| **Two changed symbols with the same name in different files collapse into one `downstream` entry** — the contract keys on the bare name | 3 | **D3** records it; the union of callers is correct and `declaringFileOf` returns the first match, so the display degrades rather than lying about callers. Fixing it needs a contract change, which is out of scope |
| **Per-symbol rows and `FileCard` headers become indistinguishable in tests and to assistive tech** — both are `role="button"` + `aria-expanded` | 10, 12 | `client/INSIGHTS.md:13-21` recorded this for `SmartDiffGroups`; Step 10 wraps each row in `<section aria-label>` and Step 12 queries `role="region"`, never a positional slice of buttons |
| **The graph view pulls in a charting dependency**, touching `client/pnpm-lock.yaml` | 9, 10 | Hand-rolled inline SVG with layout numbers in `constants.ts`; `CLAUDE.md:148-152` and `client/CLAUDE.md:64-65` forbid the lockfile edit, and both steps' done-conditions grep for hex colours (a charting library's usual tell) |
| **A hardcoded English label** ends up in the card or its `constants.ts` | 7, 9, 10 | Step 7 adds every key first; `constants.ts` holds only `REASON_LABEL_KEY` *keys* (frontend-code-organization `SKILL.md:160-163`); Step 12 renders through `NextIntlClientProvider` with the real `blast.json`, so a missing key surfaces as a visible failure |
| **A tooltip is passed to `Badge`** and fails typecheck | 10 | `client/INSIGHTS.md:81-88`: `Badge`'s props are a closed inline type; the degraded badge is wrapped in `<span title>` |
| **`userEvent` is reached for** in the new component test | 12 | `client/INSIGHTS.md:112-118`: it is not installed and adding it would touch the lockfile; the step mandates `fireEvent` |
| **`EmptyState`'s CTA is reused for resync**, rendering a "+" icon on a re-index action | 10 | **D12**: `EmptyState` hardcodes `icon="Plus"` (`client/src/vendor/ui/primitives/EmptyState.tsx:58-60`); the degraded state uses its own `Button icon="RefreshCw"` |
| **The MCP `tools/list` budget is blown** by a longer description plus two new arguments | 15, 16 | Headroom is 1361 chars (`mcp/INSIGHTS.md:9-14`); the description is capped at 600 chars by `token-budget.test.ts` itself, and Step 16 re-measures and records the new figure |
| **The MCP tool marks "repo not indexed" as an error**, inviting a retry that cannot possibly help | 15 | **D14**: a plain `text()` naming Re-analyze, mirroring `mcp/src/tools/get-findings.ts:50-57`; Step 16 asserts `isError` is false |
| **`fetch` creeps outside `mcp/src/api.ts`** | 13 | Step 13's done-condition greps for `fetch(` across `mcp/src`; `mcp/CLAUDE.md:23` makes it a single-file rule |
| **Workspace scoping forgotten on a new public route** — `repo-intel`'s tables carry no `workspace_id`, so there is no second line of defence | 4, 5 | `getContext` is the handler's first line and `repo.getPull(workspaceId, prId)` the service's first call; a foreign-workspace id 404s, asserted in Step 6. This is also why `routes.ts` routes to the **security** lane (routing.md:68) |
| **An accidental model call sneaks into this path** (P2 forbids it) | 4, 6 | `BlastService`'s constructor takes only the review repository and the repo-intel facade — there is no `container.llm` to reach for, by construction; Step 6 injects no LLM override, so a model call fails loudly by reaching a real provider (`server/INSIGHTS.md:42-52`) |

## Out of scope

- **"Prior PRs touching these files."** It needs GitHub PR history the starter
  does not fetch or store; `PrHistory` exists only as an unimplemented contract
  block (`server/src/vendor/shared/contracts/brief.ts:77-83`). Explicitly not
  built, per the change request.
- Fixing `MAX_CALLERS_PER_SYMBOL` being a **global** cap rather than per-symbol
  (**D7**) — it is a `repo-intel` change that would also alter reviewer prompt
  fuel.
- Any change to `repo-intel`: no new facade method, no indexer change, no
  `getResolvedCallers` self-file filter (**D4** compensates in `blast/helpers.ts`
  instead).
- Any change to `server/src/vendor/shared` or its client copy (**D1**).
- Persisting a blast result — no table, no column, no migration.
- Transitive callers beyond what the index resolved: the response is what
  `getBlastRadius` returns, with no extra BFS. `BFS_DEPTH`
  (`server/src/modules/repo-intel/constants.ts:49`) is not read by this path at
  all (**D7**).
- Rendering `summary` in the card (**D6** — it is an API field for MCP; the card
  uses `blast.json`).
- The PR-Brief block for blast radius (`client/messages/en/brief.json:4`'s
  `block.blast`) — a different surface in a later lesson.
- A new MCP tool: the surface stays at five and the stub is replaced
  (`mcp/CLAUDE.md:87-89`).
- Any `e2e/` spec: `e2e` flows are deterministic and model-free
  (`TESTING.md:98-99`), and a meaningful blast radius needs a real indexed clone.
- A second locale — `en` is the only one in `client/messages/`.
- Sticky headers, node dragging, or zoom in the graph view.
- Wiring blast radius into the reviewer prompt (that fuel already exists
  separately as `getCallerSignatures`,
  `server/src/modules/repo-intel/service.ts:453-564`).

## Open questions

1. **Does the demo repository actually have a `full`/`partial` index?** The
   persistent path is the only one that returns `factsByFile`, and therefore the
   only one that can populate `endpoints_affected`/`crons_affected` (**D5**);
   `tryPersistentBlast` returns `null` unless `repo_index_state.status` is
   `'full'` or `'partial'` (`server/src/modules/repo-intel/service.ts:319-320`).
   If the demo repo is unindexed, the recording shows the **degraded** state with
   zero endpoint chips — correct behaviour, weaker demo.
   *(Default if unanswered: run `POST /repos/:id/resync` on the demo repo and wait
   for `GET /repos/:id/index-state` to report `full` before recording; no plan
   change either way.)*
2. **Should `downstream` include an entry for a symbol with zero callers?**
   **D3** says yes, reading `blast.json`'s
   `noDownstream: "{count} changed symbol(s), no downstream callers found."` as
   evidence that the intended empty state is "symbols exist, callers do not". The
   alternative — omitting them — makes the client join two arrays and invent an
   order for the remainder.
   *(Default if unanswered: ship **D3**; reversing it changes only Step 3's emit
   loop and Step 2's zero-caller row.)*
3. **Graph-view node colours are a judgement call.** The three columns use
   `var(--accent)` / `var(--text-secondary)` / `var(--ok)` from the existing token
   set (`client/src/vendor/ui/styles.css`), with crons on `var(--info)`. No
   prototype pins these. If the design owner has intended tokens, they replace
   `GRAPH_NODE_COLOR`'s entries in `BlastRadiusCard/constants.ts` and nothing else
   changes.
   *(Default if unanswered: ship the mapping above; no new hex is introduced
   either way.)*

Nothing else is open: the degraded-vs-contract question (**D1**/**D2**), the
declaring-file exclusion (**D4**), the endpoint attribution (**D5**), the caller
cap (**D7**), the card's placement (**D9**) and the MCP error semantics (**D14**)
are all settled above with their sources.
