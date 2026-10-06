# Onion-architecture review: severity floor policy

Fixture root: `evals/skills/onion-architecture/fixtures/severity-policy/`
(paths below are relative to it). Skill: onion-architecture (CRITICAL / HIGH / MEDIUM).
Files read only; `depcruise` not run (fixture is not wired into `server/`).

Verdict: **3 CRITICAL, 3 HIGH, 2 MEDIUM**. Do not merge as is.

## CRITICAL

### 1. reviewer-core does I/O and reads env (severity.ts:1, 7, 10)
`reviewer-core/src/review/severity.ts:1` imports `node:fs`. Line 7 reads `process.env.DEVDIGEST_MIN_SEVERITY` and line 10 calls `readFileSync('.devdigest/severity.json')`, relative to the cwd.
- Reason: skill section 7. The core allows no filesystem, no `process.env`, and only an injected `LLMProvider` as a side effect. `applySeverityFloor` is also now non-deterministic and depends on the cwd. It behaves differently in the server and in the CI runner that shares the core, and it can't be unit-tested without touching the environment. It also gives the floor three sources (env, file, DB). The DB-stored per-agent policy that `service.ts` manages is silently overridden or ignored.
- Fix: delete `loadFloor`. Make the function pure: `applySeverityFloor(findings: Finding[], floor: Severity): Finding[]`. The server resolves the floor from the repository and passes it in. If env or file overrides are wanted, resolve them in `platform/container.ts` (the composition root) or the service, never in the core.

### 2. Service imports Fastify and uses the request object (service.ts:1, 22-26)
`service.ts:1` has `import type { FastifyRequest } from 'fastify'`. `setPolicy(req, ...)` reads `req.body` (line 23) and `req.log` (line 26).
- Reason: section 2. A service must be callable from a job handler or a test with no HTTP. The `as { floor: string }` cast also throws away the validation the route layer should provide.
- Fix: use `setPolicy(workspaceId: string, agentId: string, floor: SeverityPolicy['floor'])`. Pass `req.body.floor` from the route. Do the logging in the route (`req.log`) or through an injected logger. Remove the `fastify` import.

### 3. Service reaches for `container.db` and builds its own repository (service.ts:13-15)
`this.repo = new SeverityPolicyRepository(container.db)` uses `container.db` outside a repository (review checklist item 2).
- Reason: sections 2 and 8. The service must not touch the DB handle. The container is the place that builds repositories.
- Fix: build the repository in the container (as `container.severityPolicyRepo`, like `agentsRepo` / `reviewRepo`), or take explicit ports: `constructor(private repo: SeverityPolicyRepository)`. The explicit form is preferred for a new service with a narrow dependency set.

## HIGH

### 4. No request-body schema on the PUT route, and hand-rolled validation (routes.ts:21-24, service.ts:8, 24)
The PUT route declares only `params` and `response`. The body is validated in the service with a local `FLOORS` list (service.ts:8) and `ValidationError` (service.ts:24).
- Reason: section 1 and server/CLAUDE.md. Validation belongs in the route's zod schema so that invalid input 422s before the handler runs. `FLOORS` also duplicates `ORDER` in the core, so the two lists can drift.
- Fix: add a `SeverityPolicyUpdate` body contract in `vendor/shared/contracts` using `z.enum([...])` for the floor. Reuse that enum for `SeverityPolicy['floor']` and in reviewer-core's `Severity`. Use `body: SeverityPolicyUpdate` in the route and delete `FLOORS` and the manual check.

### 5. Repository is untyped at the boundary, and the schema is imported as a namespace (repository.ts:3, 5, 18; service.ts:19, 27)
`import * as t from '../../db/schema.js'` is used only to derive a row type (`$inferSelect`). That type is exported from `repository.ts`. `upsert` takes `floor: string`, which forces the casts at service.ts:19 and 27.
- Reason: section 4. Row types should come from `db/rows.ts` and be imported type-only. A string-typed floor pushes unsafe casts into the application layer.
- Fix: add `SeverityPolicyRow` to `db/rows.ts`. Type `floor` as the shared enum (`SeverityPolicy['floor']`). The `import * as t` in the repository is fine for queries, but nothing outside should import it. The service should then return `{ agent_id, floor: row.floor }` with no casts.

### 6. Default floor `'low'` is duplicated, and `preview` is an unrouted use case (service.ts:19, 30-32; severity.ts:15)
The default `'low'` is hard-coded in both the service and the core. `preview` is never exposed by `routes.ts`.
- Reason: sections 2 and 7. The business rule has two homes, and the shared default is a magic constant.
- Fix: put `DEFAULT_SEVERITY_FLOOR` in `modules/severity-policy/constants.ts` (or in the contract) and use it from one place. Either add a route for `preview` or drop it.

## MEDIUM

### 7. DB-backed test is not named `*.it.test.ts` (policy.test.ts)
The file calls `createDb(process.env.DATABASE_URL!)` and hits Postgres, but it is named `policy.test.ts`.
- Reason: section 10. The `.it.test.ts` suffix is the only thing that routes a test to the DB lane. As named, it runs in the hermetic lane and fails there.
- Fix: rename it `repository.it.test.ts`.

### 8. Test coverage is in the wrong layer (policy.test.ts)
Only the repository is tested. The use case (default when no row exists, floor validation, upsert) and `applySeverityFloor` and `countBySeverity` have no tests.
- Reason: section 10. Business rules should be tested at the service, mocking at the port (`ContainerOverrides` / `adapters/mocks.ts`), with no DB. Once the core is pure (issue 1), floor filtering is a trivial hermetic unit test.
- Fix: add `service.test.ts` with a stubbed repository, and `severity.test.ts` in reviewer-core. Also clean up the fixed-UUID rows in the integration test with an `afterAll` delete, or use unique ids.

## Checked and fine
- `routes.ts` is thin: it calls `getContext` on both handlers, builds the service once above the handlers, and holds no SQL (routes.ts:10, 16, 25).
- The repository filters by `workspace_id` and takes `Db`, not `Container` (repository.ts:8, 14).
- `service.ts` does not import `drizzle-orm` or `db/schema`.
- The dependency direction server to reviewer-core is correct. Only the core's internals (issue 1) break the rule.
- Minor: `severity.ts:2` imports types from the package barrel `../index.js`. Import from the specific types module to avoid a barrel cycle if `index` re-exports `review/severity`.
