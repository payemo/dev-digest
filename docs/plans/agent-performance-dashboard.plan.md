# Development Plan: Agent Performance dashboard plus agent Stats tab, both built on one per-agent Stats aggregation

**Branch:** `feat/agent-performance-dashboard` (recommended, cut from `main`; the current branch `fix/lab07-review-feedback` is already merged as PR #18) · **Date:** 2026-10-13
**Packages touched:** server · client · shared (`server/src/vendor/shared` + its physical copy in `client/src/vendor/shared`)
**Estimated steps:** 12 · **Migration required:** no · **Contract change:** yes (`AgentStats` widened, `AgentPerformance` added)
**Execution mode:** **multi-agent** (confirmed by the user).
- `implementer` runs Steps 1–3, 5–10 and 12.
- `test-writer` runs Step 4 (server tests) and Step 11 (client tests).
- After implementation, `architecture-reviewer` and `security-reviewer` run as review passes. The security lane triggers on two new public routes, workspace scoping and raw `sql` fragments.
- Review findings go back to `implementer` in the bounded fix loop (the `/implement` pipeline).

## Requirements

**Sources read:** the change request (translated from Ukrainian), the mockup image `2.png`, and the user's answers to the planner's questions Q0–Q7. No spec exists for this feature: nothing for it under `server/specs/`, `client/specs/` or the top-level `specs/` (`specs/README.md` indexes 01–06, and none of them is this feature). There are no AC-IDs, so the request's bullets got local IDs below. R11–R13 and AC8–AC11 come from the user's answers.

**Clarifications resolved with the user:**
- **Q0:** multi-agent execution.
- **Q1:** implement `GET /agents/:id/stats` **and** add a Stats tab to the agent editor. "View" links to `/agents/{id}?tab=stats` (this also resolves Q2).
- **Q3:** Agent Performance becomes the first GLOBAL item, before CI Runs. Multi-Agent Review stays in WORKSPACE and no Memory item is added.
- **Q4:** include the cost delta vs the previous period (Total cost card), the accept-rate trend arrows (table), and the Total runs sparkline (cheap: daily buckets from the same run list).
- **Q5:** page-local donut built on `recharts` + `formatUsd`. The vendored `Donut` is not touched.
- **Q6:** CI runs count toward runs and cost and contribute zero decisions.
- **Q7:** small-sample threshold = 10 decisions.

| ID | Requirement / acceptance criterion | Covered by step |
|---|---|---|
| R1 | "Agent Performance" in the GLOBAL sidebar section, before "CI Runs" | 6 |
| R2 | Periods: 1 day, 30 days, custom range | 2, 7, 8, 9 |
| R3 | KPI cards: Total runs, Total cost, Avg accept rate, Most-active agent | 2, 8 |
| R4 | Table: Agent, Runs, Avg cost, Avg duration, Accept rate, Last run, View | 2, 8 |
| R5 | Cost breakdown by agent and by model (donuts with legends and $ values) | 2, 8 |
| R6 | Same API and aggregation rules as the agent's Stats tab | 1, 2, 9 (one service method serves both routes and both UIs) |
| R7 | Loading, empty and error states | 8, 9 |
| R8 | No model calls. Reads stored runs and findings only | 2, 4, 11 |
| R9 | Show the accept-rate denominator (decisions) and the runs in the period | 1, 8, 9 |
| R10 | Accept-rate sorting only for agents with enough decisions, or flag small samples (threshold 10, justified below) | 2, 8 |
| R11 | Agent editor Stats tab (`/agents/{id}?tab=stats`). "View" links there | 9 |
| R12 | Total cost card shows the delta vs the previous equal-length period | 1, 2, 8 |
| R13 | Accept column shows a trend arrow vs the previous period. Total runs card shows a daily sparkline | 1, 2, 7, 8, 9 |
| AC1 | Runs, cost, duration and accept rate match the Stats tab for the same agent and period | 2, 4, 9, 11 |
| AC2 | Total cost = sum of counted runs. By-agent and by-model breakdowns each sum to the total | 2, 4, 8 |
| AC3 | Most-active agent = most runs in the period | 2, 4 |
| AC4 | "Agent with no runs" and "fully empty dashboard" are different, correct states | 2, 8, 9, 11 |
| AC5 | Loading and error states never show invented zeros | 8, 9, 11 |
| AC6 | Reload, sorting and row expansion never trigger a review or model call | 4, 8, 11 |
| AC7 | Cost labels say which numbers are DevDigest estimates and which are reconciled billing | 1, 8, 9 |
| AC8 | Cost delta = current total − previous-window total under identical rules. No delta is rendered when either window has no counted runs | 2, 4, 8, 11 |
| AC9 | A trend arrow appears only when both windows have ≥ 10 decisions. It compares the displayed integer accept-rate percentages. No arrow is invented otherwise | 2, 4, 7, 8, 11 |
| AC10 | The sparkline's daily buckets sum to Total runs | 2, 4 |
| AC11 | The "View" link opens the agent's Stats tab on the same window, and its numbers equal that table row | 8, 9, 11 |

**Findings from reading the code that shaped the plan:**

1. **No agent Stats tab existed.** The agent editor ships Config, Skills, Context, Evals and CI. Its own comments say Stats arrives later (`client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx:1`, `.../AgentEditor/constants.ts:10-11`), and `VALID_TABS` omits it (`client/src/app/agents/[id]/page.tsx:15`). The i18n label already exists (`client/messages/en/agents.json:50`, `editor.tabs.stats`). The intended API contract exists but is unused: `AgentStats` for `GET /agents/:id/stats` (`server/src/vendor/shared/contracts/observability.ts:91-121`). This plan builds the route and the tab on the same service as the dashboard.
2. **No reconciled billing data exists.** `agent_runs.cost_usd` holds two kinds of value with no column recording which: OpenRouter's provider-reported `usage.cost` (`reviewer-core/src/llm/openrouter.ts:96-107`), and a price-table estimate the OpenAI/Anthropic adapters write into the same column (`server/src/adapters/llm/openai.ts:84`, `server/src/adapters/llm/anthropic.ts:85`). When the column is null, cost is derived on read (`server/src/platform/run-cost.ts:31-35`). → Every response carries `cost_basis: 'estimate'` and every cost figure, the delta included, is labelled "Estimated (DevDigest)". The UI says no reconciled billing is available.
3. **Pre-scaffolded pieces:** `client/messages/en/agentPerformance.json` (keys need rewriting), `client/messages/en/shell.json` `nav.agent-performance`, `activeKeyFor` → `/agent-performance` (`client/src/components/app-shell/helpers.ts:37`).
4. **Lesson rule:** the agent performance dashboard and per-agent stats are lessons L08/L07 (`README.md:89-90`). `RULE-LESSON` warns when one lands on a branch targeting `main` (`.claude/skills/pr-self-review/repo-rules.md:211-217`, `CLAUDE.md:186`). The user requested this explicitly, so acknowledge the warning in the PR body.

## Recommendation

Build the per-agent Stats endpoint and derive everything from it. One service method, `AgentStatsService.compute(workspaceId, window, { agentId? })`, produces `AgentStats` rows:

- `GET /agents/:id/stats` returns one row, and the Stats tab renders it.
- `GET /agent-performance` returns all rows plus totals and breakdowns built from the **same rows and the same per-run cost list**.
- The previous-period figures (cost delta, accept trend) come from calling the **same** `compute` on the preceding window. They cannot drift from the current-period rules.

This makes AC1, AC2 and AC11 hold structurally, not just by testing two code paths against each other. Per-run cost reuses `effectiveRunCost` (`server/src/platform/run-cost.ts:31`) and the `status = 'done'` rule (`server/specs/pr-cost-and-findings.md` § `cost_usd`), so dashboard cost also agrees with the PR list. No schema change.

The vendored `Donut` hardcodes `$` + `.toFixed(2)` (`client/src/vendor/ui/charts/Donut.tsx`, `client/INSIGHTS.md:133`), so it is not used. A route-local `CostDonut` on `recharts` (already a dependency, `client/CLAUDE.md` Stack) with `formatUsd` (`client/src/lib/format.ts:13`) replaces it, as the user confirmed. `MetricCard`'s `delta` colours down as red (`client/src/vendor/ui/charts/MetricCard.tsx`), which is the wrong polarity for cost, so the cost delta renders in its own element below the card.

## Goal

A GLOBAL-section sidebar link opens `/agent-performance`. For a 1-day, 30-day or custom window it shows:
- KPI cards: runs with a daily sparkline, estimated cost with a delta vs the previous equal-length window, pooled accept rate with its decision count, and the most-active agent.
- A per-agent table with low-sample flags and evidence-gated accept-trend arrows.
- Cost donuts by agent and by model that sum to the total.

Each row's View opens `/agents/{id}?tab=stats` on the same window, and that tab shows identical numbers because both come from one server aggregation. Nothing on either page calls a model. Loading and error states render skeletons or "—", never 0.

## Inputs read

| File | What it constrained |
|---|---|
| `CLAUDE.md:132-141` | No workspace. `@devdigest/shared` is the one contract source |
| `CLAUDE.md:142-144`, `TESTING.md:76-91` | `*.it.test.ts` split, verbatim test commands |
| `CLAUDE.md:175-178`, `server/CLAUDE.md:79-83` | No hand-edited migrations (none planned) |
| `CLAUDE.md:186`, `README.md:89-90`, `.claude/skills/pr-self-review/repo-rules.md:211-217` | L07/L08 lesson rule → expected `RULE-LESSON` warning |
| `server/CLAUDE.md:53-55` | Query params validated by a zod route schema |
| `server/INSIGHTS.md:56` | A `reviews` row implies a `status='done'` run |
| `server/INSIGHTS.md:88` | Denominators exclude rows that can't carry the signal (pending ≠ decision) |
| `server/INSIGHTS.md:100` | No cross-module service imports |
| `server/src/modules/skills/repository.ts:7-17` | Precedent: a stats repository reads other modules' tables read-only |
| `server/src/platform/run-cost.ts:31-48` | Single per-run cost policy (`effectiveRunCost`, `sumRunCosts`, 1e-6 rounding) |
| `server/src/modules/multi-agent/service.ts:33-35` | Estimator via `container.priceBook.estimate` |
| `server/specs/pr-cost-and-findings.md` § `cost_usd` | Done runs only. Empty → `null`, never `$0.00` |
| `server/src/db/schema/runs.ts:35-75` | `agent_runs` columns. `agentId` is set-null on agent delete. No `(workspace_id, ran_at)` index |
| `server/src/db/schema/reviews.ts:11-60`, `server/src/modules/reviews/repository/review.repo.ts:126,139` | `reviews.run_id` link. `accepted_at` / `dismissed_at` are mutually exclusive |
| `server/src/modules/ci/repository.ts:231-260` | CI runs write `agent_runs` (source `ci`) with no reviews/findings |
| `server/src/vendor/shared/contracts/observability.ts:91-121` | Unused `AgentStats` / `StatPoint` to implement and widen |
| `server/src/vendor/shared/contracts/skills.ts:80-111` | Precedent: numerator + denominator exposed, null rate rather than 0 |
| `.github/workflows/client.yml:6-11`, `repo-rules.md:116-126` | `client/src/vendor/shared` is a physical copy, and CI fails on drift |
| `client/CLAUDE.md:42-50,62` | snake_case DTOs, hooks-only fetching, no duplicated vendored primitives |
| `client/INSIGHTS.md` (nav-label entry) | Nav label lives in both `nav.ts` and `shell.json` (the latter already has it) |
| `client/INSIGHTS.md:81,133-145` | `Badge` needs a wrapping `<span title>`. `Donut` is money-only at 2dp. `MetricCard.suffix` is for a unit |
| `client/INSIGHTS.md` (`user-event` entry) | Client tests use `fireEvent` |
| `client/INSIGHTS.md` (`--info` entry) | Verify token values in `styles.css` before choosing colours |
| `client/src/vendor/ui/nav.ts:33,53-60` | GLOBAL holds only CI Runs. Multi-Agent Review is in WORKSPACE |
| `client/src/app/agents/[id]/page.tsx:15,26-31` | `VALID_TABS` and the `?tab=` mechanics (`setTab` preserves other params) |
| `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`, `.../constants.ts` | Tab registry and render branches |
| `client/src/app/skills/.../SkillEditor/_components/StatsTab/StatsTab.tsx` | Existing Stats-tab UI pattern (Skeleton/ErrorState/MetricCard + caption span) |
| `client/src/app/ci-runs/page.tsx` | Global page shape (`AppShell` + `Suspense`) |
| `client/src/lib/hooks/keys.ts`, `client/src/lib/hooks/skills.ts:100-108` | Query-key factory + `useQuery` pattern |
| `.claude/skills/pr-self-review/routing.md` | Skill lanes per planned file |

## Architectural constraints binding this change

- Aggregation SQL lives only in a `repository.ts`. The service composes pure helpers. Routes validate and call the service — source: `.claude/skills/onion-architecture/SKILL.md:101,317-324`.
- The new module never imports `agents`/`reviews`/`skills`/`multi-agent` repositories or services. It reads `agents`, `agent_runs`, `reviews`, `findings` itself, read-only — source: `server/src/modules/skills/repository.ts:7-17`, `onion-architecture/SKILL.md:317`.
- Per-run cost = `effectiveRunCost`, estimator = `container.priceBook.estimate`. A stored `costUsd` is never re-derived — source: `server/src/platform/run-cost.ts:21-35`, `server/src/modules/multi-agent/service.ts:33-35`.
- Counted runs = `status = 'done'`, applied in the SQL `WHERE` — source: `server/specs/pr-cost-and-findings.md`, `server/docs/pr-list-aggregation.md` (§ Cost).
- Every query is workspace-scoped — source: `server/src/modules/skills/repository.ts:17`, `server/src/db/schema/runs.ts:39-41`.
- Query params are validated via a zod schema on the route — source: `server/CLAUDE.md:53-55`.
- Contracts change in `server/src/vendor/shared` and are byte-copied to `client/src/vendor/shared` — source: `CLAUDE.md:137-139`, `.github/workflows/client.yml:6-11`.
- No model call on the read path. The only possible outbound effect is `PriceBook`'s lazy price-list refresh, which runs no inference — source: `server/src/platform/price-book.ts:33-38,59-73`.
- Client fetches only via `src/lib/hooks/*` — source: `client/CLAUDE.md:48-50`.
- Code used by two routes (the period selector, its window helper, `TrendArrow`) lives under `src/components/<kebab-case>/`, not inside one route's `_components/` — source: `client/CLAUDE.md` Naming ("Cross-route shared components…").
- User-facing strings live in `client/messages/en/*.json` — source: `.claude/skills/pr-self-review/routing.md` (frontend i18n row).

## Aggregation rules (single source of truth: `server/src/modules/agent-stats/helpers.ts`)

| Metric | Rule |
|---|---|
| Window | Half-open `[from, to)` on `agent_runs.ran_at`, ISO-8601 with offset. **1 day** = `[now − 24h, now)`. **30 days** = `[now − 30×24h, now)`. **Custom** = `[startDate 00:00 local, endDate+1 00:00 local)`. Server rejects `from >= to` or a span > 366 days (422). |
| Previous window | `[from − (to − from), from)`: the equal-length window immediately before, for presets and custom ranges alike. Computed **server-side** from the validated `from`/`to`. Returned as `previous_window`. |
| Runs (`runs`) | Count of `status='done'` runs in window. Includes `source='local'` and `source='ci'`. |
| Failed runs (`failed_runs`) | `status IN ('failed','cancelled')` in window. Never part of cost, duration or accept rate. |
| Cost per run | `effectiveRunCost(row, priceBook.estimate)` on done runs. `null` → counted in `unpriced_runs`. |
| Total cost (`total_cost_usd`) | `sumRunCosts` semantics: unpriced contributes 0, an empty list → `null`, rounded to 1e-6 once at the end. |
| Avg cost (`avg_cost_usd`) | Sum of priced costs / number of priced runs. `null` when no runs are priced. |
| Avg duration (`avg_latency_ms`) | Mean `duration_ms` over done runs with a non-null duration. `null` when none. |
| Decisions (`decisions`) | `accepted + dismissed` over findings whose `reviews.run_id` is a done run of this agent in window. Pending findings are excluded. CI runs contribute none (they have no reviews). |
| Accept rate (`accept_rate`) | `accepted / decisions` (0..1). `null` when `decisions = 0`. |
| Small sample (`low_sample`) | `decisions < MIN_DECISIONS_FOR_RANKING = 10`. Justification: below 10 decisions the 95% Wilson interval on a proportion is wider than ±25 points (5/7 = 71% → roughly 36–92%), so ranking or trending on it is noise. 10 is still reachable within days in a lightly used workspace. Computed server-side so the threshold lives in one place. |
| Last run (`last_run_at`) | Max `ran_at` over runs of any status in window. `null` when there are none. |
| Most-active agent | Highest `runs`. Ties broken by later `last_run_at`, then name A→Z. `null` when total runs = 0. |
| Avg accept rate (KPI) | **Pooled** Σaccepted / Σdecisions. `null` when Σdecisions = 0. Pooled so a 1-decision agent can't swing the headline. |
| Cost delta (`cost_delta_usd`) | `totals.total_cost_usd − previous_totals.total_cost_usd`, rounded to 1e-6. **`null` when either side is `null`** (no counted runs in that window), so there is no invented delta against an empty period. The previous total uses exactly the same rules. |
| Accept trend (`accept_trend`, per agent) | Compares the **current vs previous-window accept rate of that agent**. Defined only when both windows have `low_sample === false`. Otherwise `null` (no arrow). With both defined: `cur = round(accept_rate×100)`, `prev = round(previous.accept_rate×100)`. `cur > prev` → `'up'`, `cur < prev` → `'down'`, equal → `'flat'`. Comparing the **displayed** integers means an arrow can never contradict two identical visible percentages. The delta is exposed as `accept_rate_delta_pp = cur − prev` (or `null`). |
| Daily trend (`trend`, per agent; `runs_trend`, totals) | Done runs per **UTC day** in window, oldest→newest, zero-filled, built in JS from the same done-run list already fetched (no extra query). `runs_trend` = per-day sum over all done runs, deleted agents included, so Σ`runs_trend` = `totals.runs` (AC10). The UI renders the sparkline only when the window spans ≥ 2 UTC days. The 1-day window has a single bucket, so no sparkline is shown (by design, not a missing feature). |
| Cost by agent | Per-agent `total_cost_usd`. Runs with `agent_id IS NULL` (deleted agent) form one "Deleted agent" slice, so the slices sum to the total. |
| Cost by model | Group done runs by `agent_runs.model` (null → "Unknown model"). Sums to the total. |
| Agent list | Every workspace agent (enabled or not) gets a row, including agents with 0 runs in the window. |

## Skills to be applied

| Path to be touched | Lane | Skills (per routing.md) |
|---|---|---|
| `server/src/vendor/shared/contracts/observability.ts` | backend contracts | zod · `RULE-CONTRACT-SYNC` · `RULE-CONTRACT-BREAK` |
| `client/src/vendor/shared/contracts/observability.ts` | frontend vendor | none (`RULE-VENDOR`, `RULE-CONTRACT-SYNC`: byte copy) |
| `server/src/modules/agent-stats/routes.ts` | backend | fastify-best-practices · onion-architecture · zod · **security** (new public routes, workspace scoping) |
| `server/src/modules/agent-stats/{service,helpers,constants}.ts` | backend | onion-architecture |
| `server/src/modules/agent-stats/repository.ts` | backend | onion-architecture · drizzle-orm-patterns · **security** (`sql\`` fragments, workspace filter) |
| `server/src/modules/index.ts` | backend registry | onion-architecture |
| `server/test/agent-stats-helpers.test.ts`, `server/test/agent-stats.it.test.ts` | backend tests | none (`RULE-IT-SUFFIX`) |
| `client/src/vendor/ui/nav.ts` | frontend vendor | none (`RULE-VENDOR` WARNING; precedent commits `05bca9e`, `f30ca7b`, `f1b1b76`) |
| `client/src/components/stats-period/**` | frontend shared component (new folder) | react-best-practices · frontend-code-organization |
| `client/src/app/agent-performance/page.tsx` | Next file convention | next-best-practices · frontend-code-organization |
| `client/src/app/agent-performance/_components/**/*.tsx` | frontend (new folders) | react-best-practices · frontend-code-organization |
| `client/src/app/agents/[id]/page.tsx` | Next file convention | next-best-practices · frontend-code-organization |
| `client/src/app/agents/[id]/_components/AgentEditor/**` (incl. new `StatsTab/`) | frontend | react-best-practices · frontend-code-organization |
| `client/src/lib/hooks/agent-performance.ts`, `client/src/lib/hooks/keys.ts` | frontend hooks | react-best-practices · frontend-code-organization |
| `client/messages/en/agentPerformance.json`, `client/messages/en/agents.json` | frontend i18n | frontend-code-organization |
| `client/**/*.test.tsx` (new and edited) | frontend tests | react-testing-library |
| `docs/plans/agent-performance-dashboard.plan.md` | no lane (`docs/**`) | none, listed as uncovered |

Skill check: the onion-architecture placement rules (`SKILL.md:101,171,317-324`) fixed the module shape. The `client/CLAUDE.md` cross-route rule put the period selector and `TrendArrow` in `src/components/`. The `client/INSIGHTS.md` Donut and MetricCard entries fixed the chart and delta rendering. No `typescript-expert` triggers are planned.

## Steps

### Step 1 — Widen `AgentStats`, add `AgentPerformance` and the window query contract
- **Closes:** R6, R9, R12, R13, AC7 (shape). Prerequisite for every later step.
- **Files:** `server/src/vendor/shared/contracts/observability.ts` (edit), then `client/src/vendor/shared/contracts/observability.ts` (edit, byte copy). Also `server/src/vendor/shared/index.ts` and its client copy, only if the barrel needs new names.
- **Change:**
  - Add `StatsWindow = z.object({ from: z.string(), to: z.string() })`.
  - Add `CostBasis = z.literal('estimate')`, with a doc comment: no reconciled billing exists, and `cost_usd` mixes OpenRouter-reported and price-table values.
  - Add `AcceptTrend = z.enum(['up','down','flat'])`.
  - Add `PeriodComparison = z.object({ runs: z.number().int(), decisions: z.number().int(), accept_rate: z.number().nullable(), low_sample: z.boolean(), total_cost_usd: z.number().nullable() })`.
  - Extend `AgentStats`. It is unused today (rg-confirmed), so the change is non-breaking. Keep all existing fields; `avg_latency_ms` = average duration, and `trend` = daily done-run counts, UTC, zero-filled. Add:
    - `window: StatsWindow`, `previous_window: StatsWindow`
    - `enabled: z.boolean()`
    - `decisions: z.number().int()`, `failed_runs: z.number().int()`, `unpriced_runs: z.number().int()`
    - `last_run_at: z.string().nullable()`
    - `low_sample: z.boolean()`
    - `previous: PeriodComparison`
    - `accept_trend: AcceptTrend.nullable()`, `accept_rate_delta_pp: z.number().int().nullable()`
    - `cost_basis: CostBasis`

    Update the doc comments: rate is 0..1 and null when `decisions = 0`; the trend arrow is evidence-gated.
  - Add `CostSlice = z.object({ key: z.string(), label: z.string(), cost_usd: z.number(), runs: z.number().int() })`.
  - Add `AgentPerformance`, with these fields:
    - `window`, `previous_window`, `cost_basis`
    - `min_decisions_for_ranking: z.number().int()`
    - `totals: z.object({ runs, failed_runs, unpriced_runs, deleted_agent_runs, total_cost_usd: nullable, accepted, dismissed, decisions, accept_rate: nullable })`
    - `previous_totals: z.object({ runs, total_cost_usd: nullable, decisions, accept_rate: nullable })`
    - `cost_delta_usd: z.number().nullable()`
    - `most_active: z.object({ agent_id, agent_name, runs, accept_rate: nullable, decisions }).nullable()`
    - `agents: z.array(AgentStats)`
    - `cost_by_agent: z.array(CostSlice)`, `cost_by_model: z.array(CostSlice)`
    - `runs_trend: z.array(StatPoint)`
  - Add `StatsWindowQuery`: `from` and `to` as `z.string().datetime({ offset: true })`, refined so `from < to` and span ≤ 366 days.
  - Export each as a const plus a type of the same name (`server/CLAUDE.md` Naming).
- **Constraint:** one contract source, physical copy kept identical (`CLAUDE.md:137`, `.github/workflows/client.yml:6-11`).
- **Owner:** implementer
- **Done when:** `diff -r client/src/vendor/shared server/src/vendor/shared` prints nothing, and `cd server && pnpm typecheck` and `cd client && pnpm typecheck` both pass.

### Step 2 — New server module `agent-stats`: current window, previous window, trends, delta
- **Closes:** R2–R6, R8, R10, R12, R13, AC1–AC4, AC8, AC9, AC10
- **Files (new):** `server/src/modules/agent-stats/constants.ts`, `server/src/modules/agent-stats/helpers.ts`, `server/src/modules/agent-stats/repository.ts`, `server/src/modules/agent-stats/service.ts`, `server/src/modules/agent-stats/routes.ts`
- **Change:**
  - `constants.ts`: `MIN_DECISIONS_FOR_RANKING = 10` (doc comment carries the Wilson justification), `MAX_WINDOW_DAYS = 366`, `DELETED_AGENT_KEY = 'deleted'`, `UNKNOWN_MODEL_KEY = 'unknown'`.
  - `repository.ts` (`AgentStatsRepository(db: Db)`): read-only, workspace-scoped queries, each taking `(ws, from, to, agentId?)`.
    - (a) `listAgents(ws)` → id, name, enabled.
    - (b) `doneRuns` → `id, agentId, model, costUsd, tokensIn, tokensOut, durationMs, ranAt`, with `status='done'` in SQL.
    - (c) `runStatusCounts` → per `agentId`: failed+cancelled count and `max(ran_at)` over all statuses.
    - (d) `decisionCounts` → per `agent_runs.agent_id`: `count(accepted_at)`, `count(dismissed_at)`, `count(*)`, severity counts, via `findings → reviews.run_id → agent_runs`, filtered on the run's window, workspace and `status='done'`.
    - Header comment mirrors `server/src/modules/skills/repository.ts:7-17`.
  - `helpers.ts` (pure, no I/O): implements every row of *Aggregation rules*.
    - `previousWindow(from, to)`
    - `buildAgentStats(rows…, estimator)` using `effectiveRunCost` from `server/src/platform/run-cost.ts`
    - `attachComparison(current, previous)`, which fills `previous`, `accept_trend` and `accept_rate_delta_pp`
    - `buildPerformance(currentRows, previousRows, runs…)`, which builds totals, breakdowns, `cost_delta_usd`, `most_active` and `runs_trend`
    - `zeroFillDailyUtc(from, to, ranAts)`, `pickMostActive`, `pooledAcceptRate`

    One per-run cost list feeds the total and both breakdowns.
  - `service.ts` (`AgentStatsService(container)`): estimator via `container.priceBook.estimate` (pattern `server/src/modules/multi-agent/service.ts:33-35`).
    - `compute(ws, window, agentId?)` runs (a)–(d) in parallel.
    - `agentStats(ws, id, window)` calls `compute` for the window and for `previousWindow(window)` with the same `agentId`, then returns the single row with its comparison. It throws `NotFoundError` (`platform/errors`) if the agent isn't in the workspace.
    - `performance(ws, window)` calls `compute` for both windows and returns `buildPerformance(...)`.
    - Both public methods share `compute` and `attachComparison`, so a dashboard row and a Stats-tab response are identical for the same window.
  - `routes.ts`:
    - `GET /agents/:id/stats` (params `IdParams` from `server/src/modules/_shared/schemas.ts:11`, querystring `StatsWindowQuery`, response `AgentStats`)
    - `GET /agent-performance` (querystring `StatsWindowQuery`, response `AgentPerformance`)
    - Workspace via `getContext` (as at `server/src/modules/skills/routes.ts:112`). Header comment lists both routes.
- **Constraint:** onion layering (`onion-architecture/SKILL.md:101,171,317-324`). No Drizzle outside `repository.ts`. Validation on the route schema only (`server/CLAUDE.md:53-55`). No `container.llm(...)`.
- **Owner:** implementer
- **Done when:** `cd server && pnpm typecheck` passes. `rg -n "llm\(|\.complete\(|runReview" server/src/modules/agent-stats` returns nothing. `rg -n "from '\.\./(agents|reviews|skills|multi-agent)/" server/src/modules/agent-stats` returns nothing.

### Step 3 — Register the module
- **Closes:** none. Prerequisite for Steps 4, 8 and 9.
- **Files:** `server/src/modules/index.ts` (edit)
- **Change:** add `import agentStats from './agent-stats/routes.js';` and an `agentStats` entry in `modules` (pattern `server/src/modules/index.ts:25-60`).
- **Constraint:** static registration (the "ADD A MODULE" comment in that file).
- **Owner:** implementer
- **Done when:** the existing `server/test/routes-smoke.test.ts` passes.

### Step 4 — Server tests: helpers (unit) and endpoint parity (integration)
- **Closes:** AC1, AC2, AC3, AC4 (server), AC6/R8 (server), AC8, AC9, AC10, R10
- **Files (new):** `server/test/agent-stats-helpers.test.ts` (hermetic), `server/test/agent-stats.it.test.ts` (DB-backed)
- **Change:**
  - **Unit:**
    - `previousWindow` for 24h, 30d and an odd custom span.
    - Null-vs-zero: `accept_rate: null` with no decisions, `total_cost_usd: null` with no runs.
    - Breakdown sums equal the total within 1e-6, including deleted-agent and unknown-model runs.
    - `avg_cost_usd` excludes unpriced runs.
    - `low_sample` boundary at 9 vs 10 decisions.
    - `accept_trend`: up, down and flat (equal rounded %, e.g. 0.704 vs 0.696 → flat), and `null` when either window is low-sample or has no decisions.
    - `cost_delta_usd`: `null` when the previous window has no runs, `null` when the current window has none, and a signed value otherwise.
    - Σ`runs_trend` = `totals.runs`. Zero-filled UTC days.
    - Most-active tie-break.
    - Pending findings excluded from `decisions`.
  - **Integration:** seed agents, plus runs that are done/failed, local/ci, in the current window, in the previous window and out of both, and one with null `agent_id`; also reviews and findings that are accepted, dismissed and pending. Assert:
    - For every agent, `GET /agents/:id/stats?from&to` deep-equals its element in `GET /agent-performance?from&to` (AC1/AC11).
    - `previous_totals` equals a direct `GET /agent-performance` on `previous_window`, so the previous period uses identical rules (AC8).
    - Other-workspace runs are excluded.
    - An agent with 0 runs returns `runs: 0, accept_rate: null, last_run_at: null, accept_trend: null`.
    - An empty workspace returns `totals.runs: 0, total_cost_usd: null, cost_delta_usd: null, most_active: null`.
    - 422 on `from >= to` or a span > 366 days. 404 for an unknown or foreign agent.
    - The LLM mocks from `server/src/adapters/mocks.ts` record **zero** calls (R8/AC6).
- **Constraint:** the DB-backed file must end `.it.test.ts` (`CLAUDE.md:142-144`). Insert fixtures in the test itself, not via seed totals (`server/INSIGHTS.md`, "fixture assumptions go stale" entry).
- **Owner:** test-writer
- **Done when:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` and `cd server && pnpm exec vitest run .it.test` both pass, with the new files included.

### Step 5 — Client query keys and hooks
- **Closes:** R8 (read-only seam). Prerequisite for Steps 8 and 9.
- **Files:** `client/src/lib/hooks/keys.ts` (edit), `client/src/lib/hooks/agent-performance.ts` (new)
- **Change:**
  - In `keys.ts`, add `agentPerformanceKeys = { window: (from, to) => ["agent-performance", from, to] as const, agentStats: (id, from, to) => ["agent-stats", id, from, to] as const }`, with a doc comment in the style of `skillKeys`.
  - In `agent-performance.ts`, add `useAgentPerformance(window | null)` → `api.get<AgentPerformance>(\`/agent-performance?from=…&to=…\`)`.
  - In the same file, add `useAgentStats(id, window | null)` → `api.get<AgentStats>(\`/agents/${id}/stats?from=…&to=…\`)`.
  - Both use URL-encoded params, `enabled` only when the window (and id) is set, `staleTime: 60_000` and `placeholderData: keepPreviousData`. **Queries only, no mutations.**
- **Constraint:** fetch only through hooks (`client/CLAUDE.md:48-50`). One hook per server call.
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck` passes, and `rg -n "useMutation|\.post\(|\.put\(" client/src/lib/hooks/agent-performance.ts` returns nothing.

### Step 6 — Sidebar entry: first item in GLOBAL, before CI Runs
- **Closes:** R1
- **Files:** `client/src/vendor/ui/nav.ts` (edit)
- **Change:** in the `GLOBAL` group (`nav.ts:53-60`), insert `{ key: "agent-performance", label: "Agent Performance", icon: "Activity", href: "/agent-performance" }` before `ci-runs`. Give it the same "No gKey… label duplicated in messages/en/shell.json under `nav.agent-performance`" comment the sibling items carry. Multi-Agent Review stays in WORKSPACE.
- **Constraint:** expected `RULE-VENDOR` WARNING (precedent commits). The label must match `shell.json` `nav.agent-performance` (`client/INSIGHTS.md` nav-label entry). `activeKeyFor` already maps the path (`client/src/components/app-shell/helpers.ts:37`).
- **Owner:** implementer
- **Done when:** the existing `client/src/components/app-shell/helpers.test.ts` passes, and the command palette lists "Go to Agent Performance" (derived from `NAV`, `client/src/components/app-shell/hooks/useShellCommands.ts:20-28`).

### Step 7 — Shared stats pieces used by both pages: period selector, window helper, TrendArrow
- **Closes:** R2, R13 (arrow component), AC9 (rendering rule)
- **Files (new):** `client/src/components/stats-period/StatsPeriodSelector.tsx`, `client/src/components/stats-period/TrendArrow.tsx`, `client/src/components/stats-period/helpers.ts`, `client/src/components/stats-period/constants.ts`, `client/src/components/stats-period/useStatsPeriod.ts`, `client/src/components/stats-period/styles.ts`, `client/src/components/stats-period/index.ts`
- **Change:**
  - `constants.ts`: `PERIODS = ["1d","30d","custom"] as const`, `DEFAULT_PERIOD = "30d"`.
  - `helpers.ts`: `windowFor(period, customFrom, customTo, now)` → `{ from, to }` ISO, or `null` for an incomplete or invalid custom range (`to` = local midnight after the inclusive end date). `now` is truncated to the minute so the query key is stable. Also `periodSearchParams(state)`, which serialises `period`/`from`/`to` for links.
  - `useStatsPeriod.ts`: reads and writes `?period=…&from=YYYY-MM-DD&to=YYYY-MM-DD` with `useSearchParams` + `router.replace`, **preserving other params** (`tab` on the agent page). Returns `{ period, setPeriod, customRange, setCustomRange, window }`.
  - `StatsPeriodSelector.tsx`: the "1 day / 30 days / Custom" control. Custom shows two `<input type="date">`, and an invalid range shows an inline message instead of firing a request.
  - `TrendArrow.tsx` (`{ trend: AcceptTrend | null; deltaPp: number | null }`):
    - `'up'` → `Icon.ArrowUp` (ok colour), `'down'` → `Icon.ArrowDown` (crit), `'flat'` → `Icon.Slash` (muted).
    - Each arrow has an `aria-label` and title "{±n} pts vs previous period".
    - `null` → renders **no arrow element**, only a `title`-bearing muted span: "Not enough decisions in one of the periods (min {n})". No arrow is ever invented.
  - `index.ts` exports all of the above.
- **Constraint:** code shared across routes lives in `src/components/<kebab-case>/` (`client/CLAUDE.md` Naming). No strings in constants (routing.md i18n row).
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck` passes.

### Step 8 — Dashboard route and view components
- **Closes:** R2–R5, R7, R9, R10, R12, R13, AC2 (display), AC4, AC5, AC6, AC7, AC8, AC9, AC11 (link)
- **Files (new):**
  - `client/src/app/agent-performance/page.tsx`
  - `client/src/app/agent-performance/_components/AgentPerformanceView/{AgentPerformanceView.tsx,index.ts,styles.ts}`
  - `.../AgentPerformanceView/_components/KpiCards/{KpiCards.tsx,index.ts,styles.ts}`
  - `.../AgentPerformanceView/_components/AgentTable/{AgentTable.tsx,helpers.ts,index.ts,styles.ts}`
  - `.../AgentPerformanceView/_components/CostBreakdown/{CostBreakdown.tsx,index.ts,styles.ts}`
  - `.../AgentPerformanceView/_components/CostDonut/{CostDonut.tsx,index.ts,styles.ts}`
- **Change:**
  - **`page.tsx`:** mirrors `client/src/app/ci-runs/page.tsx` (`"use client"`, `AppShell` with crumb, `Suspense` around the view, since `useStatsPeriod` reads search params). Header: title, the mockup subtitle and `StatsPeriodSelector` (Step 7) at top right.
  - **View states:**
    - `isLoading` → skeletons only, with no digits rendered.
    - `isError` → vendored `ErrorState` with retry = `refetch()`.
    - Success with `totals.runs === 0 && totals.failed_runs === 0` → workspace-empty `EmptyState` ("No agent runs in this period", with a hint that reviews start from a PR page; deliberately no run button).
    - Otherwise the full page. A zero-run agent renders a muted row "No runs in this period" with "—" cells.
    - While `isFetching` with previous data shown, an inline "Updating…" indicator appears.
  - **KpiCards** (vendored `MetricCard`; captions in their own `<span>` per `client/INSIGHTS.md:133-145`):
    - **Total runs:** value `totals.runs`. `trend={runs_trend.map(p => p.value)}` only when `runs_trend.length >= 2`. Caption shows failed runs if any.
    - **Total cost:** `formatUsd(totals.total_cost_usd)` ("—" when null) with an "Estimated" badge. The delta goes in a separate element below the value, **not** `MetricCard.delta` (wrong polarity): `cost_delta_usd < 0` → green "−$x vs previous {n} days", `> 0` → red "+$x vs …", `0` → muted "no change". `null` → muted "No runs in the previous period to compare", with no number. The amount is formatted with `formatUsd(Math.abs(delta))` plus a sign. The comparison span label comes from `previous_window` (days, or the date range for custom).
    - **Avg accept rate:** pooled `%` or "—". Caption "{accepted} of {decisions} decisions". Use the vendored `CircularScore` ring if its props fit a 0–100 value, otherwise omit the ring.
    - **Most active:** name + "{runs} runs · {accept}% accept ({decisions} decisions)", or "—".
  - **AgentTable:**
    - Columns: Agent · Runs · Avg cost · Avg duration · Accept · Last run · View.
    - **Accept cell:** `%` + "n={decisions}", a "Low sample" `Badge` wrapped in `<span title>` (`client/INSIGHTS.md:81`) when `low_sample`, and `<TrendArrow trend={accept_trend} deltaPp={accept_rate_delta_pp} />` imported from `client/src/components/stats-period` (Step 7).
    - Accept value colour: ≥ 70% ok, 50–69% warn, < 50% crit. Verify the token names in `client/src/vendor/ui/styles.css` first (`client/INSIGHTS.md` `--info` entry). Low-sample rows are not coloured.
    - Sortable headers: Runs (default, desc), Avg cost, Accept, Last run. **Accept sort (R10):** rows with `low_sample === false` sort by `accept_rate`, then low-sample rows (by decisions desc), then zero-run rows, in both directions. Pure `sortRows(rows, key, dir)` in `AgentTable/helpers.ts`.
    - **Row expansion** (click/Enter, `aria-expanded`): accepted / dismissed / pending, failed runs, unpriced runs, findings by severity, and the previous-period accept rate with its decisions. All from the loaded row, **no fetch**.
    - **View** → `/agents/{agent_id}?tab=stats&` + `periodSearchParams(current period)`, so the Stats tab opens on the same window (AC11).
    - **Last run:** relative time. Reuse a `client/src/lib/` helper if one exists, otherwise add one to `AgentTable/helpers.ts`.
    - A footnote shows when `totals.deleted_agent_runs > 0`.
  - **CostBreakdown + CostDonut:**
    - `CostDonut` is a page-local `recharts` `PieChart`/`Pie` (vendored `Donut` untouched), with a legend of swatch, label and `formatUsd(cost_usd)` per slice, and a footer "Total {formatUsd(totals.total_cost_usd)}".
    - Slices at $0 stay in the legend with no arc. When the total is null or 0, a "No cost recorded" message replaces the ring.
    - Two cards: By agent (`cost_by_agent`) and By model (`cost_by_model`), under the section header "Cost breakdown · Estimated". Colours: a stable categorical order from vendored CSS tokens.
  - **Provenance line (AC7):** under the KPI row, driven by `cost_basis === 'estimate'`: "All costs are DevDigest estimates: provider-reported where the provider returns a cost (OpenRouter), otherwise token counts × list price. No reconciled billing data is available."
- **Constraint:** reuse vendored primitives (`client/CLAUDE.md:62`). `CostDonut` exists only because `Donut` can't format sub-cent values (`client/INSIGHTS.md:133`, user decision Q5). DTO fields stay snake_case, props camelCase (`client/CLAUDE.md:42-46`).
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck` passes. `rg -n "useMutation|api\.post|api\.put" client/src/app/agent-performance` returns nothing. On the seeded dev stack, the loading, error (API stopped), empty (1-day window on a fresh seed) and data (30 days) states are all reachable.

### Step 9 — Agent editor Stats tab
- **Closes:** R11, R6, AC1 (UI), AC4, AC5, AC7, AC9, AC11
- **Files:**
  - `client/src/app/agents/[id]/page.tsx` (edit)
  - `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (edit)
  - `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (edit)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/{StatsTab.tsx,index.ts,styles.ts}` (new)
- **Change:**
  - `page.tsx`: add `"stats"` to `VALID_TABS` (`page.tsx:15`). `setTab` already preserves other search params (`page.tsx:27-31`), so `period`/`from`/`to` survive tab switches.
  - `constants.ts`: append `{ key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" }` to `TABS`. The label already exists at `client/messages/en/agents.json:50`, and `BarChart` is in `client/src/vendor/ui/icons.tsx`. Update the "Stats lands in a later lesson" comment.
  - `AgentEditor.tsx`: add `{tab === "stats" && <StatsTab agent={agent} />}`, add `"stats"` to the exclusion chain of the Config fallback, and update the header comment.
  - `StatsTab.tsx`:
    - `useStatsPeriod()` + `StatsPeriodSelector` + `TrendArrow` (all from `client/src/components/stats-period`, Step 7) + `useAgentStats(agent.id, window)` (Step 5).
    - Loading → skeleton tiles. Error → `ErrorState` with retry. `runs === 0 && failed_runs === 0` → "No runs in this period" empty state (no zeros).
    - Tiles (`MetricCard`): Runs (sparkline from `trend` when ≥ 2 points), Avg cost (`formatUsd`, Estimated badge), Avg duration, Accept rate (caption "{accepted} of {decisions} decisions", Low-sample badge, `TrendArrow`).
    - Below the tiles: findings by severity as vendored `BarRow`s (counts, per `client/INSIGHTS.md:133`), failed and unpriced runs, and the same provenance line as the dashboard.
    - Pattern follows `client/src/app/skills/.../SkillEditor/_components/StatsTab/StatsTab.tsx`.
- **Constraint:** route-colocated component layout (`client/CLAUDE.md` Naming). Hooks-only fetching. Shared pieces come from `src/components/stats-period`.
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck` passes. `/agents/{id}?tab=stats&period=30d` renders the tab. The existing `AgentEditor.test.tsx` passes, with its tab-list expectations updated if it asserts the tab set.

### Step 10 — i18n copy
- **Closes:** R7, AC7 (copy), R12/R13 (copy)
- **Files:**
  - `client/messages/en/agentPerformance.json` (edit: replace the scaffold keys)
  - `client/messages/en/agents.json` (edit: add `editor.stats.*`)
- **Change:**
  - `agentPerformance.json`:
    - `title`, `subtitle` ("Which agents earn their keep — accept rate is the quality signal"), `crumb`
    - `period.{1d,30d,custom,from,to,invalidRange}`: the shared period-selector and `TrendArrow` copy, read by both pages from this namespace
    - `kpi.{totalRuns,totalCost,avgAcceptRate,mostActive,failedRuns,unpricedRuns,acrossDecisions,mostActiveDetail}`
    - `delta.{lower,higher,noChange,noPrevious,vsPreviousDays,vsPreviousRange}`
    - `table.{agent,runs,avgCost,avgDuration,accept,lastRun,view,noRuns,lowSample,lowSampleHint,decisions,previousRate,expand.*}`
    - `trend.{up,down,flat,unavailable}`
    - `cost.{title,byAgent,byModel,total,none,estimated,provenance,deletedAgent,unknownModel}`
    - `empty.{title,body}`, `loadError`, `updating`, `deletedAgentRuns`
  - `agents.json` `editor.stats.*`: tile labels, `noRuns`, `loadError`, `bySeverity`.
  - ICU plurals for counts. Remove the unused scaffold keys (`sort.*`, `table.trend`, `perAgent`) after `rg -n "agentPerformance" client/src` confirms nothing references them.
- **Constraint:** strings only in `messages/` (routing.md i18n row). Keys are dotted camelCase (`client/CLAUDE.md` Naming).
- **Owner:** implementer
- **Done when:** every `t("…")` key used in Steps 7–9 exists, and Step 11's render tests show no missing-message warnings.

### Step 11 — Client tests
- **Closes:** AC1 (UI), AC4, AC5, AC6, AC8, AC9, AC11, R10
- **Files (new unless noted):**
  - `client/src/app/agent-performance/_components/AgentPerformanceView/AgentPerformanceView.test.tsx`
  - `.../AgentPerformanceView/_components/AgentTable/AgentTable.test.tsx`
  - `.../AgentPerformanceView/_components/AgentTable/helpers.test.ts`
  - `.../AgentPerformanceView/_components/CostDonut/CostDonut.test.tsx`
  - `client/src/components/stats-period/helpers.test.ts`
  - `client/src/components/stats-period/TrendArrow.test.tsx`
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.test.tsx`
  - `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx` (edit if needed)
- **Change:**
  - **Dashboard:**
    - A pending fetch shows skeletons and no digit `0` in KPI values. A rejected fetch shows the error state with no numeric KPI (AC5).
    - Workspace-empty state vs a zero-run agent row (AC4).
    - The "Estimated" label and provenance line render (AC7).
    - Cost delta: negative → "−$…" in ok colour, positive → "+$…", `null` → the "No runs in the previous period" copy with **no** `$` amount (AC8).
    - The sparkline is absent for a 1-point `runs_trend` and present for ≥ 2.
  - **Network (AC6):** across initial load, period change, sort clicks, row expand/collapse and retry, the mocked `fetch` sees **only GET** calls to `/agent-performance`.
  - **Table:**
    - Accept sort puts low-sample rows after ranked rows in both directions.
    - Expansion reveals accepted/dismissed/pending without a new fetch.
    - The View `href` equals `/agents/{id}?tab=stats&period=…` carrying the current window (AC11).
  - **TrendArrow:** up, down and flat render with labels. `null` renders no arrow element (AC9).
  - **CostDonut:** legend values use `formatUsd` (e.g. 0.0012 → "$0.0012", not "$0.00"). The footer total equals the passed total.
  - **StatsTab:** given the same `AgentStats` fixture used for a dashboard row, it renders the same runs / avg cost / avg duration / accept % / decisions strings (AC1 UI parity). It covers loading, error and no-runs states without zeros, and makes only GET calls to `/agents/{id}/stats`.
  - **Helpers:** `windowFor` presets and custom local-midnight bounds, invalid custom range → `null`, `periodSearchParams` round-trip.
- **Constraint:** `fireEvent`, not `user-event` (`client/INSIGHTS.md`). Mocked `fetch` (`client/CLAUDE.md` Stack). API-shape parity is guarded by Step 4, not by these tests (`client/CLAUDE.md` Gotchas).
- **Owner:** test-writer
- **Done when:** `cd client && pnpm test` passes.

### Step 12 — Final gates
- **Closes:** none, verification
- **Files:** none edited (an optional `engineering-insights` entry if something non-obvious was learned)
- **Change:** run `diff -r client/src/vendor/shared server/src/vendor/shared` (expect no output), `cd server && pnpm typecheck`, `cd client && pnpm typecheck`, every suite in *Test plan*, then `pr-self-review`. Acknowledge the expected warnings in the PR body: `RULE-LESSON` (user-requested L07/L08 features) and `RULE-VENDOR` (`nav.ts`, `client/src/vendor/shared` sync). Then the `architecture-reviewer` and `security-reviewer` passes run per *Execution mode*.
- **Owner:** implementer (gates), then architecture-reviewer + security-reviewer (review passes)
- **Done when:** all commands are green, the `pr-self-review` verdict has no CRITICAL, and both reviewers' findings are resolved or explicitly accepted.

## Contract changes

All changes are in `server/src/vendor/shared/contracts/observability.ts`, copied verbatim to `client/src/vendor/shared/contracts/observability.ts`:

- **`AgentStats`** (unused before this change, so non-breaking): adds `window`, `previous_window`, `enabled`, `decisions`, `failed_runs`, `unpriced_runs`, `last_run_at`, `low_sample`, `previous: PeriodComparison`, `accept_trend: 'up'|'down'|'flat'|null`, `accept_rate_delta_pp: int|null`, `cost_basis: 'estimate'`. Existing fields are kept. `trend` is now defined as daily UTC done-run counts.
- **New:** `StatsWindow`, `StatsWindowQuery`, `CostBasis`, `AcceptTrend`, `PeriodComparison`, `CostSlice`, and `AgentPerformance` (incl. `previous_window`, `previous_totals`, `cost_delta_usd`, `runs_trend`, `min_decisions_for_ranking`).
- **New endpoints:** `GET /agents/:id/stats?from&to` → `AgentStats`; `GET /agent-performance?from&to` → `AgentPerformance`. Both are read-only and workspace-scoped.

## Migration

None. Every metric, the previous-period figures included, derives from existing `agent_runs`, `reviews` and `findings` columns. The previous window doubles the scanned range, and `agent_runs` has no `(workspace_id, ran_at)` index (`server/src/db/schema/runs.ts:71-74`). That is acceptable at local scale. If it ever matters, add the index in `server/src/db/schema/runs.ts` and run `cd server && pnpm db:generate`; never hand-write the `.sql`. Not part of this plan.

## Test plan

| Suite | Command (verbatim from TESTING.md) | Covers which step |
|---|---|---|
| server unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | 2, 3 (routes-smoke), 4 (helpers: previous window, trend, delta, sparkline sums) |
| server integration | `cd server && pnpm exec vitest run .it.test` | 2, 3, 4 (Stats ↔ dashboard parity, previous-period parity, sums, empty, 422/404, zero LLM calls) |
| client | `cd client && pnpm test` | 5–11 (dashboard states, delta/arrow rendering, sorting, View link, StatsTab parity, GET-only network) |
| typecheck | `cd server && pnpm typecheck` · `cd client && pnpm typecheck` | 1, 2, 5–10 |
| contract sync | `diff -r client/src/vendor/shared server/src/vendor/shared` | 1 |

e2e (`cd e2e && npm install && npm test`) is not extended. See *Out of scope*.

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| Float drift makes donut slices not sum to the total | 2, 8 | One per-run cost list feeds the total and both breakdowns, rounded once. Unit test at 1e-6. Legend uses `formatUsd` |
| The previous period's rules drift from the current period's | 2 | The same `compute` + helpers run for both windows. The integration test compares `previous_totals` with a direct call on `previous_window` |
| An arrow or delta over-reads noise or an empty period | 2, 7, 8 | Arrow only when both windows have ≥ 10 decisions, comparing displayed integer %. Delta `null` (with explanatory copy) when either window has no runs |
| Cost-delta colour polarity (lower is better) | 8 | Rendered outside `MetricCard`, whose `delta` treats down as red |
| A stored price-table `cost_usd` is read as billed | 1, 8, 9 | `cost_basis: 'estimate'` plus the provenance line on both pages. No "billed" wording |
| `PriceBook.estimate` can trigger a background OpenRouter `/models` price fetch | 2 | Not a model call, and it already happens on the PR list. Documented in the service. The integration test asserts zero LLM-adapter calls |
| Timezones: presets are rolling, custom is local midnight, buckets are UTC | 2, 7 | Both endpoints take the same explicit `from`/`to`, so parity is unaffected. The 1-day window shows no sparkline by design. The UTC bucketing is documented in the contract |
| Deleted agents' runs disappear from the table | 2, 8 | "Deleted agent" cost slice plus a footnote |
| `period`/`tab` query params clobber each other | 7, 9 | `useStatsPeriod` and the agent page's `setTab` both preserve unrelated params. Covered by the View-link and helper tests |
| Query-key churn from `now` | 7 | Minute-truncated `now`, memoised window |
| `client/src/vendor/shared` drift fails `client.yml` | 1 | Byte copy, plus the `diff -r` gate in Steps 1 and 12 |

## Out of scope

- Reconciled billing, or a cost-provenance column on `agent_runs` (would need a schema change and migration).
- Per-agent icons and avatars from the mockup (agents have no icon field; a generic icon is used).
- Moving "Multi-Agent Review" into GLOBAL or adding a "Memory" nav item to match the mockup sidebar.
- An hourly sparkline for the 1-day window.
- A `(workspace_id, ran_at)` index on `agent_runs`.
- An e2e journey for the dashboard or the Stats tab.
- Writing a spec under `server/specs/` or `client/specs/` (`spec-creator`'s job if wanted).

## Open questions

None. The user answered Q0–Q7 on 2026-10-13 (see *Requirements*). Every decision this plan depends on is now fixed.
