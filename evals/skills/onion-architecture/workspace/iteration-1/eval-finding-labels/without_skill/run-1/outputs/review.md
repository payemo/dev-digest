# Layering review: finding-labels module

Paths are relative to `fixtures/finding-labels/server/src/`. Compared against the repo's existing modules (e.g. `modules/brief`).

## Issues

### 1. CRITICAL: shared contract imports the DB schema
`vendor/shared/contracts/finding-labels.ts:2` and `:15`

`import { findingLabels } from '../../../db/schema.js'` and `FindingLabelRecord = typeof findingLabels.$inferSelect`. `@devdigest/shared` is the Zod contract package consumed by client, mcp, reviewer-core and e2e. It must not depend on server internals (Drizzle schema). The relative path also breaks as soon as the package is consumed through a tsconfig alias from another package. It drags drizzle and DB types into the web bundle and inverts the dependency direction.
Fix: delete the import and `FindingLabelRecord`. The row type already lives in `repository.ts` as `FindingLabelRow`. Contracts stay Zod-only.

### 2. HIGH: helpers.ts depends on Drizzle and the DB schema
`modules/finding-labels/helpers.ts:1-2, 6, 16-18`

`helpers.ts` is imported by the service. It imports `drizzle-orm` and `db/schema`, and exports `labelsForFinding()`, which builds a Drizzle SQL predicate. Query construction is persistence and belongs only in the repository. `labelsForFinding` is also unused, and it omits the `workspaceId` scoping that the repository applies, so it invites a tenant-leaking query in the service.
Fix: remove `labelsForFinding` (or move it into `repository.ts` as a private helper that includes `workspaceId`). Keep `helpers.ts` pure: no drizzle, no `db/schema`, no Fastify.

### 3. HIGH: toLabel is typed against the Drizzle table
`modules/finding-labels/helpers.ts:6`

`row: typeof t.findingLabels.$inferSelect` couples the pure mapper (and so the service) to the schema module.
Fix: have the repository own the row type (`FindingLabelRow`, exported from `repository.ts`) and use `import type { FindingLabelRow } from './repository.js'`. Better, make the repository return a domain-shaped record (`{ id, findingId, name, color, createdAt: Date }`) so the service and helpers never see a table type. The `color as FindingLabel['color']` cast should be a validated narrowing, or the column should be a pgEnum (see 8).

### 4. MEDIUM: service returns a persistence row from `list`
`modules/finding-labels/service.ts:14` (return type `FindingLabelRow[]`), `:5`

The service leaks the repository row type, and `routes.ts:13-16` serves it with no `response` schema. The row has camelCase fields (`findingId`, `createdAt: Date`, `workspaceId`), which do not match the `FindingLabel` contract (snake_case, ISO string). The GET shape is inconsistent with POST and exposes `workspaceId`. `toLabel` is never applied on the list path.
Fix: `list(): Promise<FindingLabel[]>` returning `rows.map(toLabel)`. In `routes.ts:13` add `response: { 200: z.array(FindingLabel) }`.

### 5. MEDIUM: service imports repository value and row type directly; FindingLabelRow comes from the adapter file
`modules/finding-labels/service.ts:5`

This is consistent with other modules (`BriefService` builds `new BriefRepository(container.db)`), so constructing the repo in the service is acceptable here. The fault is only the type import (see 3 and 4). No change beyond those, unless the repo should be injected for tests (optional: accept the repo as a second constructor arg defaulting to `new FindingLabelRepository(container.db)`).

### 6. MEDIUM: business rule duplicated and racy; magic number duplicated
`modules/finding-labels/service.ts:19-21`, `vendor/shared/contracts/finding-labels.ts:18`, `constants.ts:1`

- `LABEL_NAME_MAX = 40` is defined in `constants.ts` but the contract hardcodes `.max(40)`. The two will drift. The contract cannot import from the server module, so either move the constant into the shared contract and have the server import it, or drop the server constant.
- The limit check does a full `listForFinding` (loads all rows) then inserts: not atomic, so concurrent requests can exceed `MAX_LABELS_PER_FINDING`. Fix: add `repository.countForFinding()` and run count and insert in one transaction (or a conditional insert), and make the repository expose it. Also there is no check that the finding exists within the workspace (see 7).

### 7. MEDIUM: finding ownership not verified on add or list
`modules/finding-labels/service.ts:14-22`, `repository.ts:17-28`

`add` inserts a label for any `findingId` string. `workspaceId` is written to the row, but nothing checks that the finding belongs to that workspace, and an unknown finding yields an FK error (500) rather than `NotFoundError`. `list` on an unknown finding returns `[]` rather than 404.
Fix: resolve the finding through the existing review/findings repository (via `container.reviewRepo` or a small lookup) scoped by workspace, and throw `NotFoundError('finding')`.

### 8. LOW: `color: string` in repository insert
`modules/finding-labels/repository.ts:21`

The repository accepts `string` while the contract has the `LabelColor` enum, which forces the cast in `toLabel`. Type it as `FindingLabel['color']` (type-only import from `@devdigest/shared` is fine for a repository) or use a pgEnum.

### 9. LOW: route-level notes
`modules/finding-labels/routes.ts:30-34`

- `response: { 204: z.null() }` with `reply.code(204).send(null)`: fine, but check it matches how other delete routes in the repo respond (Fastify strips bodies for 204).
- `getContext` plus module-local `new FindingLabelService(app.container)` follows `brief`; acceptable. If another module ever needs the service, add a Container getter instead of a second instance.
- The route layer is otherwise clean: no Drizzle, no repository access, no business logic.

### 10. LOW: `created_at: z.string()`
`vendor/shared/contracts/finding-labels.ts:11`

Use `z.string().datetime()` to match the ISO string produced by `toLabel`.

## What is fine
- `routes.ts` only imports the service, shared contracts and `_shared` utilities. It does not touch the repository or Drizzle.
- `repository.ts` is the only file that builds queries (aside from the stray helper in `helpers.ts`), and it consistently scopes by `workspaceId`.
- `service.ts` has no Fastify or Drizzle imports and throws typed `AppError` subclasses.
- `constants.ts` is dependency-free.

## Priority order
1. Remove the `db/schema` import from the shared contract (1).
2. Remove Drizzle from `helpers.ts` (2, 3).
3. Map `list` through `toLabel` and add a response schema (4).
4. Transactional limit check, finding ownership check, and de-duplicated constants (6, 7).
