# Onion-architecture review: `modules/pr-notes`

Paths are relative to `fixtures/pr-notes/server/src/modules/pr-notes/`.
Rules come from the onion-architecture skill, so section numbers (§) refer to that skill.

Verdict: 4 CRITICAL and 1 HIGH finding, plus 3 MEDIUM. `constants.ts` and `helpers.ts` are clean.

## Findings

### 1. CRITICAL: `routes.ts:3` and `routes.ts:6` import `drizzle-orm` and `db/schema` in a route (§1)
- **Why:** A `routes.ts` may only resolve context, call the service, map the result and translate errors. SQL and the schema belong in the repository, and `depcruise` encodes this rule. This is the pattern the four legacy modules are being paid down for, so it must not be copied.
- **Fix:** Delete both imports (`and, desc, eq` and `* as t`). Persistence goes through `PrNoteRepository`.

### 2. CRITICAL: `routes.ts:23-28` inline query in the GET handler bypasses the service and the repository (§1, §3)
- **Why:**
  - The handler uses `app.container.db` directly. `container.db` should only appear inside a repository.
  - `PrNoteService.list` and `PrNoteRepository.list` already exist (`service.ts:16`, `repository.ts:10`) but are unused. The same query now exists twice.
  - The route's copy has no `.limit()`, so it ignores `NOTES_PAGE_SIZE` and returns unbounded rows. The two read paths can drift apart.
- **Fix:** Replace the body with the three-line pattern:
  ```ts
  const { workspaceId } = await getContext(app.container, req);
  return service.list(workspaceId, req.params.id);
  ```
  Also drop the `toNote` import at `routes.ts:9`. Mapping is already done in the service.

### 3. CRITICAL: `service.ts:1` and `service.ts:23-24` construct an Octokit client in the service (§2, §6)
- **Why:**
  - The `octokit` SDK may only be imported under `adapters/`. The service imports `Octokit` and calls `new Octokit(...)` itself, which skips the port and breaks the rule that a service never constructs a concrete client.
  - It cannot be unit-tested through `ContainerOverrides` and `adapters/mocks.ts`. Any test would hit the network.
- **Fix:**
  - Remove the `octokit` import.
  - Call the `GitHubClient` port through the container, for example `const gh = await this.container.github()`.
  - If the port has no "authenticated viewer" method, add one to `GitHubClient` in `vendor/shared/adapters.ts`. Implement it in the Octokit adapter under `adapters/`, and add it to `adapters/mocks.ts`. Do this before using it (§6: add the port first).

### 4. CRITICAL: `service.ts:22` the service reads a raw secret (`github-token`) from `container.secrets` (§8, §6)
- **Why:** Resolving secrets and building authenticated clients is the composition root's job (`platform/container.ts`). The service is hand-assembling a client from a credential, and the secret name is a magic string in the application layer.
- **Fix:** This goes away once finding 3 is fixed. `container.github()` already resolves the token lazily, and it fails when the feature is used rather than at boot.

### 5. CRITICAL: `repository.ts:2` and `repository.ts:8` repository depends on `Container` (§3)
- **Why:**
  - A repository takes `Db` in its constructor and nothing else. Importing `platform/container` points an infrastructure class at the composition root, which is the wrong direction. It also gives the repository access to secrets, GitHub and the LLM, which it must not touch.
  - Uses at `repository.ts:11` and `repository.ts:20` (`this.container.db`) are the symptom.
- **Fix:**
  ```ts
  import type { Db } from '../../db/client.js';
  constructor(private db: Db) {}
  ```
  Use `this.db.select()...` and `this.db.insert()...`. Then change `service.ts:13` to `new PrNoteRepository(container.db)`. The service may read `container.db` only to pass it along. If you want to avoid even that, build the repository in the container or inject it through the service constructor (§8).

### 6. HIGH: `service.ts:12-13` and `service.ts:25` smaller service-level issues
- **Constructor (`service.ts:12-13`):** The service constructs its own concrete `PrNoteRepository` from the whole `Container`. Taking `Container` is an accepted exception (§8). Still, prefer explicit dependencies for a new service, such as `constructor(private repo: PrNoteRepository, private github: GitHubClient)`. This is a preference, not a violation.
- **Error type (`service.ts:25`):** `NotFoundError('github user')` is the wrong error for "token could not identify a user". That is an upstream or auth failure, not a missing resource, so the client gets a misleading 404. Use the appropriate error from `platform/errors`.
- **Missing ownership check (`service.ts:21-27`):** `add` does not check that `pullId` belongs to `workspaceId` before inserting. The skill's rule is that every query scopes by workspace "directly, or via the PR that carries it". The insert only writes `workspaceId` and `pullId` as given, so a caller can attach a note to another workspace's PR id. Look up the pull through the repository first and throw a not-found error if it is not in the workspace.

### 7. MEDIUM: `routes.ts:12` request body schema defined locally (§ Decision table)
- **Why:** Request and response shapes belong in `vendor/shared/contracts/<area>.ts` and propagate by alias. `PrNote` already comes from the shared package, but `AddNoteBody` lives in the route file. The contract is split, and the client cannot reuse it.
- **Fix:** Move it to the shared contract, for example `AddPrNoteBody`. Bound its length with `.max(NOTE_MAX_CHARS)` so the 2000-character limit is enforced at the edge with a 422. The `clampBody` helper silently truncates a note instead.

### 8. MEDIUM: `repository.ts:5` row type derived from `import * as t` (§4)
- **Why:** `typeof t.prNotes.$inferSelect` is acceptable inside the repository, which owns the schema. `helpers.ts:2` then imports it type-only from `./repository.js`, which is the pattern the skill mandates. So there is no violation today.
- **Fix (optional):** If another module ever needs the shape, export it from `db/rows.ts` instead of making consumers import this repository.

## Clean files
- `constants.ts`: no imports, holds only magic numbers. Correct.
- `helpers.ts`: pure. It imports only the contract type, a type-only row type and a constant, and has no container, I/O or `this`. This is the correct layering. The only quibble is that `clampBody` truncates silently, which is a behaviour question rather than a layering one.

## Summary table

| # | File:line | Severity | Problem |
|---|---|---|---|
| 1 | routes.ts:3,6 | CRITICAL | drizzle-orm and db/schema imported in a route |
| 2 | routes.ts:23-28 | CRITICAL | inline query bypasses service and repository, no limit |
| 3 | service.ts:1,23-24 | CRITICAL | `octokit` SDK constructed in the service, not behind a port |
| 4 | service.ts:22 | CRITICAL | service resolves a raw secret |
| 5 | repository.ts:2,8,11,20 | CRITICAL | repository takes `Container` instead of `Db` |
| 6 | service.ts:12-13,25 and 21-27 | HIGH | concrete repo built from container, wrong error type, no pull ownership check |
| 7 | routes.ts:12 | MEDIUM | request schema local to the route, no max length |
| 8 | repository.ts:5 | MEDIUM | row type location (optional) |

Suggested order: fix the repository (5), then the service (3, 4), then the route (1, 2), then run `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs`. I did not run it, and the fixture files were not edited.
