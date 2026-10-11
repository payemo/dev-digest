# Fix Plan — export-to-ci, round 2 (pr-self-review WARNING 1–3)

**Source plan:** `docs/plans/export-to-ci.plan.md`
**Execution mode:** single agent
**Origin:** `/pr-self-review` verdict (3 WARNING, 7 SUGGESTION). Only the three WARNINGs are in scope; the SUGGESTIONs are not.

## Steps

### F1 — Move the two locally re-declared response shapes into `@devdigest/shared`
- **Files:** `server/src/vendor/shared/contracts/eval-ci.ts` (add), `server/src/modules/ci/routes.ts:28-35` (use), `client/src/lib/hooks/ci.ts:42-48` (use), `client/src/vendor/shared/contracts/eval-ci.ts` (byte-identical mirror).
- **Change:** `UpdateResponse` (`{ installations: CiInstallation[] }`) and `RunnerResponse` (`{ path, contents, sha256, version }`) are declared in the server routes AND re-declared in the client hook as `CiUpdateResult` / `CiRunnerBundle`. Define each once in the shared contracts (additive; PascalCase const + inferred type, e.g. `CiUpdateResponse`, `CiRunnerResponse`), import them in `routes.ts` and `hooks/ci.ts`, and delete the local copies. Keep wire shapes exactly as they are today. Keep `byOutput` in the hook only if still needed for the new schemas.
- **Constraint:** root CLAUDE.md — `@devdigest/shared` is the one contract source; never retype per package. `diff -rq server/src/vendor/shared client/src/vendor/shared` must stay empty. Additive only.
- **Owner:** implementer
- **Done when:** `rg "UpdateResponse|RunnerResponse|CiUpdateResult|CiRunnerBundle" server/src client/src` shows only the shared definitions and their imports; server + client typecheck and existing tests pass.

### F2 — `listWorkflowRuns` must not hide a missing Actions permission behind a 404
- **Files:** `server/src/adapters/github/octokit.ts:~498-503` (`listWorkflowRuns` catch block), `server/src/adapters/mocks.ts` (only if the mock must model the new distinction).
- **Change:** today any 404 returns `[]`. That is right only when the workflow file is not on the default branch yet (the PR-first flow). GitHub also answers 404 for a token without Actions: read or an inaccessible repo, which then looks like a clean zero-run sync with no `errors` entry. On a 404, distinguish the cases: if the workflow file does not exist on the repo's default branch (check with Contents read, e.g. `repos.getContent`/default branch lookup, treating a 404 there as "file absent") return `[]`; otherwise (the file exists but listing runs 404s, or the repo itself is not reachable) rethrow through `scopeError(err, 'Actions: read', 'list workflow runs')` so the message lands in `CiSyncResult.errors` and names the scope. 403 keeps going through `scopeError`. Never include the token in any message.
- **Constraint:** onion-architecture — SDK calls stay in `adapters/`; no port signature change unless unavoidable (if one is needed, mirror `vendor/shared/adapters.ts` to the client byte-for-byte). plan S4: 403/404 map to a scope-naming message.
- **Owner:** implementer
- **Done when:** typecheck + non-integration server tests pass; a short comment in the code states the two 404 meanings; the adapter has no path where a permission 404 returns `[]`.

### F3 — Promote the duplicated status helpers to a named `src/lib` file
- **Files:** new `client/src/lib/ci-status.ts`; `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/helpers.ts:32-44` and `client/src/app/ci-runs/_components/CiRunsView/helpers.ts:47-55` (remove the copies, import from the lib file); update the importers of `statusTone` / `runStatusOf` accordingly.
- **Change:** `statusTone`, `runStatusOf` (and the `RUN_STATUSES` list they use) exist as identical copies in two route-local `helpers.ts`. Extract one `src/lib/ci-status.ts` (named for its subject, pure, no React import) and import it from both places via `@/lib/ci-status`. Behaviour unchanged. If `CiRunsView/constants.ts` `STATUS_OPTIONS` can reuse the shared list, do so only if it is a trivial change.
- **Constraint:** frontend-code-organization §6 — promote on the second unrelated consumer; helpers are pure; named file, never `utils.ts`; `@/` imports.
- **Owner:** implementer
- **Done when:** the two helper bodies exist in exactly one place; `cd client && pnpm typecheck && pnpm test` pass.

## Out of scope
The seven SUGGESTION findings from the verdict, test files (a separate `test-writer` run follows), and any edit to the plan/spec text.
