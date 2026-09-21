---
name: onion-architecture
description: >
  Enforces Onion Architecture layering in the DevDigest backend — `server/`
  (@devdigest/api) and `reviewer-core`. Decides which layer a piece of backend
  code belongs to and which imports that layer is allowed: routes vs service vs
  repository, ports vs adapters, what may touch Drizzle, what may touch Fastify,
  what the composition root is for. Use when adding or changing a module under
  `server/src/modules`, adding a route, service or repository, writing a Drizzle
  query, adding an adapter or port, wiring something into the Container, or
  reviewing a backend diff for boundary violations. Also for "where does this
  query go", "can I query the DB here", "should this be a service", "layering",
  "coupling", "dependency direction", "clean architecture", "hexagonal". Does
  NOT cover how to write the Fastify route itself — see
  [fastify-best-practices](../fastify-best-practices/SKILL.md) — or Drizzle
  query syntax — see [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md).
---

# Onion Architecture — `server/` and `reviewer-core`

Where backend code goes, and what it is allowed to import. Most of this layout
already exists — ports are declared in
[`vendor/shared/adapters.ts`](../../../server/src/vendor/shared/adapters.ts),
the composition root is
[`platform/container.ts`](../../../server/src/platform/container.ts), and
`reviewer-core` is a genuinely pure core. The point of this skill is to state
the rule so it applies to a *new* file, and to keep the four modules that
already broke it from becoming the pattern.

This is the **layering** half. The **authoring** halves are
[fastify-best-practices](../fastify-best-practices/SKILL.md) (request lifecycle,
hooks, serialization) and [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md)
(query and schema syntax). Don't duplicate rules across the three.

Machine-checkable: `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs`.
Every CRITICAL rule below is encoded there. There is no linter in this repo, so
that command plus review is the whole enforcement story.

## Severity Levels

Same scheme as the frontend skills, so all of them read as one body of rules:

- **CRITICAL** — breaks the dependency rule; caught by `depcruise`, reverted in review
- **HIGH** — erodes a layer without technically inverting it
- **MEDIUM** — inconsistency; cheap now, bulk cleanup later

---

## The dependency rule

> All code can depend on layers more central, but code cannot depend on layers
> further out from the core.
> — [Palermo, 2008](references.md)

Outer depends on inner. Never the reverse. **Many secondary write-ups state
this backwards** — if a source tells you inner may depend on outer, it is wrong;
check it against Palermo before following it.

The database is not the centre. It is external, and so is GitHub, the LLM, the
filesystem and Fastify.

## Layer map, in real paths

```
                  ┌─────────────────────────────────────┐
   Edge           │ modules/*/routes.ts · app.ts        │
                  │ server.ts · modules/index.ts        │
                  │ modules/_shared/context.ts          │
                  ├─────────────────────────────────────┤
   Composition    │ platform/container.ts               │
                  ├─────────────────────────────────────┤
   Infrastructure │ adapters/** · db/**                 │
                  │ modules/*/repository{,/*}.ts        │
                  ├─────────────────────────────────────┤
   Application    │ modules/*/service.ts                │
                  │ modules/*/helpers.ts (pure)         │
                  ├─────────────────────────────────────┤
   Ports          │ vendor/shared/adapters.ts           │
                  ├─────────────────────────────────────┤
   Core           │ reviewer-core/src/**                │
                  │ vendor/shared/contracts/**          │
                  └─────────────────────────────────────┘
```

Paths are relative to `server/src` except `reviewer-core/src`.

Two notes on things that look like violations but are not:

- **`platform/` is mixed on purpose.** `jobs.ts` uses Drizzle (infrastructure);
  `grounding.ts`, `prompt.ts`, `structured.ts`, `run-cost.ts` are pure (core-ish
  utilities). The rules below target `modules/**`, `adapters/**`, `db/**` and
  `vendor/shared/**`, and deliberately leave `platform/` alone. Don't "fix" it.
- **`reviewer-core` is a sibling package consumed as TypeScript source** through
  a tsconfig path alias, never built or published. That is what lets the pure
  core be shared with the CI runner without a build step. Keep it that way.

## Decision table (start here)

| I have a new… | It goes in | May import |
|---|---|---|
| HTTP endpoint | `modules/<domain>/routes.ts` | zod contract, `getContext`, its service, `platform/errors` |
| Use case / business rule | `modules/<domain>/service.ts` | ports, its repository, helpers, `Container` |
| SQL query | `modules/<domain>/repository.ts` | `drizzle-orm`, `db/schema`, `db/client` |
| SQL for a second aggregate in the same domain | `modules/<domain>/repository/<agg>.repo.ts` | same as above |
| Pure transform / DTO mapper | `modules/<domain>/helpers.ts` | contracts, **type-only** row types |
| Magic number, job kind, secret name | `modules/<domain>/constants.ts` | nothing |
| Call to a third-party SDK | `adapters/<thing>/<impl>.ts` | that SDK |
| Interface for an external thing | `vendor/shared/adapters.ts` | zod, contracts |
| Request/response shape | `vendor/shared/contracts/<area>.ts` | zod only |
| Prompt / grounding / reduce logic | `reviewer-core/src/**` | zod, an injected `LLMProvider` |
| Wiring, lifetime, secret resolution | `platform/container.ts` | everything |

If two rows apply, take the **inner** one. Pushing logic inward is always safe;
pulling it outward is what this skill exists to prevent.

---

## 1. Routes hold no logic (CRITICAL)

A handler does exactly four things: resolve context, hand off to the service,
map the result, translate errors. No SQL, no branching on business state, no
third-party SDK.

[`reviews/routes.ts`](../../../server/src/modules/reviews/routes.ts) is the
reference — 150 lines for ten endpoints, because every handler is three lines:

```ts
app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
  const { workspaceId } = await getContext(container, req);
  return service.listRuns(workspaceId, req.params.id);
});
```

- **Never import `drizzle-orm` or `db/schema` in a `routes.ts`.** This is the
  rule the four legacy modules break; see §9.
- **Validation is the route's zod schema**, not a hand-rolled parse in the body
  — already mandated by [server/CLAUDE.md](../../../server/CLAUDE.md). Invalid
  input 422s before your handler runs.
- **Construct the service once**, above the handlers (`const service = new
  ReviewService(container)`), not per request.
- **`getContext` on every authenticated route.** It is the one place workspace
  scoping is resolved; skipping it is how a tenancy leak gets in.

## 2. Services own the use case (CRITICAL)

`service.ts` is the application layer: it orchestrates ports and its repository
to satisfy one use case. It is the *only* layer that knows the business rule.

- **No SQL, ever.** No `drizzle-orm` import, no `db/schema` import, no
  `container.db`. Persistence goes through the repository.
- **No Fastify.** A service must be callable from a job handler and a test with
  no HTTP in sight — [`repos/service.ts`](../../../server/src/modules/repos/service.ts)
  registers a background `clone` job with the same methods the routes call.
- **Depend on ports, not implementations.** `container.git`, `container.github()`,
  `container.llm(id)` all return interfaces from
  [`vendor/shared/adapters.ts`](../../../server/src/vendor/shared/adapters.ts).
  Never `new OctokitGitHubClient(...)` inside a service.
- **`Container` in the constructor is allowed here** — see §8.

## 3. Repositories are the only place SQL lives (CRITICAL)

`repository.ts` is the persistence adapter. It is the sole holder of
`drizzle-orm` and `db/schema` imports for its domain.

- **Return a contract type or a row type — never a query builder.** Nothing
  lazily-evaluated crosses the boundary.
- **Split by aggregate when it grows**, into `repository/<agg>.repo.ts` with the
  class composing them so its public API stays flat. See
  [`reviews/repository.ts`](../../../server/src/modules/reviews/repository.ts)
  composing `review.repo` / `run.repo` / `pull.repo`.
- **Never import `platform/container`.** A repository takes `Db` in its
  constructor and nothing else. Reaching for the container here means the query
  wants data it should have been passed.
- **Own the workspace scope.** Every query filters by `workspace_id` (directly,
  or via the PR that carries it).

## 4. Row types vs contracts (HIGH)

The seam that keeps Drizzle out of the wire format.

- **A `$inferSelect` row may cross module boundaries** — that is what
  [`db/rows.ts`](../../../server/src/db/rows.ts) is for, so a consumer never has
  to import another module's `repository.ts` to name a shape.
- **A row must never reach an HTTP response.** Map it to a
  `@devdigest/shared` contract first. This is the existing camelCase-column →
  snake_case-wire rule, restated as a boundary: `costUsd` (row) → `cost_usd`
  (DTO).
- **Import row types type-only.**
  [`reviews/helpers.ts`](../../../server/src/modules/reviews/helpers.ts) is the
  pattern:

  ```ts
  import type { FindingRow, PullRow, ReviewRow } from './repository.js';
  ```

  not `import * as t from '../../db/schema.js'` for a `typeof
  t.x.$inferSelect`. The first names a type; the second drags the schema module
  into a layer that has no business knowing it exists.
- **A type-only import may point "outward" and that is fine.** It is erased at
  compile time, so it creates no runtime dependency and no runtime cycle. This
  is why `no-circular` in the config ignores cycles whose every hop is
  type-only — without that, the import style this section mandates would fail
  its own check.

## 5. Helpers are pure (HIGH)

`helpers.ts` holds functions over their arguments. Data in, data out.

- **No I/O, no `Container`, no `this`.** The test: it can be unit-tested with no
  mocks and no DB.
- **May import contracts and type-only row types.** May not import `db/schema`
  or `drizzle-orm`.
- **If it needs the container, it is a service method**, not a helper.

## 6. Ports and adapters (CRITICAL)

Every call leaving the process goes through an interface.

- **The port is an interface in
  [`vendor/shared/adapters.ts`](../../../server/src/vendor/shared/adapters.ts)** —
  `LLMProvider`, `GitHubClient`, `GitClient`, `CodeIndex`, `Embedder`,
  `SecretsProvider`, `AuthProvider`. Inner layers name only these.
- **The implementation lives in `adapters/<thing>/`** and is the only place its
  SDK may be imported: `octokit`, `simple-git`, `@ast-grep/napi`, `openai`,
  `@anthropic-ai/sdk`, `@vscode/ripgrep`. This currently holds with zero
  exceptions — keep it that way.
- **Adding an external dependency means adding a port first.** If the interface
  feels awkward to define, the feature is reaching for the wrong seam.
- **Mocks are peers of the real adapters**, in
  [`adapters/mocks.ts`](../../../server/src/adapters/mocks.ts). A test swaps
  them via `ContainerOverrides` — it does not monkey-patch a module.

## 7. The core stays pure (CRITICAL)

`reviewer-core/src/**` and `vendor/shared/contracts/**` are the centre.

- **No DB, no GitHub, no filesystem, no Fastify, no `process.env`.** The only
  side effect in `reviewer-core` is an injected `LLMProvider` — its own
  `package.json` description is the contract, and it is worth keeping true.
- **`reviewer-core/src/llm/` is that package's own adapter directory.** The
  `openai` SDK is confined to its two files (`openrouter.ts`, `structured.ts`);
  the actual core — `grounding.ts`, `prompt.ts`, `review/`, `output/` — imports
  no SDK at all. `depcruise` enforces exactly that containment, so adding an
  SDK import to `review/` or `prompt.ts` fails.
- **Contracts import zod and nothing else.** A contract that imports
  `db/schema` has inverted the dependency: the wire format would then be
  defined by the storage format.
- **Grounding rules live in the core.** A finding without a real diff-line
  citation is dropped and the score recomputed from survivors — that is a
  business rule, so it belongs in `reviewer-core`, not in a route.

## 8. The composition root (HIGH)

[`platform/container.ts`](../../../server/src/platform/container.ts) is the one
place that knows every concrete class. It resolves secrets, caches clients, and
hands out interfaces.

- **Only the container constructs adapters.** Lazily, through a getter, so a
  missing API key fails when the feature is used rather than at boot.
- **Cross-cutting repositories are built here** (`container.agentsRepo`,
  `container.reviewRepo`) so one module never reaches into another module's
  data layer.
- **`Container` in a service constructor is an accepted exception.** It is
  formally a service locator — the application layer naming the composition
  root — and a stricter onion would inject each port explicitly. We allow it:
  it is typed, and `ContainerOverrides` makes it fully swappable in tests, which
  is the property the rule is protecting. All four existing services do this.

  **Direction of travel:** new services may take explicit ports instead
  (`constructor(private git: GitClient, private repo: FooRepository)`) and that
  is preferred for anything with a narrow dependency set. Don't retrofit the
  existing four as a drive-by.
- **Never import `platform/container` from a repository or a helper** (§3, §5).

## 9. Known violations — do not copy (CRITICAL)

Four modules predate this skill and query Drizzle straight from their route
handlers. They are listed as explicit exceptions in
`server/.dependency-cruiser.cjs` so they don't block the build; the exception
list is a debt list that should only shrink.

| Module | State |
|---|---|
| [`pulls/routes.ts`](../../../server/src/modules/pulls/routes.ts) | 397 lines, ~12 inline queries — the worst case |
| [`polling/routes.ts`](../../../server/src/modules/polling/routes.ts) | no service or repository |
| [`settings/routes.ts`](../../../server/src/modules/settings/routes.ts) | no service; `feature-models.ts` queries directly |
| [`workspace/routes.ts`](../../../server/src/modules/workspace/routes.ts) | no service or repository |

Plus [`repos/helpers.ts`](../../../server/src/modules/repos/helpers.ts), which
imports `db/schema` for a row type where a type-only `db/rows.ts` import would
do (§4).

**If you are editing one of these files anyway, extract the queries you touch
into a `repository.ts` and remove that module from the exception list.** Do not
add a new query to them.

## 10. Tests follow the layers (MEDIUM)

- **Unit tests mock at the port.** `ContainerOverrides` + `adapters/mocks.ts`;
  no DB, no network.
- **`*.it.test.ts` is the only marker for a DB-backed test** — that suffix is
  what splits the two CI lanes. A DB-backed file without it silently runs in
  the hermetic lane and fails there.
- **Test the service, not the route,** for business rules. The route has no
  logic left to test (§1); the use case is where the behaviour is.
- **Testing is typological** — cover the kinds of breakage per layer, don't
  chase coverage. See [TESTING.md](../../../TESTING.md).

---

## Review checklist

- [ ] No `drizzle-orm` / `db/schema` import in a `routes.ts` or `service.ts`
- [ ] No `container.db` outside a repository
- [ ] No third-party SDK imported outside `adapters/`
- [ ] No `fastify` import outside routes / `app.ts` / `server.ts` / `modules/index.ts` / `_shared/context.ts`
- [ ] Repository takes `Db`, not `Container`
- [ ] Row types imported **type-only**; no row shape in an HTTP response
- [ ] `helpers.ts` is pure — no container, no I/O
- [ ] New external dependency has a port in `vendor/shared/adapters.ts` first
- [ ] `reviewer-core` and `contracts/` still import nothing but zod and ports
- [ ] `getContext` called on every authenticated route
- [ ] DB-backed test named `*.it.test.ts`
- [ ] `pnpm exec depcruise src --config .dependency-cruiser.cjs` passes

See [examples.md](examples.md) for each of these as a before/after from real
paths in `server/src`, and [references.md](references.md) for the sources these
rules come from.
