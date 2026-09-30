# Development Plan: PR Brief (HW05) — one Why+Risk card on the PR Overview

**Branch:** `hw05-pr-brief-feature` · **Date:** 2026-09-30
**Packages touched:** server · client · shared (both vendored copies)
**Estimated steps:** 21 · **Migration required:** no · **Contract change:** yes (additive, plus `PrBrief` reshaped; `PrBrief` has zero consumers today)
**Execution mode:** multi-agent. `implementer` owns every code step (S1–S8, S11–S17).
`test-writer` owns the three test steps (S9, S10, S18). `architecture-reviewer` (S19)
and `security-reviewer` (S20) run as review passes after implementation. S21 (FR-22
retrospective and cost report) belongs to the caller or a human, because only the
orchestrator knows what the pipeline run cost. The caller fixed this mode up front,
so it was not asked again.

## Requirements reviewed

Read [`specs/03-pr-brief.md`](../../specs/03-pr-brief.md) in full (status *draft*,
registered at `specs/README.md:60`). The caller says the user **approved it** and
**accepted the default for all four open questions**. They are binding here:

1. **Project Context input** = A-5. This is the deduplicated union of documents that the
   repo's **enabled review agents** would receive (own attachments plus those inherited
   through enabled skills), filtered to category `specs` and availability `present`, in
   first-seen order.
2. **Standalone Intent/Blast cards stay** below the empty brief card (A-4). They are
   hidden once a brief exists.
3. **Snap** a focus item's unknown line to the nearest known line of the same file
   (FR-8(c)). The item is not dropped.
4. **Budgets stay** at 8,000 input / 1,500 output tokens, with the per-section ceilings
   from NFR-2.

Also read: both mockups (generated state and empty state), plus every code site the
spec's *Sources reviewed* table cites. Nothing blocked planning. The spec leaves a few
implementation choices open. They are settled in *Design decisions* below (D1–D9) so no
step has to re-decide them.

## Recommendation

**The requested approach is the right one.** The feature fits modules and seams that
already exist, and no new table or dependency is needed. The plan makes three
refinements. None of them changes a requirement:

- **R1 — The model's output schema has no array caps and no `line ≥ 1` bound.** The spec
  asks for caps of 6 risks and 8 focus items, plus a positive line. If those lived in the
  zod schema, a model returning 7 risks or line 0 would fail validation. The adapter
  would then re-prompt, up to `maxRetries + 1` paid calls
  (`server/src/adapters/llm/openai.ts:96`), and could fail the whole generation. FR-8
  already says capping and snapping happen in **post-validation**, so they live only
  there. The model schema just checks shape. `line` is `z.number().int()`, and every
  line anchor is ≥ 1, so snapping makes line 0 impossible to store.
- **R2 — Smart Diff roles come from the pure `classifyFile` helper, not
  `SmartDiffService`.** `SmartDiffService.forPull` also reads the latest review's
  findings (`server/src/modules/smart-diff/service.ts:36-46`). FR-9 forbids sending
  findings to the model, so routing the brief through that service would put findings
  one field away from the prompt. `classifyFile`
  (`server/src/modules/smart-diff/helpers.ts:35`) is a pure function: path in, role out.
  It is not a data layer, so NFR-8 is still satisfied.
- **R3 — The injection guard is `wrapUntrusted` plus a SECURITY paragraph in the brief's
  own system prompt,** the same as intent (`server/src/modules/intent/prompt.ts:55`,
  `server/src/prompts/intent.system.md:3`). `INJECTION_GUARD` is not exported
  (`reviewer-core/src/prompt.ts:16`), and its wording is specific to reviews ("REPORT it
  as a finding"). `server/CLAUDE.md:68` says the guard is appended "to every system
  prompt". That is only true on the `assemblePrompt` path, not for single-call features.

**An option the user may want (not in this plan):** `risk_brief` defaults to
`openai / gpt-4.1` (`server/src/vendor/shared/contracts/platform.ts:60-66`). At that
model's list price, a full 8K-in / 1.5K-out generation costs about **$0.028**. That is
double the mockup's "$0.014". Intent moved to a cheap default for this reason
(`platform.ts:52-58`). If the FR-22 cost report matters, the user can pick a cheaper
`risk_brief` model in Settings, which FR-13 already supports. Changing the registry
default would be a separate decision, and it would also affect `server/INSIGHTS.md:42-53`
(hermetic tests would need to mock the new provider).

## Goal

The PR Overview tab opens with a **PR Brief** section. With no brief yet, it shows an
empty card with a "Generate brief" button, and the existing Intent and Blast Radius cards
stay below it. Generating makes one structured model call over precomputed facts only
(no hunk bodies, clone contents or findings), sized to 8,000 input tokens. The server
checks the output against real PR/blast files and lines, and stores it in the existing
`pr_brief` row, keyed to the head SHA. The card then shows a verdict banner (summary,
latest review's verdict/score, cost/tokens, refresh, stale marker), the Intent and Blast
radius snapshot, Risk areas and Review focus. Clicking a focus item or a risk file ref
deep-links to `?tab=diff&file=…&line=…`, which expands, scrolls to and highlights the
line. Reloading makes no model call.

## Inputs read

| File | What it constrained |
|---|---|
| `CLAUDE.md:106-110` | No workspace. pnpm for server/client. |
| `CLAUDE.md:111-113` | `@devdigest/shared` is the one contract source |
| `CLAUDE.md:119-124` | Typological testing. Mock the outside world. |
| `CLAUDE.md:149-158` | No hand-edited migrations or lockfiles. This plan needs neither. |
| `CLAUDE.md:160-162` | Lesson features stay off `main`. This is the homework branch. |
| `server/CLAUDE.md:53-55` | Routes validate through zod `params`/`response` schemas, never a parse inside the handler |
| `server/CLAUDE.md:68-70` | Injection-guard wording (see R3) |
| `server/INSIGHTS.md:42-53` | `container.llm(id)` falls through to the real, billed provider when a test lacks an override. Every brief test must inject the `risk_brief` provider (`openai`). |
| `server/INSIGHTS.md:100-112` | Consume another module's business logic through a Container getter, never `new XService` inside your service |
| `server/INSIGHTS.md:22-30` | Dedupe keys use physical identity (kind + file set, file + line), never free text |
| `server/INSIGHTS.md:124-131` | A purity grep can trip on a doc comment that names the forbidden token. Phrase helper comments carefully. |
| `server/INSIGHTS.md:133-144`, `:146-157` | Blast caller lists are rank-sorted and globally capped at 20. The brief keeps rank order and reports omissions (NFR-2). |
| `client/CLAUDE.md:42-44`, `:48-49`, `:56-58`, `:62-63` | snake_case DTOs. Hooks only, no `fetch` in components. Client tests can't catch shape drift. Never rebuild a vendored primitive. |
| `client/INSIGHTS.md:13-21` | Wrap collapsible rows in `<section aria-label>` so role queries don't mix tiers |
| `client/INSIGHTS.md:25-32`, `:81-88` | `Badge` is a `<span>` with no `title`; wrap it for tooltips. `Chip` is a `<button>`. |
| `client/INSIGHTS.md:99-108` | Smart Diff collapse state resets when switching views, so a deep-link target must **force-open** its group from props, not rely on persisted state |
| `client/INSIGHTS.md:112-118` | No `user-event`. Tests use `fireEvent`. |
| `client/INSIGHTS.md:161-167` | `--info` is grey. Use `--accent`/`--accent-text` for "link blue". |
| `TESTING.md:16-19`, `:76-77`, `:88-91` | Mocks live in `server/src/adapters/mocks.ts`. Verbatim lane commands. The `*.it.test.ts` split. |
| `.claude/skills/pr-self-review/routing.md:12-72` | Lane lookup (see *Skills to be applied*) |
| `.claude/skills/pr-self-review/repo-rules.md:116-134`, `:195-203` | `RULE-CONTRACT-SYNC` (`diff -r` must be clean). `RULE-CONTRACT-BREAK`. `RULE-PROMPT`: a new `server/src/prompts/*` file moves together with `docs/agent-prompts/README.md`. |
| `.github/workflows/client.yml:6,47-51` | `client/src/vendor/shared` is a **physical copy**, and CI fails on drift. Edit server's copy, then copy it byte-for-byte to client. |
| `docs/agent-prompts/README.md:20-40` | Non-reviewer prompt table (add `brief.system.md`). Don't describe the JSON shape in prose. Inputs are `<untrusted>`-wrapped. |

## Architectural constraints binding this change

- **A lesson feature is its own module registered in the static registry.** The registry
  names "brief" explicitly. Source: `server/src/modules/index.ts:26-45`.
- **Route template:** `withTypeProvider<ZodTypeProvider>()`, service built once above
  the handlers, `schema: { params: IdParams, response: { 200: … } }`, `getContext` first.
  Source: `server/src/modules/intent/routes.ts:20-41`. `IdParams` is at
  `server/src/modules/_shared/schemas.ts:11`.
- **Workspace scope is the PR lookup.** Use `container.reviewRepo.getPull(workspaceId,
  prId)` and throw `NotFoundError` on a miss. `pr_brief` has no `workspace_id`. Source:
  `server/src/modules/reviews/repository.ts:31-33`,
  `server/src/db/schema/reviews.ts:102-107`, `server/src/modules/blast/service.ts:71-75`.
- **Only a repository touches Drizzle.** Enforced by `no-db-in-service`,
  `no-schema-in-helpers`, `no-container-in-helpers` and `no-db-outside-repository`
  (`server/.dependency-cruiser.cjs:107-161`). `no-fastify-outside-edge` (`:194-201`)
  means only `routes.ts` names Fastify. The service's logger is therefore a local
  structural interface, not `FastifyBaseLogger`.
- **Name no other module's repository**, not even as a type. `no-cross-module-repository`
  (`.dependency-cruiser.cjs:247-259`) applies, and `tsPreCompilationDeps: true` (`:300`)
  keeps type-only imports in the graph. Use `Container['reviewRepo']` indexed access.
  Precedent: `server/src/modules/blast/service.ts:51-67`.
- **Cross-module business logic goes through Container getters.** `container.intent`
  (`server/src/platform/container.ts:157-159`) and `container.projectContext`
  (`:179-181`) already exist. `BlastService` is promoted the same way.
- **Feature model:** `resolveFeatureModel(container, workspaceId, 'risk_brief')`
  (`server/src/modules/settings/feature-models.ts:51-57`), then
  `container.llm(choice.provider)` (`container.ts:226-234`). Precedent:
  `server/src/modules/intent/service.ts:143-159`.
- **Structured call result** carries `data, model, tokensIn, tokensOut, costUsd, raw,
  attempts` (`server/src/vendor/shared/adapters.ts:77-85`). `MockLLMProvider` keys
  fixtures by `schemaName` and throws when a fixture fails the schema
  (`server/src/adapters/mocks.ts:92-108`). It can only be `openai`/`anthropic` (`:62`).
- **Token counting** uses `container.tokenizer.count(text)`, which falls back to chars/4
  and never throws (`server/src/adapters/tokenizer/index.ts:24-47`,
  `container.ts:191-195`).
- **Untrusted text is wrapped with `wrapUntrusted(label, content)`**
  (`reviewer-core/src/prompt.ts:38-43`, exported at `reviewer-core/src/index.ts:15-20`).
  Model output renders as plain text, never Markdown. Precedent:
  `client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx:96-98`.
- **Double-click guard** is an in-process `Set` keyed `workspaceId:prId`, throwing
  `ConflictError` (409) before any work. Source: `server/src/modules/intent/service.ts:99-126,188-190`;
  `server/src/platform/errors.ts:31-35`.
- **Staleness is derived on read** (`head_sha !== pull.headSha`) and never stored.
  Source: `server/src/modules/intent/service.ts:330-345`.
- **Client:** one TanStack hook per call in `client/src/lib/hooks/reviews.ts`. Keys come
  from the `reviewKeys` factory (`client/src/lib/hooks/keys.ts:11-19`). `next-intl` loads
  every `messages/en/*.json` automatically (`client/src/i18n/request.ts:16-25`), so
  `useTranslations("brief")` needs no wiring.
- **Never import another route's `_components/`.** Sibling components inside one route's
  `_components/` may import each other (e.g. `OverviewTab.tsx:5-6`). Source:
  `.claude/skills/frontend-code-organization/SKILL.md` §1.
- **`src/components/diff-viewer` is shared.** Its `index.ts` is its curated public API,
  so a new prop type is exported there explicitly (frontend-code-organization §8).

## Skills to be applied

| Path to be touched | Lane | Skills (per routing.md) |
|---|---|---|
| `server/src/vendor/shared/contracts/brief.ts` (edit) + `client/src/vendor/shared/contracts/brief.ts` (copy) | backend / vendor | zod + `RULE-CONTRACT-SYNC`, `RULE-CONTRACT-BREAK` (routing.md:23). The client copy is `RULE-VENDOR`/`RULE-CONTRACT-SYNC` (routing.md:44). |
| `server/src/platform/container.ts` (edit) | backend | onion-architecture (routing.md:19) |
| `server/src/modules/intent/service.ts`, `server/src/modules/project-context/service.ts` (edit) | backend | onion-architecture (routing.md:16). security by content (workspace-scoping logic, routing.md:68). |
| `server/src/modules/brief/routes.ts` (new) | backend + cross-cutting | fastify-best-practices, onion-architecture, zod (routing.md:14). **security**: new public route (routing.md:68). |
| `server/src/modules/brief/service.ts`, `helpers.ts` (new) | backend | onion-architecture (routing.md:16). zod by content (`safeParse`, routing.md:69). |
| `server/src/modules/brief/prompt.ts`, `constants.ts` (new) | backend | No exact row. Nearest is routing.md:16 (non-route file under `modules/**`), so onion-architecture. |
| `server/src/modules/brief/repository.ts` (new) | backend | onion-architecture, drizzle-orm-patterns (routing.md:17) |
| `server/src/modules/index.ts` (edit) | backend | fastify-best-practices, onion-architecture (routing.md:15) |
| `server/src/prompts/brief.system.md` (new) | backend | none. `RULE-PROMPT` (routing.md:24). |
| `docs/agent-prompts/README.md` (edit) | no lane | none (routing.md:52). Moves together with the prompt under `RULE-PROMPT`. |
| `server/test/brief-*.test.ts`, `server/test/brief.it.test.ts` (new) | backend | none. `RULE-IT-SUFFIX` only (routing.md:25). |
| `client/src/lib/hooks/reviews.ts`, `keys.ts` (edit) | frontend | react-best-practices, frontend-code-organization (routing.md:39) |
| `client/messages/en/brief.json` (edit) | frontend | frontend-code-organization (routing.md:41) |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/**`, `…/BlastRadiusView/**` (**new folders**) | frontend | react-best-practices, frontend-code-organization. Placement is the point (routing.md:37, :43). |
| `…/_components/{BlastRadiusCard,VerdictBanner,OverviewTab,DiffTab,SmartDiffGroups}/*.tsx` (edit) | frontend | react-best-practices, frontend-code-organization (routing.md:37) |
| `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit) | frontend | next-best-practices, frontend-code-organization (routing.md:36) |
| `client/src/app/repos/[repoId]/pulls/[number]/helpers.ts` (new) | frontend | No exact row. It is a non-component `.ts` under `app/`, so the nearest analogue is frontend-code-organization (routing.md:40/48). |
| `client/src/components/diff-viewer/{DiffViewer,FileCard,CodeLine}/*.tsx`, `index.ts`, `styles.ts`, `target.ts` (edit/new) | frontend | react-best-practices, frontend-code-organization (routing.md:38, :40) |
| `client/**/*.test.tsx` (new/edit) | frontend | react-testing-library (routing.md:42) |
| `docs/plans/hw05-pr-brief.plan.md` (this file) | no lane | none (routing.md:52). Contains no Mermaid block. |

Loaded for this plan: **frontend-code-organization** (it decided where `BlastRadiusView`
goes, the nested `PrBriefCard/_components/`, and the route-level `helpers.ts`) and
**onion-architecture** (it decided the container getter for blast, the local logger
interface, and the pure `prompt.ts`/`helpers.ts`). zod, fastify and security were not
loaded, because nothing in them changes a decision here. Their constraints are the ones
already cited. `typescript-expert` should not trigger: the plan uses no `any`, no
`as unknown as`, and no conditional types. A test-fixture cast in `server/test/**` has
no lane.

---

## Design decisions (settled here so no step re-litigates them)

- **D1 — Contract shapes.** Everything goes in `brief.ts` (both copies):
  - `ReviewFocusItem = { file: string, line: z.number().int(), reason: string }`
    (no positive bound, see R1)
  - `PrBriefModelOutput = { summary: string, risks: z.array(Risk), review_focus: z.array(ReviewFocusItem) }`.
    No `.max()`. Field order stays summary → risks → review_focus, because field order
    is generation order (`server/src/modules/intent/prompt.ts:16-22`).
  - `PrBrief` becomes `{ summary, intent: Intent.nullable(), blast: BlastRadius.nullable(), risks: Risks, review_focus: z.array(ReviewFocusItem), history: PrHistory }`.
    `risks` keeps the existing `Risks` wrapper (`{ risks: Risk[] }`) and `history` keeps
    `PrHistory` (`{ history: [] }`), as the spec says ("keep their shapes").
  - `BriefInputStatus = z.enum(['present','missing','partial','stale'])`
  - `BriefInputs = z.object({ intent, blast, description, linked_issue, project_context })`,
    each a `BriefInputStatus`. This is an explicit object, not `z.record`, so all five
    keys are always present.
  - `BriefValidation = z.object({ risks_dropped, refs_stripped, focus_dropped, focus_snapped, duplicates_collapsed })`,
    all `z.number().int().nonnegative()`.
  - `PrBriefStored = PrBrief.extend({ pr_id, head_sha, generated_at, provider, model: z.string().nullish(), attempts: int, tokens_in: int, tokens_out: int, cost_usd: z.number().nullable(), input_tokens_measured: int, truncated_sections: z.array(z.string()), inputs: BriefInputs, validation: BriefValidation })`
  - `PrBriefRecord = PrBriefStored.extend({ is_stale: z.boolean() })`. This is the wire
    shape of both endpoints. `PrBriefStored` is exactly what goes into `pr_brief.json`.
- **D2 — Persistence.** One row per PR, `pr_brief.json = PrBriefStored`. The insert uses
  `onConflictDoUpdate` on `prId` (same pattern as
  `server/src/modules/intent/repository.ts:49-57`). On read, `PrBriefStored.safeParse(row.json)`
  runs. A failed parse is treated as **no brief** (returns `null`, logs a warn line), so
  a corrupt row can never 500 the Overview (NFR-8). No migration: the table exists
  (`server/src/db/schema/reviews.ts:102-107`).
- **D3 — Input statuses (FR-10).**
  - `intent`: `missing` if `container.intent.get` returns null or throws, `stale` if
    `is_stale`, otherwise `present`.
  - `blast`: `missing` if `forPull` throws, or if it comes back degraded **and** with
    zero changed symbols. `partial` if degraded with some data. Otherwise `present`.
    The stored `blast` is `null` when missing. Otherwise it is the response *minus*
    `degraded`/`reason`, parsed through `BlastRadius` so zod strips those keys.
  - `description`: `missing` when `pull.body?.trim()` is empty.
  - `linked_issue`: `missing` when there is no closing reference or the read fails.
  - `project_context`: `missing` when no spec documents qualify.
- **D4 — Linked issue** reuses intent's resolver. `IntentService.readLinkedIssue`
  (`server/src/modules/intent/service.ts:263-281`) goes from `private` to public, with
  its signature unchanged. The brief calls it through `container.intent`. That is at
  most one GitHub read, and it already degrades to `null` (NFR-5).
- **D5 — Blast** is reached through a new `container.blast` getter returning
  `new BlastService(this.reviewRepo, this.repoIntel)`. It honours the existing
  `repoIntel` override, so tests inject a mock `RepoIntel` exactly as
  `server/test/blast.it.test.ts:171` does. `blast/routes.ts` is **not** changed.
- **D6 — Project Context specs (A-5)** come from a new public
  `ProjectContextService.specsForBrief(workspaceId, repoId)`, returning
  `{ path: string; content: string; tokenCount: number }[]`. Algorithm:
  1. `container.agentsRepo.listEnabled(workspaceId)` (`server/src/modules/agents/repository.ts:61-66`).
  2. For each agent in returned order, build `mergeEffectiveSet(direct, enabledSkillIds…)`.
     This is the same merge `effectiveSetForRun` uses
     (`server/src/modules/project-context/service.ts:315-327`), with the existing
     private `enabledSkillIdsFor` (`:356-362`).
  3. Concatenate document ids in first-seen order, deduped.
  4. Call `repo.documentsByIds(workspaceId, repoId, ids)`, which is workspace- and
     repo-scoped (`server/src/modules/project-context/repository.ts:143-159`).
  5. Keep rows with `category === 'specs' && availability === 'present'`, preserving the
     order from step 3.
- **D7 — Smart Diff role** per file = `classifyFile(path)` from
  `server/src/modules/smart-diff/helpers.ts:35` (see R2).
- **D8 — Zero changed files** → `ValidationError` (422) before any model call, the same
  as intent (`server/src/modules/intent/service.ts:132-138`). With no files, FR-7 can
  keep nothing, so a paid call would be wasted.
- **D9 — Deep link** is `?tab=diff&file=<path>&line=<n>`. `line` is optional. Switching
  tabs by any other route clears `file` and `line`. Navigation uses the existing
  `router.replace` convention (`client/src/app/repos/[repoId]/pulls/[number]/page.tsx:55-61`).

---

## Steps

### Step 1 — Extend the shared brief contracts (both copies)
- **Files:** `server/src/vendor/shared/contracts/brief.ts` (edit), then
  `client/src/vendor/shared/contracts/brief.ts` (overwrite with a byte-identical copy of
  server's file)
- **Change:** Add `ReviewFocusItem`, `PrBriefModelOutput`, `BriefInputStatus`,
  `BriefInputs`, `BriefValidation`, `PrBriefStored` and `PrBriefRecord` exactly as in
  **D1**. Each is a PascalCase const plus a same-named `z.infer` type. Replace the
  `PrBrief` object at `brief.ts:166-173` with the D1 shape. Add a doc comment on
  `Risk.file_refs` giving the entry form: `path`, `path:line` or `path:start-end`, where
  only the path part is validated. Update the barrel comment at
  `server/src/vendor/shared/index.ts:6` to mention `PrBriefRecord` (again in both copies,
  since `index.ts` is part of the copy).
- **Constraint:** `server/CLAUDE.md:36-41` (PascalCase const plus type).
  `.github/workflows/client.yml:47-51` (physical copy). No `.max()` on the model output
  (R1).
- **Owner:** `implementer`
- **Done when:** `diff -r client/src/vendor/shared server/src/vendor/shared` is silent.
  `cd server && pnpm typecheck` and `cd client && pnpm typecheck` both pass. Nothing
  imported the old `PrBrief`, so nothing else breaks.

### Step 2 — Expose the three capabilities the brief consumes
- **Files:** `server/src/platform/container.ts` (edit),
  `server/src/modules/intent/service.ts` (edit),
  `server/src/modules/project-context/service.ts` (edit)
- **Change:**
  - `container.ts`: add `private _blast?: BlastService` and a `get blast(): BlastService`
    getter (D5), with a doc comment in the style of `:150-159`. Import `BlastService`
    from `../modules/blast/service.js`.
  - `intent/service.ts`: make `readLinkedIssue` public (D4) and add a one-line doc note
    that the brief also uses it. No behaviour change.
  - `project-context/service.ts`: add `specsForBrief(workspaceId, repoId)` per **D6**.
    It returns an empty array for zero enabled agents or zero attachments, and it never
    throws on an empty set.
- **Constraint:** `server/INSIGHTS.md:100-112` (Container getter).
  `.dependency-cruiser.cjs:259-272` (`no-circular` ignores type-only cycles).
  `blast/service.ts` only imports `Container` as a type, so the new value edge
  container → blast/service creates no runtime cycle.
- **Owner:** `implementer`
- **Done when:** `cd server && pnpm typecheck` passes.
  `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` reports no
  violations. Existing `intent-service.test.ts`, `project-context-service.test.ts` and
  `blast-*.test.ts` still pass.

### Step 3 — Brief module constants
- **Files:** `server/src/modules/brief/constants.ts` (new)
- **Change:** Add:
  - `BRIEF_SCHEMA_NAME = 'PrBrief'` (the `MockLLMProvider` fixture key)
  - `BRIEF_SYSTEM_PROMPT_FILE = 'brief.system.md'`
  - `BRIEF_TEMPERATURE = 0.2`, `BRIEF_TIMEOUT_MS = 60_000`
  - `INPUT_TOKEN_BUDGET = 8_000`, `OUTPUT_MAX_TOKENS = 1_500`
  - `SECTION_CEILINGS = { files: 2000, blast_detail: 1500, description: 1000, linked_issue: 800, project_context: 2000 } as const`
  - `SHRINK_ORDER = ['project_context','linked_issue','description','blast_detail','files'] as const`
  - `MAX_RISKS = 6`, `MAX_FOCUS = 8`, `SUMMARY_MAX_CHARS = 400`
  - `MAX_INTENT_CHARS = 1_200` (caps the always-kept intent block so the ~700-token
    reserve holds)

  The section keys are also the values written to `truncated_sections`. Comment each
  number with its source (spec NFR-1, NFR-2, FR-8(e)).
- **Constraint:** onion-architecture decision table: magic numbers go in `constants.ts`.
- **Owner:** `implementer`
- **Done when:** the file exports only constants, imports nothing, and typechecks.

### Step 4 — Pure helpers: line anchors, post-validation, DTO mapping
- **Files:** `server/src/modules/brief/helpers.ts` (new)
- **Change:** Pure functions only. No container, no DB, no I/O, no clock (the caller
  passes `now`).
  - `changedRanges(patch: string | null): { start: number; end: number }[]`: scan
    **only** lines starting with `@@` using the regex from
    `server/src/adapters/git/diff-parser.ts:46`. Map `+start,len` to `[start, start+len-1]`.
    A `len` of 0 (deletion-only hunk) maps to `[max(1,start), max(1,start)]`. A missing
    len means 1. No body line is ever read into the output.
  - `buildAnchorIndex(files, blast)` → `Map<path, number[]>` of known lines. For changed
    files, these are the range endpoints plus every line inside the ranges (as sorted
    ranges, not an expanded array). For blast files, these are caller lines, plus the
    declaring files of changed symbols. The union of both key sets is FR-7's
    allow-list.
  - `parseFileRef(ref)` → `{ path, suffix }`, splitting on a trailing `:N` or `:N-M`.
  - `postValidate(output, anchors, caps)` → `{ risks, review_focus, validation }`,
    implementing FR-8 (a) through (e) in order:
    - (a) strip refs whose path is not allowed (`refs_stripped`), then drop risks left
      with no refs (`risks_dropped`)
    - (b) drop focus items with an unknown file (`focus_dropped`)
    - (c) snap each focus line to the nearest known line of that file (`focus_snapped`,
      counted only when the line changed). If the file has no line anchors (e.g.
      `patch: null`), clamp it to ≥ 1.
    - (d) collapse duplicates (`duplicates_collapsed`) on the key `file:line` for focus
      and `kind + sorted path set` for risks (`server/INSIGHTS.md:22-30`)
    - (e) slice to `MAX_RISKS` and `MAX_FOCUS`, keeping the model's order
  - `clampSummary(text)`: trim, then cut to `SUMMARY_MAX_CHARS` on a word boundary with
    `…`.
  - `toStored(...)` and `toRecord(stored, currentHeadSha)`. `toRecord` adds
    `is_stale = stored.head_sha !== currentHeadSha`.
  - `inputStatuses(...)` per **D3**.
- **Constraint:** `.dependency-cruiser.cjs:124-140` (helpers stay pure).
  `server/INSIGHTS.md:124-131` (don't spell out forbidden tokens in the purity comment).
  Grounding principle: `CLAUDE.md:125-127`.
- **Owner:** `implementer`
- **Done when:** `cd server && pnpm typecheck` passes and depcruise stays clean.
  `grep -n "@@" server/src/modules/brief/helpers.ts` shows the header regex is the only
  place diff text is parsed.

### Step 5 — Prompt assembly with the token budget, plus the system prompt
- **Files:** `server/src/modules/brief/prompt.ts` (new),
  `server/src/prompts/brief.system.md` (new), `docs/agent-prompts/README.md` (edit: add
  a table row at `:26-29`: `brief.system.md` | PR Brief (L05) | `modules/brief/service.ts`)
- **Change:**
  - `prompt.ts` is pure, like `server/src/modules/intent/prompt.ts`. It exports
    `buildBriefMessages(facts, count: (s: string) => number, system: string)` →
    `{ messages, inputTokens, truncatedSections }`. `facts` is a plain object:
    - title
    - intent (sentence, scopes, intent `risk_areas` labels + paths) or null
    - blast summary + symbols + callers + endpoints + crons, or null, with a degraded
      flag
    - files `{ path, role, additions, deletions, ranges }[]`
    - totals and per-role counts
    - description, issue `{ title, body }` or null
    - specs `{ path, content }[]`
    - inputs map
  - **Always-kept block** (trusted framing): title, totals, per-role counts, the blast
    summary string and counts, intent capped at `MAX_INTENT_CHARS`, and a
    **missing-inputs note**, e.g. "Not available: Intent (never derived); Blast radius
    (index degraded, partial)", so the model does not invent context (FR-10).
  - **Budgeted sections** are each rendered by a function `(tokenBudget) → { text, truncated: boolean }`:
    - `files`: `core` first, then by churn (additions + deletions) descending. Each line
      is `path [role] +a −d lines 12-18,40-52`. Overflow collapses per role to
      "+N more <role> files".
    - `blast_detail`: per symbol, callers in the index's rank order, with
      "(+N more callers)" for any omitted.
    - `description` and `linked_issue`: cut at the budget with the marker
      `[truncated]`.
    - `project_context`: documents go in whole, in D6 order. The first one that doesn't
      fit is cut with `[truncated]`. Later ones are skipped and listed as
      `[omitted: path, path]`.
  - Every untrusted payload is passed through `wrapUntrusted('<section>', …)`: file and
    symbol names, description, issue, specs. Section headings and markers stay outside
    the wrap.
  - **Fit loop:** render each section at its ceiling, then measure
    `count(system) + count(user)`. While the total exceeds `INPUT_TOKEN_BUDGET`, walk
    `SHRINK_ORDER`: halve that section's budget, and after two halvings set it to 0
    (the section is then replaced by `[omitted for budget]`). Re-measure after every
    change. Every section whose output was cut goes into `truncatedSections`. The loop
    must terminate: at all-zero, only the always-kept block remains.
  - `brief.system.md`: role statement. A SECURITY paragraph modelled on
    `server/src/prompts/intent.system.md:3`. What to write:
    - a summary of what the PR does and why, at most 3 sentences and 400 characters
    - concrete risks, each citing a path copied exactly from the CHANGED FILES or BLAST
      files lists, optionally with `:line`/`:start-end`
    - review focus as `file` + `line` taken from the listed changed line ranges or caller
      lines, most important first

    Say plainly that citations are verified in code and invalid ones are discarded.
    Never ask for confidence or a score. **Do not describe the JSON shape in prose**
    (`docs/agent-prompts/README.md:33-38`). Do not add "at most N" quotas, since capping
    happens in code.
- **Constraint:** NFR-1, NFR-2, NFR-3, FR-9. R3. `RULE-PROMPT`
  (`.claude/skills/pr-self-review/repo-rules.md:195-203`): the prompt and the docs row
  land together.
- **Owner:** `implementer`
- **Done when:** typecheck passes. `prompt.ts` imports only `@devdigest/reviewer-core`
  (`wrapUntrusted`), `./constants.js` and types. The docs table lists
  `brief.system.md`.

### Step 6 — Brief repository
- **Files:** `server/src/modules/brief/repository.ts` (new)
- **Change:** `class BriefRepository { constructor(private db: Db) }` with two methods:
  - `getBrief(prId): Promise<unknown | undefined>`, returning `row.json`
  - `upsertBrief(prId, json: PrBriefStored): Promise<void>`, using `insert … onConflictDoUpdate({ target: t.prBrief.prId, set: { json } })`

  It gets no container and does no workspace check. The PR the caller passes has already
  been resolved inside the workspace (doc-comment that, as
  `server/src/modules/intent/repository.ts:12-14` does).
- **Constraint:** onion-architecture §3. `.dependency-cruiser.cjs:166-174` (the
  repository takes `Db` only).
- **Owner:** `implementer`
- **Done when:** typecheck passes and depcruise stays clean.

### Step 7 — Brief service (read + generate)
- **Files:** `server/src/modules/brief/service.ts` (new)
- **Change:** `export interface BriefLog { info(obj: object, msg: string): void; warn(obj: object, msg: string): void }`,
  a structural type that Fastify's `req.log` satisfies without importing Fastify.
  `class BriefService { constructor(private container: Container) }`, holding a
  `BriefRepository` built from `container.db` (same as `intent/service.ts:103-105`) and
  a `generating = new Set<string>()`.
  - `get(workspaceId, prId, log)`: `reviewRepo.getPull`, throwing `NotFoundError` on a
    miss. Then `repo.getBrief`, then `PrBriefStored.safeParse`. A failed parse logs a
    warn and returns null (D2). Otherwise it returns `toRecord(stored, pull.headSha)`.
    **No LLM, no GitHub call** (NFR-5).
  - `generate(workspaceId, prId, log)`:
    1. Check the guard key `${workspaceId}:${prId}`: if it is present, throw
       `ConflictError` before any I/O. Otherwise add it, wrapped in `try/finally`
       (FR-16).
    2. `getPull` → NotFound. `reviewRepo.getRepo(pull.repoId)`.
       `reviewRepo.getPrFiles(prId)`. If there are zero files, throw `ValidationError`
       (D8).
    3. Collect facts, each fallible source in its own try/catch so it degrades instead of
       failing:
       - `container.intent.get`
       - `container.blast.forPull`
       - `container.intent.readLinkedIssue({ owner: repo.owner, name: repo.name }, pull.body)`
       - `container.projectContext.specsForBrief(workspaceId, pull.repoId)`

       Build file rows with `classifyFile` + `changedRanges` (D7). Compute
       `inputStatuses`.
    4. `resolveFeatureModel(container, workspaceId, 'risk_brief')`, then
       `container.llm(choice.provider)`, then `loadPromptTemplate(BRIEF_SYSTEM_PROMPT_FILE)`.
    5. `buildBriefMessages(facts, (s) => container.tokenizer.count(s), system)`.
    6. **One** `llm.completeStructured({ model: choice.model, schema: PrBriefModelOutput, schemaName: BRIEF_SCHEMA_NAME, messages, temperature, maxTokens: OUTPUT_MAX_TOKENS, timeoutMs })`.
       A throw propagates, and nothing is persisted, so the previous brief stays (FR-15).
    7. `postValidate` against `buildAnchorIndex`, then `clampSummary`.
    8. Build `PrBriefStored` with:
       - intent and blast snapshots (A-3)
       - `history: { history: [] }`
       - `provider: choice.provider`, `model: result.model`, `attempts: result.attempts`
       - `tokens_in`, `tokens_out`, `cost_usd`
       - `input_tokens_measured`, `truncated_sections`
       - `head_sha: pull.headSha`, `generated_at: new Date().toISOString()`

       Then `repo.upsertBrief`.
    9. Write one log line:
       `log.info({ prId, provider, model, attempts, tokensIn, tokensOut, costUsd, inputTokensMeasured, truncatedSections, validation }, 'brief: generated')`
       (FR-14).
    10. Return `toRecord(stored, pull.headSha)`.
- **Constraint:** NFR-4 (scope via `getPull`), NFR-5, NFR-8, FR-13, FR-14.
  `.dependency-cruiser.cjs:107-124` (no Drizzle, no Fastify in the service).
  `server/INSIGHTS.md:100-112`.
- **Owner:** `implementer`
- **Done when:** typecheck passes and depcruise stays clean. `grep -n "fastify\|drizzle" server/src/modules/brief/service.ts`
  finds nothing, and the file makes exactly one `completeStructured` call.

### Step 8 — Routes and registration
- **Files:** `server/src/modules/brief/routes.ts` (new), `server/src/modules/index.ts`
  (edit: import + `brief` entry)
- **Change:** `export default async function briefRoutes(appBase)`, with the service
  built once and two handlers:
  - `GET /pulls/:id/brief`, schema `{ params: IdParams, response: { 200: PrBriefRecord.nullable() } }`,
    calling `service.get(workspaceId, req.params.id, req.log)`
  - `POST /pulls/:id/brief`, schema `{ params: IdParams, response: { 200: PrBriefRecord } }`,
    calling `service.generate(…)`

  Both call `getContext` first. Add a header doc comment in the style of
  `server/src/modules/intent/routes.ts:8-19`. It should say GET returns `null` rather
  than 404 for "no brief yet", and POST is one paid call that returns 409 while one is
  in flight. The service stays route-local, with **no** container getter, because no
  other module consumes it. That also means only one guard set exists per process.
- **Constraint:** `server/CLAUDE.md:53-55`. onion-architecture §1.
  `server/src/modules/index.ts:14-17` (one import plus one entry).
- **Owner:** `implementer`
- **Done when:** `cd server && pnpm typecheck` passes. depcruise is clean. The existing
  `server/test/routes-smoke.test.ts` still passes.

### Step 9 — Server unit tests (hermetic)
- **Files:** `server/test/brief-helpers.test.ts` (new), `server/test/brief-prompt.test.ts` (new)
- **Change:**
  - **helpers:**
    - `changedRanges` on multi-hunk, `,0` and missing-len headers
    - `postValidate` against the spec's verification case (`specs/03-pr-brief.md:304-307`):
      an invented path is dropped, a blast-only caller path is kept, an out-of-range
      line is snapped to the nearest anchor, 10 focus items are cut to 8, the dedupe
      works, a risk left with zero refs is dropped, and the counts match exactly
    - `parseFileRef` on all three forms
    - `toRecord` stale/fresh
    - `inputStatuses` for each D3 branch
  - **prompt**, with a fake counter `s => Math.ceil(s.length / 4)`:
    - a fixture whose description, specs and file list each exceed their ceilings yields
      `inputTokens ≤ 8000`, and `truncatedSections` names them
    - the user message contains **no line** of any fixture patch body (assert each `+`/`-`
      body line is absent)
    - untrusted sections appear inside `<untrusted source=…>` blocks
    - the missing-inputs note lists the missing inputs
    - shrink order is respected: specs shrink before files
- **Constraint:** `TESTING.md:8-24` (typological, one happy path plus the edges that
  matter). `server/CLAUDE.md:61-62` (no `.it.` suffix, since these are DB-free).
- **Owner:** `test-writer`
- **Done when:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` passes.

### Step 10 — Server integration test (real Postgres)
- **Files:** `server/test/brief.it.test.ts` (new)
- **Change:** Follow `server/test/intent.it.test.ts` (testcontainers, `buildApp`,
  seed).
  - **Inject `MockLLMProvider` under `openai`**, since `risk_brief` defaults there. Also
    inject it under `anthropic`, and inject `MockGitHubClient`, so no path can go live
    (`server/INSIGHTS.md:42-53`). The fixture goes under `structuredBySchema.PrBrief`.
  - Inject a mock `repoIntel` (pattern at `server/test/blast.it.test.ts:171`).
  - Cases:
    1. GET returns `null` before generation.
    2. POST returns a record with `summary`, filtered risks and focus. GET returns it
       identically, with **zero** additional `completeStructured` calls on the mock
       (FR-6).
    3. After `UPDATE pull_requests SET head_sha`, GET returns `is_stale: true`, with no
       call (FR-11).
    4. A fixture failing the schema makes POST fail, and the prior brief stays
       byte-identical (FR-15).
    5. Two concurrent POSTs give one 200 and one 409, with exactly one model call
       (FR-16). Make the mock await a deferred promise so the overlap is deterministic.
    6. A PR in another workspace gives 404 on both verbs (NFR-4).
    7. With no intent row and a degraded empty `repoIntel`, POST succeeds, with
       `inputs.intent === 'missing'`, `inputs.blast === 'missing'` and `blast === null`
       (FR-10).
    8. A workspace `feature_models.risk_brief = { provider: 'anthropic', model: 'x' }`
       setting routes the single call to the anthropic mock (FR-13).
    9. A `specs` document attached to an enabled agent reaches the captured user
       message, and a `docs`-category one does not (D6).
- **Constraint:** `CLAUDE.md:116-118` (`*.it.test.ts` suffix). NFR-7.
- **Owner:** `test-writer`
- **Done when:** `cd server && pnpm exec vitest run .it.test` passes with Docker, and
  also runs clean under `env -u OPENAI_API_KEY -u OPENROUTER_API_KEY -u ANTHROPIC_API_KEY`.

### Step 11 — Client hooks and query key
- **Files:** `client/src/lib/hooks/keys.ts` (edit), `client/src/lib/hooks/reviews.ts` (edit)
- **Change:**
  - Add `brief: (prId) => ["pr-brief", prId] as const` to `reviewKeys`.
  - In `reviews.ts`, add `usePrBrief(prId)`, which does `api.get<PrBriefRecord | null>(\`/pulls/${prId}/brief\`, PrBriefRecordSchema.nullable())`
    with `enabled: !!prId`.
  - Add `useGeneratePrBrief(prId)`, a mutation posting to the same URL and parsing with
    `PrBriefRecordSchema`. Its `onSuccess` calls
    `qc.setQueryData(reviewKeys.brief(prId), record)`. On error it does **not** clear the
    cache, so the previous brief stays visible (FR-20).
  - Add a doc comment modelled on `reviews.ts:139-156`: reading costs nothing, while
    generating is one paid call and returns 409 while one runs.
- **Constraint:** `client/CLAUDE.md:48-49`. `client/src/lib/hooks/keys.ts:1-10` (key
  factory only).
- **Owner:** `implementer`
- **Done when:** `cd client && pnpm typecheck` passes.

### Step 12 — Brief copy
- **Files:** `client/messages/en/brief.json` (edit)
- **Change:** Keep the existing keys. Change `block.risks` to `"Risk areas"`. Add:
  - `section` ("PR Brief")
  - `empty.title` ("No brief yet"), `empty.hint` ("Generate a Why+Risk brief for this PR.")
  - `generate` ("Generate brief"), `generating` ("Generating brief…"), `regenerate`
    ("Regenerate brief")
  - `stale` / `staleHint`
  - `reviewFocus.heading` ("Review focus — read these first"), `reviewFocus.empty`
  - `noRisks` (exists, reuse)
  - `missingInputs` ("Generated without: {inputs}"), `partialInputs`, and labels
    `input.intent`, `input.blast`, `input.description`, `input.linked_issue`,
    `input.project_context`
  - `notInDiff` ("File not in this PR's diff: {file}"). This is used by DiffTab, which
    reads the `brief` namespace for that one key.
  - `error.title`, `error.retry`, `conflict` ("A brief is already being generated for
    this PR.")
  - `severity.high|medium|low`
- **Constraint:** FR-21. frontend-code-organization §5 (strings never live in
  constants).
- **Owner:** `implementer`
- **Done when:** the JSON is valid and every key used in S13–S17 exists.

### Step 13 — Extract a presentational `BlastRadiusView` (behaviour-preserving)
- **Files:** `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusView/{BlastRadiusView.tsx,index.ts,styles.ts,constants.ts,helpers.ts}` (new),
  `…/_components/BlastRadiusCard/{BlastRadiusCard.tsx,constants.ts,helpers.ts,styles.ts}` (edit)
- **Change:**
  - Move the following out of `BlastRadiusCard.tsx:52-420` into
    `BlastRadiusView({ data: BlastRadius, repoFullName, headSha })`, along with the
    constants, helpers and styles they use:
    - `CallerRef`, `ImpactChips`, `ImpactGraph`
    - the stat row with its Tree/Graph toggle
    - the per-symbol tree with its open state
  - `BlastRadiusView` takes the **base** `BlastRadius`, so it can render the brief's
    snapshot, and has no fetching and no Card wrapper.
  - `BlastRadiusCard` keeps the hook, loading/error, the degraded badge with its resync
    button, and the empty state. It renders `<Card><SectionLabel …/><BlastRadiusView …/></Card>`.
  - The `helpers.ts` functions typed against `PrBlastRadius` move with the view and are
    retyped to `BlastRadius` (a structural supertype, so no cast is needed).
- **Constraint:** frontend-code-organization §1: two consumers in the **same** route
  means a sibling in `_components/`, not a promotion to `src/components/`.
  `client/INSIGHTS.md:13-21` (keep the `<section aria-label>` per symbol row).
- **Owner:** `implementer`
- **Done when:** `cd client && pnpm test` passes the **unchanged**
  `BlastRadiusCard.test.tsx`, and `pnpm typecheck` passes.

### Step 14 — Make `VerdictBanner` usable without a verdict and with actions
- **Files:** `…/_components/VerdictBanner/VerdictBanner.tsx` (edit), `…/VerdictBanner/styles.ts` (edit)
- **Change:** Make three additive props optional and default them, so the Findings-tab
  call site at `ReviewRunAccordion.tsx:144-154` is untouched:
  - `verdict: Verdict | null`. With `null`, render no verdict icon/label or findings
    badge, only the summary. The icon box shows a neutral `FileText` in
    `var(--text-muted)`.
  - `findingsCount` and `blockers` become optional.
  - `actions?: React.ReactNode`, rendered at the top right of the main column, before the
    score column. The brief puts its refresh button and stale badge here.

  Summary stays plain text.
- **Constraint:** `.claude/skills/frontend-code-organization/SKILL.md` §2. FR-17. NFR-3
  (plain text).
- **Owner:** `implementer`
- **Done when:** the existing `VerdictBanner.test.tsx` and `ReviewRunAccordion.test.tsx`
  pass unchanged. `pnpm typecheck` passes.

### Step 15 — `PrBriefCard` (all states)
- **Files:** `…/_components/PrBriefCard/{PrBriefCard.tsx,index.ts,styles.ts,constants.ts,helpers.ts}` (new).
  Nested `…/PrBriefCard/_components/{IntentBlock,RiskAreas,ReviewFocusList,BriefSkeleton}/{<Name>.tsx,index.ts}` (new, plus `styles.ts` where needed).
- **Change:** Props are `{ prId, repoFullName, headSha, onOpenInDiff: (file: string, line: number | null) => void }`.
  Hooks: `usePrBrief`, `useGeneratePrBrief`, and `usePrReviews` (a cache hit, as at
  `DiffTab.tsx:55-56`).
  - **Loading** → `BriefSkeleton`. **No brief** → mockup 2: `SectionLabel icon="FileText"`
    reading "PR BRIEF" over a Card with an `EmptyState` and a "Generate brief" CTA
    (loading while pending).
  - **Generating with no prior brief** → `BriefSkeleton` (FR-20). **Generating with a
    prior brief** → the prior brief, with the refresh button in its loading state.
  - **Error** → an inline error row with a Retry button. Any prior brief stays rendered
    below it. A 409 (`ApiError.status === 409`, `client/src/lib/api.ts:9-17`) shows
    `conflict` instead.
  - **Ready**, per mockup 1:
    - **Top:** `VerdictBanner`. `verdict`/`score`/`findingsCount`/`blockers` come from
      `latestReviewSummary(reviews)` in `helpers.ts`: the first review with a non-null
      verdict, where blockers are CRITICAL findings without `dismissed_at`, the same
      rule as `ReviewRunAccordion.tsx:60`. `summary` is `brief.summary`, and
      `costUsd`/`tokensIn`/`tokensOut` come from the brief. `actions` holds the stale
      Badge in a `<span title>` wrapper (`client/INSIGHTS.md:81-88`) plus a tertiary
      `RefreshCw` button.
    - **Missing-inputs line:** only when some input is not `present`. Uses
      `missingInputs`/`partialInputs`, with labels from a `constants.ts` key map.
    - **Two-column grid.** Left: `IntentBlock` (quote plus In/Out scope, only when
      `brief.intent`), then `RiskAreas`. Right: a "Blast radius" panel containing
      `<BlastRadiusView data={brief.blast} …/>` when `brief.blast` is set.
    - **Bottom:** `ReviewFocusList` with a heading and a count `Badge`. Items are
      `<button>`s reading `file:line — reason`, and each one calls
      `onOpenInDiff(file, line)`.
  - **RiskAreas**: one chip per risk. Each chip has a severity icon/colour from a
    `constants.ts` map to CSS tokens (`high→--crit`, `medium→--warn`, `low→--text-muted`),
    the title, and the first file ref in mono. The chip is a `<section aria-label>` with
    a `role="button"`/`aria-expanded` chevron header. Expanding shows the explanation
    and **all** refs. Each ref is a `<button>` that calls `onOpenInDiff(path, startLine)`,
    parsing the ref with a `parseRef` helper in `helpers.ts` (FR-18).
  - All model text renders as React text nodes: no `Markdown`, no
    `dangerouslySetInnerHTML` (NFR-3).
- **Constraint:** frontend-code-organization §1 (nested private parts), §2, §5 (colours
  are tokens) and §7. `client/INSIGHTS.md:25-32` (read-only labels are `Badge`,
  interactive ones are buttons). `client/INSIGHTS.md:161-167`.
- **Owner:** `implementer`
- **Done when:** `pnpm typecheck` passes and `helpers.ts` imports nothing from `react`.

### Step 16 — Overview integration and deep-link URL wiring
- **Files:** `…/_components/OverviewTab/OverviewTab.tsx` (edit),
  `client/src/app/repos/[repoId]/pulls/[number]/helpers.ts` (new),
  `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` (edit)
- **Change:**
  - `helpers.ts` (pure): export `DIFF_TARGET_PARAMS = { file: "file", line: "line" } as const`.
    - `readDiffTarget(search: URLSearchParams): { file: string; line: number | null } | null`,
      where a non-positive-integer line reads as `null`
    - `withDiffTarget(search, file, line): URLSearchParams`, which sets `tab=diff`,
      `file`, and `line` (or deletes it)
    - `withoutDiffTarget(search)`
  - `page.tsx`: `setTab` now calls `withoutDiffTarget` before setting `tab` (D9). Add an
    `openInDiff(file, line)` that calls `router.replace` with
    `withDiffTarget(search, file, line)`. Pass `onOpenInDiff={openInDiff}` to
    `OverviewTab` and `target={readDiffTarget(search)}` to `DiffTab`. The page stays a
    wiring layer.
  - `OverviewTab`: add the props `onOpenInDiff`. Render `<PrBriefCard …/>` first. Render
    the standalone `IntentCard` and `BlastRadiusCard` **only while** `usePrBrief(prId)`
    has no data: loading, null or error (A-4, NFR-8). The description section stays at
    the bottom, unchanged.
- **Constraint:** frontend-code-organization §4 (pages stay thin, shaping lives in
  helpers). next-best-practices (App Router `useSearchParams` is already used on this
  client page).
- **Owner:** `implementer`
- **Done when:** `pnpm typecheck` passes. Manual check (by whoever runs the app, not the
  implementer): `?tab=diff&file=src/config.ts&line=12` survives a reload.

### Step 17 — Files-changed target: expand, scroll, highlight, not-in-diff notice
- **Files:** `…/_components/DiffTab/DiffTab.tsx` (edit), `…/DiffTab/styles.ts` (edit),
  `…/_components/SmartDiffGroups/SmartDiffGroups.tsx` (edit),
  `client/src/components/diff-viewer/target.ts` (new),
  `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx` (edit),
  `client/src/components/diff-viewer/FileCard/FileCard.tsx` (edit),
  `client/src/components/diff-viewer/CodeLine/CodeLine.tsx` (edit),
  `client/src/components/diff-viewer/styles.ts` (edit),
  `client/src/components/diff-viewer/index.ts` (edit: export `type DiffTarget`)
- **Change:**
  - Add `export interface DiffTarget { file: string; line: number | null }`, declared
    in the new `target.ts` next to `findings.ts`/`comments.ts`.
  - **DiffTab**: new prop `target?: DiffTarget | null`. If `target` is set and
    `!files.some(f => f.path === target.file)`, render a notice row
    (`t("notInDiff", { file })` from `useTranslations("brief")`) above the viewer
    (FR-19). Pass `target` down to both `SmartDiffGroups` and `DiffViewer`.
  - **SmartDiffGroups**: new prop `target`. A `useEffect` keyed on `target?.file` finds
    the group whose `joined` files contain it and sets `open[role] = true`
    (`client/INSIGHTS.md:99-108`: state is not assumed to survive). Pass `target`
    through to each group's `DiffViewer`.
  - **DiffViewer** passes `target` to each `FileCard`.
  - **FileCard**: `const isTarget = target?.file === file.path`. Initial `open` is
    `isTarget || size rule`. A `useEffect` on `[isTarget, target?.line]` calls
    `setOpen(true)` and then, in `requestAnimationFrame`, scrolls the focused line
    element (a ref from `CodeLine`, or `[data-diff-focus]` inside the card's root ref)
    or else the card itself: `scrollIntoView?.({ block: "center" })`, optional-called
    because jsdom lacks it. Pass
    `focused={isTarget && ln.newNo === target.line && ln.kind !== "del"}` to each
    `CodeLine`.
  - **CodeLine**: a new optional `focused` prop that adds `data-diff-focus` and a
    highlight style `s.focusedLine` (an `--accent-bg` background with an `--accent`
    left stripe; tokens only).

  All new props are optional, so every other `DiffViewer` consumer is unaffected.
- **Constraint:** FR-5, FR-12, FR-19. frontend-code-organization §8 (curated shared
  barrel). `client/INSIGHTS.md:13-21`, `:99-108`.
- **Owner:** `implementer`
- **Done when:** `cd client && pnpm typecheck` passes. The existing
  `FileCard.test.tsx`, `DiffTab.test.tsx` and `SmartDiffGroups.test.tsx` pass unchanged.

### Step 18 — Client tests
- **Files:** `…/_components/PrBriefCard/PrBriefCard.test.tsx` (new),
  `client/src/app/repos/[repoId]/pulls/[number]/helpers.test.ts` (new),
  `…/_components/OverviewTab/OverviewTab.test.tsx` (new),
  `…/_components/DiffTab/DiffTab.test.tsx` (edit),
  `client/src/components/diff-viewer/FileCard/FileCard.test.tsx` (edit),
  `…/_components/VerdictBanner/VerdictBanner.test.tsx` (edit)
- **Change:** Mock at `@/lib/hooks/reviews` (pattern: `IntentCard.test.tsx:23-34`). Wrap
  renders in `NextIntlClientProvider` with `messages/en/brief.json` (+ `prReview.json`,
  `blast.json`). Use `fireEvent` only.
  - **PrBriefCard:**
    - Empty state shows the three strings, and clicking the CTA calls `mutate`.
    - Ready state shows summary, risk chips and focus items with the count, and
      "Risk areas".
    - Clicking a focus item calls `onOpenInDiff("src/config.ts", 12)`.
    - Expanding a risk shows its explanation.
    - Stale shows the badge.
    - Missing inputs shows "Generated without: Intent, Blast radius".
    - The no-review case shows no score.
    - Error keeps the prior brief visible.
    - Summary text containing `<b>x</b>` renders literally.
  - **Route helpers:** round-trip of `withDiffTarget`/`readDiffTarget`, rejection of an
    invalid line, and `withoutDiffTarget`.
  - **OverviewTab:** with no brief, the standalone Intent/Blast cards render. With a
    brief, they do not.
  - **DiffTab:** a target not in the files shows the notice. A target inside a
    default-collapsed `docs` group force-opens that group.
  - **FileCard:** a target auto-opens a large (>`AUTO_EXPAND_MAX_LINES`) file, and the
    focused line carries `data-diff-focus`. Stub `Element.prototype.scrollIntoView` and
    assert it was called.
  - **VerdictBanner:** `verdict={null}` renders the summary with no verdict label, and
    `actions` renders.
- **Constraint:** `client/INSIGHTS.md:112-118` (no user-event). `client/INSIGHTS.md:25-32`
  (query Badges by text, buttons by role). react-testing-library.
- **Owner:** `test-writer`
- **Done when:** `cd client && pnpm test` passes.

### Step 19 — Architecture review pass
- **Files:** read-only over the whole diff
- **Change:** Run `architecture-reviewer`. It checks onion boundaries (depcruise clean),
  that `BriefService` reaches other modules only through Container getters, that
  `helpers.ts`/`prompt.ts` are pure, that frontend placement is right (`BlastRadiusView`
  sibling, nested `PrBriefCard/_components`, route `helpers.ts`), contract parity, and
  the `RULE-PROMPT` pairing. Findings go back to `implementer`.
- **Constraint:** `.claude/skills/onion-architecture/SKILL.md` review checklist.
  frontend-code-organization review checklist.
- **Owner:** `architecture-reviewer`
- **Done when:** the reviewer reports no CRITICAL/HIGH findings still open.

### Step 20 — Security review pass
- **Files:** read-only over the whole diff
- **Change:** Run `security-reviewer`. The lane triggers on two new public routes,
  workspace-scoping logic, and untrusted text reaching a model (routing.md:68). Focus:
  - NFR-4 tenancy on both verbs, and in `specsForBrief` (workspace + repo scoped)
  - NFR-3: every untrusted section is wrapped, and the system prompt has its SECURITY
    paragraph
  - no hunk body text in the prompt
  - model text rendered as plain text
  - `file` and `line` query params used only as comparison values in the client, never
    as HTML or a URL (`githubBlobUrl` is not fed from them)
  - no secrets are logged in the generation log line
- **Constraint:** `.claude/skills/security/SKILL.md`. `server/CLAUDE.md:66-70`.
- **Owner:** `security-reviewer`
- **Done when:** no CRITICAL/HIGH findings remain open.

### Step 21 — FR-22 retrospective and cost report
- **Files:** `docs/retros/hw05-pr-brief.md` (new; location per *Open questions*)
- **Change:** A short workflow retrospective (spec → plan → implement → review/fix
  rounds: what worked, what didn't) plus a cost report. The report covers the pipeline's
  own agent spend, taken from the orchestrator, and the per-generation brief cost:
  `cost_usd`, `tokens_in`/`tokens_out` and `input_tokens_measured` from one real or
  seeded generation, compared with the Recommendation's ~$0.028 estimate on the default
  model.
- **Constraint:** FR-22. Not a spec file, not product code.
- **Owner:** caller or human. Not `implementer`, because the pipeline's cost data lives
  with the orchestrator.
- **Done when:** the file exists with both sections.

---

## Contract changes

All changes are in `server/src/vendor/shared/contracts/brief.ts`, copied byte-for-byte
to `client/src/vendor/shared/contracts/brief.ts` (CI enforces this at
`.github/workflows/client.yml:47-51`):

- **New:** `ReviewFocusItem`, `PrBriefModelOutput`, `BriefInputStatus`, `BriefInputs`,
  `BriefValidation`, `PrBriefStored`, `PrBriefRecord` (D1).
- **Changed:** `PrBrief` gains required `summary` and `review_focus`, and `intent`/`blast`
  become `.nullable()`. `RULE-CONTRACT-BREAK` would normally warn. Here, a repo-wide
  grep shows no consumer of `PrBrief` (spec, `specs/03-pr-brief.md:52`), and both
  packages type-check against the new shape in this same change.
- **Unchanged:** `Risk`, `Risks`, `PrHistory`, `BlastRadius`, `BlastRadiusResponse`,
  `Intent`, and `FeatureModelId` (`risk_brief` already exists, `platform.ts:15-21`).
- **Client URL contract (not zod):** `?tab=diff&file=<path>&line=<n>` (D9).

## Migration

**None.** `pr_brief (pr_id PK → pull_requests ON DELETE CASCADE, json jsonb NOT NULL)`
already exists (`server/src/db/schema/reviews.ts:102-107`), and the brief, its head SHA
and all metadata live inside `json` (NFR-6). No file under `server/src/db/schema/` is
edited, so `pnpm db:generate` must **not** be run.

## Test plan

| Suite | Command (verbatim from TESTING.md / CLAUDE.md) | Covers which step |
|---|---|---|
| server-unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | S9. Regression for S2 (intent/project-context/blast unit tests), S8 (routes smoke) |
| server-integration | `cd server && pnpm exec vitest run .it.test` | S10 (FR-6/10/11/13/15/16, NFR-4/7, D6). Regression for intent/project-context/blast `.it` files |
| server typecheck | `cd server && pnpm typecheck` | S1–S8 |
| server architecture | `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` (`server/.dependency-cruiser.cjs:9`) | S2, S4–S8, S19 |
| client | `cd client && pnpm test` | S13, S14, S17 regressions. S18 |
| client typecheck | `cd client && pnpm typecheck` | S1, S11–S17 |
| contract parity | `diff -r client/src/vendor/shared server/src/vendor/shared` (`.claude/skills/pr-self-review/repo-rules.md:121-122`) | S1, NFR-9 |

e2e is not extended. No existing e2e flow asserts Overview content (a grep of `e2e/`
for Overview/Intent/Blast finds nothing), so nothing regresses there.

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| A test reaches `container.llm('openai')` without an override and makes a live, billed call | S10 | Inject mocks under `openai` **and** `anthropic`. Run once under `env -u …_API_KEY` (S10 done-when). `server/INSIGHTS.md:42-53`. |
| Array caps or a `positive()` bound in the model schema turn a slightly-off answer into paid retries, then a failure | S1, S7 | R1: no bounds in `PrBriefModelOutput`. Capping and snapping happen only in `postValidate`. |
| Findings leak into the prompt through `SmartDiffService` | S7 | R2 / D7: use `classifyFile` only. The S20 security pass greps the user message builder. |
| The fit loop fails to terminate, or goes over budget when the always-kept block is large | S5 | `MAX_INTENT_CHARS` cap. The loop goes to all-zero and then stops. S9 asserts ≤ 8000 on an oversized fixture. |
| A process-local 409 guard doesn't cover multiple API processes | S7 | The app runs as one local process (`CLAUDE.md:50`, "API and web run on the host"). This is the same accepted limit as intent (`intent/service.ts:99-101`). |
| A corrupt or old-shaped `pr_brief.json` makes GET return 500 and breaks the Overview | S7 | D2: `safeParse`, then `null` plus a warn log. OverviewTab also falls back to the standalone cards on error (S16, NFR-8). |
| The `BlastRadiusCard` refactor silently changes behaviour | S13 | The existing `BlastRadiusCard.test.tsx` must pass **unchanged** (S13 done-when). |
| The new `VerdictBanner` props break the Findings tab | S14 | All props are additive and optional. `ReviewRunAccordion.test.tsx` must pass unchanged. |
| jsdom lacks `scrollIntoView`, so FileCard tests crash | S17, S18 | Call it optionally in code and stub it in tests. |
| A deep-link target sits inside a collapsed Smart Diff group, or the user toggles Original order and back | S17 | Force-open from the `target` prop in an effect, never from persisted state (`client/INSIGHTS.md:99-108`). |
| `client/src/vendor/shared` drifts and fails `client.yml` | S1 | Copy the file, then check with `diff -r` (S1 done-when). |
| A prompt lands without its docs row and `RULE-PROMPT` warns | S5 | The docs row is in the same step. |

## Out of scope

- "Prior PRs touching these files". `history` is always `{ history: [] }`.
- Auto-regenerating on a new commit or when a review completes.
- Deriving intent (or any other model-backed fact) during brief generation.
- A dedicated brief attachment target for Project Context documents (no schema change).
- Changing the `risk_brief` registry default model (see Recommendation).
- Promoting `BriefService` onto the Container. No second consumer exists.
- Updating the `specs/README.md` status of spec 03 to *implemented*. That is the spec
  owner's or caller's edit after verification, not a plan step.
- e2e browser coverage for the brief.
- Merging to `main`.

## Open questions

None of these block implementation. Each has a default the plan already uses:

1. **FR-22 artefact location.** The repo has no retrospective or cost-report precedent
   (`docs/` holds only `agent-prompts/` and `plans/`). Default:
   `docs/retros/hw05-pr-brief.md`. Change the S21 path if the homework expects a
   different place.
2. **Zero-changed-files PR** (D8). The plan returns 422 without a model call, mirroring
   intent. The spec is silent. Confirm, or ask for an empty brief instead.
3. **Summary length.** The spec says "≤ ~400 characters". The plan instructs the model
   and then hard-clamps to 400 on a word boundary with `…` (S4 `clampSummary`). Nothing
   is rejected for length.
