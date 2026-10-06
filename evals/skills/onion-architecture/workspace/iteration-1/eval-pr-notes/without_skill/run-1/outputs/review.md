# Layering review: server/src/modules/pr-notes

Intended layering: routes (HTTP only) -> service (use-case logic, depends on ports) -> repository (only layer touching Drizzle). External systems are reached through ports/adapters on the Container, never by importing an SDK in a module.

## Findings

### 1. routes.ts:3,6,23-28 (GET handler) - CRITICAL
Route handler imports `drizzle-orm` and `db/schema` and runs a query directly via `app.container.db`. This bypasses the service and repository; the existing `PrNoteRepository.list` and `PrNoteService.list` are unused (dead code), and the route also ignores the `NOTES_PAGE_SIZE` limit, so it returns unbounded rows (behavior drift from the service).
Fix: delete the Drizzle imports and call `service.list(workspaceId, req.params.id)`; the repository already holds this query.

### 2. service.ts:1,22-25 - CRITICAL
Service imports the concrete `octokit` SDK, builds an `Octokit` client itself, and reads the `github-token` secret directly. The service (application layer) depends on a vendor SDK and on infrastructure details, and re-implements what the Container already does (`container.github()` returns a `GitHubClient` port backed by `OctokitGitHubClient`, using the `GITHUB_TOKEN` secret; here the key is `'github-token'`, which looks wrong). It is also untestable with `adapters/mocks.ts`.
Fix: remove the Octokit import. Depend on the `GitHubClient` port via `await this.container.github()`. `GitHubClient` has no "get authenticated user" method, so add one (e.g. `getViewerLogin(): Promise<string>`) to the port in `server/src/vendor/shared/adapters.ts`, implement it in `adapters/github/octokit.ts`, and add it to the mock. Alternatively take the author login from the request/auth context (`getContext`) and pass it in, which avoids the external call on every write.

### 3. service.ts:3,10-13 - MEDIUM
Service takes the whole `Container` (service locator) and constructs `PrNoteRepository` itself. It only needs the repository, secrets/github port. Hidden dependencies and harder to unit test with a fake repository.
Fix: inject narrow dependencies (`constructor(repo: PrNoteRepository, github: GitHubClient)` or a small ports interface), and wire in the route/composition root. Check what sibling modules do and stay consistent; if they take `Container`, this is lower priority.

### 4. repository.ts:2,8,11,19 - LOW/MEDIUM
Repository depends on the full `Container` just to get `db`, pulling the composition root into the persistence layer (inward-pointing dependency on a wide type). Fix: inject only the Drizzle `db` handle (type it narrowly).

### 5. helpers.ts:2,5 and repository.ts:5 - MEDIUM
`helpers.ts` imports `PrNoteRow` from `repository.ts`, and `toNote` is called from the route (routes.ts:9,28), so the HTTP layer depends on a persistence row type. The row type (`$inferSelect` from Drizzle schema) leaks out of the repository into mapping code and the route.
Fix: keep row-to-DTO mapping inside the service/repository boundary (the service already returns `PrNote`); once the route calls `service.list`, the route no longer needs `toNote`. Consider having the mapper live with the repository (or the service) rather than a generic `helpers.ts`, and note `clampBody` is domain logic that belongs with the service (it is fine in a pure helper, as it has no I/O).

### 6. routes.ts:12 / helpers.ts:15-18 - LOW
Input validation is split: the route allows any non-empty `body` (`z.string().min(1)`) with no max, and the service silently truncates to `NOTE_MAX_CHARS` (also whitespace-only passes `min(1)` and becomes an empty string after trim and is inserted). Validate at the edge (`.trim().min(1).max(NOTE_MAX_CHARS)`, ideally the schema in `@devdigest/shared` since it is the contract source) rather than silently truncating in the domain layer. Also `AddNoteBody` is defined locally in the route instead of in shared contracts.

### 7. routes.ts:16 - LOW
Route constructs the service at plugin load with `new PrNoteService(app.container)`. Acceptable if other modules do it the same way; otherwise build the service in the composition root.

## Files with no layering problems
- constants.ts: pure constants, no imports. Fine.

## Priority
Fix 1 and 2 first (they break the layer rules); 3-5 are cleanup; 6-7 are polish.
