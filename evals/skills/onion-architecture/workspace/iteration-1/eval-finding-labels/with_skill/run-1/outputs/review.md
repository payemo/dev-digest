# Layering review: finding-labels module

Reviewed against the onion-architecture skill. Paths are relative to
`evals/skills/onion-architecture/fixtures/finding-labels/server/src/`.
Nothing was edited.

Correct as written: `routes.ts` has no SQL and calls `getContext` on every
route. It builds the service once, validates through zod, and does no business
branching. `service.ts` imports no Drizzle or Fastify. `repository.ts` takes
`Db`, not `Container`, and scopes every query by `workspace_id`.

## Findings

### 1. CRITICAL: contract imports `db/schema`
`vendor/shared/contracts/finding-labels.ts:2` and `:15`

The contract imports `findingLabels` from `../../../db/schema.js` just to
export `FindingLabelRecord = typeof findingLabels.$inferSelect`. Contracts are
the core and may import only zod (skill §7). This makes the wire format depend
on the storage format, and `depcruise` will flag it.

Fix:
- Delete line 2 and the `FindingLabelRecord` export on line 15. Nothing in the
  module uses it.
- Add `export type FindingLabelRow = typeof t.findingLabels.$inferSelect;` to
  `server/src/db/rows.ts` and use that wherever a row type is needed.

### 2. HIGH: helpers import Drizzle and the schema at runtime
`modules/finding-labels/helpers.ts:1-2`, `:6`, `:16-18`

`helpers.ts` must be pure (skill §5) and may not import `drizzle-orm` or
`db/schema`.
- Line 2 is a runtime `import * as t from db/schema` used only for a row type
  (§4).
- Line 1 plus `labelsForFinding` (16-18) build a Drizzle `eq()` predicate.
  That is SQL and belongs in the repository. It is also dead code, because
  the repository already writes the same condition inline.

Fix:
- Delete `labelsForFinding` and the `eq` import.
- Change line 2 to `import type { FindingLabelRow } from '../../db/rows.js'`,
  or from `./repository.js` as `reviews/helpers.ts` does.
- Change the signature on line 6 to `toLabel(row: FindingLabelRow)`.
- `toLabel` and `canAddLabel` are then pure and testable without mocks.

### 3. HIGH: a DB row reaches the HTTP response
- `modules/finding-labels/service.ts:14` returns `Promise<FindingLabelRow[]>`.
- `modules/finding-labels/routes.ts:13-16` returns it unmapped.
- The GET route has no `response` schema.

`GET /findings/:id/labels` sends raw camelCase rows (`findingId`, `createdAt`
as a `Date`). The POST route returns the snake_case `FindingLabel`, so the two
shapes diverge. Rows must be mapped to a contract before reaching a response
(skill §4).

Fix:
- Change `list` to `return (await this.repo.listForFinding(...)).map(toLabel)`
  with return type `Promise<FindingLabel[]>`.
- Add `response: { 200: z.array(FindingLabel) }` to the GET route schema.

### 4. MEDIUM: service reaches into `container.db`
`modules/finding-labels/service.ts:11`

The service does `new FindingLabelRepository(container.db)`. The skill says
the service should not touch `container.db` (§2 and the checklist). The
composition root should own repository construction (§8).

The existing `reviews/service.ts:35` does the same thing, so I rated this
MEDIUM rather than CRITICAL. It is still not a pattern to copy.

Fix, in order of preference:
- Build `container.findingLabelsRepo` in `platform/container.ts` and use
  `this.repo = container.findingLabelsRepo`.
- Or inject the repository: `constructor(private repo: FindingLabelRepository)`.

Either also makes the service testable with a fake repository and no DB.

### 5. MEDIUM: duplicated limit constant
- `vendor/shared/contracts/finding-labels.ts:18` hardcodes `.max(40)`.
- `modules/finding-labels/constants.ts:1` defines `LABEL_NAME_MAX = 40`, and
  nothing uses it.

The two can drift. The contract cannot import from a module, because that
would point inward to outward.

Fix: keep the limit in the contract. Export `LABEL_NAME_MAX` from the contract
file, or from `@devdigest/shared`, and drop it from the module `constants.ts`.
`MAX_LABELS_PER_FINDING` correctly stays in the module.

### 6. MEDIUM: row type declared in the repository, color untyped
`modules/finding-labels/repository.ts:5`, `:21`

- `FindingLabelRow` is declared locally with a `t.*` `$inferSelect`. Repo-wide
  row types live in `db/rows.ts`, and the repository should re-export from
  there (see finding 1).
- `insert(..., color: string)` loses the `LabelColor` type. That is why
  `helpers.ts:11` needs the `as FindingLabel['color']` cast. Type `color` as
  `FindingLabel['color']`, or constrain the column with a Drizzle enum or
  `$type`, and drop the cast.

## Not layering, noted only
`service.ts:19-21` counts labels and then inserts, so concurrent adds can
exceed the limit. This is a correctness issue. A transaction or a repository
`count` would fix it.

## Summary
| # | Severity | Location |
|---|---|---|
| 1 | CRITICAL | contracts/finding-labels.ts:2,15 |
| 2 | HIGH | helpers.ts:1-2,6,16-18 |
| 3 | HIGH | service.ts:14, routes.ts:13-16 |
| 4 | MEDIUM | service.ts:11 |
| 5 | MEDIUM | contracts:18 / constants.ts:1 |
| 6 | MEDIUM | repository.ts:5,21 |

I did not run `depcruise`.
