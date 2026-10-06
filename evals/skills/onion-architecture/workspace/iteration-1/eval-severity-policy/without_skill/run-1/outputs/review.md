# Review: severity floor policy (reviewer-core + server)

Paths are relative to `evals/skills/onion-architecture/fixtures/severity-policy/`. Judged against root, server and reviewer-core CLAUDE.md. No skill used.

## Findings

### 1. CRITICAL - reviewer-core/src/review/severity.ts:1, 6-16 - filesystem and env reads in the pure engine
`readFileSync('.devdigest/severity.json')` and `process.env.DEVDIGEST_MIN_SEVERITY` are I/O inside reviewer-core. reviewer-core/CLAUDE.md says it has "zero DB/GitHub/filesystem access" and must never add a filesystem call. The read is also relative to the process cwd, so behaviour depends on where the server was launched. The bare `catch {}` hides a corrupt file.
Fix: make `applySeverityFloor(findings, floor: Severity)` a pure function. Delete `loadFloor`. The server resolves the floor (DB, via the repository and service) and passes it in as data.

### 2. CRITICAL - reviewer-core/src/review/severity.ts:7-11 plus server/.../service.ts:19 - two competing sources of truth
The engine takes its floor from env or a file. The server stores it in the DB per workspace and agent (`repository.ts`). Nothing connects them, so the stored policy is never applied by the engine, and the default `'low'` is duplicated in `severity.ts:15` and `service.ts:19`.
Fix: one source, the DB. Pass the floor into the engine as an argument and keep the default in one place.

### 3. HIGH - reviewer-core/src/review/severity.ts:2 - imports from `../index.js`
The package barrel is the public surface. A module inside the package importing from it is circular. CLAUDE.md also says contracts (`Finding`, `Severity`) come from `@devdigest/shared`.
Fix: `import type { Finding, Severity } from '@devdigest/shared'`. Check that `Severity` exists there; the grep found it in `contracts/observability.ts`.

### 4. HIGH - reviewer-core/src/review/severity.ts:4 vs service.ts:8 - the severity enum is defined three times
`ORDER` (reviewer-core) and `FLOORS` (service) are separate hand-typed lists. A third copy is implied by the `SeverityPolicy['floor']` casts. The shared Zod contract should own this, since `@devdigest/shared` is "the one contract source".
Fix: derive `ORDER` from the shared `Severity` enum (`Severity.options`), and use `SeverityPolicy.shape.floor` for validation. Delete `FLOORS`.

### 5. HIGH - server/.../service.ts:1, 22-26 - the Fastify request leaks into the service, and validation is done by hand
`setPolicy(req: FastifyRequest, ...)` makes the service depend on Fastify, so it cannot be unit-tested without faking a request. It reads `req.body as {floor: string}` with an unchecked cast and validates with `FLOORS.includes` and `ValidationError`. The logging also uses `req.log`. server/CLAUDE.md requires routes to validate through zod `params`/`body` schemas so invalid input is rejected before the handler runs.
Fix: the PUT route declares `body: SeverityPolicyUpdate` (a shared Zod schema). The handler calls `service.setPolicy(workspaceId, agentId, req.body.floor)`. If the service needs logging, inject a logger or take it from the container. Remove the `FastifyRequest` import.

### 6. MEDIUM - server/.../routes.ts:14, 22 - the PUT route has no `body` schema
Both routes share one schema shape, and the PUT declares only `params` and `response`. This is the cause of finding 5. The schema also lacks a 404 or unknown-agent path: nothing checks that `agentId` belongs to `workspaceId`.
Fix: add the body schema. Have the service or repository confirm the agent belongs to the workspace, which is a tenancy and authorization gap.

### 7. MEDIUM - server/.../routes.ts:10 and service.ts:13-15 - the service and repository are built by hand, bypassing the composition root
The route does `new SeverityPolicyService(app.container)`, and the service does `new SeverityPolicyRepository(container.db)`. The service takes the whole Container (service-locator style) when it needs only a repository. This hides dependencies and blocks substituting a fake repository in tests.
Fix: `constructor(private repo: SeverityPolicyRepository)`. Build the repository and service once in the composition root (the module's register function or the Container) and inject them. Check how sibling modules (for example `reviews`) wire this and follow that.

### 8. MEDIUM - server/.../service.ts:30-32 - `preview()` is dead code and the only link to reviewer-core
`preview` is not used by any route. The service's only use of the engine is a passthrough. The real place the floor must apply is the review pipeline (`reviews`), which does not call this module.
Fix: remove `preview`, or wire the floor into the review run flow. Also note that `applySeverityFloor` is not exported from `reviewer-core/src/index.ts`, and the barrel is the only allowed entry point. Add the export.

### 9. MEDIUM - server/.../service.ts:19, 27 and repository.ts:18 - weak typing at the boundaries
`floor: string` in the repository, `as SeverityPolicy['floor']` casts in the service. A bad value in the DB is silently passed through as a valid floor.
Fix: type the column with a pg enum or text with `$type<Severity>()`. Make `upsert` take `Severity`. Remove the casts.

### 10. HIGH - server/.../policy.test.ts (file name and line 6) - a DB-backed test not named `*.it.test.ts`
The test calls `createDb(process.env.DATABASE_URL!)` and hits real Postgres. Root and server CLAUDE.md say the `*.it.test.ts` suffix is the only thing separating the DB lane from the hermetic one. As named, it runs in the unit lane, where there is no database, and fails (or is silently skipped) in CI.
Fix: rename it to `repository.it.test.ts`. Use the repo's testcontainers helper, which self-skips without Docker, rather than a raw `DATABASE_URL`. Use unique per-test IDs or clean up, since fixed UUIDs at lines 8-9 will collide across runs.

### 11. MEDIUM - server/.../policy.test.ts (coverage) - the layers that carry the logic have no tests
Only the repository is tested. Add:
- a hermetic service unit test with a fake repository (this works only after finding 7);
- a route test for 422 on a bad floor and for the default `'low'`;
- a pure unit test for `applySeverityFloor` and `countBySeverity` in reviewer-core (`npm test`). None exists, and the function is trivial to test once finding 1 is fixed.

### 12. LOW - reviewer-core/src/review/severity.ts:23-27 - `countBySeverity` is unused
No caller appears in the change, and `Finding.severity` is not guarded against values outside `ORDER`. Remove it or use it. The repo already has `findings_by_severity` contracts, so check whether a helper exists.

### 13. LOW - server/.../repository.ts:3 and the tests - the import `../../db/schema.js`
The server package has both `db/schema.ts` and a `db/schema/` folder, and CLAUDE.md says to edit `src/db/schema/*`. No `severityPolicies` table exists in the schema. This change needs a new table definition and a generated migration (`pnpm db:generate`, never hand-written), or it will not typecheck or run.

## Summary

The server-side layering is mostly right: route to service to repository, with Drizzle confined to the repository. The Fastify leak in the service and the hand-wired construction are the main faults there. The reviewer-core problem is the serious one. Filesystem and env access break the package's purity rule, and the engine's floor is disconnected from the server's DB policy. Fix findings 1, 2, 5 and 10 first.
