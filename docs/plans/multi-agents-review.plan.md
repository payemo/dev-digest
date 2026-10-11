# Development Plan: Multi-Agent Review with live per-agent statuses (worktree A)

**Branch:** emdash/multi-agents-review-qyvmj · **Date:** 2026-10-10
**Packages touched:** server · client · shared (`server/src/vendor/shared` and its physical copy `client/src/vendor/shared`)
**Estimated steps:** 17 · **Migration required:** yes · **Contract change:** yes (additive only)
**Execution mode:** **single-agent** (decided by the user to save tokens). `implementer` runs Steps 1–17 itself, including tests (Steps 16–17), then `architecture-reviewer` and `security-reviewer` review via `/implement`. `test-writer` is not used.

## Requirements

**Source read:** `specs/06-multi-agent-review.md` (status draft, revised with user answers, 2026-10-10). It has already been reviewed. Its FR/AC IDs are used as given and not restated. The 6 mockups listed in the request were also checked (PR-page picker, Configure run with agents, Columns results, Tabs + detail results).

**The spec's open questions, resolved by the user via the caller:**
- OQ-1 (where the user lands after a PR-page run): **default accepted.** The Multi-Agent Review results page for that PR, in Columns mode, live.
- OQ-2 (card and column colour/icon): **default accepted.** Each agent gets a deterministic identity colour and icon derived from the agent. Severity colours stay on findings.
- OQ-3 (`Learn`): **default accepted.** Visible but disabled, with a "coming soon" tooltip.
- OQ-4 (unique-issues counter): **default accepted.** No counter.
- OQ-5 (does every PR-page run create a parent run?): **ASSUMED default, not yet confirmed by the user.** Yes: "Run all enabled" and a picker run with 1 agent ticked both create a parent run. See *Open questions*.
- OQ-6 (scope of "latest" in the area): **ASSUMED default, not yet confirmed by the user.** Latest run in the current repository, not the whole workspace. See *Open questions*.

**User constraints (via caller):** stay inside the spec's boundaries. No `ci/` or `agent-runner/` changes, and no worktree-based execution. All of the spec's real gaps are in scope: the sequential executor, the unused `multi_agent_runs` table, the missing grouping heuristic, missing estimates, the missing results page, and the per-run live-log stream. Migrations are generated with drizzle-kit and never hand-edited.

**AC coverage:**

| AC-ID | Covered by step |
|---|---|
| AC-1, AC-2, AC-3, AC-4, AC-49, AC-50 | 12 (picker UI), 8 (estimate endpoint), 6 (estimate math) |
| AC-5 | 12 (link), 14 (preselect via `?pr=`) |
| AC-6, AC-7, AC-8 | 14 |
| AC-9, AC-10, AC-51, AC-52 | 14 (cards), 7 + 8 (latest summary, estimates) |
| AC-11, AC-12 | 11 (pure totals helper), 14 (render) |
| AC-13, AC-14, AC-15, AC-53, AC-54, AC-68 | 7 (query filter), 6 (averaging), 11 (formatting "no estimate") |
| AC-16, AC-17 | 3, 4 |
| AC-18 | 12, 14 (navigate on start response), 4 (response returns before execution) |
| AC-19, AC-20 | 5 |
| AC-21, AC-22 | 1 (persistent link), 8 (view read), 15 (polling + reload) |
| AC-23, AC-24, AC-25 | 15 |
| AC-55 | 6 (failed-cost rule), 15 (render) |
| AC-26, AC-27, AC-28, AC-29 | 15 |
| AC-30, AC-56, AC-57, AC-58 | 6 |
| AC-31, AC-32 | 6 (originals kept), 15 (per-column/tab lists, actions keyed by finding id) |
| AC-33, AC-34, AC-59 | 6 (takes only for columns of this parent), 15 |
| AC-35, AC-36, AC-60 | 6 (take kinds), 15 (one fixed i18n string) |
| AC-37, AC-38 | 6 (conflict flag), 15 (toggle) |
| AC-39, AC-40, AC-41, AC-42 | 10 (shared FindingCard), 15 |
| AC-43 | 10, 15 |
| AC-44, AC-45 | 10 (shared drawer), 15 |
| AC-46 | 5 (per-run loggers stay separate under concurrency), 15 (one SSE subscription per column) |
| AC-47, AC-48 | 6 |
| AC-61, AC-62, AC-69 | 4 (`all` → parent), 12 |
| AC-63, AC-64, AC-65 | 8 (repo-latest), 13, 15 |
| AC-66 | 8 (latest per PR), 15 (results route keyed by PR) |
| AC-67 | 3 (only `agentIds`/`all` create a parent, so CI rows never get one), 7 (`source = 'local'` filter) |

No AC is deferred. AC-55 has a real-world caveat (see *Open questions* Q3): today no failed run ever stores a cost, so the separate figure is correct but will rarely show.

## Recommendation

This plan follows the literal ask, with seven choices made explicit. Each is grounded in the code:

1. **Start runs through the existing `POST /pulls/:id/review`, using an additive `agentIds` field.** Do not add a new `/multi-agent-run` endpoint. This is what the spec asks for. It keeps the rate limit (`server/src/modules/reviews/routes.ts:33`), and it leaves the legacy `{agentId}` path unchanged, so it never creates a parent. That matters because the MCP server (`mcp/src/api.ts:127`) and 3 integration tests (`server/test/run-skills.it.test.ts:143`, `server/test/run-project-context.it.test.ts:185`, `server/test/reviews.it.test.ts:279`) use `{agentId}`.
2. **Add new contracts in a new file `contracts/multi-agent.ts` instead of reshaping the unused ones in `contracts/observability.ts:22-86`.** The old `ConflictTake.verdict` only allows a severity or `'ignored'`, `AgentColumn.status` has no `cancelled`, and `Conflict` has a single line. None of these fit the spec. Nothing consumes them (rg finds no users outside the two vendor copies). The repo's precedent is to keep an unused contract and point to its replacement (`server/src/vendor/shared/contracts/platform.ts:276-283`, `SpecFile`). The barrel says features extend with new files (`server/src/vendor/shared/index.ts:20-21`).
3. **Compute grouping and disagreements on read, in pure server helpers, and never store them.** NFR-5 then holds by construction: no write path touches findings. It is also unit-testable without a database (`TESTING.md:14-16`).
4. **Key the results route on the PR number, always showing that PR's latest parent run** (`/repos/[repoId]/multi-agent/[number]`). There is no route by parent id. This makes FR-23 ("only the latest per PR") structural rather than a filter that could be bypassed, and it matches the PR page's own number-keyed routing (`client/src/app/repos/[repoId]/pulls/[number]/page.tsx:35-38`).
5. **Fan out in-process with `Promise.allSettled`, not through `container.jobs`.** The JobRunner is a `PQueue` with default concurrency 3 (`server/src/platform/jobs.ts:51`), which would break NFR-3 (no cap). Today's fire-and-forget execution is already in-process (`server/src/modules/reviews/service.ts:146`), and the spec's service-communication section says in-process.
6. **Promote `RunTraceDrawer` and `FindingCard` to `client/src/components/`.** This is required, not optional. A second route must never import another route's `_components/` (`.claude/skills/frontend-code-organization/SKILL.md:85-91`). Tabs + detail needs FindingCard's Accept/Dismiss/eval-case behaviour as-is (`FindingCard.tsx:112-147`), and FR-18 needs the drawer as-is (`client/INSIGHTS.md` 2026-09-29).
7. **Caveat on "+ $X on failed runs" (FR-10, AC-55):** the executor writes `costUsd: null, tokensIn: 0, tokensOut: 0` on every failure (`server/src/modules/reviews/run-executor.ts:377-387`). So the separate figure will show only for rows that carry a reported cost. And `effectiveRunCost` would turn a failed row with 0 tokens into a derived `$0`, which would violate AC-55 (`server/src/platform/run-cost.ts:31-35`). This plan adds a failed-run rule that treats such a row as unknown. Recording partial usage on failure would need a `reviewer-core` change, which is outside worktree A. It is recorded as Open question Q3, not silently dropped.

## Goal

When this is done, a reviewer can tick any set of enabled agents, either from the PR page's `Run Review` dropdown or from the new Configure run screen. They see per-agent and total time/cost estimates. They start all ticked agents concurrently as one `multi_agent_runs` parent with N linked `agent_runs` children, and land on `/repos/:repoId/multi-agent/:number`. That page shows live per-column status, log and trace, side-by-side findings (Columns) or detailed actionable findings (Tabs + detail), location groups, and a *Where agents disagree* block with `did not flag` and a conflicts toggle. Totals show successful cost, with failed-run cost shown separately. Opening the sidebar entry lands on the repo's latest parent run, or on Configure run when none exists.

## Inputs read

| File | What it constrained |
|---|---|
| `CLAUDE.md` (root) | No workspace. pnpm for server/client. Migrations never hand-edited (`Do not touch`). `@devdigest/shared` is the one contract source. `*.it.test.ts` suffix. |
| `server/CLAUDE.md:53-62,77-90` | Routes validate with zod schemas, no hand parsing. Migrations only via `pnpm db:generate`. |
| `server/INSIGHTS.md:56-65` (2026-09-19) | A `reviews` row exists only for a `done` run, so findings come only from done children. A failed agent must render "no result", never `did not flag`. |
| `server/INSIGHTS.md:22-30` (2026-09-21) | Dedupe/grouping key on physical location only: file and line range, never text. |
| `server/INSIGHTS.md:67-75` (2026-09-21) | A run-linking structure belongs in `schema/runs.ts` (cycle-free home). |
| `server/INSIGHTS.md:88-98` (2026-09-21) | Estimates must exclude pre-feature or non-matching rows: `source='local'`, `status='done'`, current model. |
| `server/INSIGHTS.md:100-112` (2026-09-21) | Cross-module business logic goes through Container getters. Modules never import each other's service or repository. |
| `server/INSIGHTS.md:114-122` (2026-09-24) | Try/catch placement with `RunLogger.step`. Pre-work failure still fails every child via `failAll`. |
| `server/INSIGHTS.md:170-182` (2026-09-29) | `RunTrace` can be added to, never retyped. This plan does not touch trace shape. |
| `server/INSIGHTS.md:186-197` | drizzle-kit prompts interactively on drop+add in one pass. This plan only adds, so no prompt. |
| `server/INSIGHTS.md:42-52` (2026-09-24) | Integration tests must mock every provider they hit, or they go live and billed. |
| `client/CLAUDE.md:28-58` | Component folder layout. Hooks only in `src/lib/hooks/*`. snake_case DTOs. Component tests mock fetch. |
| `client/INSIGHTS.md:48-57` | Nav label lives in both `vendor/ui/nav.ts` and `messages/en/shell.json`. |
| `client/INSIGHTS.md:81-88` | Vendored primitives (`Badge`) accept no `title`. Wrap them in `<span title>` for tooltips (Learn "coming soon"). |
| `client/INSIGHTS.md:110-121` (2026-09-29) | The trace drawer content is reused as-is. |
| `client/INSIGHTS.md:125-131` | No `@testing-library/user-event`. Use `fireEvent`. |
| `client/INSIGHTS.md:163-170` | `--info` is grey. Check a token's real value before using it for identity colours. |
| `TESTING.md:69-104` | Verbatim test commands. Hermetic vs `.it.test` split. Mock LLM via `adapters/mocks.ts`. |
| `.claude/skills/pr-self-review/routing.md` | Lane lookup for every planned path (see *Skills to be applied*). |
| `.claude/skills/pr-self-review/repo-rules.md:116-136,186-193` | `RULE-CONTRACT-SYNC`: `client/src/vendor/shared` is a physical copy and must `diff -r` clean. `RULE-VENDOR` warns on in-place `client/src/vendor/**` edits. |
| `.claude/skills/onion-architecture/SKILL.md:97-114,311-328,357-371` | Layer placement. No cross-module service/repository import. JobRunner rule, and why fan-out deliberately does not use it. |
| `.claude/skills/frontend-code-organization/SKILL.md:41-62,85-91,139-148,204-224` | Promote on second consumer. Never import another route's `_components`. Thin pages. Barrels. |
| `server/.dependency-cruiser.cjs:91-175,245-258` | Enforced layering. Only `repository.ts`/`repository/*.repo.ts` touch Drizzle. Helpers import neither schema nor container. |
| `server/src/modules/reviews/{routes,service,run-executor,repository}.ts`, `repository/run.repo.ts` | Current start flow, sequential loop at `run-executor.ts:122-158`, row creation at `service.ts:127-142`. |
| `server/src/db/schema/runs.ts:9-87` | `agent_runs` has no parent link. `multi_agent_runs` is unused. |
| `server/src/platform/{sse,run-logger,run-cost,jobs}.ts` | Per-run bus, per-run logger narrowing (`forRun`), cost rules, JobRunner concurrency. |
| `server/test/helpers/runs.ts`, `server/src/adapters/mocks.ts:47-66` | `waitForPrRuns`. `MockLLMOptions.respond` can hold calls open, which a concurrency test needs. |
| `client/src/lib/hooks/reviews.ts:241-352`, `RunReviewDropdown.tsx`, `PrDetailHeader.tsx`, PR `page.tsx`, `RunTraceDrawer.tsx`, `FindingCard.tsx`, `vendor/ui/nav.ts`, `components/app-shell/helpers.ts:28`, `i18n/request.ts` | Current picker, drawer, card, nav wiring. `activeKeyFor` already maps `/multi-agent`. Message namespaces load automatically from `messages/en/*.json`. |

## Architectural constraints binding this change

- Only a module's `repository.ts` / `repository/*.repo.ts` may import `drizzle-orm` or `db/schema`. — source: `server/.dependency-cruiser.cjs:141-163`
- `helpers.ts` imports neither `db/schema`/`drizzle-orm` nor `platform/container`, and uses type-only row imports. — source: `server/.dependency-cruiser.cjs:124-140`; `.claude/skills/onion-architecture/SKILL.md:205-213`
- A new module must not import another module's `service.ts`/`repository.ts`. Shared pure policy goes in `platform/` (as `run-cost.ts` already does). — source: `.claude/skills/onion-architecture/SKILL.md:311-328`; `server/src/platform/run-cost.ts:4-7`
- Every repository query filters by `workspace_id` (directly or via the PR). Every route calls `getContext`. — source: `.claude/skills/onion-architecture/SKILL.md:141-142,174-175`
- Route bodies and params are validated by the zod schema on the route. There is no `.parse` in handlers. — source: `server/CLAUDE.md:53-55`
- Services throw typed `AppError`s (`ValidationError` 422, `NotFoundError`). — source: `server/src/platform/errors.ts:25-29`; `.claude/skills/onion-architecture/SKILL.md:330-340`
- A migration is generated, never hand-written or renamed. — source: `CLAUDE.md` (Do not touch); `server/CLAUDE.md:79-83`
- A run-attribution structure lives in `schema/runs.ts`. — source: `server/INSIGHTS.md:67-75`
- `client/src/vendor/shared` must stay byte-identical to `server/src/vendor/shared`. — source: `.claude/skills/pr-self-review/repo-rules.md:116-123`
- Contracts are PascalCase const + same-name `z.infer` type. — source: `server/CLAUDE.md:41-44`
- `effectiveRunCost` returns a provider-reported cost verbatim, and never re-derives a persisted cost. — source: `server/src/platform/run-cost.ts:21-35`
- PR cost on the PR list counts successful runs only. Failed cost is never folded into it. — source: spec "Existing specs checked"; `server/src/platform/run-cost.ts:37-48`
- Client: fetch only through `src/lib/hooks/*`. User-facing strings in `messages/en/*.json`. Colours as CSS custom properties, never hex in `constants.ts`. — source: `client/CLAUDE.md:48-49`; `.claude/skills/frontend-code-organization/SKILL.md:57,161-165`
- Client: never import another route's `_components/`. Promote to `src/components/<kebab-case>/`. — source: `.claude/skills/frontend-code-organization/SKILL.md:85-91`
- Client: `@/` imports for anything outside the component folder. No deep relative climbs. — source: `.claude/skills/frontend-code-organization/SKILL.md:226-234`
- Tests: DB-backed tests must end in `.it.test.ts`. Mock every LLM provider a test reaches. — source: `TESTING.md:88-91`; `server/INSIGHTS.md:42-52`

## Skills to be applied

| Path to be touched | Lane | Skills (per routing.md) |
|---|---|---|
| `server/src/db/schema/runs.ts` | backend | drizzle-orm-patterns, postgresql-table-design |
| `server/src/db/rows.ts` | backend (no table row) → treat as schema-adjacent | drizzle-orm-patterns (type-only addition) |
| `server/src/db/migrations/0018_*.sql` + `meta/*` (generated) | backend | none, `RULE-MIGRATION` (generated, so it passes) |
| `server/src/vendor/shared/contracts/multi-agent.ts` (new), `platform.ts`, `review-api.ts`, `observability.ts`, `index.ts` | backend + cross-cutting zod | zod, `RULE-CONTRACT-SYNC`, `RULE-CONTRACT-BREAK` |
| `client/src/vendor/shared/**` (verbatim copy) | frontend vendor | none, `RULE-VENDOR`, `RULE-CONTRACT-SYNC` |
| `server/src/modules/reviews/repository/run.repo.ts`, `server/src/modules/reviews/repository.ts` | backend | onion-architecture, drizzle-orm-patterns |
| `server/src/modules/reviews/service.ts`, `run-executor.ts` | backend | onion-architecture (+ security: workspace-scoped validation of agent ids) |
| `server/src/modules/reviews/routes.ts` | backend | fastify-best-practices, onion-architecture, zod |
| `server/src/modules/multi-agent/helpers.ts`, `service.ts`, `constants.ts` (new) | backend | onion-architecture |
| `server/src/modules/multi-agent/repository.ts` (new) | backend | onion-architecture, drizzle-orm-patterns (+ security: workspace scoping) |
| `server/src/modules/multi-agent/routes.ts` (new), `server/src/modules/index.ts` | backend | fastify-best-practices, onion-architecture, zod (+ security: new public routes) |
| `server/test/multi-agent-helpers.test.ts`, `server/test/multi-agent.it.test.ts` (new) | backend tests | none, `RULE-IT-SUFFIX` |
| `server/README.md` (Mermaid module map) | no lane | mermaid-diagram (a `.md` editing a Mermaid block) |
| `client/src/components/run-trace-drawer/**`, `client/src/components/finding-card/**` (promoted) | frontend | react-best-practices, frontend-code-organization |
| `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` | frontend (Next file convention) | next-best-practices, frontend-code-organization |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/{RunReviewDropdown,PrDetailHeader,FindingsPanel,DiffTab}/**` | frontend | react-best-practices, frontend-code-organization |
| `client/src/app/repos/[repoId]/multi-agent/{page,new/page,[number]/page}.tsx` (new) | frontend (Next file conventions) | next-best-practices, frontend-code-organization |
| `client/src/app/repos/[repoId]/multi-agent/**/_components/**` (new folders) | frontend | react-best-practices, frontend-code-organization (placement) |
| `client/src/app/repos/[repoId]/multi-agent/{helpers,constants}.ts` (new) | frontend non-hook lib-like | frontend-code-organization |
| `client/src/lib/hooks/multi-agent.ts` (new), `reviews.ts`, `keys.ts`, `index.ts` | frontend hooks | react-best-practices, frontend-code-organization |
| `client/src/lib/format.ts` | frontend lib | frontend-code-organization |
| `client/messages/en/multiAgent.json` (new), `prReview.json` | frontend i18n | frontend-code-organization |
| `client/src/vendor/ui/nav.ts` | frontend vendor | none, `RULE-VENDOR` (warning accepted; precedent: the `context` and `eval` items in the same file) |
| `client/src/app/globals.css` | no lane listed | none (app-owned stylesheet, deliberately chosen over `vendor/ui/styles.css` to avoid `RULE-VENDOR`) |
| `client/**/*.test.tsx` (new and updated) | frontend tests | react-testing-library |

Skills loaded in full for this plan: **none**. The decisions that onion-architecture, frontend-code-organization, postgresql-table-design (FK-index rule, `SKILL.md:13,20,68`), drizzle-orm-patterns (`db.transaction`, `SKILL.md:38`) and zod could change were confirmed by targeted reads/greps (cited above). None contradicted the plan.

## Steps

### Step 1 — Link child runs to a parent run (schema + generated migration)
- **Closes:** none — prerequisite (enables AC-16, AC-21, AC-22, AC-66)
- **Files:** `server/src/db/schema/runs.ts` (edit), `server/src/db/rows.ts` (edit), `server/src/db/migrations/0018_<generated>.sql` + `server/src/db/migrations/meta/*` (generated)
- **Change:**
  - In `runs.ts`, move the `multiAgentRuns` table definition **above** `agentRuns`. Add an index `multi_agent_runs_ws_pr_ran_at_idx` on `(workspace_id, pr_id, ran_at)` for the latest-per-PR and latest-per-repo lookups.
  - Add a nullable column to `agentRuns`: `multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })`. Use `set null` so deleting a parent never deletes run history. Add an index `agent_runs_multi_agent_run_id_idx` on it, because Postgres does not auto-index FKs (same reasoning as `findings_review_id_idx`, `server/src/db/schema/reviews.ts:54-57`).
  - Update the doc comment of `multi_agent_runs` to say it groups the children of one multi-agent run, and that CI runs never get a parent.
  - Add `export type MultiAgentRunRow = typeof t.multiAgentRuns.$inferSelect;` to `rows.ts`.
  - Run `cd server && pnpm db:generate`. The pass only adds columns and indexes, so it raises no interactive rename prompt (`server/INSIGHTS.md:186-197`). Never edit the produced files.
- **Constraint:** migrations generated only (`CLAUDE.md` Do not touch; `server/CLAUDE.md:79-83`). Run-link lives in `runs.ts` (`server/INSIGHTS.md:67-75`).
- **Owner:** implementer
- **Done when:**
  - `git status server/src/db/migrations` shows exactly one new `0018_*.sql` plus updated `meta/_journal.json` and a new `meta/0018_snapshot.json`, with no modified older files.
  - The SQL contains `ADD COLUMN "multi_agent_run_id"` and both `CREATE INDEX` statements.
  - `cd server && pnpm typecheck` passes.

### Step 2 — Shared contracts for multi-agent runs (server copy, then verbatim client copy)
- **Closes:** none — prerequisite (shapes for AC-4, AC-10, AC-16, AC-23, AC-33–AC-38, AC-47, AC-55)
- **Files:** `server/src/vendor/shared/contracts/multi-agent.ts` (new), `server/src/vendor/shared/contracts/platform.ts` (edit, `RunRequest` at :301-305), `server/src/vendor/shared/contracts/review-api.ts` (edit, `ReviewRunResponse` at :52-56), `server/src/vendor/shared/contracts/observability.ts` (edit, comment only), `server/src/vendor/shared/index.ts` (edit), then `client/src/vendor/shared/**` (verbatim copy of the whole server directory)
- **Change (all additive):**
  - `RunRequest`: add `agentIds: z.array(z.string().uuid()).min(1).optional()`.
  - `ReviewRunResponse`: add `multi_agent_run_id: z.string().nullish()`.
  - New `multi-agent.ts` (imports only `zod` plus `Severity`, `Verdict` from `./findings.js` and `FindingRecord` from `./review-api.js`):
    - `MultiAgentRunStatus = z.enum(['running','done','partial','failed'])`
    - `MultiAgentChildStatus = z.enum(['running','done','failed','cancelled'])`
    - `AgentEstimate = { avg_duration_ms: number|null, avg_cost_usd: number|null, sample_size: int }` (`sample_size: 0` means "no estimate")
    - `MultiAgentCandidate = { agent_id, agent_name, provider, model, description: string, latest_summary: string|null, estimate: AgentEstimate }`
    - `MultiAgentColumn = { run_id, agent_id: string|null, agent_name: string|null, provider: string|null, model: string|null, status: MultiAgentChildStatus, error: string|null, verdict: string|null, score: int|null, summary: string|null, duration_ms: int|null, cost_usd: number|null, findings: z.array(FindingRecord) }`
    - `FindingGroupMember = { run_id, agent_id: string|null, finding_id }`
    - `FindingGroup = { id, file, start_line, end_line, title, members: FindingGroupMember[] }`
    - `DisagreementTake = z.discriminatedUnion('kind', [ {kind:'flagged', run_id, agent_id: string|null, severity: Severity, note: string, finding_ids: string[]}, {kind:'did_not_flag', run_id, agent_id}, {kind:'no_result', run_id, agent_id}, {kind:'pending', run_id, agent_id} ])`. `did_not_flag` deliberately carries **no note**: the generic note is one fixed client string (AC-60).
    - `DisagreementRow = { group_id, file, line: int, title, conflict: boolean, takes: DisagreementTake[] }`
    - `MultiAgentRunView = { id, pr_id, pr_number: int, pr_title, repo_id, ran_at, status: MultiAgentRunStatus, agent_count: int, total_duration_ms: int|null, total_cost_usd: number|null, failed_cost_usd: number|null, columns, groups, disagreements }`
    - `MultiAgentRunRef = { id, pr_id, pr_number: int, ran_at }`
    - Each is exported as const + same-name `z.infer` type.
  - In `observability.ts`, add one doc line above the `// Multi-Agent Review` block: these shapes are unused, and new code uses `contracts/multi-agent.ts`. Change nothing else, and do not remove or rename anything.
  - Add `export * from './contracts/multi-agent.js';` to `index.ts` and its header comment.
  - Copy every changed or new file under `server/src/vendor/shared/` byte-for-byte to the same path under `client/src/vendor/shared/`.
- **Constraint:** contracts import zod only (`.claude/skills/onion-architecture/SKILL.md:245-247`). Additive only (`RULE-CONTRACT-BREAK`). Physical copy must match (`RULE-CONTRACT-SYNC`). Naming per `server/CLAUDE.md:41-44`.
- **Owner:** implementer
- **Done when:**
  - `diff -r client/src/vendor/shared server/src/vendor/shared` prints nothing.
  - `git diff server/src/vendor/shared/contracts | grep -E '^-\s+\w+:'` prints nothing.
  - `cd server && pnpm typecheck` and `cd client && pnpm typecheck` pass.

### Step 3 — Repository: create a parent and its children atomically
- **Closes:** AC-16, AC-17 (with Step 4); AC-67 (no code path gives a CI row a parent)
- **Files:** `server/src/modules/reviews/repository/run.repo.ts` (edit), `server/src/modules/reviews/repository.ts` (edit)
- **Change:**
  - Add `createMultiAgentRunWithChildren(db, { workspaceId, prId, children: { agentId, provider, model }[] }): Promise<{ multiAgentRunId: string; runIds: string[] }>`. Inside one `db.transaction`, it inserts the `multi_agent_runs` row, then one `agent_runs` row per child with `status: 'running'`, `source: 'local'` and `multiAgentRunId` set. It returns ids in input order.
  - Expose it on the `ReviewRepository` facade with a one-line doc comment.
  - Leave `createAgentRun` unchanged.
- **Constraint:** SQL only in repository files (`server/.dependency-cruiser.cjs:141-163`). A failed insert leaves no orphan parent (spec edge case "rate limit / no parent").
- **Owner:** implementer
- **Done when:**
  - `cd server && pnpm typecheck` passes.
  - `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` reports no new violations.

### Step 4 — Reviews service and route: accept `agentIds`, create a parent for `agentIds` and `all`
- **Closes:** AC-16, AC-17, AC-18 (server side), AC-61, AC-62 (server enforces enabled), AC-69 (server ignores ticks for `all`)
- **Files:** `server/src/modules/reviews/service.ts` (edit), `server/src/modules/reviews/routes.ts` (edit)
- **Change:**
  - `resolveTargets(workspaceId, { agentIds?, agentId?, all? })` now returns `{ targets: AgentRow[]; grouped: boolean }`. Precedence is `agentIds` > `all` > `agentId`.
    - For `agentIds`: dedupe them, then load with `this.agents.listByIds(workspaceId, ids)`. If any id is missing (unknown or another workspace's) or disabled, throw `ValidationError('Unknown or disabled agent(s)', { agentIds: rejected })`, which is a 422. Return `grouped: true`.
    - For `all`: use `listEnabled`. If the list is empty, throw `ValidationError('No enabled agents')` so no empty parent is created. Return `grouped: true`.
    - For `agentId`: keep today's behaviour with `grouped: false`.
  - `runReview(workspaceId, prId, targets, logger, { grouped })`. When `grouped`, create rows through `createMultiAgentRunWithChildren`. Otherwise use the existing per-row `createAgentRun` loop. Return `{ runs, reviews: [], multi_agent_run_id }`, where the id is `null` when not grouped. Execution stays fire-and-forget (`service.ts:146`), so the response returns before any agent finishes.
  - Update the route doc comment (`routes.ts:12`) to list `{agentIds}`. Pass `body.agentIds` through and return `multi_agent_run_id` in the response object. The handler stays three lines of hand-off: no parsing, no branching.
- **Constraint:** routes hold no logic (`.claude/skills/onion-architecture/SKILL.md:118-142`). Inputs provenance: each id is validated server-side as an **enabled** agent in the workspace (spec, Inputs provenance). Typed errors (`server/src/platform/errors.ts:25-29`). The existing rate limit still applies (`routes.ts:33`).
- **Owner:** implementer
- **Done when:**
  - `cd server && pnpm typecheck` passes.
  - The existing `server/test/reviews.it.test.ts` "run all enabled agents" case still passes, now with a non-null `multi_agent_run_id` in the body.
  - `{agentId}` callers still get `multi_agent_run_id: null`.

### Step 5 — Executor: run all children concurrently, isolated
- **Closes:** AC-19, AC-20, AC-46 (server side)
- **Files:** `server/src/modules/reviews/run-executor.ts` (edit)
- **Change:**
  - Replace the sequential `for (const { agent, runId } of jobs)` loop (`:122-158`) with `await Promise.allSettled(jobs.map(async ({ agent, runId }) => { … same body … }))`. Each job keeps its own try/catch and its own start time. `runOneAgent` already narrows the logger per run with `parentLog.forRun(runId)` (`:177`), so log lines cannot mix.
  - Keep the shared pre-work exactly as is: diff load with `failAll`, then intent. It runs once, before the fan-out, and `failAll` still fails every child when the diff cannot load (spec edge case).
  - Update the class and method doc comments: "concurrently, no cap" replaces "map-reduces each agent" ordering wording.
  - No other behaviour changes. Per-run cancel (`runBus.isCancelled(runId)`) and per-run `complete` already work per child.
- **Constraint:** NFR-3 has no cap, which is why this does not use `container.jobs` (`server/src/platform/jobs.ts:51`). Failure isolation is preserved (`run-executor.ts:149-157`, `:370-394`). The try/catch placement rule from `server/INSIGHTS.md:114-122` is unchanged.
- **Owner:** implementer
- **Done when:**
  - `cd server && pnpm typecheck` passes.
  - `grep -n "for (const { agent, runId } of jobs)" server/src/modules/reviews/run-executor.ts` returns nothing.
  - The concurrency test in Step 16 passes.

### Step 6 — Pure multi-agent helpers: estimates, grouping, disagreements, status, totals
- **Closes:** AC-13, AC-14 (math side), AC-15, AC-30, AC-31 (originals untouched), AC-33, AC-34, AC-35, AC-36, AC-37, AC-38, AC-47, AC-48, AC-55, AC-56, AC-57, AC-58, AC-59, AC-60 (no per-agent note produced)
- **Files:** `server/src/modules/multi-agent/helpers.ts` (new), `server/src/modules/multi-agent/constants.ts` (new)
- **Change (pure functions over their arguments, with type-only row imports from `../../db/rows.js` and contract types from `@devdigest/shared`):**
  - `constants.ts`:
    - `ESTIMATE_SAMPLE_SIZE = 10`
    - `SEVERITY_RANK = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 }`
    - `NOTE_MAX_CHARS = 160`
  - `averageEstimate(rows: { durationMs: number|null; cost: number|null }[]): AgentEstimate`. Averages duration over non-null durations and cost over non-null costs. Each average is `null` when it has no inputs. `sample_size = rows.length`.
  - `failedRunCost(row: RunCostInputs & { tokensIn, tokensOut }, estimate)`:
    - a reported `costUsd` is returned verbatim;
    - otherwise, a run with `tokensIn + tokensOut > 0` gets `estimate(...)`;
    - otherwise the result is `null`.
    - This avoids `effectiveRunCost` deriving `$0` from the zero tokens a failed run always stores (`run-executor.ts:377-387`; `run-cost.ts:31-35`), which is AC-55's "not shown as $0.00".
  - `deriveParentStatus(statuses: MultiAgentChildStatus[])`, per FR-20:
    - `running` if any child is running;
    - otherwise `done` if all are done;
    - otherwise `failed` if none is done;
    - otherwise `partial`.
  - `computeTotals(columns, failedCosts)`:
    - `total_duration_ms` is the max of known child durations, or `null`;
    - `total_cost_usd` is `sumRunCosts` over `done` children only (reuse `server/src/platform/run-cost.ts:44`);
    - `failed_cost_usd` is the sum of non-null failed/cancelled costs, or `null` when none are known;
    - `agent_count` is the number of columns.
  - `groupFindings(columns): FindingGroup[]`:
    - Per file, sort that file's findings across all columns by `start_line`. Sweep and merge a finding into the current group when `start_line <= group.end_line` (inclusive overlap). Extending `end_line` makes the merge transitive.
    - Category is ignored, and there is no tolerance, so lines 52 and 53 stay separate unless a range covers both.
    - Group `id = "<file>:<start>-<end>"`. `title` is the title of the highest-severity member; on a tie, the earliest `start_line`, then the first column order.
    - Members reference `{ run_id, agent_id, finding_id }` only. They never copy or alter findings.
  - `buildDisagreements(columns, groups): DisagreementRow[]`:
    - Return `[]` when there are fewer than 2 columns (spec edge case "only one agent selected") or when no column is `done` (the client shows an "every agent failed" empty state).
    - Otherwise, for every group, one take per column of this parent only:
      - `running` gives `pending`;
      - `failed` or `cancelled` gives `no_result`;
      - `done` with ≥1 member gives `flagged`, with `severity` = the agent's highest-severity member. Its `note` is the first sentence of that member's `rationale`, trimmed to `NOTE_MAX_CHARS` as plain text. `finding_ids` lists all of that agent's members;
      - `done` with no member gives `did_not_flag`.
    - `conflict` is true when, among `done` columns, (≥1 flagged and ≥1 did_not_flag) OR (the flagged agents' highest severities differ).
    - `line` = the group's `start_line`, and `title` = the group's title.
- **Constraint:** helpers are pure, with no schema/drizzle/container import (`server/.dependency-cruiser.cjs:124-140`). Location-only keys (`server/INSIGHTS.md:22-30`). Failed agents never `did_not_flag` (`server/INSIGHTS.md:56-65`). Do not write a doc comment that literally names a forbidden import token (`server/INSIGHTS.md:124-131`).
- **Owner:** implementer
- **Done when:**
  - `cd server && pnpm typecheck` passes.
  - `grep -nE "drizzle|db/schema|platform/container" server/src/modules/multi-agent/helpers.ts` returns nothing.
  - Step 16's helper tests pass.

### Step 7 — Multi-agent repository: estimates, summaries, latest lookups, parent with children
- **Closes:** AC-13, AC-14, AC-53, AC-54, AC-68 (sample filter); AC-52 (latest summary); data side of AC-21, AC-22, AC-63–AC-66
- **Files:** `server/src/modules/multi-agent/repository.ts` (new)
- **Change:** `class MultiAgentRepository { constructor(private db: Db) }` with these methods. Every query filters by `workspace_id`.
  - `estimateRows(workspaceId, agent: { id, model }, limit)`: `agent_runs` where `workspace_id = ?`, `agent_id = ?`, `status = 'done'`, `source = 'local'` and `model = agent.model`, ordered by `ran_at desc`, with `limit`. Returns `{ durationMs, costUsd, model, tokensIn, tokensOut }[]`. The service calls it once per enabled agent with `Promise.all`; the enabled-agent count bounds that.
  - `latestSummaries(workspaceId, prId, agentIds)`: for each agent, the newest `reviews.summary` where `reviews.pr_id = ?`, `reviews.workspace_id = ?` and `kind = 'review'`. Returns `Map<agentId, string>`. Use `selectDistinctOn([reviews.agentId])` ordered by `agentId, createdAt desc`, or an equivalent typed query.
  - `latestForPull(workspaceId, prId)`: the newest `multi_agent_runs` row for the PR, or `undefined`.
  - `latestForRepo(workspaceId, repoId)`: the newest `multi_agent_runs` row joined to `pull_requests` on `pr_id` where `pull_requests.repo_id = ?`. Returns `{ run, prNumber }` or `undefined`.
  - `loadParent(workspaceId, multiAgentRunId)`: returns the parent row, its PR row (`number`, `title`, `repoId`), its children (`agent_runs` where `multi_agent_run_id = ?`, left-joined to `agents.name`), and each done child's review (`reviews` where `run_id IN children`) with its findings (`findings` where `review_id IN …`). Use 3–4 queries in all, never one per child.
- **Constraint:** repository takes `Db` only, never the container (`server/.dependency-cruiser.cjs:164-173`). Reads tables directly, never through `reviews/repository*` (`.claude/skills/onion-architecture/SKILL.md:317-321`). Workspace scoping on every query (`SKILL.md:174-175`). Estimate filter per FR-6 and `server/INSIGHTS.md:88-98`.
- **Owner:** implementer
- **Done when:**
  - `cd server && pnpm typecheck` passes.
  - `pnpm exec depcruise src --config .dependency-cruiser.cjs` is clean.
  - `grep -c "workspaceId" server/src/modules/multi-agent/repository.ts` is at least one per exported method.

### Step 8 — Multi-agent service and routes (new module, registered)
- **Closes:** AC-4/AC-10 (estimates served), AC-52 (summary served), AC-21, AC-22, AC-63, AC-64, AC-65, AC-66
- **Files:** `server/src/modules/multi-agent/service.ts` (new), `server/src/modules/multi-agent/routes.ts` (new), `server/src/modules/index.ts` (edit)
- **Change:**
  - `MultiAgentService(container)` builds `new MultiAgentRepository(container.db)` and uses `container.agentsRepo`, `container.priceBook` and `effectiveRunCost` / `sumRunCosts` from `platform/run-cost.ts`.
    - `candidates(workspaceId, prId)`: 404 if the PR is not in the workspace. Otherwise, for each `agentsRepo.listEnabled(workspaceId)` agent, return a `MultiAgentCandidate`. Its estimate is `averageEstimate` over `estimateRows(…, ESTIMATE_SAMPLE_SIZE)` mapped through `effectiveRunCost`, and its `latest_summary` comes from `latestSummaries`. Sort candidates by agent name.
    - `viewLatestForPull(workspaceId, prId)` returns `MultiAgentRunView | null` by composing `loadParent`, the row-to-DTO mapping (findings mapped to `FindingRecord` fields: `review_id`, `accepted_at`, `dismissed_at`, snake_case), `computeTotals`, `failedRunCost`, `deriveParentStatus`, `groupFindings` and `buildDisagreements`.
    - `latestRefForRepo(workspaceId, repoId)` returns `MultiAgentRunRef | null`.
    - Throw `NotFoundError` for a foreign or unknown PR or repo.
  - Routes, each with `params: IdParams` and `getContext` and nothing else in the handler:
    - `GET /pulls/:id/multi-agent/candidates`
    - `GET /pulls/:id/multi-agent/latest` (returns `null` when none)
    - `GET /repos/:id/multi-agent/latest` (returns `null` when none)
    - Add `response` schemas: `z.array(MultiAgentCandidate)`, `MultiAgentRunView.nullable()`, `MultiAgentRunRef.nullable()`. The precedent is `server/src/modules/eval/routes.ts` (response schemas).
  - Register as `multiAgent` in `server/src/modules/index.ts`.
- **Constraint:** routes hold no logic. The service imports no drizzle or fastify (`server/.dependency-cruiser.cjs:105-123`). Service DTO mapping must not import `reviews/helpers.ts` (`findingRowToDto`), because sibling modules do not import each other (`.claude/skills/onion-architecture/SKILL.md:322-325`). Write a local mapper in `multi-agent/helpers.ts` instead. Rows never reach HTTP unmapped (`SKILL.md:184-187`).
- **Owner:** implementer
- **Done when:**
  - `cd server && pnpm typecheck` passes and depcruise is clean.
  - `grep -n "multiAgent" server/src/modules/index.ts` shows the import and the registry entry.
  - Step 16's integration test passes.

### Step 9 — Client hooks and query keys
- **Closes:** none — prerequisite (data seam for Steps 12–15)
- **Files:** `client/src/lib/hooks/multi-agent.ts` (new), `client/src/lib/hooks/keys.ts` (edit), `client/src/lib/hooks/reviews.ts` (edit), `client/src/lib/hooks/index.ts` (edit)
- **Change:**
  - `keys.ts`: add `multiAgentKeys = { root: () => ["multi-agent"], candidates: (prId) => ["multi-agent","candidates",prId], latestForPull: (prId) => ["multi-agent","pull",prId], latestForRepo: (repoId) => ["multi-agent","repo",repoId] }` with a doc comment in the existing style.
  - `multi-agent.ts` (`"use client"`):
    - `useMultiAgentCandidates(prId)` parses with `z.array(MultiAgentCandidateSchema)`.
    - `useLatestPrMultiAgentRun(prId)` parses with `MultiAgentRunViewSchema.nullable()`. It uses `refetchInterval: (q) => q.state.data?.status === "running" ? 3000 : false` (NFR-4), the same pattern as `usePrRuns` at `reviews.ts:53-61`.
    - `useLatestRepoMultiAgentRun(repoId)` parses with `MultiAgentRunRefSchema.nullable()`.
  - `reviews.ts`: `RunReviewInput` gains `agentIds?: string[]`. `useRunReview` posts `agentIds` when present, and its `onSuccess` also invalidates `multiAgentKeys.root()`. `useFindingAction.onSuccess` also invalidates `multiAgentKeys.root()`, so Accept/Dismiss in Tabs + detail refreshes the view (AC-40).
  - `index.ts`: add `export * from "./multi-agent";`.
- **Constraint:** one hook per server call, no `fetch` in components (`client/CLAUDE.md:48-49`). Keys through the factory (`client/src/lib/hooks/keys.ts:1-10`).
- **Owner:** implementer
- **Done when:**
  - `cd client && pnpm typecheck` passes.
  - Existing `cd client && pnpm test` stays green.

### Step 10 — Promote `RunTraceDrawer` and `FindingCard` to shared components; add a disabled `Learn`
- **Closes:** AC-39, AC-40, AC-41 (by reuse), AC-43, AC-44, AC-45 (by reuse)
- **Files:**
  - move `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/**` → `client/src/components/run-trace-drawer/**`
  - move `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/**` → `client/src/components/finding-card/**`
  - edit the PR route's `page.tsx`, `_components/FindingsPanel/FindingsPanel.tsx` and `_components/DiffTab/DiffTab.tsx`
  - edit `client/messages/en/prReview.json`
- **Change:**
  - Move both folders with `git mv` so history follows. Keep the internal layout, including the nested `_components/` inside the drawer.
  - Rewrite every import that climbed out of the old folder to `@/…`. For example, `FindingCard.tsx:23` `githubBlobUrl` becomes `@/lib/github-urls`. Test files import messages via `@/../messages/en/…` or the relative path from the new location, whichever this package's existing shared-component tests use (check `client/src/components/eval-case-modal/*.test.tsx` and copy it).
  - Each `index.ts` stays one line and exports only the component. The drawer's barrel keeps its default + named export.
  - Update the 3 consumers to import from `@/components/run-trace-drawer` and `@/components/finding-card`.
  - Add an optional `showLearn?: boolean` prop to `FindingCard`, defaulting to `false` so the PR page is unchanged (NFR-6). When true, it renders a `Learn` `Button` with `disabled` (icon of the implementer's choice from `@devdigest/ui` `Icon`) inside `<span title={t("finding.learnComingSoon")}>`, because vendored primitives do not take `title` (`client/INSIGHTS.md:81-88`). It has no `onClick` and calls no endpoint.
  - Add `finding.learn: "Learn"` and `finding.learnComingSoon: "Coming soon"` to `prReview.json`.
- **Constraint:** promote on second consumer and never import another route's `_components` (`.claude/skills/frontend-code-organization/SKILL.md:85-91`). Drawer content reused as-is (`client/INSIGHTS.md:110-121`). No rebuilt vendor primitive.
- **Owner:** implementer
- **Done when:**
  - `ls client/src/app/repos/[repoId]/pulls/[number]/_components | grep -E "RunTraceDrawer|FindingCard"` returns nothing.
  - `cd client && pnpm typecheck && pnpm test` passes, including the moved `RunTraceDrawer.test.tsx` and `FindingCard.test.tsx`.

### Step 11 — Route-level helpers, agent identity, formatting, i18n, identity tokens
- **Closes:** AC-11, AC-12 (totals helper), AC-15 (no-estimate formatting), OQ-2 default (identity)
- **Files:**
  - new: `client/src/app/repos/[repoId]/multi-agent/helpers.ts`, `client/src/app/repos/[repoId]/multi-agent/constants.ts`, `client/messages/en/multiAgent.json`
  - edit: `client/src/lib/format.ts`, `client/src/app/globals.css`
- **Change:**
  - `format.ts`: add `formatDurationEstimate(ms: number|null|undefined): string|null`. It returns `null` for null (the caller renders the "no estimate" i18n string) and otherwise one decimal of seconds (`8.2s`). It has two consumers, the PR route picker and the multi-agent route, which is why it lives in `src/lib`.
  - `globals.css`: define `--agent-1` … `--agent-6` plus `--agent-1-bg` … `--agent-6-bg` under `:root` and `[data-theme="light"]` (the selector used in `client/src/vendor/ui/styles.css:49`). Use six distinguishable hues, including a purple and a green, that do not reuse the severity tokens `--crit`, `--warn` and `--sugg` (`client/INSIGHTS.md:163-170`). Defining them here, and not in `vendor/ui/styles.css`, avoids `RULE-VENDOR`.
  - `constants.ts`: `AGENT_IDENTITY_COLORS = ["var(--agent-1)", …]` with matching bg tokens, and `AGENT_IDENTITY_ICONS = ["Shield","Zap","Lightbulb","Users","Layers","Boxes"]`. All of these exist in `client/src/vendor/ui/icons.tsx`; verify the exact export names. Hold no hex values and no English strings.
  - `helpers.ts` (pure, no React):
    - `agentIdentity(agentId: string|null, name: string|null)` uses a stable string hash of `agentId ?? name ?? ""` to pick `{ color, bg, icon }`.
    - `selectionTotals(candidates, tickedIds)` returns `{ durationMs: max of known avg_duration_ms | null, costUsd: sum of known avg_cost_usd | null, partial: boolean }`. `partial` is true when any ticked candidate has `sample_size === 0` or a null field.
  - `multiAgent.json`: every user-facing string for Steps 12–15:
    - title, step labels, `Pick a pull request first`, `Select all`, the run-button label with `{count}`, `parallel fan-out`, the partial marker, `no estimate`, the empty "no enabled agents" state;
    - the header `{count} selected agents · parallel`, the totals line, `+ {cost} on failed runs`, `Columns`/`Tabs`, `Configure run`, `New multi-agent run`, `View trace`, `{count} findings`, `no findings`;
    - status labels for running, done, failed and cancelled;
    - `Where agents disagree`, `Show only conflicts`, `did not flag`, the **single** generic did-not-flag note (for example "No finding at this location."), `no result`, `pending`, and the all-failed empty state.
- **Constraint:** strings in messages, never constants. Colours as tokens, never hex (`.claude/skills/frontend-code-organization/SKILL.md:161-165`). Helpers pure (`SKILL.md:119-120`). Messages auto-load per namespace (`client/src/i18n/request.ts:16-25`).
- **Owner:** implementer
- **Done when:**
  - `cd client && pnpm typecheck` passes.
  - `grep -nE "#[0-9a-fA-F]{3,6}" client/src/app/repos/[repoId]/multi-agent/constants.ts` returns nothing.

### Step 12 — PR-page picker replaces the per-agent items
- **Closes:** AC-1, AC-2, AC-3, AC-4, AC-5 (link side), AC-18, AC-49, AC-50, AC-61, AC-62, AC-69
- **Files:**
  - edit: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx`, its `styles.ts` and `constants.ts`, and its `RunReviewDropdown.test.tsx`
  - new: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/_components/AgentPicker/{AgentPicker.tsx,index.ts,styles.ts}`
  - edit: `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `client/messages/en/prReview.json`
- **Change:**
  - `RunReviewDropdown` gains `repoId: string` and `prNumber: number` props. `PrDetailHeader` gains `repoId` and passes both (`pr.number` is already there). `page.tsx` passes `repoId`.
  - The vendored `Dropdown` only renders `items` (`client/src/vendor/ui/kit/Dropdown.tsx:61-79`), so the trigger opens a route-local `AgentPicker` popover. It copies Dropdown's outside-click pattern and uses the `Button` + `Checkbox` primitives. It contains:
    - the `PICK AGENTS TO RUN` heading and a `Clear` action;
    - one `Checkbox` row per **enabled** candidate from `useMultiAgentCandidates(prId)`, showing `~{formatDurationEstimate}` or the "no estimate" string;
    - a primary `Run multi-agent review ({count})` button, disabled at 0;
    - a "Run all enabled agents" action (keep the `runReview.runAll` key);
    - a `Configure agents…` link.
  - Ticks reset to all enabled each time the popover opens: local state seeded on open.
  - Behaviour:
    - The run button calls `run.mutateAsync({ prId, agentIds: ticked })`.
    - "Run all" calls `run.mutateAsync({ prId, all: true })` and ignores ticks.
    - Both then call `router.push(\`/repos/${repoId}/multi-agent/${prNumber}\`)` (OQ-1 default), plus the existing `onRunStart`/`onRunsStarted`/`onRunSettled` callbacks.
    - `Configure agents…` pushes `/repos/${repoId}/multi-agent/new?pr=${prNumber}`.
    - No enabled agents shows a muted entry linking to `/agents` (existing pattern at `RunReviewDropdown.tsx:61`), and both run actions are disabled.
  - Remove the per-agent `agentItems` list entirely, so a disabled agent is not runnable from here (AC-62).
  - Keep the merged-PR warning.
- **Constraint:** fetch via hooks only. Private sub-part goes in a nested `_components/` (`.claude/skills/frontend-code-organization/SKILL.md:80-84`). Strings in `prReview.json`. Tests use `fireEvent` (`client/INSIGHTS.md:125-131`).
- **Owner:** implementer
- **Done when:**
  - `cd client && pnpm typecheck` passes.
  - `grep -n "agentId: a.id" client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx` returns nothing.
  - The updated `RunReviewDropdown.test.tsx` (Step 17) passes.

### Step 13 — Sidebar entry and area landing
- **Closes:** AC-63, AC-64 (routing side)
- **Files:** `client/src/vendor/ui/nav.ts` (edit), `client/src/app/repos/[repoId]/multi-agent/page.tsx` (new)
- **Change:**
  - In `nav.ts`, add `{ key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent" }` to the `WORKSPACE` group, with no `gKey`. Add a comment in the style of the `context` item noting that the label is duplicated in `messages/en/shell.json` (`nav.multi-agent` already exists at `client/messages/en/shell.json:26`).
  - `activeKeyFor` already maps `/multi-agent` (`client/src/components/app-shell/helpers.ts:28`), so no change is needed there.
  - `multi-agent/page.tsx` is a thin client page inside `AppShell`. It calls `useLatestRepoMultiAgentRun(repoId)`:
    - while loading, it shows a `Skeleton`;
    - if a ref exists, `router.replace(\`/repos/${repoId}/multi-agent/${ref.pr_number}\`)`;
    - if none exists, `router.replace(\`/repos/${repoId}/multi-agent/new\`)`;
    - on error, it shows `ErrorState` with retry.
  - It reuses `RepoNotFound` handling like the PR page (`client/src/app/repos/[repoId]/pulls/[number]/page.tsx:90-97`).
- **Constraint:** pages stay thin (`.claude/skills/frontend-code-organization/SKILL.md:139-148`). Nav label lives in two places (`client/INSIGHTS.md:48-57`). `RULE-VENDOR` warning accepted, with the `context`/`eval` items at `client/src/vendor/ui/nav.ts:28-47` as precedent.
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck` passes, and the sidebar renders the item highlighted on `/repos/<id>/multi-agent/*`.

### Step 14 — Configure run screen
- **Closes:** AC-5 (preselect), AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12 (render), AC-18, AC-51, AC-52
- **Files:**
  - new: `client/src/app/repos/[repoId]/multi-agent/new/page.tsx`
  - new: `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/{ConfigureRun.tsx,index.ts,styles.ts,ConfigureRun.test.tsx}`
  - new: `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/_components/AgentCard/{AgentCard.tsx,index.ts,styles.ts}`
- **Change:**
  - `new/page.tsx` reads `repoId` and `?pr=<number>` and renders `ConfigureRun` inside `AppShell`, with crumb `Multi-Agent Review › Configure run`.
  - `ConfigureRun`:
    - Step 1 is a PR selector over `usePulls(repoId)`, labelled `#<number> · <title>`, built with the vendored `SearchableSelect` or `SelectInput` from `@devdigest/ui`. It is preselected from `?pr`.
    - Step 2, with no PR, shows `Pick a pull request first` and a disabled run button.
    - Step 2, with a PR, shows `useMultiAgentCandidates(prId)` as `AgentCard`s, all ticked when the PR is chosen. Each card has a checkbox, `agentIdentity` colour/icon, name, a one-line description (`latest_summary ?? description`, rendered as **plain text** with CSS ellipsis because it is untrusted LLM text, not Markdown), and `Ns · $cost` or "no estimate".
    - `Select all` ticks every card. The total line is `≈ {duration} · {cost} · parallel fan-out`, built from `selectionTotals` and marked partial when needed.
    - The run button `Run multi-agent review ({count})` is disabled with no PR or 0 ticked. On click it calls `useRunReview().mutateAsync({ prId, agentIds })` and then `router.push(\`/repos/${repoId}/multi-agent/${prNumber}\`)`.
    - No enabled agents shows `EmptyState` linking to `/agents`.
    - An error such as a 429 or 422 toasts through the existing global error path, and the user stays on the page.
- **Constraint:** route-local components with nested private parts. Thin page. Hooks only. Strings from `multiAgent.json`. Untrusted text is never rendered as HTML (spec Inputs provenance, "Card description").
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck` passes, and `ConfigureRun.test.tsx` (Step 17) passes.

### Step 15 — Results page: header, Columns, Tabs + detail, disagreements, trace drawer
- **Closes:** AC-18, AC-21, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46, AC-55, AC-59, AC-60, AC-64, AC-65, AC-66
- **Files:**
  - new: `client/src/app/repos/[repoId]/multi-agent/[number]/page.tsx`
  - new, under `client/src/app/repos/[repoId]/multi-agent/_components/`:
    - `ResultsHeader/{ResultsHeader.tsx,index.ts,styles.ts}`
    - `ColumnsView/{ColumnsView.tsx,index.ts,styles.ts,ColumnsView.test.tsx}` and `ColumnsView/_components/AgentColumn/{AgentColumn.tsx,index.ts,styles.ts}`
    - `TabsView/{TabsView.tsx,index.ts,styles.ts,TabsView.test.tsx}`
    - `Disagreements/{Disagreements.tsx,index.ts,styles.ts,helpers.ts,Disagreements.test.tsx}`
- **Change:**
  - **`[number]/page.tsx`** (thin):
    - Resolve the PR uuid from `usePulls(repoId)` the same way the PR page does (`client/src/app/repos/[repoId]/pulls/[number]/page.tsx:35-38`), then call `useLatestPrMultiAgentRun(prId)`.
    - Search params:
      - `view` is `columns` (default) or `tabs` (AC-25);
      - `agent` is the column `run_id` for Tabs;
      - `finding` is the finding id to expand;
      - `trace` is the run id for the drawer.
      - Each one is set with `router.replace`, like `setParam` at `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:58-63`.
    - With no run for this PR, render `EmptyState` with a button to `/new?pr=<number>`.
    - Render `ResultsHeader`, then `ColumnsView` or `TabsView`, then `Disagreements` (both modes), then `RunTraceDrawer` from `@/components/run-trace-drawer` when `trace` is set. Pass the drawer `running={column.status === "running"}`, the column's `findings` and `agent_name`.
  - **`ResultsHeader`**:
    - shows `#n title`, `{agent_count} selected agents · parallel`, a `Configure run` button (to `/new?pr=<number>`, AC-24), a prominent `New multi-agent run` button (to `/new`, FR-22) and the `Columns`/`Tabs` switch;
    - shows the totals line `{agent_count} agents · {formatDurationEstimate(total_duration_ms)} total · {formatUsd(total_cost_usd)}`;
    - shows `+ {formatUsd(failed_cost_usd)} on failed runs` only when `failed_cost_usd != null` (AC-55, NFR-1);
    - shows an overall status badge (FR-20).
  - **`AgentColumn`** (one per `view.columns`, and only those, AC-59):
    - an identity colour bar and icon, name, and a status label;
    - duration and cost once known, with "—" via `formatUsd`, never `$0.00` for unknown;
    - a `CircularScore` when `done`, and `error` text with no score when `failed`/`cancelled` (AC-27);
    - while `running`, a compact `LiveLogStream` fed by `useRunEvents([column.run_id])`. That is one SSE subscription per column, so lines never mix (AC-26, AC-46). When `running` flips false, invalidate `multiAgentKeys.latestForPull(prId)`;
    - a findings list showing severity icon, title and `file:line`, where each item is a button setting `view=tabs&agent=<run_id>&finding=<id>` (AC-28);
    - a findings count or "no findings";
    - a `View trace` button setting `trace=<run_id>`;
    - **no** action buttons (AC-29).
  - **`TabsView`**:
    - one tab per column, labelled with name and score;
    - the active tab shows a summary card (`CircularScore`, plain-text summary, duration, cost, `View trace`);
    - then, for `done`, `FindingCard` from `@/components/finding-card` for each finding, with `showLearn`, `defaultExpanded={f.id === finding}`, and `onAction` wired to `useFindingAction().mutate({ findingId, action, prId })` (AC-32, AC-40, AC-41, AC-43);
    - for `running`, the live status and log instead of findings (AC-42);
    - for `failed`, the error.
  - **`Disagreements`**:
    - a header `Where agents disagree` and a `Toggle` labelled `Show only conflicts`, off by default and held in local state;
    - `helpers.ts` holds `visibleRows(rows, onlyConflicts)`;
    - each row shows `file:line` and the title, then one cell per take:
      - `flagged` shows a `SeverityBadge` and the note as plain text;
      - `did_not_flag` shows `did not flag` plus the single generic i18n note (AC-60);
      - `no_result` and `pending` get their own distinct labels (AC-35, AC-36);
    - cell headers use the column's `agent_name` looked up by `run_id`;
    - with `view.disagreements.length === 0` and no `done` column, show the all-failed empty state, and with fewer than 2 columns render nothing (spec edge cases).
- **Constraint:** route-local tier. Thin page with derivation in `helpers.ts`. Hooks only. `SeverityBadge` is a `<span>` and `Chip` a `<button>`, so query accordingly in tests (`client/INSIGHTS.md:25-32`). Untrusted text is rendered as text (Markdown only inside the reused `FindingCard`, as today).
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck && pnpm test` passes, including Step 17's tests.

### Step 16 — Server tests: helpers (hermetic) and multi-agent flow (integration)
- **Closes:** verification for AC-13–AC-17, AC-19, AC-20, AC-30, AC-33–AC-38, AC-47, AC-48, AC-53–AC-58, AC-60, AC-61, AC-63, AC-64, AC-66, AC-67, AC-68, AC-69
- **Files:** `server/test/multi-agent-helpers.test.ts` (new), `server/test/multi-agent.it.test.ts` (new)
- **Change:**
  - **Hermetic** `multi-agent-helpers.test.ts` uses the spec's fixture cases:
    - same lines but different categories give one group (AC-56);
    - lines 52 and 53 that do not overlap give two groups (AC-57);
    - a WARNING and a SUGGESTION from one agent give WARNING (AC-58);
    - a transitive chain gives one group;
    - a location flagged by one agent only, in a 3-column run with one failed and one running column, gives `flagged` / `no_result` / `pending`, and a done non-flagger gives `did_not_flag` (AC-33, AC-35, AC-36);
    - `did_not_flag` takes carry no note field (AC-60);
    - conflict truth table (AC-37, AC-38);
    - `deriveParentStatus` for all/partial/failed/running (AC-47, AC-48);
    - `averageEstimate` of 6s and 8s gives 7000ms (AC-13), and zero rows give `sample_size: 0` with null averages (AC-15);
    - `failedRunCost` with reported $0.02 gives 0.02, and with null cost and 0 tokens gives `null` (AC-55);
    - `computeTotals` sums only done children and keeps failed cost separate (AC-55);
    - `selectionTotals` math is covered client-side in Step 17.
  - **Integration** `multi-agent.it.test.ts`. Use the testcontainers pattern of `server/test/reviews.it.test.ts`, with `MockLLMProvider` overrides for **every** provider the test agents use (`server/INSIGHTS.md:42-52`) and `waitForPrRuns` (`server/test/helpers/runs.ts:14`).
    - **(a)** `POST /pulls/:id/review {agentIds:[a,b,c,d]}` gives 1 `multi_agent_runs` row and 4 `agent_runs` with that `multi_agent_run_id`, and unticked enabled agents have no run (AC-16, AC-17).
    - **(b) Concurrency (AC-19).** A `respond` mock holds every structured call on a shared deferred promise that resolves only after it has received 4 calls. A sequential executor would never reach 4 and would time out, so the test proves overlap.
    - **(c)** One agent's provider throws while the other 3 reach `done`, and `GET /pulls/:id/multi-agent/latest` returns `status: 'partial'` and a `no_result` take (AC-20, AC-35, AC-47).
    - **(d)** `{agentIds:[disabledId]}` gives 422 and no parent row. `{agentIds:[foreignWorkspaceAgentId]}` gives 422 (AC-62, NFR-7).
    - **(e)** `{all:true}` creates one parent with every enabled agent (AC-61, AC-69).
    - **(f)** `{agentId}` returns `multi_agent_run_id: null` and creates no parent (legacy and MCP path).
    - **(g)** A second run on the same PR makes `latest` return the second parent (AC-66), and `GET /repos/:id/multi-agent/latest` returns its ref, or `null` for a repo with none (AC-63, AC-64).
    - **(h)** Estimates: insert `agent_runs` rows directly for one agent: 14 local done rows on the current model with known durations, plus a CI row, a failed row, a running row and an old-model row. `GET /pulls/:id/multi-agent/candidates` must average only the 10 newest matching rows (AC-14, AC-53, AC-54, AC-68). An agent with only CI rows gives `sample_size: 0`. A disabled agent is absent (AC-49, AC-51).
    - **(i)** `latest_summary` equals that agent's newest `reviews.summary` on this PR, and is `null` for an agent with no review there (AC-52).
    - **(j)** A foreign-workspace PR id on all three GETs gives 404.
- **Constraint:** DB-backed file must end `.it.test.ts` (`TESTING.md:88-91`). Hermetic mocks from `adapters/mocks.ts` (`TESTING.md:96-97`). Typological, not exhaustive (`TESTING.md:8-23`).
- **Owner:** test-writer (multi-agent mode) / implementer (single-agent mode)
- **Done when:** both commands in *Test plan* rows 1–2 pass, and the integration file self-skips cleanly without Docker.

### Step 17 — Client tests, plus the server README module map
- **Closes:** verification for AC-1, AC-2, AC-3, AC-6, AC-9, AC-11, AC-12, AC-28, AC-29, AC-37, AC-43, AC-50, AC-55 (render), AC-60 (render), AC-69 (UI)
- **Files:**
  - edit: `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.test.tsx`
  - new: `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/ConfigureRun.test.tsx`, `client/src/app/repos/[repoId]/multi-agent/_components/ColumnsView/ColumnsView.test.tsx`, `client/src/app/repos/[repoId]/multi-agent/_components/TabsView/TabsView.test.tsx`, `client/src/app/repos/[repoId]/multi-agent/_components/Disagreements/Disagreements.test.tsx`, `client/src/app/repos/[repoId]/multi-agent/helpers.test.ts`
  - edit: `client/src/components/finding-card/FindingCard.test.tsx`
  - edit: `server/README.md` (Mermaid module map at line ~72)
- **Change:**
  - Mock hooks at module seams, as the existing `RunReviewDropdown.test.tsx:6-14` does, and use `fireEvent`.
  - **Picker:**
    - it opens with every enabled agent ticked and a disabled agent absent (AC-49, AC-50);
    - `Clear` sets the count to 0 and disables Run (AC-2, AC-3);
    - ticking 2 shows `(2)` (AC-1), and Run posts `agentIds` of exactly those 2;
    - "Run all" with 2 of 4 ticked posts `{all:true}` (AC-69);
    - a "no estimate" row renders.
  - **ConfigureRun:**
    - with no PR, the empty state shows and Run is disabled (AC-6);
    - `Select all` makes the count equal the card count (AC-9);
    - the total renders `≈ 8.2s · $0.20` for the AC-11 fixture, and a partial marker when one candidate has `sample_size: 0` (AC-12).
  - **ColumnsView:**
    - no Accept/Dismiss/Learn/eval control renders (AC-29);
    - clicking a finding calls `router.replace` with `view=tabs&agent=…&finding=…` (AC-28);
    - a failed column shows the error and no score.
  - **TabsView:** the expanded finding shows `Learn` disabled, and clicking it calls no mutation (AC-43).
  - **Disagreements:**
    - the toggle hides non-conflict rows (AC-37);
    - every `did_not_flag` cell renders the identical note (AC-60);
    - the header shows `+ … on failed runs` only when `failed_cost_usd` is non-null (AC-55). Put this check in a ResultsHeader test inside the ColumnsView test, or add `ResultsHeader.test.tsx` if cleaner.
  - **`helpers.test.ts`:** `agentIdentity` is deterministic, and `selectionTotals` max/sum/partial behave as specified.
  - **FindingCard:** with `showLearn` false, nothing changes, so the PR page is unaffected (NFR-6).
  - **README:** in `server/README.md`, add a `multi-agent` node (`/pulls/:id/multi-agent/(candidates|latest) · /repos/:id/multi-agent/latest`) to the module Mermaid diagram, and add `{agentIds}` to the reviews node label.
- **Constraint:** `react-testing-library` lane. No `user-event` (`client/INSIGHTS.md:125-131`). Component tests mock fetch, so contract drift is caught by the server tests in Step 16 (`client/CLAUDE.md:54-58`).
- **Owner:** test-writer (multi-agent mode) / implementer (single-agent mode); the README edit is implementer
- **Done when:** `cd client && pnpm test && pnpm typecheck` passes.

## Contract changes

All are additive. The edits go in `server/src/vendor/shared`, then whole files are copied verbatim to `client/src/vendor/shared`. That directory is a **physical copy** checked by `diff -r` in `client.yml` (`.claude/skills/pr-self-review/repo-rules.md:116-123`), not an alias. The `mcp/` package reads the server copy by alias (`mcp/tsconfig.json:25-26`) and gets only additive fields, so it needs no change.

- `contracts/platform.ts` `RunRequest`: `+ agentIds?: string[] (uuid, min 1)`.
- `contracts/review-api.ts` `ReviewRunResponse`: `+ multi_agent_run_id?: string | null`.
- New `contracts/multi-agent.ts`: `MultiAgentRunStatus`, `MultiAgentChildStatus`, `AgentEstimate`, `MultiAgentCandidate`, `MultiAgentColumn`, `FindingGroupMember`, `FindingGroup`, `DisagreementTake` (discriminated on `kind`: `flagged | did_not_flag | no_result | pending`), `DisagreementRow`, `MultiAgentRunView`, `MultiAgentRunRef`. The full field lists are in Step 2.
- `contracts/observability.ts`: comment only. The unused `MultiAgentRun`/`AgentColumn`/`Conflict`/`ConflictTake` stay as they are.
- `index.ts`: `+ export * from './contracts/multi-agent.js'`.

## Migration

Yes. Edit `server/src/db/schema/runs.ts` (Step 1), then run `cd server && pnpm db:generate`. Never hand-write or rename the `.sql`, `meta/_journal.json` or snapshot. Apply locally with `cd server && pnpm db:migrate`, because migrations never run on boot. The change only adds a column and 2 indexes, so drizzle-kit raises no interactive prompt (`server/INSIGHTS.md:186-197`).

## Test plan

| Suite | Command (verbatim from TESTING.md / CI) | Covers which step |
|---|---|---|
| server-unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | 6, 16 (helpers), regression for 4–5 |
| server-integration | `cd server && pnpm exec vitest run .it.test` | 1, 3, 4, 5, 7, 8, 16; regression `reviews.it.test.ts`, `run-skills.it.test.ts`, `run-project-context.it.test.ts`, `pulls-findings.it.test.ts`, `run-cost.it.test.ts` |
| server typecheck | `cd server && pnpm typecheck` | 1–8 |
| server layering | `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` (from `.github/workflows/server-unit.yml:123`) | 3, 6, 7, 8 |
| contract sync | `diff -r client/src/vendor/shared server/src/vendor/shared` (`repo-rules.md:122`) | 2 |
| client | `cd client && pnpm test` | 9–15, 17 |
| client typecheck | `cd client && pnpm typecheck` | 9–15 |
| pre-PR | `pr-self-review` skill (root `CLAUDE.md`, Before opening a PR) | all |

E2E is not extended in this plan. `e2e/specs/*` has no flow touching the Run Review dropdown (grep finds no `Run Review`, `Run all` or `Configure agents`), so nothing breaks there. See *Out of scope*.

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| A sequential-ordering assumption in existing integration tests breaks once children run concurrently (for example, asserting run order or events across runs). | 5 | Run the full integration lane. Any failure should be fixed by making the assertion order-independent, never by re-serialising the executor. |
| Concurrency exhausts the DB pool (`max: 10`, `server/src/db/client.ts:18`) with many agents, since each child runs several sequential queries. | 5 | Queries queue on the pool rather than fail. The spec requires no cap (NFR-3). Note it in `server/INSIGHTS.md` via `engineering-insights` if observed. |
| A provider rate-limits N simultaneous LLM calls, so several children fail together. | 5 | The failures are isolated per child and surface as `no_result` / partial. That is by design, and the spec accepts it. |
| `effectiveRunCost` shows a failed run with 0 tokens as `$0`. | 6 | Use the dedicated `failedRunCost` helper, which returns `null`. A unit test asserts it. |
| The promoted drawer or card breaks PR-page tests through moved relative imports. | 10 | Use `git mv`, rewrite to `@/` imports, and run the full client suite before continuing. |
| The physical shared copy drifts, and the client CI fails before install. | 2 | Copy whole files after every server-side contract edit. `diff -r` gates the step. |
| A Next route clash between `multi-agent/new` and `multi-agent/[number]`. | 14, 15 | A static segment wins over a dynamic one in the App Router. `[number]/page.tsx` also treats a non-numeric value as "not found". |
| Unbounded `agentIds` length. | 4 | Each id must be an enabled workspace agent and ids are deduped, so the length is bounded by the enabled-agent count. The route's rate limit still applies. |
| A forgotten mock provider makes integration tests live and billed. | 16 | Override every provider used by test agents (`server/INSIGHTS.md:42-52`). Run once with `env -u OPENROUTER_API_KEY`. |
| `RULE-VENDOR` warning on `client/src/vendor/ui/nav.ts`. | 13 | Accepted, with the `context`/`eval` precedent. Identity colour tokens deliberately go in `client/src/app/globals.css` instead of `vendor/ui/styles.css`. |

## Out of scope

- `Reply to author`. The actual behaviour of `Learn` (displayed and disabled only).
- Browsing earlier parent runs of a PR. There is no route by parent id.
- Cancelling a whole parent run. Per-child cancel keeps working via the existing `POST /runs/:id/cancel`.
- Any change under `reviewer-core/`, `ci/`, `agent-runner/` or `mcp/`. Recording partial token usage for failed runs (needs `reviewer-core`; see Q3).
- Worktree-based execution. Fan-out is in-process.
- An aggregate per-parent SSE stream. Each column subscribes to its own run's existing stream (FR-19).
- New e2e browser flows for Multi-Agent Review.
- Agent icon/colour as stored agent fields. Identity is derived client-side (OQ-2 default).
- Agent Performance, Memory and CI Runs pages, and a `GLOBAL` sidebar section. The new nav item goes in `WORKSPACE`.

## Open questions

- **Q1 (OQ-5) — RESOLVED by the user.** A parent multi-agent run is created in all three cases: a multi-agent picker run, "Run all enabled", and a 1-agent picker run. `{agentIds}` and `{all:true}` both create a parent; the legacy `{agentId}` (MCP, existing tests) does not. Consequence: every PR-page run shows up in Multi-Agent Review.
- **Q2 (OQ-6) — RESOLVED by the user.** The area's "latest" is scoped to the **current repository** (`GET /repos/:id/multi-agent/latest`, Step 8; landing, Step 13).
- **Q3 — RESOLVED by the user.** Accept the limitation for this implementation: failed runs record no cost, so "+ $X on failed runs" will rarely show. Partial-usage recording on failure (needs `reviewer-core`) is a possible follow-up, not part of this plan.
- **Q4 — default applied (user asked what it means; no explicit choice).** With fewer than 2 columns the disagreement block is **not rendered at all** (no rows, no placeholder text). FR-15's "toggle off lists every grouped location" applies only with 2 or more columns.

## Handoff

**Option A — single agent pass (`implementer`).** Hand `docs/plans/multi-agents-review.plan.md` to `implementer` (or via the `implement` skill: `/implement docs/plans/multi-agents-review.plan.md`). It executes Steps 1–17 in order, including the tests in 16–17, and runs the *Test plan* commands after Steps 5, 8, 10 and 17. Then `architecture-reviewer` and `security-reviewer` run (the `implement` skill does this). Security is triggered by the new public routes, workspace scoping and agent-id validation in Steps 4, 7 and 8.

**Option B — multi-agent fan-out.**
1. `implementer`: Steps 1 → 2 → 3 → 4 → 5 (server write path). Gate: server typecheck + depcruise + `diff -r`.
2. `implementer`: Steps 6 → 7 → 8 (server read path). It can start once Step 2 is done, in parallel with 3–5 if a second implementer is available. Both edit only disjoint files, except `server/src/modules/index.ts`, which only Step 8 touches.
3. `test-writer`: Step 16 after Steps 5 and 8.
4. `implementer`: Steps 9 → 10 → 11 → 12 → 13 → 14 → 15 (client). It can start after Step 2. It needs Step 8's endpoints only for manual verification, not for typecheck.
5. `test-writer`: Step 17 after Step 15.
6. `architecture-reviewer` over the whole diff (onion layering, frontend placement, contract sync). `security-reviewer` over Steps 4, 7 and 8 (tenant scoping on every new query and route, server-side enabled-agent validation, untrusted LLM text rendered as text in Steps 14–15).
7. Bounded fix loop back through `implementer`, then `plan-verifier` against the AC table in *Requirements*.
