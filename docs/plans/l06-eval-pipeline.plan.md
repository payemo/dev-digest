# Development Plan: L06 Eval pipeline — regression harness for reviewer agents

**Branch:** `hw06-evals-feature` · **Date:** 2026-10-07
**Packages touched:** server · client · shared (both vendored copies). `reviewer-core` is consumed **unchanged**.
**Estimated steps:** 30 · **Migration required:** yes (generated via `pnpm db:generate`) · **Contract change:** yes (eval contracts reshaped; their only consumer today is `server/test/contracts.test.ts`)
**Execution mode:** multi-agent, fixed by the caller (not asked again).
- `implementer` owns every code step: S1–S15 and S19–S27.
- `test-writer` owns the test steps: S16, S17, S18 and S28.
- `architecture-reviewer` (S29) and `security-reviewer` (S30) run as review passes after implementation. The security lane triggers because the plan adds new public routes, workspace-scoping logic, and untrusted text (frozen diffs) that reaches a model (`.claude/skills/pr-self-review/routing.md:68`).
- **Nothing is committed or pushed by the pipeline.** Every change stays uncommitted in the working tree. No step runs `git commit`, `git push`, `git stash` or `git checkout`.

## Requirements

Source: [`specs/04-eval-pipeline.md`](../../specs/04-eval-pipeline.md). It has 28 FRs and AC-1 to AC-84, with no open questions and no `[NEEDS CLARIFICATION]` marker. It is registered as *draft* at `specs/README.md:60`. It is a `spec-creator` spec, so its FR and AC IDs are used as given and not re-reviewed. The caller added these constraints:

- Nothing is pushed or committed.
- `cd server && pnpm verify:l06` must exist and pass (AC-77 to AC-79).
- `server/package.json` must be checked with `git ls-files -v` before it is edited (see S15). At planning time it reads `H server/package.json`, which means a normally tracked file. It is **not** skip-worktree, whatever root `CLAUDE.md` Gotchas says.
- Migrations are generated only, never hand-edited.
- Contracts are copied byte-for-byte between server and client.
- Scoring is pure code.
- A run is a background run, limited to one per agent, and a run cut off by a restart ends as failed.
- The mockups are at `/tmp/claude-1000/-home-darks-projects-web-dev-digest/33c3fe18-0d5f-4ad8-beff-e89f5d46e0c3/images/1.png` through `8.png`.
- The seed needs at least 8 cases, covering both kinds, with self-contained fixtures.
- Tests are typological.
- Promote does **not** restore skill links. The modal warns instead (AC-69).

The mockups were read: (1) finding card, (2) positive-case modal, (3) dashboard, (4) agent detail, (5) compare modal, (6) Evals tab, (7) hand-made editor, (8) negative-case modal.

| AC-ID | Covered by step |
|---|---|
| AC-1, AC-2, AC-3 | S24 (S20 copy). Test: S28 |
| AC-4, AC-5 | S8 (draft), S11 (seed endpoint), S23 (modal). Test: S18, S28 |
| AC-6 | S2 (columns), S11. Test: S18 |
| AC-7 | S2 (unique index), S11. Test: S18 |
| AC-8, AC-9, AC-10 | S8, S23. Test: S16, S28 |
| AC-11, AC-12, AC-13 | S8, S23. Test: S16, S28 |
| AC-14, AC-15, AC-16 | S8 (slug), S11 (uniqueness suffix). Test: S16, S18 |
| AC-17 | S8, S11 (input is copied, never referenced). Test: S18 |
| AC-18 | S23. Test: S28 |
| AC-19 | S8 (`isCitable`), S11 (refusal). Test: S16, S18 |
| AC-20, AC-21, AC-22, AC-23 | S1 (shape rules), S23. Test: S16, S28 |
| AC-24 | S11 (single-case run), S23 (run on save). Test: S28 |
| AC-25 | S2 (`case_id` has no FK), S9. Test: S18 |
| AC-26 | S7 (N/M rule). Test: S16 |
| AC-27, AC-28 | S8 (deltas), S22 (tiles), S25. Test: S28 |
| AC-29, AC-30 | S8 (list item), S25. Test: S28 |
| AC-31 | S9, S25. Test: S18 |
| AC-32, AC-33, AC-34 | S4, S8 (skill snapshot), S10 (pinning). Test: S18 |
| AC-35 | S11. Test: S18 |
| AC-36 to AC-50 | S7. Test: S16 (AC-36 also S18) |
| AC-51, AC-52, AC-53, AC-54 | S26. Test: S28 |
| AC-55, AC-56 | S8 (trend), S27. Test: S16, S28 |
| AC-57, AC-58, AC-59 | S8 (`precisionDip`), S27. Test: S16, S28 |
| AC-60 to AC-65 | S8 (`compareRuns`), S27. Test: S16, S18, S28 |
| AC-66, AC-67, AC-68, AC-69 | S4 (`promoteVersion`), S11, S27. Test: S18, S28 |
| AC-70, AC-71 | S4 (`ensureVersionSnapshot`), S10. Test: S18 |
| AC-72, AC-73, AC-74 | S14 (seed). Test: S18 |
| AC-75, AC-76 | S13 (prompt-keyed mock). Test: S18 |
| AC-77, AC-78, AC-79 | S15 (script). Test: S16, S17, S18 |
| AC-80 to AC-84 | S10, S11, S12 (boot reaper), S19 (polling), S22, S25–S27. Test: S18, S28 |

No AC is deferred.

## Recommendation

**The spec's approach is right, and `reviewer-core` needs no change.** `reviewPullRequest` already returns grounded findings, the dropped findings with reasons, tokens and cost (`reviewer-core/src/review/run.ts:108-127`, `:211-226`). That is everything the scorer needs:

- emitted = kept + dropped
- grounded = kept

The plan makes five refinements. None of them changes a requirement:

- **R1 — Run in the background with fire-and-forget, not through `container.jobs`.** onion-architecture §14 says slow work goes through the JobRunner. But that runner is one shared instance built with a 120 s whole-job timeout and 2 retries (`server/src/platform/jobs.ts:51-53`, `server/src/platform/container.ts:101`).
  - An N-case eval run would be killed at 120 s.
  - Worse, it would be **re-run from scratch** on retry, paying for every case again.

  The plan copies the precedent reviews already set instead (`server/src/modules/reviews/service.ts:144-148`):
  1. Create the `eval_agent_runs` row (the durable record) first.
  2. `void runner.execute(...)` in the service.
  3. Each case gets its own timeout and bounded concurrency (`p-queue`, already a dependency at `server/package.json:35`; `withTimeout` at `server/src/platform/resilience.ts:13`).
  4. A boot reaper fails orphans, the same as `app.ts:80-85`.

  S29 should accept this as a documented deviation, not flag it.
- **R2 — "One in-flight run per agent" is enforced by the database, not only in memory.** A partial unique index on `eval_agent_runs(agent_id) WHERE status = 'running'` makes AC-82 hold even with two concurrent POSTs. The service catches the conflict and re-attaches to the existing run. This is a new Drizzle pattern in this repo, so see the Risks table.
- **R3 — The linked-skill "content state" is a version plus a content hash, and the snapshot stores the rendered block.** A skill's version bumps **only on a body change** (`server/src/modules/skills/repository.ts:124-136`). But the prompt block also renders the name and the description (`server/src/modules/reviews/helpers.ts:125-131`), and the enabled flag decides whether the block is injected at all (`:141-151`). The snapshot therefore stores, per linked skill, in link order: `{skill_id, name, version, enabled, order, content_hash, rendered}`.
  - The run injects `rendered` from the snapshot. That makes AC-33 and AC-34 hold even if the skill is edited mid-run.
  - Compare diffs on `content_hash` and `enabled`, so AC-62 and AC-71 catch description edits that leave the version unchanged.
- **R4 — Extend the existing per-case table instead of adding a third one.** `eval_runs` already holds "one row per single case execution" (`server/src/db/schema/eval.ts:22-35`), so it becomes the **per-case result** table. A new `eval_agent_runs` table is the agent-wide run. `eval_runs.case_id` loses its cascading FK (`eval.ts:24-26`), so deleting a case keeps history (AC-25). Every new column on `eval_runs` is **nullable**, so the migration applies even to a dev DB that holds stray rows.
- **R5 — The contract parity check is a byte comparison, enforced twice.** `client/src/vendor/shared` is a **physical copy**, not an alias (`.github/workflows/client.yml:6-11`), and CI already runs `diff -r` on it (`:47-53`). For AC-78, a server-lane test compares the two copies of `contracts/knowledge.ts`, `contracts/eval-ci.ts` and `index.ts` byte-for-byte. That way `pnpm verify:l06` fails locally on drift without waiting for the client workflow.

**Something the user may want to know (not a plan step):** root `CLAUDE.md` (Gotchas), `TESTING.md:92-94` and `server/CLAUDE.md:86-87` all say `server/package.json` is `skip-worktree`. In this checkout `git ls-files -v` shows it as `H`, a normal tracked file. The plan leaves those docs alone (see *Out of scope*). S15 re-checks the flag before editing. The finding is worth an `engineering-insights` entry once it is confirmed.

## Goal

Any accepted or dismissed finding becomes a frozen, agent-owned eval case (`must_find` / `must_not_flag`) in two clicks. Users can also create, edit, delete and single-run cases by hand from a new agent **Evals** tab.

**Run all evals** starts a background run. The run is pinned to the agent version and to a snapshot of the linked skills, and its progress (k / n) survives a reload. Each case goes through the real review engine and grounding gate with only its frozen input. Pure-code scoring produces recall, precision and citation_accuracy, each of which may be not-applicable. The results feed the Evals tab, a sidebar **Eval Dashboard**, a per-agent detail page (with trend, precision-dip banner and Compare with prompt diff and skill diff), and **Promote vN**.

`cd server && pnpm verify:l06` passes hermetically on a fresh testcontainers DB.

## Inputs read

| File | What it constrained |
|---|---|
| `specs/04-eval-pipeline.md` | Every FR, AC, NFR and edge case |
| `CLAUDE.md` (Non-default conventions, Do not touch, Gotchas) | pnpm for server/client. One contract source. Generated migrations only. No lockfile edits. Typological tests. `*.it.test.ts` split. |
| `server/CLAUDE.md:36-49`, `:53-55`, `:61-62`, `:79-83` | PascalCase const + type contracts. camelCase columns, snake_case wire. Zod route schemas. `.it.test.ts`. No migration hand-edits. |
| `server/INSIGHTS.md:32-40` | `now()` hardcodes `created_at`, so `updated_at`, `started_at` and `finished_at` must spell out `timestamp(name, …)` |
| `server/INSIGHTS.md:42-52` | An unmocked provider makes a hermetic test live and billed. Seeded agents use `openrouter` (`server/src/db/seed.ts:14`), so every eval test overrides `openrouter`, `openai` **and** `anthropic`. |
| `server/INSIGHTS.md:77-86` | Skill bodies are injected as **trusted** text (not wrapped). The eval run injects them exactly as reviews do, with no new trust path. |
| `server/INSIGHTS.md:88-98` | Stats must exclude pre-feature rows. Every eval query keys on `eval_agent_runs` or a non-null `agent_id`, so legacy `eval_runs` rows never surface. |
| `server/INSIGHTS.md:100-112` | Cross-module logic goes through Container getters. The eval module reaches agents and reviews data only via `container.agentsRepo` / `container.reviewRepo`. |
| `server/INSIGHTS.md:124-131` | Purity grep gates trip on comments. Phrase the purity comments in `scoring.ts`/`helpers.ts` without the forbidden tokens. |
| `server/INSIGHTS.md:186-197` | drizzle-kit prompts interactively when one pass drops **and** adds columns. The plan only adds columns and alters a constraint. If a prompt appears anyway, split the change into two passes. |
| `server/INSIGHTS.md:240-247` | Integration fixtures go stale when the shared seed changes. S14 adds a new demo PR, so the whole `.it` lane re-runs after S14. |
| `client/CLAUDE.md:28-49`, `:56-58`, `:62-63` | Folder layout. snake_case DTOs. Hooks only (no `fetch` in components). Client tests can't catch shape drift. Never rebuild vendored primitives. |
| `client/INSIGHTS.md:25-32`, `:81-88` | `Badge` is a `<span>` with no `title`, `Chip` is a `<button>`. Wrap a badge for tooltips. |
| `client/INSIGHTS.md:48-57` | Nav labels live in both `vendor/ui/nav.ts` and `messages/en/shell.json` (`nav.eval` already exists at `shell.json:24`) |
| `client/INSIGHTS.md:59-68` | The existing `messages/en/eval.json` is pre-scaffolded copy and only a starting point |
| `client/INSIGHTS.md:125-131` | No `user-event`. Tests use `fireEvent`. |
| `client/INSIGHTS.md:133-144` | `MetricCard.suffix` is for "%" only. Put explanatory text in a separate span. |
| `client/INSIGHTS.md:146-152` | `diffLines` needs trailing-newline normalisation. Reuse the existing `computeLineDiff`, which already does it. |
| `client/INSIGHTS.md:154-161` | Multi-line textarea values are asserted via `.value`, not `getByDisplayValue` |
| `client/INSIGHTS.md:163-170` | `--info` is grey. Use `--accent` / `--sugg` for blue. |
| `reviewer-core/CLAUDE.md:5-9`, `:55-56` | The engine stays pure with an injected provider. Nothing in it changes. |
| `reviewer-core/INSIGHTS.md:17-27` | Recorded prompt slots omit section headings. Irrelevant to scoring, so it is noted only. |
| `INSIGHTS.md` (root) | Nothing relevant (nothing under `scripts/`, workflows or `.claude/` changes) |
| `TESTING.md:8-24`, `:76-77`, `:88-97` | Typological strategy. Verbatim lane commands. Mocks in `server/src/adapters/mocks.ts`. |
| `.claude/skills/onion-architecture/SKILL.md` (§1–§3, §5, §11, §14) | Layering of the new module. The §14 deviation is in R1. |
| `.claude/skills/frontend-code-organization/SKILL.md` §1, §6 | Shared components go to `src/components/<kebab>` on the second route consumer. Helpers go to `src/lib/` on the second unrelated consumer. |
| `.claude/skills/pr-self-review/routing.md:12-72` | Skill lookup (see *Skills to be applied*) |
| `.claude/skills/pr-self-review/repo-rules.md:22-31`, `:116-134`, `:186-192` | `RULE-CONTRACT-SYNC`, `RULE-CONTRACT-BREAK`, `RULE-VENDOR` (nav.ts), `RULE-SKIPWORKTREE` (package.json, expected here) |
| `.github/workflows/client.yml:6-11`, `:47-53` | The client contracts are a physical copy, checked with `diff -r` |

## Architectural constraints binding this change

- **A new module is registered statically:** one import plus one entry. Source: `server/src/modules/index.ts:18-47`. Bind the import as `evals` (the identifier `eval` is invalid as a binding in ESM strict mode).
- **Routes:** `withTypeProvider<ZodTypeProvider>()`, the service built once, `schema: { params, body, querystring }`, and `getContext` first in every handler. Source: `server/src/modules/agents/routes.ts:70-143`. `IdParams` is at `server/src/modules/_shared/schemas.ts`.
- **Only `repository.ts` touches Drizzle.** Sources: `server/.dependency-cruiser.cjs:107-161` (`no-db-in-service`, `no-schema-in-helpers`, `no-container-in-helpers`, `no-db-outside-repository`). This also applies to new non-standard files like `runner.ts` and `scoring.ts`, which fall under `no-db-outside-repository` (`:142-161`).
- **No other module's repository may be named**, even as a type. Use `Container['agentsRepo']` / `Container['reviewRepo']`. Source: `server/.dependency-cruiser.cjs:247-259`. Agents and review data come from `container.agentsRepo` / `container.reviewRepo` (`server/src/platform/container.ts:110-116`).
- **Pure functions may be shared across modules through `helpers.ts`** (onion-architecture §11). `taskLine` and `selectInjectableSkills`/`renderSkillBlock` are imported from `server/src/modules/reviews/helpers.ts:83`, `:125`, `:141`. `parseUnifiedDiff` comes from `server/src/adapters/git/diff-parser.ts:14`. Precedent: `server/src/modules/reviews/diff-loader.ts:3`.
- **No Fastify outside the edge.** Source: `server/.dependency-cruiser.cjs:194-201`. `runner.ts` and `service.ts` take a local structural logger type, like `Logger` in `server/src/modules/reviews/run-executor.ts:20-25`.
- **The engine entry point is `reviewPullRequest`** (`reviewer-core/src/review/run.ts:136`), with the input shape used at `server/src/modules/reviews/run-executor.ts:244-289`. For eval, pass **only** `systemPrompt`, `model`, `diff`, `llm`, `strategy`, `skills` (when non-empty), `prDescription` (when non-empty) and `task`. Never pass `callers`, `repoMap`, `specs`, `intent` or `memory` (NFR-1).
- **The citation gate is `groundFindings`** (`reviewer-core/src/grounding.ts:52`). The file-only kinds are in `FULL_FILE_KINDS` (`:16`). The seeding citability check reuses this gate with `kind: 'finding'`, so line ranges are always checked (AC-19, including file-only kinds).
- **Cost:** a null provider cost is derived through `effectiveRunCost` + `container.priceBook.estimate` (`server/src/platform/run-cost.ts:31-34`, used at `server/src/modules/reviews/service.ts:77-84`). If the cost is still null, it shows as "—" (NFR-3).
- **Errors:** use `NotFoundError`, `ValidationError` (422) and `ConflictError` (409) from `server/src/platform/errors.ts:19-35`. A service never throws a bare `Error` (onion-architecture §12).
- **Agent versions:** `AgentsRepository.snapshotVersion` writes `config_json` with provider, model, system prompt, output schema, strategy, CI gate, repo-intel flag and skill ids (`server/src/modules/agents/repository.ts:164-189`). Seeded agents have no snapshot (`server/src/db/seed.ts:345-348`). Edits bump the version only on a config change (`repository.ts:126-161`).
- **Migrations:** edit `server/src/db/schema/eval.ts`, then run `cd server && pnpm db:generate`. Never touch `server/src/db/migrations/**` by hand (`CLAUDE.md` Do not touch; `server/CLAUDE.md:79-83`). The schema barrel `server/src/db/schema.ts:23`, `:38`, `:81-82` must list the new table.
- **Contracts:** edit `server/src/vendor/shared/contracts/*`, then copy the **whole** `server/src/vendor/shared` directory over `client/src/vendor/shared` byte-for-byte (`.github/workflows/client.yml:47-53`). `mcp/` reads the server copy by alias (`mcp/tsconfig.json:25-26`) and uses no eval shape.
- **Client:**
  - One TanStack hook per call in `client/src/lib/hooks/*`, with keys from `client/src/lib/hooks/keys.ts`.
  - `next-intl` loads every `messages/en/*.json` file automatically.
  - Never import another route's `_components/` (frontend-code-organization §1).
  - Active-nav detection already maps `/eval*` to the key `eval` (`client/src/components/app-shell/helpers.ts:35`), so the routes are `/eval` and `/eval/[agentId]`.

## Skills to be applied

| Path to be touched | Lane | Skills (per routing.md) |
|---|---|---|
| `server/src/vendor/shared/contracts/{knowledge,eval-ci}.ts`, `server/src/vendor/shared/index.ts` | backend | zod + `RULE-CONTRACT-SYNC`, `RULE-CONTRACT-BREAK` (routing.md:23) |
| `client/src/vendor/shared/**` (byte copy) | frontend vendor | none. `RULE-VENDOR`/`RULE-CONTRACT-SYNC` (routing.md:44) |
| `server/src/db/schema/eval.ts`, `server/src/db/schema.ts` | backend | drizzle-orm-patterns, postgresql-table-design (routing.md:20) |
| `server/src/db/migrations/**` (generated) | none | `RULE-MIGRATION` only (routing.md:22) |
| `server/src/db/rows.ts`, `server/src/db/seed.ts`, `server/src/db/seed-eval.ts` (new) | backend | drizzle-orm-patterns (routing.md:21; `seed-eval.ts` is the nearest analogue of `seed-prompts.ts`) |
| `server/src/modules/agents/repository.ts` | backend | onion-architecture, drizzle-orm-patterns (routing.md:17) |
| `server/src/modules/reviews/helpers.ts` | backend | onion-architecture (routing.md:16) |
| `server/src/modules/eval/{service,helpers}.ts` | backend + cross-cutting | onion-architecture (routing.md:16). security by content (workspace scoping, routing.md:68). zod by content (`safeParse`). |
| `server/src/modules/eval/{runner,scoring,constants}.ts` | backend | No exact row. Nearest is routing.md:16 (`run-executor.ts` / `helpers.ts` analogues), so onion-architecture. |
| `server/src/modules/eval/repository.ts` | backend | onion-architecture, drizzle-orm-patterns (routing.md:17) |
| `server/src/modules/eval/routes.ts` | backend + cross-cutting | fastify-best-practices, onion-architecture, zod (routing.md:14). **security**: new public routes (routing.md:68). |
| `server/src/modules/index.ts`, `server/src/app.ts` | backend | fastify-best-practices, onion-architecture (routing.md:15) |
| `server/src/adapters/mocks.ts` | backend | onion-architecture (routing.md:19) |
| `server/package.json` | no lane | `RULE-SKIPWORKTREE` warning, expected and justified (see S15) |
| `server/test/eval-*.test.ts`, `server/test/eval-pipeline.it.test.ts` | backend | none. `RULE-IT-SUFFIX` (routing.md:25). |
| `client/src/lib/hooks/{eval,keys,index}.ts` | frontend | react-best-practices, frontend-code-organization (routing.md:39) |
| `client/src/lib/line-diff.ts` (new), `client/src/lib/eval-format.ts` (new) | frontend | frontend-code-organization (routing.md:40) |
| `client/messages/en/{eval,agents}.json` | frontend | frontend-code-organization (routing.md:41) |
| `client/src/components/eval-case-modal/**`, `client/src/components/eval-metrics/**` (new folders) | frontend | react-best-practices, frontend-code-organization (routing.md:38) |
| `client/src/app/eval/page.tsx`, `client/src/app/eval/[agentId]/page.tsx`, `client/src/app/agents/[id]/page.tsx` | frontend | next-best-practices, frontend-code-organization (routing.md:36) |
| `client/src/app/eval/**/_components/**`, `client/src/app/agents/[id]/_components/AgentEditor/**`, `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/**`, `client/src/app/skills/**/DiffModal/helpers.ts` | frontend | react-best-practices, frontend-code-organization (routing.md:37, :43) |
| `client/src/vendor/ui/nav.ts` | frontend vendor | none. `RULE-VENDOR` warning. Precedent: commits `f9cf93b`, `3e8b776` and `f64a7b4` each added a nav item here. |
| `client/**/*.test.tsx` | frontend | react-testing-library (routing.md:42) |
| `docs/plans/l06-eval-pipeline.plan.md` (this file) | no lane | none (routing.md:52). No Mermaid block. |

Loaded for this plan: **onion-architecture**. It decided where the runner and scorer live, the Container-only cross-module access, the §14 deviation in R1, and typed errors. frontend-code-organization §1 and §6 were read rather than loaded. They decided the two `src/components/*` promotions and the `src/lib/line-diff.ts` promotion. zod, drizzle, fastify and security were not loaded, because none of them changes a decision here. `typescript-expert` should not trigger: no `any`, no `as unknown as`, no conditional types.

---

## Design decisions (settled here so no step re-decides them)

- **D1 — Tables.**
  - **`eval_cases` (edit), adding:**
    - `kind text enum('must_find','must_not_flag') NOT NULL DEFAULT 'must_find'`
    - `forbidden_location jsonb` (nullable, `{file,start_line,end_line}`)
    - `source_finding_id uuid` (nullable, **no FK**, so the link survives deletion of the finding)
    - `source_decision text enum('accepted','dismissed')` (nullable)
    - `created_at` via `now()`
    - `updated_at` spelled out as `timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()` (`server/INSIGHTS.md:32-40`)
    - unique index `(owner_kind, owner_id, name)` (AC-16)
    - partial unique index `(owner_id, source_finding_id) WHERE source_finding_id IS NOT NULL` (AC-7)
  - **`eval_agent_runs` (new):**
    - `id`
    - `workspace_id` → workspaces (cascade)
    - `agent_id` → agents (cascade, the edge case "Agent deleted")
    - `agent_version int NOT NULL`, `provider text`, `model text NOT NULL`
    - `skill_snapshot jsonb NOT NULL`, `case_ids jsonb NOT NULL`
    - `status text enum('running','completed','failed') NOT NULL`
    - `cases_total`, `cases_done`, `passed`, `errored` (int NOT NULL default 0)
    - `recall`, `precision`, `citation_accuracy` (double, **nullable** = not applicable)
    - `cost_usd` (double nullable), `duration_ms` (int nullable)
    - `started_at` (spelled out, default now), `finished_at` (nullable)
    - `error text`
    - index `(agent_id, started_at)`
    - partial unique index `(agent_id) WHERE status = 'running'` (R2)
  - **`eval_runs` (edit, now the per-case result):**
    - `case_id` becomes nullable and loses its FK (AC-25)
    - adds `suite_run_id uuid` → eval_agent_runs (cascade, nullable; null = a single-case run)
    - adds `agent_id uuid` → agents (cascade, nullable in the DB, always set by the app)
    - adds `agent_version int`, `case_name text`, `case_kind text`, `status text enum('passed','failed','errored')`, `reason text`
    - adds `emitted int`, `grounded int`, `expected_n int`, `got_m int`, `matched jsonb`
    - index `(case_id, ran_at)`, index `(suite_run_id)`
    - Existing columns stay (`actual_output` = the grounded findings, `pass`, the per-case metric columns, `duration_ms`, `cost_usd`). Nothing is dropped, so drizzle-kit raises no rename prompt.
- **D2 — Contracts.** Everything goes in the existing files, then both copies are synced.
  - **`knowledge.ts`:**
    - `EvalExpectationKind = z.enum(['must_find','must_not_flag'])`
    - `EvalExpectedFinding = { severity: Severity, category: Category, title: z.string().min(1), file: z.string().min(1), start_line: int ≥1, end_line: int ≥1 optional }`, refined so `end_line ≥ start_line`. Use the existing finding enums from `contracts/findings.ts:11-63`.
    - `EvalLocation = { file, start_line, end_line }`
    - `EvalPrMeta = { number: int nullish, title: string, description: string nullish, author: string nullish }`
    - `EvalInputFile = { path: string, note: string nullish }`
    - `EvalSkillSnapshotEntry = { skill_id, name, version: int, enabled: bool, order: int, content_hash: string, rendered: string }`
    - `EvalCaseStatus = z.enum(['passed','failed','errored'])`
    - `EvalRunStatus = z.enum(['running','completed','failed'])`
    - `EvalCase` gains `kind`, `forbidden_location: EvalLocation.nullable()`, `source_finding_id: string.nullable()`, `source_decision: enum.nullable()`, `created_at`, `updated_at`. `input_files` becomes `z.array(EvalInputFile)`, `input_meta` becomes `EvalPrMeta`, and `expected_output` becomes `z.array(EvalExpectedFinding)`.
    - `EvalRun` metrics become `z.number().min(0).max(1).nullable()`. The same applies to the `EvalDashboard`, `current`/`delta` and `EvalTrendPoint` metric fields in `eval-ci.ts`.
  - **`eval-ci.ts`:**
    - **`EvalCaseInput`.** Fields: `name` (min 1, max 120), `kind`, `input_diff` (min 1), `input_files` (default []), `input_meta`, `expected_output`, `forbidden_location` (nullish), `notes`. Rules:
      - `must_find` ⇒ `expected_output.length ≥ 1` and no `forbidden_location`
      - `must_not_flag` ⇒ `expected_output.length === 0`

      Use `superRefine` with path-specific messages. The client uses the same schema for live validation (AC-20, AC-22). `owner_kind`/`owner_id` come from the route, not the body.
    - `EvalCaseSeed` = `{ decision: 'accepted'|'dismissed', existing: EvalCaseRecord.nullable(), draft: EvalCaseInput }`
    - `EvalCaseFromFindingInput` = `{ name?: string, notes?: string, expected_output?: EvalExpectedFinding[] }`. These are overrides only. The input is always re-frozen on the server.
    - `EvalCaseResult` = `{ id, case_id: nullable, case_name, case_kind, suite_run_id: nullable, agent_version, status, reason: nullable, emitted, grounded, expected_n, got_m, matched: z.array(z.number().int()), findings: z.array(Finding), duration_ms, cost_usd: nullable, ran_at }`
    - `EvalCaseRecord` = `EvalCase & { last_result: EvalCaseResult.nullable(), source_available: boolean }`
    - **`EvalAgentRun`.** Fields:
      - `id`, `agent_id`, `agent_version`, `provider`, `model`, `status`
      - `skill_snapshot: z.array(EvalSkillSnapshotEntry)`, `case_ids`
      - `cases_total`, `cases_done`, `passed`, `errored`
      - `recall`, `precision`, `citation_accuracy` (nullable)
      - `cost_usd` (nullable), `duration_ms` (nullable)
      - `started_at`, `finished_at` (nullable), `error` (nullable)

      For the wire, strip `rendered` from snapshot entries via `EvalSkillSnapshotEntry.omit({ rendered: true })` (NFR-2/size). Only the server reads `rendered`.
    - `EvalAgentRunDetail` = `EvalAgentRun & { results: EvalCaseResult[] }`
    - `EvalMetricTriple` = `{ recall, precision, citation_accuracy }`, all nullable
    - `EvalPrecisionDip` = `{ points: int, version: int, recall_delta: number.nullable(), citation_delta: number.nullable() }`
    - `EvalAgentDetail` = `{ agent_id, agent_name, model, cases_total, runs_in_window: int, window_days, latest: EvalAgentRun.nullable(), delta: EvalMetricTriple, trend: EvalTrendPoint[], recent_runs: EvalAgentRun[], in_flight: EvalAgentRun.nullable(), alert: EvalPrecisionDip.nullable() }`
    - `EvalAgentSummary` = `{ agent_id, agent_name, model, cases_total, latest: EvalAgentRun.nullable(), recall_series: z.array(z.number()), in_flight: boolean }`
    - `EvalWorkspaceDashboard` = `{ agents: EvalAgentSummary[], recent_runs: z.array(EvalAgentRun.extend({ agent_name })) }`
    - `EvalSkillDiff` = `{ added: string[], removed: string[], reordered: boolean, changed: z.array(z.object({ name, from_version, to_version })) }`
    - **`EvalCompare`.** Fields:
      - `old`, `new` (each an `EvalAgentRun`, ordered older → newer)
      - `delta: EvalMetricTriple & { cost_usd: nullable }`
      - `old_prompt`, `new_prompt` (strings), `same_prompt: boolean`
      - `model_change: { from, to }.nullable()`
      - `skill_diff: EvalSkillDiff`
      - `no_config_change: boolean`
      - `case_set: { same: boolean, only_old: int, only_new: int }`
      - `promote: { version: int, available: boolean, skill_mismatch: boolean }`
    - `EvalPromoteInput` = `{ run_id: uuid }`
    - `EvalPromoteResult` = `{ agent: Agent, new_version: int, source_version: int, skill_mismatch: boolean }`
    - `EvalStartResult` = `{ run: EvalAgentRun, attached: boolean }`
    - `EvalRunAllResult` = `{ runs: EvalStartResult[] }`

    The old `EvalRunRecord`/`EvalRunResult`/`EvalDashboard`/`EvalTrendPoint` either stay (with metrics nullable) or are replaced. **Keep `EvalTrendPoint`** (nullable metrics, plus a `version: int` field). **Remove `EvalRunRecord`, `EvalRunResult` and `EvalDashboard`**, which have zero consumers (repo-wide grep at planning time: only `server/test/contracts.test.ts` imports `EvalRun`). Update the barrel doc comment at `server/src/vendor/shared/index.ts:8`.
- **D3 — Expected-output and seeded-input rules.**
  - **Seeded `must_find`:** `expected_output = [{severity, category, title, file, start_line, end_line?}]`, with `end_line` only when it differs from `start_line` (FR-3).
  - **Seeded `must_not_flag`:** `expected_output = []` and `forbidden_location = {file, start_line, end_line}` (FR-4).
  - **Frozen input (FR-6):**
    - `input_diff` = `diff --git a/<f> b/<f>\n--- a/<f>\n+++ b/<f>\n<patch>`, built from the stored `pr_files.patch` of the finding's file (same text shape as `server/src/modules/reviews/diff-loader.ts:33-43`)
    - `input_files` = `[{ path: file, note: 'reference only — not sent to the agent' }]`
    - `input_meta` = `{ number, title, description: pull.body, author }`

    The copy is by value, so later changes can't reach it (AC-17).
  - **Refusal (422, nothing saved, AC-19):** when the patch is null or missing, when the expectation is not citable via `isCitable`, when the finding has no decision (AC-3 server side), or when the review has no `agent_id`. That last case applies to the legacy PR #482 sample review (`server/src/db/seed.ts:121-133`), which is inserted with no agent.
- **D4 — Slugs (FR-5).**
  - Prefix `must-find-` for positive cases and `no-` for negative ones. The negative prefix matches mockup 8, "no-unused-import-warning".
  - Steps: lower-case, map non-`[a-z0-9]` runs to `-`, trim the hyphens, cap the total at 80, then strip the trailing `-`.
  - **Uniqueness:** if the name is taken in the agent's set, append `-2`, `-3`, … and re-truncate the base so the total stays ≤ 80 (AC-15, AC-16).
- **D5 — Pass rules and metrics** are exactly FR-14 to FR-18. Matching uses inclusive range intersection on equal file paths (`start ≤ other_end && other_start ≤ end`).
  - **Per-case N and M:**
    - `must_find`: N = expectations, M = grounded findings
    - `must_not_flag`: N = 0, and M = grounded findings matching the forbidden location. With no location, M = all grounded findings (AC-26, FR-15).
  - **Not applicable:** a metric is `null` when its denominator is 0, and errored cases are excluded from every numerator and denominator (FR-17, FR-18).
  - **Trend and tiles:**
    - trend, tiles, deltas and dashboard use `completed` runs only
    - `failed` runs appear in history with their status but never in metrics
    - a delta is `null` when either side is `null` (AC-49)
- **D6 — Precision dip (FR-21):** `points = Math.round((prev - latest) * 100)`. The banner shows iff both values are non-null and `points ≥ 1`. That gives 0.93 → 0.91 = 2 (AC-57). A rise or a drop of less than 0.5 point gives no banner (AC-58).
- **D7 — Execution.**
  - **Per-run pinning (AC-32/33):**
    1. `agentsRepo.getById`
    2. `agentsRepo.ensureVersionSnapshot(agent)`
    3. `agentsRepo.getVersion(agent.id, agent.version)`, whose `config_json` supplies `system_prompt`, `model`, `provider`, `strategy`
    4. the skill snapshot from `agentsRepo.linkedSkills` via `selectInjectableSkills`/`renderSkillBlock` (R3; `content_hash` = sha256 hex of `rendered` via `node:crypto`)
    5. the case set = every case of the agent at start, copied in memory
  - **Concurrency and timeout:** `EVAL_CASE_CONCURRENCY = 2` and `EVAL_CASE_TIMEOUT_MS = 120_000` (NFR-4).
  - **Progress:** each finished case inserts its `eval_runs` row and increments `cases_done`/`passed`/`errored` in one repository call, so a progress read is one PK select plus one indexed select (NFR-4, AC-80/81).
  - **Completion:** compute the metrics from all non-errored results, set `completed`, `finished_at`, the total cost (`null` if any scored case's cost is still `null` after `effectiveRunCost`) and `duration_ms` (wall clock).
  - **Crash inside the runner:** mark the run `failed` with an error.
  - **Single-case run (FR-13):** synchronous in the request, against the *current* version (also `ensureVersionSnapshot`) and the current skills. It inserts an `eval_runs` row with `suite_run_id = null`, so it is never part of history, trend or the dashboard (AC-35).
- **D8 — The modal shows the "Last run" line** only for a saved case with a `last_result` (AC-24/26). Format: "Last run passed|failed · expected N finding(s), got M · <duration s> · <cost or —>". An errored result reads "Last run errored · <reason>".
- **D9 — Promote (FR-23)** = `agentsRepo.promoteVersion(workspaceId, agentId, sourceVersion)` in one transaction:
  1. read the agent and the `agent_versions` row for `sourceVersion` (404 if missing)
  2. if `sourceVersion === agent.version`, throw `ConflictError` (AC-68)
  3. update `agents` with `provider`, `model`, `system_prompt`, `output_schema`, `strategy`, `ci_fail_on`, `repo_intel` from `config_json`, and `version = agent.version + 1`
  4. `snapshotVersion(tx, row, newVersion)`. Skill links are **untouched** (decision 3).

  `skill_mismatch` = whether the source run's snapshot ids/order/hash/enabled differ from a fresh snapshot of the current links (AC-69). The client shows it **before** confirming, from `EvalCompare.promote.skill_mismatch`.
- **D10 — Endpoints.** Every endpoint starts with `getContext`. Every agent, case, run and finding lookup is scoped to the workspace, and anything outside it is a 404 (NFR-8).

  | Verb + path | Body/query | Response |
  |---|---|---|
  | `GET /findings/:id/eval-case` | — | `EvalCaseSeed` (422 per D3) |
  | `POST /findings/:id/eval-case` | `EvalCaseFromFindingInput` | `EvalCaseRecord` (201 new, 200 existing) |
  | `GET /agents/:id/eval/cases` | — | `EvalCaseRecord[]` |
  | `POST /agents/:id/eval/cases` | `EvalCaseInput` | `EvalCaseRecord` (201, 409 on duplicate name) |
  | `PUT /eval/cases/:id` | `EvalCaseInput` | `EvalCaseRecord` |
  | `DELETE /eval/cases/:id` | — | `{ ok: true }` |
  | `POST /eval/cases/:id/run` | — | `EvalCaseResult` |
  | `POST /agents/:id/eval/runs` | — | `EvalStartResult` (422 when the agent has 0 cases) |
  | `GET /agents/:id/eval/runs` | `?days=` (default 30) | `EvalAgentRun[]` newest first |
  | `GET /eval/runs/:id` | — | `EvalAgentRunDetail` |
  | `GET /agents/:id/eval/detail` | `?days=` | `EvalAgentDetail` |
  | `GET /eval/dashboard` | — | `EvalWorkspaceDashboard` |
  | `POST /eval/runs/all` | — | `EvalRunAllResult` |
  | `GET /eval/compare` | `?a=&b=` (uuids) | `EvalCompare` (422 if the agents differ) |
  | `POST /agents/:id/eval/promote` | `EvalPromoteInput` | `EvalPromoteResult` |

---

## Steps

### Step 1 — Reshape the shared eval contracts (both copies)
- **Closes:** none — prerequisite (shapes for AC-20, AC-22, AC-47–49 and every endpoint)
- **Files:** `server/src/vendor/shared/contracts/knowledge.ts` (edit, the eval section at `:49-84`), `server/src/vendor/shared/contracts/eval-ci.ts` (edit, the eval section at `:15-89`), `server/src/vendor/shared/index.ts` (edit, the doc comment at `:8`). Then overwrite `client/src/vendor/shared/` with a byte-identical copy of `server/src/vendor/shared/`.
- **Change:** Add and modify the shapes exactly as in **D2**, each as a PascalCase const plus a same-named `z.infer` type. `eval-ci.ts` already imports from `./knowledge.js` and `./findings.js`. Add the missing imports (`Severity`, `Category`, `Finding`, and `Agent` from wherever `Agent` is exported) without creating an import cycle. Also update `server/test/contracts.test.ts:135-145` so its `EvalRun.parse` fixture still parses: it does today, because the nullable change only widens. **Do not** add `rendered` to any wire shape (D2).
- **Constraint:** `server/CLAUDE.md:41-44`. `.github/workflows/client.yml:47-53`. `RULE-CONTRACT-BREAK` (repo-rules.md:128-134): every consumer is updated in this same change.
- **Owner:** `implementer`
- **Done when:** `diff -r client/src/vendor/shared server/src/vendor/shared` prints nothing. `cd server && pnpm typecheck` and `cd client && pnpm typecheck` both pass. `rg -n "EvalRunRecord|EvalRunResult|EvalDashboard\b" server/src client/src mcp/src` returns nothing.

### Step 2 — Schema changes and the generated migration
- **Closes:** none — prerequisite for AC-6, AC-7, AC-16, AC-25, AC-32, AC-82
- **Files:** `server/src/db/schema/eval.ts` (edit), `server/src/db/schema.ts` (edit: add `evalAgentRuns` to the import at `:38` and to the table object near `:81-82`). New generated files under `server/src/db/migrations/` (`NNNN_<word>_<word>.sql`, `meta/NNNN_snapshot.json`, `meta/_journal.json`), produced **only** by the generator.
- **Change:**
  1. Edit `eval.ts` per **D1**. Import `agents` from `./agents` (no cycle: `agents.ts` imports only `core` and `skills`). Use `uniqueIndex(...).on(...).where(sql\`…\`)` for the two partial unique indexes (import `sql` from `drizzle-orm`). Spell out the timestamp names other than `created_at`.
  2. Run `cd server && pnpm db:generate`.
  3. If drizzle-kit prompts interactively, stop. Split the edit into two passes (constraint and nullability changes on `eval_runs` first, additions second) and regenerate (`server/INSIGHTS.md:186-197`).
  4. Read the generated SQL. It must contain `CREATE UNIQUE INDEX … WHERE`, the dropped `eval_runs_case_id_…_fk` constraint, `ALTER COLUMN "case_id" DROP NOT NULL`, and **no** `DROP COLUMN`.
- **Constraint:** `CLAUDE.md` Do not touch (no migration hand-edit, keep the generator's file name). `server/CLAUDE.md:79-83`. `RULE-MIGRATION`/`RULE-MIGRATION-MISSING` (repo-rules.md:16-17).
- **Owner:** `implementer`
- **Done when:** exactly one new migration exists alongside its snapshot and journal entry, and `git diff --stat server/src/db/migrations` shows only additions plus the `_journal.json` change. `cd server && pnpm typecheck` passes. Running `cd server && pnpm db:migrate` against the local DB succeeds. That is the one allowed local command, and it is optional if Docker is down, because S18's testcontainers run migrates a fresh DB anyway.

### Step 3 — Row types
- **Closes:** none — prerequisite
- **Files:** `server/src/db/rows.ts` (edit)
- **Change:** Export `EvalCaseRow`, `EvalAgentRunRow` and `EvalCaseResultRow` (`eval_runs`) as `typeof t.<table>.$inferSelect`, following the existing pattern in that file, so helpers can import them type-only.
- **Constraint:** onion-architecture §4.
- **Owner:** `implementer`
- **Done when:** `cd server && pnpm typecheck` passes.

### Step 4 — Agents repository: version snapshot, promote, cascade on delete
- **Closes:** AC-66, AC-67, AC-68 (server), AC-70; the "Agent deleted" edge case
- **Files:** `server/src/modules/agents/repository.ts` (edit)
- **Change:**
  - `ensureVersionSnapshot(agent: AgentRow): Promise<void>` calls the existing private `snapshotVersion` in a transaction for `agent.version`. That is already `onConflictDoNothing` (`:188`), so it is idempotent. This closes AC-70 for seeded agents that have no snapshot.
  - `promoteVersion(workspaceId, agentId, sourceVersion): Promise<AgentRow>` per **D9**. Throw nothing HTTP-ish. Return `undefined` for a missing agent or version, and let the *service* map that to `NotFoundError` and the "already active" case to `ConflictError`. To do that, return a discriminated result `{ kind: 'not_found' } | { kind: 'already_active' } | { kind: 'ok', row }`.
  - `deleteById` wraps the existing delete in a transaction that first deletes `eval_cases` where `owner_kind = 'agent' AND owner_id = id AND workspace_id = workspaceId`. `eval_agent_runs` and the agent-scoped `eval_runs` cascade through their FKs (D1).
- **Constraint:** onion-architecture §3 (a repository takes `Db` only). Workspace scope on every query. `history is never rewritten`: never update an `agent_versions` row.
- **Owner:** `implementer`
- **Done when:** `cd server && pnpm typecheck` passes, and the existing `server/test/agents-versions.it.test.ts` still passes.

### Step 5 — Widen `taskLine`'s parameter type
- **Closes:** none — prerequisite for S10 (the eval task line comes from frozen PR meta)
- **Files:** `server/src/modules/reviews/helpers.ts` (edit, `:83`)
- **Change:** Change the signature to `taskLine(pull: Pick<PullRow, 'number' | 'title' | 'author'>)`. The body is unchanged, so the review prompt is byte-identical.
- **Constraint:** onion-architecture §11 (share pure functions through `helpers.ts`).
- **Owner:** `implementer`
- **Done when:** typecheck passes, and `server/test/reviews-helpers.test.ts` passes unchanged.

### Step 6 — Eval module constants
- **Closes:** none — prerequisite
- **Files:** `server/src/modules/eval/constants.ts` (new)
- **Change:** Add:
  - `EVAL_CASE_CONCURRENCY = 2`, `EVAL_CASE_TIMEOUT_MS = 120_000` (NFR-4)
  - `EVAL_NAME_MAX = 80` (FR-5)
  - `EVAL_POSITIVE_PREFIX = 'must-find-'`, `EVAL_NEGATIVE_PREFIX = 'no-'` (D4)
  - `EVAL_DEFAULT_WINDOW_DAYS = 30` (FR-20), `EVAL_DIP_THRESHOLD_POINTS = 1` (FR-21)
  - `EVAL_RECENT_RUNS_LIMIT = 20`, `EVAL_SPARKLINE_POINTS = 10`
  - `EVAL_REAPED_ERROR = 'Interrupted by a server restart'` (AC-84)
  - `EVAL_FILE_NOTE = 'reference only — not sent to the agent'`

  Comment each one with its FR/NFR.
- **Owner:** `implementer`
- **Done when:** the file imports nothing and typechecks.

### Step 7 — Pure scorer
- **Closes:** AC-26, AC-36, AC-37, AC-38, AC-39, AC-40, AC-41, AC-42, AC-43, AC-44, AC-45, AC-46, AC-47, AC-48, AC-50
- **Files:** `server/src/modules/eval/scoring.ts` (new)
- **Change:** Imports are limited to **type-only** contract types (`Finding`, `EvalExpectedFinding`, `EvalLocation`, `EvalExpectationKind`). No other imports.
  - `rangesIntersect(file, start, end, other)`: equal paths and inclusive intersection (FR-14). An expectation without `end_line` is `[start, start]`.
  - `scoreCase({ kind, expected, forbidden, grounded, emitted }) → { status: 'passed'|'failed', matched: number[] /* expectation indexes */, expectedN, gotM, recallNum, recallDen, noise, groundedCount, emittedCount }`. Rules:
    - `must_find` passes iff every expectation is matched at least once. Several findings on one expectation count once.
    - `must_not_flag` passes iff no grounded finding hits the forbidden location. With no location, it passes iff there are no grounded findings at all.
    - `noise` = grounded findings hitting the forbidden location (a `must_not_flag` case with no location counts all of them). On `must_find` cases it is always 0 (AC-46).
  - `aggregateRun(results: Array<ScoredCase | { status: 'errored' }>) → { recall, precision, citation_accuracy, passed, errored, total }`. Errored cases are excluded from every sum (AC-50). Zero denominators give `null` (FR-17). Formulas:
    - **recall** = Σ matched ÷ Σ expectations over `must_find` cases
    - **precision** = 1 − Σ noise ÷ Σ grounded over **all** scored cases
    - **citation_accuracy** = Σ grounded ÷ Σ emitted

    Purity doc comment: phrase it without naming forbidden tokens (`server/INSIGHTS.md:124-131`).
- **Constraint:** NFR-2. `CLAUDE.md` Non-default conventions ("Grounding is mandatory"). The scorer consumes post-gate output and never re-grounds.
- **Owner:** `implementer`
- **Done when:** typecheck passes. `rg -n "^import" server/src/modules/eval/scoring.ts` shows only `import type` lines from `@devdigest/shared`.

### Step 8 — Pure helpers: slug, seeding, citability, snapshots, compare, aggregation, DTOs
- **Closes:** AC-8, AC-9, AC-11, AC-12, AC-14, AC-15, AC-19 (helper), AC-27 (deltas), AC-29 (list item), AC-55, AC-57, AC-58, AC-59, AC-60, AC-62, AC-63, AC-64, AC-65, AC-69 (mismatch helper)
- **Files:** `server/src/modules/eval/helpers.ts` (new)
- **Change:** Pure functions only. No container and no I/O. The caller passes the clock. Row types are imported type-only from `../../db/rows.js`.
  - `slugifyCaseName(kind, title, taken: Set<string>)` per **D4**.
  - `fileDiffText(path, patch)` builds the D3 text.
  - `isCitable(diff: UnifiedDiff, loc)` → `groundFindings([syntheticFinding], diff).kept.length === 1`, where `syntheticFinding` has `kind: 'finding'` and the location's file and lines (`reviewer-core/src/grounding.ts:52`). Import `groundFindings` from `@devdigest/reviewer-core`.
  - `buildSeedDraft({ finding, pull, patch }) → EvalCaseInput | { refused: string }` per **D3**. It refuses when there is no decision, no patch, or the location is not citable (AC-19). The refusal text is user-facing English, e.g. "No stored diff for src/x.ts — this finding can't be frozen into a case.".
  - `buildSkillSnapshot(links) → EvalSkillSnapshotEntry[]`: every linked skill in order, with `rendered = renderSkillBlock(skill)` and `content_hash = sha256(rendered)`. Use `node:crypto` `createHash`; that is a standard library hash, not I/O. `injectableBodies(snapshot)` = the `rendered` text of the enabled entries, in order.
  - `skillDiff(a, b) → EvalSkillDiff`, `sameSkillState(a, b)`.
  - `compareRuns(older, newer, olderPrompt, newerPrompt, currentSnapshot, activeVersion) → EvalCompare`. Order by `started_at`, so the caller's order is irrelevant (AC-60). Delta points are rounded to 4 decimals.
  - `precisionDip(latest, previous)` per **D6**.
  - `trendPoints(runs)`: completed runs only, oldest → newest, null metrics kept as null (the client skips them).
  - `metricDeltas(latest, previous)`: null when either side is null.
  - `toCaseRecord(row, lastResult, sourceAvailable)`, `toResultDto(row)`, `toAgentRunDto(row)`: map snake_case and strip `rendered`.
- **Constraint:** onion-architecture §5. `.dependency-cruiser.cjs:124-140`.
- **Owner:** `implementer`
- **Done when:** typecheck passes, and `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` reports no violations.

### Step 9 — Eval repository
- **Closes:** AC-25, AC-31 (queries); NFR-8 (scoping)
- **Files:** `server/src/modules/eval/repository.ts` (new)
- **Change:** `class EvalRepository { constructor(private db: Db) }`. Every method takes `workspaceId` (except the in-run writes, which are keyed by a run id the service created in-scope).
  - **Cases:** `listCases(ws, agentId)`, `getCase(ws, id)`, `caseBySourceFinding(ws, agentId, findingId)`, `caseNamesFor(ws, agentId)`, `insertCase`, `updateCase` (sets `updated_at = now`), `deleteCase`. Insert and update translate a unique violation (Postgres code `23505`) into a typed return such as `{ conflict: 'name' | 'source' }`, never a thrown driver error.
  - **Last results:** `lastResultsFor(caseIds)`, the latest `eval_runs` row per case via `DISTINCT ON (case_id) … ORDER BY case_id, ran_at DESC`.
  - **Runs:**
    - `insertRunningRun(values)` returns `{ row } | { conflict: true }` (partial-index violation, R2). `runningRunFor(ws, agentId)`.
    - `recordCaseResult(runId | null, values)`: inserts the `eval_runs` row and, when `runId` is set, increments `cases_done`/`passed`/`errored` in **one transaction**.
    - `completeRun(id, metrics)`, `failRun(id, error)`.
    - `getRun(ws, id)`, `resultsForRun(runId)`.
    - `runsForAgent(ws, agentId, sinceDate)` (newest first).
    - `latestCompletedRuns(ws, agentIds, perAgent)`, `recentRunsAcrossAgents(ws, limit)`.
  - **Dashboard:** `caseCountsByAgent(ws)`.
  - **Boot reaper:** `reapRunningRuns()` sets `status = 'failed'`, `error = EVAL_REAPED_ERROR` and `finished_at = now` where `status = 'running'`, and returns the count (AC-84; mirrors `server/src/modules/reviews/repository/run.repo.ts:112-119`).
  - Doc-comment that pre-feature `eval_runs` rows (null `agent_id`) never match any query (`server/INSIGHTS.md:88-98`).
- **Constraint:** onion-architecture §3. drizzle-orm-patterns.
- **Owner:** `implementer`
- **Done when:** typecheck passes and depcruise is clean.

### Step 10 — Case executor and background runner
- **Closes:** AC-32, AC-33, AC-34, AC-50 (execution side), AC-71, AC-80, AC-84 (in-process crash path); NFR-1, NFR-4
- **Files:** `server/src/modules/eval/runner.ts` (new)
- **Change:** `export type EvalLogger = { info; warn; error }` (structural). `class EvalRunner { constructor(private container: Container, private repo: EvalRepository) }`.
  - **`executeCase(pinned, caseRow, signal?) → CaseOutcome`:**
    1. `diff = parseUnifiedDiff(caseRow.inputDiff)`
    2. `llm = await container.llm(pinned.provider)`
    3. `outcome = await withTimeout(reviewPullRequest({...}), EVAL_CASE_TIMEOUT_MS)` with:
       - `systemPrompt: pinned.systemPrompt`, `model: pinned.model`, `strategy: pinned.strategy`
       - `diff`, `llm`
       - `skills` only when the injectable bodies are non-empty
       - `prDescription` only when `meta.description` is non-empty
       - `task: taskLine({ number: meta.number ?? 0, title: meta.title, author: meta.author ?? 'unknown' })`
       - **nothing else**: no callers, repoMap, specs, intent, memory, sessionId or onEvent (NFR-1, AC-34)
    4. `emitted = outcome.review.findings.length + outcome.dropped.length`, `grounded = outcome.review.findings`
    5. `scoreCase(...)`
    6. `cost = effectiveRunCost({ costUsd: outcome.costUsd, model, tokensIn, tokensOut }, estimate)`
    7. Measure duration on the wall clock.

    Any throw (provider error, timeout, parse failure) becomes `{ status: 'errored', reason: message }`. **Never log the case input or diff** (NFR-5). Log lines carry only ids, the case name and the status.
  - **`execute(runRow, pinned, cases, log)`:** a `PQueue({ concurrency: EVAL_CASE_CONCURRENCY })` over the cases. Each case calls `repo.recordCaseResult(runRow.id, …)` as it finishes (AC-80). After `onIdle`, it runs `aggregateRun`, then `repo.completeRun`. The whole body sits in try/catch, and the catch calls `repo.failRun(id, message)`, so a run is never left `running` while the process lives.
  - `pinned` (`{ version, provider, model, systemPrompt, strategy, skillSnapshot }`) is built by the service **before** this is called (AC-33).
- **Constraint:** onion-architecture §2 (no Drizzle or Fastify here; `no-db-outside-repository` covers this file). R1. `reviewer-core` is unchanged.
- **Owner:** `implementer`
- **Done when:** typecheck passes. depcruise is clean. `rg -n "repoIntel|projectContext|intent|callers|repoMap|specs" server/src/modules/eval/runner.ts` finds no engine-input usage (comments excepted; phrase them to avoid these tokens).

### Step 11 — Eval service (use cases)
- **Closes:** AC-3 (server), AC-4, AC-5, AC-6, AC-7, AC-16, AC-17, AC-19, AC-24 (server), AC-35, AC-53 (server), AC-66, AC-67, AC-68, AC-69, AC-81, AC-82; NFR-8
- **Files:** `server/src/modules/eval/service.ts` (new)
- **Change:** `class EvalService { constructor(private container: Container) }`. It builds `EvalRepository(container.db)` and `EvalRunner`. Agents and reviews are reached **only** through `container.agentsRepo`/`container.reviewRepo`.
  - **`seedFromFinding(ws, findingId)`:**
    1. `reviewRepo.findingContext`. Throw `NotFoundError` unless `ctx.pull.workspaceId === ws` (same rule as `server/src/modules/reviews/findings.ts:17-20`).
    2. Refuse with `ValidationError` when `review.agentId` is null.
    3. `reviewRepo.getPrFiles(pull.id)`, then find the finding's file.
    4. `buildSeedDraft`. A refusal throws `ValidationError(reason)`.
    5. Name it via `slugifyCaseName` with the agent's taken names.
    6. Return `{ decision, existing, draft }`, where `existing` comes from `caseBySourceFinding`.
  - **`createFromFinding(ws, findingId, overrides)`:** recompute the draft server-side, the same as above, and **ignore** any client-sent input (AC-17). If a case already exists for the finding, return it with `created: false` (AC-7). Otherwise apply `name`/`notes`/`expected_output` overrides (only for `must_find`), re-validate with `EvalCaseInput`, and insert it with `source_finding_id` and `source_decision` (AC-6). A source conflict on a concurrent double-click returns the existing case. A name conflict gets the next suffix.
  - **`listCases(ws, agentId)`:** agent existence is checked (404), then cases plus last results. `source_available` = the source finding still resolves.
  - **`createCase`, `updateCase`, `deleteCase`:** ownership is checked via the agent in workspace. A name conflict throws `ConflictError`.
  - **`runCase(ws, caseId)`:** single-case run per **D7**. The result is recorded with `suite_run_id = null` (AC-35).
  - **`startRun(ws, agentId, log)`:**
    1. Look up the agent (404).
    2. Zero cases throws `ValidationError`.
    3. Build the pinned config (D7).
    4. `insertRunningRun`. On conflict, return `{ run: runningRunFor(...), attached: true }` (AC-82).
    5. Otherwise `void runner.execute(...).catch(log)`.
    6. Return `{ run, attached: false }` **before any case finishes** (AC-80).
  - **`runAll(ws, log)`:** `startRun` for every agent with ≥ 1 case.
  - **Reads:** `getRun`, `listRuns`, `agentDetail(ws, agentId, days)` (trend, deltas, alert, in-flight, runs-in-window, `cases_total`), `dashboard(ws)`.
  - **`compare(ws, a, b)`:** both runs are in workspace and on the same agent (422 otherwise). Load both versions' `config_json.system_prompt` via `agentsRepo.getVersion`, build a fresh current snapshot for `skill_mismatch`, then `compareRuns`. No model call (NFR-2).
  - **`promote(ws, agentId, runId)`:** the run must belong to the agent. Then `agentsRepo.promoteVersion(ws, agentId, run.agentVersion)`, mapping `not_found`/`already_active` to `NotFoundError`/`ConflictError`. Return the agent DTO (reuse the agents module's existing DTO mapper only if it is in a `helpers.ts`; otherwise map minimally in eval helpers), plus `skill_mismatch` (AC-69).
  - **`reapStaleRuns()`:** `repo.reapRunningRuns()`.
- **Constraint:** onion-architecture §2, §11, §12. `server/INSIGHTS.md:100-112`.
- **Owner:** `implementer`
- **Done when:** typecheck passes. depcruise is clean. `rg -n "fastify|drizzle" server/src/modules/eval/service.ts` finds nothing.

### Step 12 — Routes, module registration, boot reaper
- **Closes:** AC-84 (boot path); every endpoint in **D10**
- **Files:** `server/src/modules/eval/routes.ts` (new), `server/src/modules/index.ts` (edit: `import evals from './eval/routes.js'` and an `evals` entry), `server/src/app.ts` (edit: next to `:80-85`, add a second try/catch block calling `new EvalService(container).reapStaleRuns()`, logging `reaped stale running eval runs on boot`)
- **Change:** One handler per row of **D10**:
  - `params` via `IdParams`, plus `z.object({ a: z.string().uuid(), b: z.string().uuid() })` for compare and `z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })` for `?days`
  - `body` via the D2 schemas
  - `response` schemas from D2
  - `getContext` first; each handler is three lines; no logic

  Add a header doc comment listing the routes (style of `server/src/modules/agents/routes.ts:19-31`). POST `/agents/:id/eval/runs` returns 202 when `attached === false` and 200 when re-attached.
- **Constraint:** onion-architecture §1. `server/CLAUDE.md:53-55`. `server/src/modules/index.ts:22-25`.
- **Owner:** `implementer`
- **Done when:** `cd server && pnpm typecheck` passes. depcruise is clean. `server/test/routes-smoke.test.ts` still passes.

### Step 13 — Prompt-keyed responses in the mock LLM
- **Closes:** none — enables AC-75, AC-76 (test infrastructure)
- **Files:** `server/src/adapters/mocks.ts` (edit, `MockLLMOptions` at `:47-59` and `completeStructured` at `:92-108`)
- **Change:** Add an optional `respond?: (req: StructuredRequest<unknown>) => unknown` to `MockLLMOptions`. When it is present, its return value is the fixture (validated against the schema as today). This is additive, so every existing test is unchanged.
- **Constraint:** `TESTING.md:96-97` (mocks live here). onion-architecture §6 (mocks are peers of adapters).
- **Owner:** `implementer`
- **Done when:** typecheck passes, and `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` is green.

### Step 14 — Demo eval seed (self-contained fixtures)
- **Closes:** AC-72, AC-73, AC-74
- **Files:** `server/src/db/seed-eval.ts` (new), `server/src/db/seed.ts` (edit: one call `await seedEvalDemo(db, workspaceId, repoId, agentIdByName)` after `seedExtraDemoPrs` at `:353`; update the header comment at `:28-29`, which says eval starts empty)
- **Change:** `seedEvalDemo` has two parts, each idempotent on its own guard.
  - **(a) Demo PR #491** "Add Stripe checkout and webhook forwarder" (guard: the PR number exists in the repo):
    - **`pr_files` with real `patch` text**, at least `src/config.ts` (a `sk_live_…` key on a `+` line), `src/api/public/webhooks.ts` (an SSRF-shaped forward) and `src/api/users.ts` (an unused import on a `+` line).
    - **A `reviews` row** for **Security Reviewer** (`agentId` set, unlike the PR #482 sample at `seed.ts:121-133`).
    - **Three findings:** the Stripe-key finding with `acceptedAt` set, the unused-import finding with `dismissedAt` set, and the SSRF finding undecided (AC-74 and AC-3 demo). Each finding's lines are citable in its patch.
    - **No fixture uses PR #482**, whose `pr_files` have no patches (`seed.ts:105-110`).
  - **(b) Security Reviewer case set** (guard per case: name exists for the agent): **≥ 8 cases**, with at least 5 `must_find` and at least 3 `must_not_flag`. Each case has its own small self-contained `input_diff`, `input_meta` and expectation. Suggested names, mirroring mockup 6:
    - `must_find`: `stripe-key-leak`, `ssrf-webhook`, `missing-retry-after`, `n-plus-1-users-query`, `lethal-trifecta-callback`
    - `must_not_flag`: `no-unused-import-warning`, `no-raw-body-parser-flag`, `no-test-fixture-secret`

    Every `must_find` expectation and every `forbidden_location` must pass `isCitable` against its own diff. Import the helper from `../modules/eval/helpers.js` and assert at seed time; throw if a fixture is not citable, so a bad fixture fails loudly.

  Put the fixture text in `seed-eval.ts` as constants. No file I/O.
- **Constraint:** `server/INSIGHTS.md:14-20` (gate dependent inserts on the dependent rows themselves). `server/INSIGHTS.md:240-247` (the seed change can perturb other integration fixtures, so re-run the whole `.it` lane).
- **Owner:** `implementer`
- **Done when:** typecheck passes. `cd server && pnpm exec vitest run .it.test` (Docker) stays green. That covers existing fixtures such as `server/test/run-cost.it.test.ts`, `pulls-findings.it.test.ts` and `conventions.it.test.ts`. If an existing assertion counted PRs or findings workspace-wide, adjust **the fixture expectation**, never the seeded data's meaning, and note it in the step's report.

### Step 15 — `verify:l06` script
- **Closes:** AC-77 (gate exists)
- **Files:** `server/package.json` (edit: `scripts` only)
- **Change:**
  1. **First** run `git ls-files -v server/package.json`. At planning time it prints `H server/package.json`: tracked normally, not skip-worktree, contrary to `CLAUDE.md` Gotchas, `TESTING.md:92-94` and `server/CLAUDE.md:86-87`.
  2. If it prints `S`, **stop and report back.** The edit would be invisible to git, so the caller must decide.
  3. If it prints `H`, add `"verify:l06": "VERIFY_L06=1 vitest run test/eval-"`. The `test/eval-` filter selects `eval-scoring.test.ts`, `eval-helpers.test.ts`, `eval-contract-parity.test.ts` and `eval-pipeline.it.test.ts`.
  4. Do not touch dependencies or `pnpm-lock.yaml`.
- **Constraint:** `CLAUDE.md` Do not touch (no lockfile edits). `RULE-SKIPWORKTREE` warning (repo-rules.md:31) is expected here and justified by the `H` flag. The inline `VAR=…` env syntax assumes a POSIX shell (Linux/WSL/macOS). The Windows CI job runs only `typecheck`, never this script.
- **Owner:** `implementer`
- **Done when:** `jq -r '.scripts["verify:l06"]' server/package.json` prints the script, and `git diff server/package.json` shows only that line.

### Step 16 — Scoring and helper unit tests (hermetic)
- **Closes:** AC-8, AC-11, AC-14, AC-15, AC-16 (helper), AC-19 (helper), AC-26, AC-36–AC-50, AC-55, AC-57–AC-59, AC-60, AC-62–AC-65 (helper), AC-79
- **Files:** `server/test/eval-scoring.test.ts` (new), `server/test/eval-helpers.test.ts` (new)
- **Change:**
  - **Scoring**, table-driven against hand-computed values:
    - AC-38 matching cases
    - AC-39, AC-40, AC-41 pass rules
    - AC-42 (recall 0.8), AC-43 (precision 0.75), AC-44 (citation 0.9)
    - AC-45 (dropped finding only affects citation), AC-46 (unmatched finding on `must_find` leaves precision unchanged)
    - AC-47 and AC-48 (every zero denominator → `null`)
    - AC-50 (7 scored + 1 errored = the metrics of the 7)
    - AC-37 (scoring twice gives deep-equal output)
    - an expectation matched by two findings counts once
  - **AC-36/AC-79 (no model call):**
    - (a) score a fixture while a `MockLLMProvider` spy is constructed alongside, and assert `calls.length === 0`
    - (b) read `server/src/modules/eval/scoring.ts` source and assert every `import` line is `import type` from `@devdigest/shared` (structural proof: the module cannot reach a provider)
  - **Helpers:**
    - the AC-14 slug example, plus truncation at 80 with no trailing hyphen (AC-15) and the collision suffix (AC-16)
    - `buildSeedDraft` for an accepted finding (AC-8/AC-9 shape) and a dismissed one (AC-11/AC-12)
    - refusals on a null patch, an uncitable line, and a `secret_leak` kind with uncitable lines (AC-19)
    - `precisionDip` 0.93 → 0.91 = 2 points on v7, plus no banner at < 1 point or when a value is null
    - `compareRuns` order (v7, v6 → "v6 → v7"), same prompt with a different skill snapshot, no config change, model change, case-set difference
    - `trendPoints` order
- **Constraint:** `TESTING.md:8-24` (one happy path plus the edges that matter). `server/CLAUDE.md:48-49` (no `.it.` suffix, since these are DB-free).
- **Owner:** `test-writer`
- **Done when:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` passes.

### Step 17 — Contract parity test
- **Closes:** AC-78
- **Files:** `server/test/eval-contract-parity.test.ts` (new)
- **Change:** Use `fs.readFileSync` on `path.resolve(__dirname, '../src/vendor/shared/<f>')` and `path.resolve(__dirname, '../../client/src/vendor/shared/<f>')` for `contracts/knowledge.ts`, `contracts/eval-ci.ts`, `contracts/findings.ts` and `index.ts`, and assert byte equality, with a failure message naming the file and telling the reader to copy server → client. Add one more test: every `Eval*` export name present in the server's `eval-ci.ts` and `knowledge.ts` also appears in the client file text. That is redundant with byte equality, but it gives a precise message.
- **Constraint:** NFR-7. `.github/workflows/client.yml:47-53` (CI already checks the whole directory with `diff -r`).
- **Owner:** `test-writer`
- **Done when:** the test passes, and it fails when a single character is temporarily changed in the client copy. Check that locally, then revert.

### Step 18 — Eval integration test (real Postgres, hermetic providers)
- **Closes:** AC-4, AC-5, AC-6, AC-7, AC-16, AC-17, AC-19, AC-25, AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-60–AC-65 (server data), AC-66, AC-67, AC-68, AC-69, AC-70, AC-71, AC-72, AC-73, AC-74, AC-75, AC-76, AC-77, AC-80, AC-81, AC-82, AC-84; NFR-8, NFR-9
- **Files:** `server/test/eval-pipeline.it.test.ts` (new)
- **Change:** Follow `server/test/brief.it.test.ts` / `agents-versions.it.test.ts`: `startPg()`, `buildApp({ db, overrides })`, `seed(db)`.
  - **Docker gate:** without Docker, skip as the other files do, **except** when `process.env.VERIFY_L06 === '1'`. In that case fail with "verify:l06 needs Docker (testcontainers)", so the gate can never pass vacuously (AC-77).
  - **Providers:** the overrides inject a `MockLLMProvider` under **`openrouter`, `openai` and `anthropic`**, a `MockGitHubClient`, and a mock `repoIntel` whose methods throw if called (NFR-1 and NFR-9; `server/INSIGHTS.md:42-52`). Use the S13 `respond` hook so output depends on the system prompt: a marker string in the prompt decides which findings come back.
  - **Cases:**
    1. **Seed (AC-72–74):** Security Reviewer has ≥ 8 cases of both kinds. Calling `seed(db)` again leaves the counts unchanged. PR #491 has one accepted and one dismissed finding with patches.
    2. **Seeding from a finding:**
       - GET draft → POST with no overrides gives 201, the right kind, `source_finding_id` and `source_decision` (AC-4–6). POST again → the same id (AC-7).
       - Delete the review → the case input is unchanged (AC-17).
       - A finding on PR #482 → 422 (AC-19).
    3. **Full run:**
       - POST runs returns `running` and `cases_done < cases_total` (gate the mock on a deferred promise so this is deterministic, AC-80).
       - A second POST gives `attached: true` and the same id (AC-82).
       - GET `/eval/runs/:id` shows progress (AC-81).
       - Release the deferred, poll to `completed`. Metrics are non-null as the fixture implies, and `agent_version`, the skill snapshot and `case_ids` are persisted (AC-32).
       - The seeded agent now has an `agent_versions` row (AC-70).
       - Mock-captured messages for one case are identical between two runs with the same version and skills (AC-34).
       - The `repoIntel` mock was never called (NFR-1).
    4. **Mid-run edits:** while a run is held, PUT the agent's prompt and link a skill. The run's recorded `agent_version` and snapshot are the pre-edit ones (AC-33).
    5. **Skill-only change:** link a skill, then run → same version, different snapshot. Compare reports `same_prompt: true` and lists the skill (AC-62, AC-71).
    6. **Sensitivity:** edit the prompt to v2 (marker changes the output) and run, then compare v1 vs v2: recall or precision differ, with deltas (AC-75). Spoil the prompt (marker makes the mock flag a `must_not_flag` location) and run → precision is strictly lower, and `/agents/:id/eval/detail` returns a non-null `alert` (AC-76).
    7. **Single-case run:** the case's `last_result` updates and `GET /agents/:id/eval/runs` length is unchanged (AC-35).
    8. **Delete a case:** the historical run results still list it by name (AC-25).
    9. **Promote:**
       - Promote the older run's version → a new version whose `system_prompt` equals the old one, and `GET /agents/:id` reflects it (AC-66).
       - Earlier runs' data is unchanged (AC-67).
       - Promoting the active version → 409 (AC-68).
       - After linking another skill, `skill_mismatch: true` (AC-69).
    10. **Reaper:** insert a `running` eval run row directly, then call `new EvalService(app.container).reapStaleRuns()` → the row is `failed` with the reaped error (AC-84).
    11. **Tenancy:** a second workspace gets 404 on case, run, compare and promote (NFR-8).
    12. **No model call outside execution:** the mock's `calls.length` is unchanged across compare, detail and dashboard reads (AC-36, NFR-2).
- **Constraint:** `CLAUDE.md` (`*.it.test.ts`). `TESTING.md:16-19` (one real integration per data-backed workflow).
- **Owner:** `test-writer`
- **Done when:** `cd server && pnpm exec vitest run .it.test` passes with Docker, and `cd server && env -u OPENAI_API_KEY -u OPENROUTER_API_KEY -u ANTHROPIC_API_KEY pnpm verify:l06` exits 0.

### Step 19 — Client hooks and query keys
- **Closes:** AC-81, AC-83 (polling and refresh); data access for S22–S27
- **Files:** `client/src/lib/hooks/eval.ts` (new), `client/src/lib/hooks/keys.ts` (edit), `client/src/lib/hooks/index.ts` (edit: `export * from "./eval";`)
- **Change:**
  - **Keys:** `evalKeys = { root: () => ["eval"], cases: (agentId) => ["eval","cases",agentId], runs: (agentId, days) => …, run: (id) => …, detail: (agentId, days) => …, dashboard: () => …, compare: (a,b) => …, seed: (findingId) => … }`, all under the `"eval"` prefix so one `invalidateQueries({ queryKey: evalKeys.root() })` refreshes every view (AC-83).
  - **Hooks, one per D10 endpoint:**
    - `useEvalCaseSeed(findingId, enabled)`, `useCreateCaseFromFinding()`
    - `useEvalCases(agentId)`, `useCreateEvalCase(agentId)`, `useUpdateEvalCase()`, `useDeleteEvalCase()`, `useRunEvalCase()`
    - `useStartEvalRun()`, `useRunAllEvals()`
    - `useEvalRun(runId)` with `refetchInterval: (q) => q.state.data?.status === "running" ? 2000 : false`
    - `useEvalAgentRuns(agentId, days)`, `useEvalAgentDetail(agentId, days)`, `useEvalDashboard()`
    - `useEvalCompare(a, b)` (enabled only when both are set)
    - `usePromoteVersion()`, whose `onSuccess` invalidates `["agent", id]`, `["agents"]` and `evalKeys.root()` (AC-66)
  - **Run tracking:** `useEvalAgentDetail` and `useEvalDashboard` also poll every 2000 ms while their payload has an `in_flight` run. A small `useEvalRunWatcher(runId)` invalidates `evalKeys.root()` once a watched run leaves `running` (AC-83).
  - Every response is parsed with its D2 schema, as existing hooks do with `api.get<T>(url, Schema)`.
- **Constraint:** `client/CLAUDE.md:48-49`. `client/src/lib/hooks/keys.ts:1-10`. `client/src/lib/hooks/reviews.ts:46` (the `refetchInterval` precedent).
- **Owner:** `implementer`
- **Done when:** `cd client && pnpm typecheck` passes.

### Step 20 — i18n copy
- **Closes:** NFR-10; the copy for AC-3, AC-4, AC-10, AC-13, AC-23, AC-26, AC-28, AC-29, AC-30, AC-53, AC-54, AC-57, AC-60–AC-65, AC-69, AC-80
- **Files:** `client/messages/en/eval.json` (edit; it already exists with `dashboard`/`caseEditor`/`evalsTab`/`page`), `client/messages/en/agents.json` (no change needed: `editor.tabs.evals` already exists at `:49`; verify only)
- **Change:** Keep the existing keys. Replace `caseEditor.resultSummary` with the FR-8 line. Add:
  - **`finding`:** `turnIntoCase` ("Turn into eval case"), `needsDecision` ("Accept or dismiss this finding first")
  - **`modal`:**
    - `seededFrom` ("Seeded from a {decision} finding · assert the expected output"), `handMade`
    - `positive` ("POSITIVE CASE"), `positiveBanner` ("MUST find \"{title}\" at {location}"), `negative` ("NEGATIVE CASE"), `negativeBanner` ("MUST NOT comment on {location} ({title})")
    - `kindLabel`, `assertEmpty` ("assert empty"), `expectedNone`
    - `filesReferenceOnly` ("Reference only — file contents are not sent to the agent")
    - `findingSkeleton`, `runOnSave`, `cancel`, `nameRequired`, `wrongShape`
    - `lastRun` ("Last run {status} · expected {expected, plural, one {# finding} other {# findings}}, got {got} · {duration} · {cost}"), `lastRunErrored`
    - `sourceUnavailable`, `refused`
  - **`kind`:** `mustFind` ("MUST FIND"), `mustNotFlag` ("MUST NOT FLAG")
  - **`tiles`:** `tracesPassed`, `empty` ("No completed runs yet"), `scoringNote` (FR-9 sentence verbatim), `viewDashboard`
  - **`cases`:** `passing` ("{passing} / {withResult} passing"), `total` ("{count} cases"), `runAll` ("Run all evals"), `newCase`, `noCasesRunDisabled`, `expectedGot`
  - **`history`:** heading and columns
  - **`progress`:** `cases` ("{done} / {total} cases"), `running` ("Running…"), `errored`, `failed`
  - **`dashboard`:** `runAllAgents`, `confirmRunAll` ("Run {agents} agents on {cases} cases?"), `neverRun`, `recentAll` ("Recent eval runs · all agents"), `lastRun`
  - **`detail`:** `allAgents`, `runsOnSet` ("{runs} runs on the {cases}-case set"), `window` ("{days} days"), `dip` ("Precision dipped {points}pts on v{version}"), `dipDetail`, `compare`, `selectTwo`
  - **`compare`:** `title` ("Compare runs · v{old} → v{new}"), `promptDiff`, `samePrompt`, `noConfigChange`, `modelChanged`, `skillsAdded`, `skillsRemoved`, `skillsReordered`, `skillChanged`, `caseSetDiffers`, `promote` ("Promote v{version}"), `promoteActive`, `skillMismatch` ("This run used different skills than are linked now. Promote copies the prompt and model only — skill links stay as they are."), `confirm`, `close`

  `nav.eval` already exists in `client/messages/en/shell.json:24`. Every UI string in S22–S27 comes from here.
- **Constraint:** NFR-10. `client/INSIGHTS.md:59-68` (the scaffolded copy is not a spec). frontend-code-organization §5.
- **Owner:** `implementer`
- **Done when:** the JSON is valid and every key used in S22–S27 exists.

### Step 21 — Promote the line-diff helper to `src/lib`
- **Closes:** none — prerequisite for AC-61
- **Files:** `client/src/lib/line-diff.ts` (new, holding `computeLineDiff` + `DiffLine` moved verbatim), `client/src/app/skills/_components/SkillsWorkbench/_components/SkillEditor/_components/VersionsTab/_components/DiffModal/helpers.ts` (edit: re-export from `../../../../../../../../../lib/line-diff`, or update the importers to import from `src/lib/line-diff` directly; pick whichever keeps `DiffModal/helpers.test.ts` passing unchanged)
- **Change:** Move the function with its comment, keeping the trailing-newline normalisation (`client/INSIGHTS.md:146-152`). No behaviour change.
- **Constraint:** frontend-code-organization §6 (promote on the second unrelated consumer). §1 (the eval route must not import the skills route's `_components`).
- **Owner:** `implementer`
- **Done when:** `cd client && pnpm test` passes the existing `DiffModal` tests unchanged, and typecheck passes.

### Step 22 — Shared eval metric components
- **Closes:** AC-27, AC-28, AC-49 (render), AC-80 (progress render)
- **Files:** `client/src/components/eval-metrics/{index.ts,EvalMetricTiles/EvalMetricTiles.tsx,EvalMetricTiles/index.ts,RunProgress/RunProgress.tsx,RunProgress/index.ts,styles.ts}` (new), `client/src/lib/eval-format.ts` (new, pure: `pct(v|null) → "82%" | "—"`, `pointsDelta(d|null) → "+4pt" | null`, `costLabel(v|null) → "$0.23" | "—"`, `durationLabel(ms)`)
- **Change:**
  - **`EvalMetricTiles({ latest, delta, trend?, showTracesPassed })`:** uses the vendored `MetricCard` (`client/src/vendor/ui/charts/MetricCard.tsx`).
    - The value is `pct(...)`.
    - **Omit `delta` when it is null** (AC-49).
    - Sparkline series skip nulls.
    - An optional "Traces passed x/y" tile.
    - With no `latest`, show an `EmptyState` (AC-28), never zeros.
    - Per `client/INSIGHTS.md:133-144`, `suffix` is only `"%"`.
  - **`RunProgress({ run })`:** "k / n cases" plus a `ProgressBar`. Per-case status icons come from the run's `results` when given.

  Look at mockups **4** and **6** (`…/images/4.png`, `…/images/6.png`) for the tile layout and delta styling. They are used by both the agents route (S25) and the eval route (S27), which is why they live in `src/components`.
- **Constraint:** frontend-code-organization §1 (two routes consume these, so `src/components/<kebab>`), §6. `client/CLAUDE.md:62-63` (no rebuilt primitives).
- **Owner:** `implementer`
- **Done when:** typecheck passes, and `eval-format.ts` imports nothing from `react`.

### Step 23 — Shared eval-case modal (seeded + hand-made)
- **Closes:** AC-4, AC-5, AC-8, AC-10, AC-11, AC-13, AC-18, AC-20, AC-21, AC-22, AC-23, AC-24, AC-26 (render)
- **Files:** `client/src/components/eval-case-modal/{index.ts,EvalCaseModal.tsx,helpers.ts,constants.ts,styles.ts}` (new). Nested `client/src/components/eval-case-modal/_components/{CaseBanner,InputTabs,ExpectedOutputEditor,LastRunLine}/{<Name>.tsx,index.ts}` (new).
- **Change:** Props are `{ open, onClose, mode: { kind: "fromFinding"; findingId } | { kind: "new"; agentId } | { kind: "edit"; caseRecord } }`. It uses the vendored `Modal`, `Tabs`, `TextInput`, `Textarea`, `Toggle`, `Button` and `Badge`.
  - **`fromFinding`:**
    - `useEvalCaseSeed(findingId)`. If `existing` is set, open in edit mode on that case (AC-7).
    - A 422 shows the server's refusal message (AC-19).
    - Otherwise prefill from `draft`. **Save works with no edits** (AC-5).
    - The subtitle uses `modal.seededFrom` with "accepted"/"dismissed" (AC-4).
    - `CaseBanner` shows the POSITIVE or NEGATIVE banner with title and `file:line` (AC-10).
    - The diff, files and PR meta are **read-only** (frozen, FR-6).
  - **`new` / `edit`:**
    - Name input (required) and an explicit kind selector (FR-7).
    - `InputTabs`: Diff (textarea, diff-coloured preview), **Files** (with the `filesReferenceOnly` notice, AC-23), PR meta (title, description, number).
    - `ExpectedOutputEditor`: a JSON textarea with a live **valid JSON / invalid JSON** badge, parsed with `EvalCaseInput`'s expected-output shape and kind rule. For `must_not_flag`, `[]` with the **assert empty** badge (AC-13). The **Finding skeleton** button inserts `{severity, category, title, file, start_line}` (AC-21). For `must_not_flag`, an optional forbidden location form.
    - **Save is disabled** while the name is empty, the JSON is invalid, or the shape or kind rule fails (AC-20, AC-22).
  - **Footer:** **Run on save** toggle, **Cancel**, **Run case**, **Save**. With Run on save on, Save then calls `useRunEvalCase` and shows `LastRunLine` (AC-24). `LastRunLine` renders D8 (AC-26: for `must_not_flag`, "expected 0, got M").
  - The diff text renders as plain text in `<pre>`, never Markdown or `dangerouslySetInnerHTML` (NFR-6 render side).
  - `helpers.ts` (pure): `parseExpected(text, kind)`, `skeletonFor(location?)`, `bannerLocation(case)`.

  Look at mockups **2** (positive seeded), **7** (hand-made editor) and **8** (negative seeded) at `…/images/2.png`, `7.png` and `8.png`. Follow the spec's interpretation note for mockup 8: its "expected 1, got 1" result line and its `src/config.ts` diff are mockup errors. Show `expected 0, got M`, and the frozen diff of the forbidden file.
- **Constraint:** frontend-code-organization §1 (consumed by the pulls route via S24 and the agents route via S25, so it goes in `src/components/<kebab>`, with private parts nested), §2. `client/INSIGHTS.md:154-161` (textarea testing note for S28).
- **Owner:** `implementer`
- **Done when:** typecheck passes, and `helpers.ts` imports nothing from `react`.

### Step 24 — "Turn into eval case" on the finding card
- **Closes:** AC-1, AC-2, AC-3
- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx` (edit, the actions row at `:105-125`), `…/FindingCard/styles.ts` (edit if needed)
- **Change:**
  - Add a third action button after Dismiss: `icon="FlaskConical"`, or the nearest existing icon in `@devdigest/ui` icons if that one doesn't exist. Do not add icons to the vendored set.
  - The label is `t("finding.turnIntoCase")` from the `eval` namespace (a second `useTranslations("eval")`).
  - **Enabled iff** `f.accepted_at || f.dismissed_at`. Otherwise disabled, with a `<span title={needsDecision}>` wrapper and a visible hint line (AC-3; `client/INSIGHTS.md:81-88`).
  - The card owns `const [evalOpen, setEvalOpen] = useState(false)` and renders `<EvalCaseModal mode={{ kind: "fromFinding", findingId: f.id }} …/>` only while it is open. The parents (`FindingsPanel`, `DiffTab`) are untouched.
  - Learn and Reply are **not** added (spec *Out of scope*).

  Look at mockup **1** (`…/images/1.png`) for the button placement.
- **Constraint:** frontend-code-organization §1 (import the shared modal from `src/components/eval-case-modal`). `client/CLAUDE.md:48-49`.
- **Owner:** `implementer`
- **Done when:** typecheck passes, and the existing `FindingCard.test.tsx` passes unchanged.

### Step 25 — Agent editor Evals tab
- **Closes:** AC-27, AC-28, AC-29, AC-30, AC-31, AC-80, AC-81, AC-82 (UI: "Running…" instead of a duplicate), AC-83
- **Files:**
  - `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (edit: add `{ key: "evals", labelKey: "editor.tabs.evals", icon: "Gauge" }`, or the nearest existing icon, and update the comment at `:10-11`)
  - `…/AgentEditor/AgentEditor.tsx` (edit: render `<EvalsTab agent={agent} />` for `tab === "evals"`, and exclude it from the Config fallback at `:26`)
  - `client/src/app/agents/[id]/page.tsx` (edit: add `"evals"` to `VALID_TABS` at `:15`)
  - `…/AgentEditor/_components/EvalsTab/{EvalsTab.tsx,index.ts,styles.ts,helpers.ts}` (new) and nested `…/EvalsTab/_components/{EvalCaseRow,EvalRunHistory}/{<Name>.tsx,index.ts}` (new)
- **Change:**
  - **Top section** ("EVAL METRICS"):
    - `EvalMetricTiles` from `useEvalAgentDetail(agent.id, 30)` (`latest`, `delta`), with traces passed `x/y`
    - the `tiles.scoringNote` line
    - a "View full dashboard →" link to `/eval/${agent.id}`
  - **Cases header:**
    - "Eval cases", the `cases.passing` badge (`passing` = cases whose `last_result.status === "passed"`, `withResult` = cases with any `last_result`) and the `cases.total` badge (AC-29)
    - **Run all evals**: `useStartEvalRun`. Disabled when there are 0 cases. Shows "Running…" and `RunProgress` while `detail.in_flight` is set. It never starts a duplicate; a second click while a run is in flight is impossible, and the server re-attaches anyway (AC-82).
    - **New eval case**: opens the modal in `new` mode.
  - **`EvalCaseRow`, per case:**
    - pass / fail / errored / never-run icon
    - name (mono)
    - kind `Badge` (**MUST FIND** / **MUST NOT FLAG**, AC-30)
    - "expected N, got M" from `last_result`
    - a severity · category chip, or "assert empty"
    - run (`useRunEvalCase`), edit (modal in `edit` mode), delete (`useDeleteEvalCase` with a confirm)
  - **`EvalRunHistory`:** full runs from `useEvalAgentRuns`, newest first: version, time, three metrics (`pct`), pass `x/y`, cost (`costLabel`), and status (completed / failed, AC-84) (AC-31).
  - **On run completion**, `useEvalRunWatcher` refreshes every view (AC-83). Re-opening the tab mid-run shows the same in-flight run, because the state lives in the server's `in_flight` (AC-81).

  Look at mockup **6** (`…/images/6.png`).
- **Constraint:** frontend-code-organization §1 (nested private parts under the route-local `AgentEditor`), §4.
- **Owner:** `implementer`
- **Done when:** typecheck passes, and the existing `AgentEditor.test.tsx` passes, updated only if it asserts the exact tab count.

### Step 26 — Sidebar entry and Eval Dashboard page
- **Closes:** AC-51, AC-52, AC-53, AC-54, AC-83 (dashboard refresh)
- **Files:**
  - `client/src/vendor/ui/nav.ts` (edit: add `{ key: "eval", label: "Eval Dashboard", icon: "Gauge" /* or nearest existing */, href: "/eval" }` to the `SKILLS LAB` items after `conventions` at `:38-44`; no `gKey`, same reasoning as the comment at `:26-29`)
  - `client/src/app/eval/page.tsx` (new)
  - `client/src/app/eval/_components/{AgentEvalRow,RecentEvalRuns,RunAllAgentsButton}/{<Name>.tsx,index.ts,styles.ts}` (new)
- **Change:**
  - **`page.tsx`:** a thin client page. `AppShell` with crumb `[{ label: "Skills Lab" }, { label: <eval.page.crumbEvalDashboard> }]`, title and subtitle, then `useEvalDashboard()`.
  - **`AgentEvalRow`, one per agent with ≥ 1 case** (the server omits zero-case agents):
    - icon, name, model badge
    - "Last run v{N} · {time} · {passed}/{total} pass", or **"never run"** when `latest` is null (AC-54)
    - a `Sparkline` of `recall_series`
    - RECALL / PREC / CITE values (`pct`, so "—" when null)
    - the whole row is a link to `/eval/${agent_id}` (AC-52)
  - **`RunAllAgentsButton`:** a confirm `Modal` that first states "Run {agents} agents on {cases} cases?", using the dashboard's summed `cases_total` (AC-53), then calls `useRunAllEvals`.
  - **`RecentEvalRuns`:** a table of agent, time, version, three metric bars with % (vendored `BarRow`/`ProgressBar`) and pass.
  - **Highlighting:** `activeKeyFor` already maps `/eval` to `eval` (`client/src/components/app-shell/helpers.ts:35`) and `shell.json:24` already has `nav.eval`, so the entry is highlighted on the page (AC-51).

  Look at mockup **3** (`…/images/3.png`).
- **Constraint:** `client/INSIGHTS.md:48-57` (the label lives in both nav.ts and shell.json). `RULE-VENDOR` warning, justified (see *Skills to be applied*). frontend-code-organization §4 (pages stay thin).
- **Owner:** `implementer`
- **Done when:** typecheck passes, and `client/src/components/app-shell` tests (if any) still pass.

### Step 27 — Per-agent eval detail page and Compare modal
- **Closes:** AC-55, AC-56, AC-57, AC-58, AC-59, AC-60, AC-61, AC-62, AC-63, AC-64, AC-65, AC-66 (UI), AC-68 (UI), AC-69, AC-80, AC-81, AC-83
- **Files:**
  - `client/src/app/eval/[agentId]/page.tsx` (new)
  - `client/src/app/eval/[agentId]/_components/{EvalDetailHeader,PrecisionDipBanner,MetricTrend,RecentRunsTable,CompareRunsModal}/{<Name>.tsx,index.ts,styles.ts}` (new)
  - `…/CompareRunsModal/helpers.ts` (new, pure)
- **Change:**
  - **`page.tsx`:** crumb Skills Lab › Eval Dashboard (`/eval`) › agent name. `useEvalAgentDetail(agentId, days)`, where `days` is local state defaulting to 30.
  - **`EvalDetailHeader`:**
    - "‹ All agents" back link, name and model badge
    - an agent switcher (`Dropdown` over `useAgents()`, navigating to `/eval/<id>`)
    - a window selector (7/30/90 days)
    - **Run eval**: "Running…" plus `RunProgress` while `in_flight` is set; disabled with 0 cases
    - subtitle `detail.runsOnSet`
  - **`PrecisionDipBanner`:** renders iff `detail.alert` is set (the server applies D6, AC-57–59). Text: "Precision dipped {points}pts on v{version}", plus recall and citation movement.
  - **Tiles:** `EvalMetricTiles` with sparklines from `trend`.
  - **`MetricTrend`:** the vendored `LineChart` with three series. Null points are skipped. One point per completed run in the window, oldest → newest (AC-55).
  - **`RecentRunsTable`:** checkbox per row (vendored `Checkbox`), time, version, three metric bars, pass, cost, status. **Compare** is enabled iff exactly 2 rows are checked (AC-56).
  - **`CompareRunsModal`:**
    - `useEvalCompare(a, b)`. The title is "Compare runs · v{old} → v{new}", using the server's older → newer order (AC-60).
    - Four delta cards: recall, precision and citation in points, cost in currency (`—` when unavailable).
    - **System prompt diff** via `computeLineDiff(old_prompt, new_prompt)` from `client/src/lib/line-diff.ts`, with added lines on `--ok`-tinted and removed on `--crit`-tinted backgrounds (AC-61). `same_prompt` shows "same prompt" (AC-62).
    - A config-differences list: "no config change" (AC-63), model change (AC-64), skills added, removed, reordered or changed (AC-62), case-set difference (AC-65).
    - **Promote v{new.agent_version}** (pure helper `promoteTarget(compare)`), disabled with `compare.promoteActive` when `promote.available` is false (AC-68).
    - **Promote confirm:** clicking Promote opens a confirm step. When `promote.skill_mismatch`, that step shows the `compare.skillMismatch` warning **before** the confirm button (AC-69). Promote never touches skill links (spec *Out of scope*).
    - On success, `usePromoteVersion` invalidates agent and eval queries (AC-66).
  - All prompt text renders as plain text in `<pre>`.

  Look at mockups **4** (detail) and **5** (compare modal) at `…/images/4.png` and `5.png`.
- **Constraint:** frontend-code-organization §1 (`CompareRunsModal` is route-local; only this route uses it), §4, §6. `client/INSIGHTS.md:163-170` (use `--accent` for blue). NFR-2 (the diff is computed client-side from two strings, with no model).
- **Owner:** `implementer`
- **Done when:** typecheck passes, and the helpers import nothing from `react`.

### Step 28 — Client component tests
- **Closes:** AC-1, AC-2, AC-3, AC-5, AC-10, AC-13, AC-20, AC-21, AC-22, AC-23, AC-24, AC-28, AC-29, AC-30, AC-49, AC-51, AC-53, AC-54, AC-56, AC-57 (render), AC-60, AC-61, AC-68, AC-69, AC-83 (UI)
- **Files:**
  - `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx` (edit)
  - `client/src/components/eval-case-modal/EvalCaseModal.test.tsx` (new)
  - `client/src/components/eval-metrics/EvalMetricTiles/EvalMetricTiles.test.tsx` (new)
  - `client/src/lib/eval-format.test.ts` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/EvalsTab.test.tsx` (new)
  - `client/src/app/eval/_components/RunAllAgentsButton/RunAllAgentsButton.test.tsx` (new)
  - `client/src/app/eval/[agentId]/_components/{RecentRunsTable,CompareRunsModal,PrecisionDipBanner}/*.test.tsx` (new)
- **Change:** `fetch` is mocked. Typological cases only:
  - **FindingCard:** enabled when accepted, enabled when dismissed, disabled with the hint when undecided (AC-1–3).
  - **Modal, seeded positive:** the banner shows the title and `src/config.ts:12`, and Save posts with no edits (AC-5, AC-10).
  - **Modal, seeded negative:** "assert empty" (AC-13).
  - **Modal, hand-made:** Save is disabled on an empty name and on invalid JSON (assert the textarea `.value` directly, `client/INSIGHTS.md:154-161`). Finding skeleton inserts the five keys. `must_not_flag` with a non-empty list is refused. The Files tab notice is present. Run on save shows the result line (AC-20–24).
  - **Tiles:** an empty state and no zeros when there are no runs, and no delta element for a null delta (AC-28, AC-49).
  - **EvalsTab:** 9 cases, 8 with a result and 6 passed, renders "6 / 8 passing" and "9 cases", with both badges (AC-29, AC-30).
  - **RunAllAgentsButton:** the confirm text states the agent and case counts before any POST (AC-53).
  - **RecentRunsTable:** Compare is disabled with 1 or 3 selected and enabled with 2 (AC-56).
  - **CompareRunsModal:** the v6 → v7 title, added and removed lines marked, Promote disabled when active, the skill-mismatch warning shown before confirm (AC-60, AC-61, AC-68, AC-69).
  - **PrecisionDipBanner:** renders "Precision dipped 2pts on v7".
  - **`eval-format`:** `pct(null) === "—"`, `costLabel(null) === "—"`.
  - **Nav:** a test (or assertion in an existing app-shell test) that `NAV` contains `eval` under SKILLS LAB and `activeKeyFor("/eval/x") === "eval"` (AC-51).

  Use `fireEvent` only (`client/INSIGHTS.md:125-131`). Query `Badge`s by text, buttons by role (`client/INSIGHTS.md:25-32`).
- **Constraint:** react-testing-library. `TESTING.md:38-40` (what the client suite covers).
- **Owner:** `test-writer`
- **Done when:** `cd client && pnpm test` passes.

### Step 29 — Architecture review pass
- **Closes:** none — review
- **Files:** read-only over the whole diff
- **Change:** Run `architecture-reviewer`. It checks:
  - **Server layering:**
    - `depcruise` is clean.
    - The eval module reaches agents and reviews only via `container.agentsRepo`/`container.reviewRepo` and `reviews/helpers.ts` pure functions.
    - `scoring.ts`/`helpers.ts` are pure.
    - `runner.ts` passes no enrichment to the engine (NFR-1).
    - R1's deviation from onion-architecture §14 is documented in a code comment in `service.ts` citing `platform/jobs.ts:51-53`.
  - **Data and contracts:**
    - The migration is generated, not hand-written.
    - The contract copies are identical.
  - **Frontend placement:**
    - the two `src/components/*` promotions
    - `src/lib/line-diff.ts`
    - route-local `CompareRunsModal`
    - no cross-route `_components` import

  Findings go back to `implementer`.
- **Constraint:** `.claude/skills/onion-architecture/SKILL.md` review checklist. frontend-code-organization review checklist.
- **Owner:** `architecture-reviewer`
- **Done when:** no CRITICAL or HIGH findings remain open.

### Step 30 — Security review pass
- **Closes:** none — review (NFR-5, NFR-6, NFR-8)
- **Files:** read-only over the whole diff
- **Change:** Run `security-reviewer` (lane: new public routes, workspace scoping, untrusted text to a model; routing.md:68). Focus:
  - **NFR-8:** every new route resolves workspace via `getContext`, and case, run, finding, compare and promote lookups 404 across workspaces. The seed endpoint checks `pull.workspaceId`.
  - **NFR-5:** no log line contains case diffs, PR meta or findings text. The runner logs ids, names and status only. The seeded `sk_live_…` fixture is an obviously fake demo key, not a real-format secret (confirm it doesn't trip the repo's secret gate).
  - **NFR-6:** frozen diffs and PR description reach the model only through `reviewPullRequest`/`assemblePrompt`'s existing wrapping and `INJECTION_GUARD`. Skill bodies are injected exactly as in reviews (`server/INSIGHTS.md:77-86`). The client renders diffs and prompts as plain text.
  - **Overrides:** `createFromFinding` ignores client-sent `input_*` (AC-17 integrity).
  - **Promote:** the run must belong to the agent in the workspace.
- **Constraint:** `.claude/skills/security/SKILL.md`. `server/CLAUDE.md:68-70`.
- **Owner:** `security-reviewer`
- **Done when:** no CRITICAL or HIGH findings remain open.

---

## Contract changes

Every change lives in `server/src/vendor/shared/contracts/{knowledge,eval-ci}.ts` (plus the doc comment in `server/src/vendor/shared/index.ts`). The whole `server/src/vendor/shared` directory is then copied byte-for-byte over `client/src/vendor/shared`. CI enforces this with `diff -r` (`.github/workflows/client.yml:47-53`), and `verify:l06` enforces it with `server/test/eval-contract-parity.test.ts` (S17). `mcp/` consumes the server copy by alias (`mcp/tsconfig.json:25-26`) and uses no eval shape.

- **New:**
  - `EvalExpectationKind`, `EvalExpectedFinding`, `EvalLocation`, `EvalPrMeta`, `EvalInputFile`, `EvalSkillSnapshotEntry`, `EvalCaseStatus`, `EvalRunStatus`
  - `EvalCaseSeed`, `EvalCaseFromFindingInput`, `EvalCaseResult`, `EvalCaseRecord`
  - `EvalAgentRun`, `EvalAgentRunDetail`, `EvalMetricTriple`, `EvalPrecisionDip`
  - `EvalAgentDetail`, `EvalAgentSummary`, `EvalWorkspaceDashboard`
  - `EvalSkillDiff`, `EvalCompare`, `EvalPromoteInput`, `EvalPromoteResult`, `EvalStartResult`, `EvalRunAllResult` (D2)
- **Changed:**
  - `EvalCase` gains kind, location, source and timestamps, and its typed inputs and expectations.
  - `EvalCaseInput` drops `owner_*` and gains kind rules.
  - `EvalRun` and `EvalTrendPoint` metrics become nullable, and `EvalTrendPoint` gains `version`.
- **Removed:** `EvalRunRecord`, `EvalRunResult`, `EvalDashboard`. Zero consumers, verified by grep at planning time. `RULE-CONTRACT-BREAK` is satisfied because both packages type-check against the new shapes in this change.

## Migration

**Yes.** Edit `server/src/db/schema/eval.ts` (and the barrel `server/src/db/schema.ts`) per D1, then run `cd server && pnpm db:generate`. **Never hand-write or edit the `.sql`, `meta/*_snapshot.json` or `meta/_journal.json`.** The generated file keeps its generator name (`NNNN_<word>_<word>.sql`). The change adds one table and adds nullable columns and indexes to two tables. It drops one FK on `eval_runs.case_id` and its NOT NULL. No column is dropped. Apply it with `cd server && pnpm db:migrate` (migrations never run on boot). Testcontainers suites migrate automatically (`server/test/helpers/pg.ts`).

## Test plan

| Suite | Command (verbatim from TESTING.md / CLAUDE.md) | Covers which step |
|---|---|---|
| server-unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | S16, S17. Regression for S5 (`reviews-helpers.test.ts`), S12 (`routes-smoke.test.ts`), S13, `contracts.test.ts` |
| server-integration | `cd server && pnpm exec vitest run .it.test` | S18. Regression for S4 (`agents-versions.it.test.ts`) and S14 (every seeded fixture) |
| **acceptance gate** | `cd server && pnpm verify:l06` (also run once under `env -u OPENAI_API_KEY -u OPENROUTER_API_KEY -u ANTHROPIC_API_KEY`) | AC-77, AC-78, AC-79 (S15–S18) |
| server typecheck | `cd server && pnpm typecheck` | S1–S15 |
| server architecture | `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` | S7–S12, S29 |
| reviewer-core | `cd reviewer-core && npm test` | Regression only (the engine is unchanged, but the eval path consumes `groundFindings`/`reviewPullRequest`) |
| client | `cd client && pnpm test` | S28. Regression for S21 (`DiffModal`), S24 (`FindingCard`), S25 (`AgentEditor`) |
| client typecheck | `cd client && pnpm typecheck` | S1, S19–S27 |
| contract parity | `diff -r client/src/vendor/shared server/src/vendor/shared` | S1, S17 |

e2e is not extended. Existing flows assert PR #482 only (`e2e/specs/02-*.flow.json`, `04-*.flow.json`, `05-*.flow.json`), and S14 leaves #482 untouched, so nothing regresses there. The new PR #491 adds one row to the PR list, and no e2e spec counts rows.

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| A test resolves `container.llm('openrouter')` (seeded agents' provider) without an override and makes a live, billed call | S18 | Override `openrouter`, `openai` and `anthropic`. Run `verify:l06` once under `env -u …_API_KEY`. `server/INSIGHTS.md:42-52`. |
| The integration test self-skips without Docker, so `verify:l06` passes vacuously | S15, S18 | `VERIFY_L06=1` turns "no Docker" into a failure (S18). |
| drizzle-kit can't express the partial unique index, or generates an interactive prompt | S2 | Read the generated SQL (S2 done-when). If the index is missing, keep R2's guarantee with a `SELECT … FOR UPDATE`-free fallback: insert inside a transaction that first checks `runningRunFor`, plus an in-process `Set<agentId>` guard (single API process, as stated at `server/src/app.ts:78-79`). Record whichever path was taken. For a prompt, split into two passes (`server/INSIGHTS.md:186-197`). |
| Fire-and-forget runs die with the process | S10, S12 | The boot reaper marks them `failed` (AC-84). The same accepted limit as reviews (`server/src/app.ts:70-85`). |
| A whole-run timeout in the JobRunner would kill or re-pay long runs | S10 | Not used (R1). Each case has its own `withTimeout`. |
| The seed change shifts other integration fixtures (counts, sums) | S14 | Re-run the full `.it` lane in S14's done-when. `server/INSIGHTS.md:240-247`. |
| A seeded fixture's expectation is not citable, so the demo set is "not runnable as-is" (FR-25) | S14 | Seed-time `isCitable` assertion throws. S18 asserts a full run over the seeded set completes. |
| Skill descriptions edited without a version bump go undetected in Compare | S8 | R3: compare on `content_hash` + `enabled`, not only `version`. |
| The model returns findings on files outside the frozen diff | S10 | They are dropped by the existing grounding gate and count only against citation accuracy (AC-45). No new code needed. |
| Case input contains secrets copied from real diffs | S10, S30 | Never logged. Sent only to the agent's provider. Stays in the local DB (NFR-5). The S30 review greps the log calls. |
| `server/package.json` turns out to be skip-worktree on another machine | S15 | S15 checks `git ls-files -v` first and stops on `S`. |
| The vendored `nav.ts` edit is overwritten by a future UI sync (`RULE-VENDOR`) | S26 | The same accepted practice as three prior features. Noted for the PR description. |
| `MetricCard` renders a delta of 0 as "flat" and has no "no delta" state | S22 | Omit the `delta` prop entirely when it is null (the prop is optional). |
| The client polls too often | S19 | 2 s only while a run is `running`. Each poll reads one PK row plus results by an indexed `suite_run_id` (NFR-4). |

## Out of scope

- The rest of L06: Secret-leak and Phantom-API gates, Plan Verifier, Export to CI.
- Skill-owned eval cases (`owner_kind = 'skill'` stays unused).
- The *Learn* and *Reply to author* finding actions shown in mockup 1.
- Restoring skill links through Promote. The modal warns instead (AC-69).
- Changing how agent versions react to skill changes (decision 3).
- Cancelling an in-flight run. LLM-as-judge or semantic matching. CI or scheduled eval runs. Case import and export. Repeated sampling and significance testing.
- Any change to `reviewer-core`.
- Fixing the stale "`server/package.json` is skip-worktree" statements in `CLAUDE.md`, `TESTING.md` and `server/CLAUDE.md`. Those are harness docs, and editing a `CLAUDE.md` triggers `pnpm eval:workflow` (`CLAUDE.md`, Harness evals). Recommended as a separate follow-up plus an `engineering-insights` entry once confirmed.
- Updating the `specs/README.md` status of spec 04 to *implemented*. That is the caller's edit after verification.
- Extending e2e browser flows.
- Committing or pushing anything.

## Open questions

None of these block implementation. The spec has no open questions, and the plan settles every implementation choice in D1–D10. Each default below is what the plan already does:

1. **Negative slug prefix** (D4). The spec says only "a negative prefix". The plan uses `no-`, matching mockup 8 ("no-unused-import-warning"). Change `EVAL_NEGATIVE_PREFIX` if `must-not-flag-` is preferred.
2. **Precision-dip rounding** (D6). "≥ 1 point after rounding" is read as rounding the *difference* to whole points. Rounding each value first would differ only on half-point edges, e.g. 0.935 → 0.93.
3. **Hand-made case citability.** The spec's refusal list for hand-made cases (AC-20, AC-22) does not include "expectation not citable in the given diff", so the plan does not enforce it. Such a case simply can't pass. Say so if hand-made cases should also be refused.
