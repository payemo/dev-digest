# Development Plan: Export to CI — deploy a review agent to GitHub Actions, ingest CI runs back into the studio

**Branch:** emdash/export-to-ci-w8gut · **Date:** 2026-10-10
**Packages touched:** server · client · shared (`server/src/vendor/shared` + its `client/src/vendor/shared` copy) · agent-runner (small, additive) · scripts/.github (bundle build + CI job)
**Estimated steps:** 19 · **Migration required:** yes · **Contract change:** yes (additive only)
**Execution mode:** multi-agent. `implementer` runs S1–S15 and S17. `test-writer` runs S16. `architecture-reviewer` (S18a) and `security-reviewer` (S18b) review after implementation. `plan-verifier` (S19) closes. Fix loops go back to `implementer`.

---

## Requirements

**Sources read:**
- The user's freeform spec "Export to CI — вимоги для worktree B" (relayed verbatim by the caller). There is no `spec-creator` spec, so it has no AC-IDs. The bullets are numbered below as **R1–R12** so steps can reference them.
- Five mockup PNGs: Target, CI tab, Preview, Configure, Install.

**Clarified with the user (relayed answers, 2026-10-10):**
1. **Ingest** uses **pull via GitHub Actions artifacts**, hardened as described in [Security model](#security-model). The user can veto that section. A push endpoint with a hashed token stays documented as a later option and is not built here.
2. **`agent-runner/` already exists** (commit `4450ef1`). The plan builds on it and does not create it. The plan also decides how the bundle reaches the target repo (see Recommendation, point 2).
3. **Target step:** all four cards render exactly as in the mockup. Only GitHub Actions is selectable. CircleCI, Jenkins and Generic CLI render disabled with a "coming soon" badge. No generators exist for them.
4. **Execution mode** is multi-agent.
5. **Accepted defaults:**
   - Fail CI on: a 3-value segmented control writing `agents.ci_fail_on`. `any` stays Config-tab-only.
   - OpenRouter-only in CI. The wizard blocks Install for other providers.
   - `memory.jsonl` holds global memory plus repo-scoped memory for the target repo.
   - Repo picker in the Target step lists imported repos only.
   - The zip is built client-side and still records an installation.
   - Tests: server unit + integration, agent-runner unit, client component tests. No new e2e.
   - Each CI run writes `agent_runs` with `source='ci'`.
   - `ci_runs` is extended into a link table. `ci_installations` gets new columns. Columns are added only, never dropped.
   - `RunTrace.config` gets additive optional fields.
   - The `uses: devdigest/review-action@v1` placeholder is not emitted.
   - Fork PRs are skipped.
   - Out of scope: the Stats tab, the multi-run service, the PR feed.

| Req | Text (condensed) | Covered by step |
|---|---|---|
| R1 | `Add to CI` opens a 4-step wizard: Target → Preview → Configure → Install | S13 |
| R2 | Target: GitHub Actions primary; other targets only if real generators exist (user: show disabled + "coming soon") | S13 |
| R3 | Preview: manifest, skills, `.devdigest/memory.jsonl`, editable `.github/workflows/…yml` | S5, S7, S13 |
| R4 | Configure: `pull_request` opened / synchronize / optional reopened; post as review / PR comment / exit code only | S1, S5, S13 |
| R5 | Install: open a PR with the files, or download a zip | S7, S9, S13 |
| R6 | Wizard writes to its own `devdigest/ci` branch and opens a PR, never directly to `main` | S7 |
| R7 | Workflow runs the bundled `agent-runner`; the `devdigest/review-action@v1` placeholder is not emitted | S4, S5, S10, S11 |
| R8 | CI Runs page: repo, PR, agent, verdict, findings, cost, duration, job link | S6, S8, S14 |
| R9 | Agent CI tab: installations, workflow version, history, `Fail CI on` | S6, S7, S13 |
| R10 | Touch only `ci/`, its routes, CI Runs and the agent's CI tab; leave the multi-run service and PR feed alone | all (Constraint check) |
| R11 | Ingest writes `agent_runs` with `source='ci'` and accepts results only through an authenticated or verified channel | S6, S8 |
| R12 | Manifest validated by the same Zod schema in studio and runner; trace stores manifest version, model, deps, commit SHA | S1, S5, S8, S10 |

## Recommendation

The literal ask is sound. These points refine it or depart from the mockup or the runner's current docs:

1. **One workflow file per agent: `.github/workflows/devdigest-review-<agent-slug>.yml`.** The mockup and spec say `devdigest-review.yml`. The existing runner's `findManifestPath` throws when `.devdigest/agents/` holds more than one YAML (`agent-runner/src/manifest.ts:116-125`). A single shared workflow file would make every additional agent in the same repo overwrite the first agent's workflow, along with any user edits to it. The plan adds a `--agent <slug>` selector to the runner, as in the mockup's `review --agent security-reviewer`, and names the workflow per agent so each installation owns its own files. **If the user insists on the literal `devdigest-review.yml`, only `ciWorkflowPath()` in S5 changes; every other step is unaffected.**
2. **Runner bundle delivery.** `agent-runner/dist/` is git-ignored by `agent-runner/.gitignore:2`, which overrides the root `.gitignore:3-6` whitelist, so the bundle is absent from the checkout.
   - **Recommended:** the studio reads the locally built bundle from `../agent-runner/dist/index.js` through a new `RunnerBundleSource` port (S4). `scripts/dev.sh` builds it when it is missing (S11). A new `agent-runner.yml` workflow typechecks, tests and builds it (S11).
   - If the bundle is missing, Preview and Install return a clear 409 with the build command. The studio never builds it on demand: no `child_process` in a request path.
   - Committing `dist/` was rejected. It would put a minified megafile in git that drifts from `src/`, and it needs both `.gitignore` files edited.
3. **The exported runner file is `.devdigest/runner.mjs`, as in the mockup, not `.devdigest/runner/index.js`** as the runner's README says (`agent-runner/README.md:107-109`). The bundle is ESM: the package has `"type":"module"` (`agent-runner/package.json`) and `src/index.ts:68` uses `import.meta.url`. A target repo without `"type":"module"` would load a `.js` file as CommonJS and fail. The `.mjs` extension makes Node load it as ESM regardless of the target repo. S11 has the implementer confirm the bundle's module format before fixing the extension. The runner's diff filter already strips every `.devdigest/` path (`agent-runner/src/diff.ts:20`), so the bundle never reaches the model.
4. **The generated workflow pins `node-version: 22`, not the mockup's `20`.** Node 20 reached end of life in April 2026, and today is 2026-10-10. The runner's own comment assumes Node 22's global `fetch` (`agent-runner/src/github.ts:2-3`). This is a one-line constant in S5 if the user prefers 20.
5. **`post_as` is passed to the workflow as `DEVDIGEST_POST_AS`,** which the runner already reads (`agent-runner/src/index.ts:25-33`). It is not added to `AgentManifest`. This closes the open question at `agent-runner/insights/INSIGHTS.md:264` without a manifest field.
6. **No new GitHub dependency in the runner.** The artifact upload is done by `actions/upload-artifact@v4` in the generated workflow, and the runner keeps its hand-rolled `fetch` client.

## Goal

From an agent's **CI** tab, a user can open the Export Wizard, preview and edit the generated files, choose triggers and how results are posted, and either:
- get a PR on branch `devdigest/ci` in an imported repo containing the manifest, skills, memory, workflow and bundled runner, or
- download the same files as a zip.

Every completed GitHub Actions run of that workflow can then be pulled back into the studio through the hardened artifact channel. Each one appears as an `agent_runs` row with `source='ci'`, a `run_traces` document and a `ci_runs` link row. CI runs are listed on a new **CI Runs** page and summarized per repo on the agent's CI tab, alongside the `Fail CI on` setting.

## Inputs read

| File | What it constrained |
|---|---|
| `CLAUDE.md:96-110` (Non-default conventions) | No workspace; per-package package manager; `@devdigest/shared` is the one contract source; migrations never run on boot; secrets only via `SecretsProvider` |
| `CLAUDE.md:131-142` (Do not touch) | Never hand-edit migrations or lockfiles; `reviewer-core` stays pure |
| `server/CLAUDE.md:53-62, 77-90` | Zod route schemas only; secrets not in `AppConfig`; `pnpm db:generate`; no ad-hoc body parsing |
| `client/CLAUDE.md:28-52` | `_components/<Name>/` layout; hooks in `src/lib/hooks/*`; never `fetch` from a component; snake_case DTOs |
| `reviewer-core/CLAUDE.md:106-110, 123-126` | No DB, GitHub or filesystem in reviewer-core. The plan does **not** touch reviewer-core. |
| `agent-runner/CLAUDE.md:22-74` | The runner reads `process.env` deliberately. Grounding, `wrapUntrusted` and the deterministic gate are mandatory. `src/index.ts` changes affect every installed bundle. |
| `agent-runner/README.md:107-109, 171-181, 183-200` | Bundle path, `pnpm` commands, env contract (`DEVDIGEST_POST_AS`, `PR_NUMBER`, `GITHUB_EVENT_PATH`) |
| `agent-runner/insights/INSIGHTS.md:240, 244, 264` | Run `reviewer-core` install before typecheck; vitest aliases mirror tsconfig; `post_as` wiring gap |
| `agent-runner/src/{run,manifest,context,artifact,diff,github,skills,index}.ts` | What the runner already does (S10 builds on it): exactly-one-manifest rule, no memory consumption, an artifact with no trace fields |
| `server/INSIGHTS.md:67-73` | Run-attribution join tables live in `schema/runs.ts` (cycle). `ci_runs` stays in `schema/ci.ts` because it imports `runs.ts` one way only; see S2. |
| `server/INSIGHTS.md:100-112` | Cross-module business logic goes through a Container getter, never `new OtherService()` |
| `server/INSIGHTS.md:170-184` | `RunTrace` fields can only be added (nullish), never retyped |
| `server/INSIGHTS.md:186-197` | `drizzle-kit generate` prompts interactively when one pass drops and adds columns on the same table, so S2 adds columns only |
| `server/INSIGHTS.md:124-131` | Purity doc comments must not spell out the tokens a grep gate looks for |
| `client/INSIGHTS.md:48-57` | A nav label has two sources: `nav.ts` and `messages/en/shell.json` |
| `client/INSIGHTS.md:59-68` | Pre-scaffolded i18n copy can describe a design that was never built. `ci.json` `blockMergeDesc` is stale and is replaced in S13. |
| `INSIGHTS.md:16-21` | `!**/INSIGHTS.md` must stay last in every workflow `paths:` list (S11) |
| `TESTING.md:27-34, 67-94` | Suite map and verbatim commands; `*.it.test.ts` split; `pnpm exec vitest run …` |
| `server/src/vendor/shared/contracts/eval-ci.ts:342-452` | Existing `CiTarget`, `CiFile`, `AgentManifest`, `CiExportInput`, `CiInstallation`, `CiExport`, `CiRunStatus`, `CiRun`, `CiResultArtifact`, all extended additively |
| `server/src/vendor/shared/adapters.ts:121-167, 314-328` | `GitHubClient` already has `commitFiles`, `findOpenPr` and `openPullRequest`; `SecretKey` |
| `server/src/db/schema/ci.ts`, `runs.ts:9-37`, `agents.ts:136-146`, `knowledge.ts:8-29`, `repos.ts` | Existing tables and columns the plan extends or reads |
| `server/src/modules/reviews/repository/run.repo.ts:124-216` | `createAgentRun` hard-codes `source:'local'` and requires `prId`, so CI inserts get their own repository function (S6) |
| `server/src/modules/project-context/helpers.ts:36-72`, `constants.ts:10-19` | Repo `.devdigest/{specs,docs,insights}/**` is the project-context root. Exported paths must never use those three directory names (S5). |
| `server/src/adapters/git/diff-parser.ts` (via `server/src/adapters/index.ts:9`) | `parseUnifiedDiff` is reused for re-grounding at ingest (S8) |
| `client/src/app/agents/[id]/_components/AgentEditor/{constants.ts,AgentEditor.tsx}` | How a tab is added (S13) |
| `client/src/components/eval-case-modal/EvalCaseModal.tsx:9,103` | Modals portal to `document.body` (fix `c461768`); the wizard does the same |
| `client/src/vendor/ui/{ExportWizardSteps.tsx,nav.ts,kit/*}` | Step indicator primitive; no GLOBAL nav group exists yet |
| `client/messages/en/ci.json` | Pre-scaffolded strings, reused where accurate |
| `client/package.json:15` | `fflate` is already a client dependency, used for the zip |
| `.claude/skills/onion-architecture/SKILL.md:144-171, 215-230` | Services contain no SQL; repositories take only `Db`; every external call goes through a port in `vendor/shared/adapters.ts`; mocks are peers |
| `.claude/skills/pr-self-review/routing.md`, `repo-rules.md:16-32, 116-132, 186-190` | Skill lanes; RULE-CONTRACT-SYNC, RULE-CONTRACT-BREAK, RULE-VENDOR, RULE-MIGRATION |
| `docs/plans/l06-eval-pipeline.plan.md:18, 569` | `server/package.json` reads `H` (tracked normally), not skip-worktree; re-check before editing |

## Architectural constraints binding this change

- **Contracts:**
  - Request and response shapes change only in `server/src/vendor/shared/contracts/eval-ci.ts` (and `trace.ts` for `RunTrace.config`). Then copy them byte-for-byte to `client/src/vendor/shared/` in the same change. Sources: `CLAUDE.md:102-104`, `repo-rules.md:116-120` (RULE-CONTRACT-SYNC CRITICAL).
  - Contract edits are **additive** (new nullish fields or new schemas). The only narrowing is `CiExportInput.triggers`, which no code consumes yet (verify with `rg "CiExportInput" server/src client/src agent-runner/src`). Source: `repo-rules.md:128-132`.
  - `RunTrace` fields are added, never retyped. Source: `server/INSIGHTS.md:170-184`.
- **Migrations:** edit `server/src/db/schema/ci.ts` only, then run `cd server && pnpm db:generate`. Never hand-write the SQL or the meta files. Add columns only; no drops or renames in the same pass. Sources: `CLAUDE.md:134-139`, `server/CLAUDE.md:79-83`, `server/INSIGHTS.md:186-197`.
- **Onion layering** (`.claude/skills/onion-architecture/SKILL.md:118-230`):
  - `routes.ts` holds no logic and does not import `drizzle-orm` or `db/schema`.
  - `service.ts` contains no SQL and reaches GitHub, the runner bundle and secrets only through ports.
  - `repository.ts` takes only `Db` and filters every query by workspace. Installations are scoped through `agents.workspace_id`.
  - New external calls get a port in `server/src/vendor/shared/adapters.ts`, with implementations in `server/src/adapters/<thing>/` and mock peers in `server/src/adapters/mocks.ts`.
- **Cross-module access:**
  - The ci service reads agents through `container.agentsRepo` and repos through `container.reposRepo`.
  - It reads an agent's linked skills through `container.skills` (`server/src/platform/container.ts:148-150`, `server/INSIGHTS.md:100-112`). It never imports another module's service class.
  - CI writes to `agent_runs` and `run_traces` go in the ci repository's own transactional function. `reviews/repository/run.repo.ts` is not edited, because `createAgentRun` there hard-codes `source:'local'`.
- **Secrets:**
  - The studio's GitHub token is read only through `SecretsProvider` (`container.github()` → `GITHUB_TOKEN`).
  - Nothing secret goes into `AppConfig`, the DB, generated files, logs or the artifact. Sources: `server/CLAUDE.md:56-59, 90`, `CLAUDE.md:111-112`.
  - The runner's `process.env` reads are the documented exception (`agent-runner/CLAUDE.md:35-50`).
- **reviewer-core** is not modified (`reviewer-core/CLAUDE.md:123-126`). The runner and server only call its existing exports (`reviewer-core/src/index.ts:14-59`).
- **Runner invariants:** the mandatory `groundFindings`, `assemblePrompt`/`wrapUntrusted`, and a deterministic gate from `ci_fail_on`. Source: `agent-runner/CLAUDE.md:61-74`. S10 only adds inputs and outputs around `runCi`.
- **Scope fence:** do not touch `server/src/modules/reviews/run-executor.ts`, `multi_agent_runs`, the pulls or polling modules, or the PR feed UI. Source: user spec R10.
- **Package managers:** `server`, `client` and `agent-runner` use pnpm (`agent-runner/README.md:171-178`). Dependency changes go through `pnpm add` only. Sources: `CLAUDE.md:99-101, 140-145`.
- **Client:**
  - Server calls go only through hooks in `client/src/lib/hooks/*`, with keys from `keys.ts` (`client/CLAUDE.md:48-49`).
  - User-facing strings go in `client/messages/en/*.json` (`routing.md` frontend lanes).
  - Components use the `_components/<PascalCase>/` layout (`client/CLAUDE.md:30-35`).
- **Exported paths** must never sit under `.devdigest/specs|docs|insights/`. The project-context scanner treats those as repo documents (`server/src/modules/project-context/helpers.ts:36-72`). Slugs are flat (`^[a-z0-9][a-z0-9-]{0,62}$`).

## Security model

> **Veto point for the user.** This section is the trust model for ingest option (A), pull via artifacts. If any rule here is unacceptable, stop before S8.

**What the GitHub API proves:** when the studio fetches workflow run X with its own token, GitHub vouches that run X happened in repo Y, for workflow file Z, at commit S, triggered by event E. The API does **not** vouch for the content of an artifact. Anyone with write access to repo Y can push a branch that edits the workflow or `runner.mjs` and uploads an arbitrary `devdigest-result.json`. Every rule below follows from that distinction.

**Ingest rules.** The service is `server/src/modules/ci/ingest.ts` (S8). A run is **rejected** (not stored, counted in `CiSyncResult.rejected` with a reason) unless every check passes:

| # | Check | Reject reason |
|---|---|---|
| I1 | Runs are listed **per installation**, from that installation's own `repo` and its own `workflow_path`. The studio never accepts a run id or repo from the client. | — (by construction) |
| I2 | `run.repository.full_name === installation.repo` (case-insensitive) | `repo_mismatch` |
| I3 | `run.head_repository.full_name === installation.repo`, which rejects fork PRs. The generated workflow also skips forks. | `fork_run` |
| I4 | `run.event === 'pull_request'` | `wrong_event` |
| I5 | `run.path === installation.workflow_path` | `wrong_workflow` |
| I6 | `run.status === 'completed'`. Runs that are still in progress are skipped silently and picked up on a later sync. | (skipped) |
| I7 | Exactly one artifact named `devdigest-result`, not expired, `size_in_bytes ≤ CI_ARTIFACT_MAX_ZIP_BYTES` (256 KiB). The zip entry `devdigest-result.json` must have uncompressed size ≤ `CI_ARTIFACT_MAX_JSON_BYTES` (1 MiB), enforced inside the adapter **while** inflating to stop zip bombs. No other entries are read. | `artifact_missing` / `artifact_too_large` |
| I8 | `JSON.parse` then `CiResultArtifact.safeParse`; `findings` capped at 500 by the schema | `artifact_invalid` |
| I9 | `artifact.head_sha === run.head_sha`; `artifact.github_run_id === run.id` when present; `artifact.agent_slug === installation.agent_slug` | `artifact_mismatch` |
| I10 | **Idempotency:** unique `ci_runs.github_run_id`, with `ON CONFLICT DO NOTHING` in the same transaction as the `agent_runs` insert. A re-sync never duplicates. | (skipped, `duplicate`) |

A run that passes I1–I6 but has **no artifact and `conclusion === 'failure'`** is stored as `agent_runs.status='failed'` with `ci_runs.status='failed'` and the job link. That is the runner's hard-fail path, which writes no artifact (`agent-runner/README.md:205-212`). The verification is still computed.

**Content trust (stored, but flagged):**
- **V1 Verification.** At export the studio records the **git blob SHA** of every file it generated. A git blob SHA is `sha1("blob " + byteLength + "\0" + content)`, which GitHub's contents API returns per path without downloading the content. These are stored in `ci_installations.expected_blobs` as `{path: blobSha}`. At ingest the studio fetches the blob SHAs of the same paths at `run.head_sha`:
  - If every path matches, the run is `verification='verified'`.
  - Otherwise it is stored as `verification='unverified'`. The UI shows a warning badge and the CI tab's "last run" ignores it for the "succeeded" state.
  - This catches a branch that edited the workflow, the manifest, a skill, memory or `runner.mjs`.
  - Known false positive: `pull_request` checks out the *merge* ref, so if `devdigest/ci` files changed on the base after the PR branched, the run is flagged unverified. That errs on the safe side.
- **V2 Untrusted findings.** Findings are untrusted data:
  - They are stored and rendered as plain text. The client never uses `dangerouslySetInnerHTML`, and Markdown goes through the existing `Markdown` primitive only.
  - When `artifact.base_sha` is present, the studio fetches the compare diff `base_sha...head_sha` through the port and re-runs `groundFindings` from `@devdigest/reviewer-core` with `parseUnifiedDiff`. Findings that fail are dropped, `findings_count` and `grounding` are recomputed from the survivors, and the CI-reported count is kept only in the trace.
  - If the diff cannot be fetched or is too large (> `CI_REGROUND_MAX_DIFF_BYTES`, 2 MiB), the findings are kept and `grounding` is set to `'not rechecked'`.
  - `blockers` are recomputed with `countBlockers` against the installation's agent `ci_fail_on`. The studio never trusts `artifact.verdict` for its own display; the stored `verdict` comes from `gateTriggered`.
- **V3 Cost and duration** are self-reported and labeled "reported by CI" in the UI. They are informational only.

**Token and secrets:**
- The studio uses the existing `GITHUB_TOKEN` from `SecretsProvider` (`server/src/adapters/secrets/local.ts:37-42`). It needs these scopes:
  - Contents read/write (commit to `devdigest/ci`)
  - Pull requests read/write (open the PR)
  - Workflows write (GitHub refuses commits under `.github/workflows/` without it)
  - Actions read (list runs and download artifacts)
- A 403 or 404 from any of these is mapped to an `AppError` naming the missing scope, never the token.
- No ingest token is created, so there is no new secret.
- The generated workflow references only `secrets.OPENROUTER_API_KEY` and the automatic `secrets.GITHUB_TOKEN`. It uses `permissions: { contents: read, pull-requests: write }` and `actions/checkout` with `persist-credentials: false`.

**Concurrency:** `CiIngestService.sync` is single-flight per workspace. A second concurrent call awaits the in-flight promise. Each installation syncs at most the newest `CI_SYNC_RUNS_PER_INSTALLATION` (30) runs per call.

**Deferred option (B), not built:** `POST /ci/ingest` with a per-installation token, stored as a SHA-256 hash and shown once, sent by the runner over HTTPS. It needs a publicly reachable studio. It would reuse I2–I10 and V1–V3 unchanged.

## Skills to be applied

Lookup per `.claude/skills/pr-self-review/routing.md`. Cross-cutting lanes are triggered by the content each step adds.

| Path to be touched | Lane | Skills (per routing.md) |
|---|---|---|
| `server/src/vendor/shared/contracts/eval-ci.ts`, `trace.ts`, `adapters.ts` | backend (contracts) | zod + RULE-CONTRACT-SYNC, RULE-CONTRACT-BREAK |
| `client/src/vendor/shared/**` (verbatim copy) | frontend vendor | none (RULE-VENDOR, RULE-CONTRACT-SYNC) |
| `server/src/db/schema/ci.ts` | backend schema | drizzle-orm-patterns, postgresql-table-design |
| `server/src/db/migrations/**` (generated) | none | RULE-MIGRATION (generated only) |
| `server/src/adapters/github/octokit.ts`, `server/src/adapters/runner-bundle/local.ts`, `server/src/adapters/mocks.ts` | backend adapters | onion-architecture; **security** (token, outbound fetch, zip parsing, path from config) |
| `server/src/platform/config.ts`, `container.ts` | backend platform | onion-architecture; security (`process.env`) |
| `server/src/modules/ci/{constants,helpers,manifest,workflow}.ts` | backend helpers | onion-architecture; zod |
| `server/src/modules/ci/repository.ts` | backend repository | onion-architecture, drizzle-orm-patterns |
| `server/src/modules/ci/service.ts`, `ingest.ts` | backend service | onion-architecture; **security** (workspace scoping, untrusted artifact, secrets) |
| `server/src/modules/ci/routes.ts`, `server/src/modules/index.ts` | backend routes | fastify-best-practices, onion-architecture, zod; security (new routes) |
| `server/package.json` + `pnpm-lock.yaml` (via `pnpm add`) | none | RULE-LOCKFILE, RULE-SKIPWORKTREE (re-check `git ls-files -v`) |
| `agent-runner/src/**` | **no lane** (uncovered by routing.md; repo-rules only) | Its own `agent-runner/CLAUDE.md` invariants apply; security lane by content (`process.env`) |
| `client/src/lib/hooks/ci.ts`, `keys.ts` | frontend hooks | react-best-practices, frontend-code-organization |
| `client/src/app/agents/[id]/_components/AgentEditor/**` (CiTab + ExportWizard) | frontend components | react-best-practices, frontend-code-organization (new folders) |
| `client/src/app/ci-runs/page.tsx` | frontend page | next-best-practices, frontend-code-organization |
| `client/src/app/ci-runs/_components/**` | frontend components | react-best-practices, frontend-code-organization |
| `client/src/vendor/ui/nav.ts` | frontend vendor | none (RULE-VENDOR WARNING, accepted, same as the L06 eval nav entry `nav.ts:45-47`) |
| `client/messages/en/{ci,agents,shell}.json` | frontend i18n | frontend-code-organization |
| `client/**/*.test.tsx` | frontend tests | react-testing-library |
| `scripts/dev.sh`, `.github/workflows/agent-runner.yml`, `CLAUDE.md`, `*.md` | no lane | repo-rules only (RULE-ALIAS-CI, RULE-INSIGHTS-LAST) |

Skills loaded during planning: none in full. The onion-architecture sections on repositories and ports (`SKILL.md:160-230`) were read directly because they decided where the zip parsing, runner-bundle reads and `agent_runs` CI insert go. The other lanes were checked by grep against the planned shapes and raised no conflict.

---

## Steps

### Step 1 — Extend the shared contracts (additive) and mirror them to the client
- **Closes:** R4, R12 (contract half); prerequisite for all later steps.
- **Files:** `server/src/vendor/shared/contracts/eval-ci.ts` (edit), `server/src/vendor/shared/contracts/trace.ts` (edit), then a byte-identical copy of both into `client/src/vendor/shared/contracts/` (edit).
- **Change** (all in the "Export-to-CI + CI Runs" block of `eval-ci.ts` unless noted):
  1. `CiTrigger = z.enum(['opened','synchronize','reopened'])`; `CiPostAs = z.enum(['github_review','pr_comment','none'])`.
  2. `AgentManifest`: add `version: z.number().int().nullish()` (agent version at export). It is additive and optional, so old manifests still validate. Change nothing else in it.
  3. `CiExportInput`:
     - `triggers` becomes `z.array(CiTrigger).min(1).default(['opened','synchronize'])`, matching the mockup's default where `reopened` is unchecked.
     - `post_as` uses `CiPostAs`.
     - Add `workflow_yaml: z.string().max(20_000).nullish()` (the user-edited workflow; `null` means use the generated one).
     - Keep `repo`, `target`, `action` (`'open_pr' | 'files'`) and `base`. Make `base` optional with no default, because the service resolves the repo's `default_branch`.
     - First run `rg -n "CiExportInput" server/src client/src agent-runner/src` and confirm the only hits are the contract files. Record the result in the step's done-check.
  4. `CiPreviewInput = CiExportInput.pick({ repo, target, post_as, triggers })`.
  5. `CiFile`: add `role: z.enum(['manifest','skill','memory','workflow','runner'])` and `size_bytes: z.number().int()`.
  6. `CiPreview = { files: CiFile[], workflow_path, branch: z.literal('devdigest/ci'), blocking: z.array(z.object({ code: z.enum(['provider_unsupported','runner_bundle_missing','repo_not_imported','target_unsupported']), message })), secret_names: z.array(z.string()) }`. The runner file's `contents` is **omitted** (empty string) with `editable:false` and its `size_bytes` set, because the bundle is too large to ship to the browser for preview. The zip path fetches it separately (S9 `GET …/ci/runner`).
  7. `CiInstallation`: add nullish `repo_id`, `post_as`, `triggers`, `workflow_path`, `workflow_version` (int, template version), `manifest_version` (int), `runner_version` (string), `branch`, `pr_url`, `updated_at`, `outdated` (boolean, computed on read), `last_run` (`{ status: CiRunStatus, ran_at, verification } | null`).
  8. `CiAgentOverview = { agent_id, ci_fail_on: CiFailOn, active_repos: int, installations: CiInstallation[], recent_runs: CiRun[] }`.
  9. `CiRun`: keep all existing fields and add nullish `agent_id`, `agent_run_id`, `repo`, `verdict` (`'APPROVE'|'REQUEST_CHANGES'|'COMMENT'`), `duration_ms`, `job_url`, `head_sha`, `model`, `manifest_version`, `verification` (`'verified'|'unverified'`), `grounding`, `reported_findings_count`.
  10. `CiRunsQuery = { days: coerce int 1..90 default 7, agent_id?: uuid, repo?: string, status?: CiRunStatus }`.
  11. `CiSyncResult = { ingested: int, failed_runs: int, skipped: int, rejected: z.array(z.object({ installation_id, github_run_id: z.number().int(), reason: z.enum([...I2..I9 reasons]) })) }`.
  12. `CiResultArtifact`: add nullish `format` (`z.literal('devdigest-ci-result/v2')`), `agent_slug`, `manifest_version`, `manifest_sha256`, `provider`, `model`, `runner_version`, `node_version`, `dependencies` (`z.record(z.string())`), `repo`, `head_sha`, `base_sha`, `github_run_id`, `github_run_attempt`, `verdict`, `blockers`, `gate_triggered`, `post_as`, `tokens_in`, `tokens_out`, `findings` (`z.array(Finding).max(500)`). The existing required fields stay required.
  13. `trace.ts` `RunTrace.config`: add nullish `commit_sha`, `base_sha`, `manifest_sha256`, `runner_version`, `dependencies: z.record(z.string())`, `ci_job_url`, `verification`. No existing field changes.
  14. The barrel `index.ts` is already `export *` for both files, so it needs no edit.
- **Constraint:** additive only (RULE-CONTRACT-BREAK); both copies identical (RULE-CONTRACT-SYNC); `server/INSIGHTS.md:170-184`.
- **Owner:** implementer
- **Done when:**
  - `diff -rq server/src/vendor/shared client/src/vendor/shared` prints nothing.
  - `cd server && pnpm typecheck`, `cd client && pnpm typecheck` and `cd agent-runner && pnpm typecheck` all pass.

### Step 2 — Extend the CI tables and generate the migration
- **Closes:** R8, R9, R11 (storage).
- **Files:** `server/src/db/schema/ci.ts` (edit); `server/src/db/migrations/00NN_<generated>.sql` plus `meta/*` (**generated by `pnpm db:generate`**, never hand-edited).
- **Change:**
  - `ci_installations`, add:
    - `repoId` (uuid FK `repos.id` on delete set null)
    - `agentSlug` text not null default `''`
    - `postAs` text enum, default `'github_review'`
    - `triggers` jsonb `$type<string[]>()` not null default `['opened','synchronize']`
    - `workflowPath` text
    - `workflowYaml` text (the installed, possibly user-edited workflow, reused by "Update CI config")
    - `workflowVersion` integer
    - `manifestVersion` integer
    - `manifestSha256` text
    - `runnerVersion` text
    - `runnerSha256` text
    - `expectedBlobs` jsonb `$type<Record<string,string>>()`
    - `branch` text
    - `prUrl` text
    - `updatedAt` timestamptz default now not null
    - `lastSyncedAt` timestamptz
  - `ci_installations` indexes: `uniqueIndex('ci_installations_agent_repo_uq').on(agentId, repo)` and `index('ci_installations_repo_idx').on(repo)`.
  - `ci_runs`, add:
    - `agentRunId` uuid FK `agent_runs.id` on delete cascade (import `agentRuns` from `./runs`; `runs.ts` does not import `ci.ts`, so there is no cycle, see `server/INSIGHTS.md:67-73`)
    - `githubRunId` bigint `{ mode: 'number' }`
    - `githubRunAttempt` integer
    - `repo` text
    - `headSha` text
    - `jobUrl` text
    - `verdict` text
    - `verification` text enum `['verified','unverified']`
    - `durationMs` integer
    - `reportedFindingsCount` integer
  - `ci_runs` indexes: `uniqueIndex('ci_runs_github_run_id_uq').on(githubRunId)` and `index('ci_runs_installation_ran_idx').on(ciInstallationId, ranAt)`.
  - Do **not** drop or rename any existing column, including `githubUrl`, which stays populated with the run URL for back-compat.
  - Do not use `now()` from `_shared.ts` for `updatedAt`. It hard-codes `created_at` (`server/INSIGHTS.md:32`).
  - Then run `cd server && pnpm db:generate`, then `cd server && pnpm db:migrate`.
- **Constraint:** `CLAUDE.md:134-139`; `server/INSIGHTS.md:186-197` (no drop+add in one pass). Both tables are empty in every DB today (no seed or code writes them: `rg -n "ciInstallations|ciRuns" server/src` shows only the schema), so adding the unique indexes is safe.
- **Owner:** implementer
- **Done when:**
  - A new `NNNN_<word>_<word>.sql` and an updated `meta/_journal.json` exist, untouched after generation.
  - `pnpm db:migrate` succeeds on a dev DB.
  - `git diff --stat server/src/db/migrations` shows only added files plus the journal.

### Step 3 — Add the two server dependencies
- **Closes:** none (prerequisite for S4 and S5).
- **Files:** `server/package.json`, `server/pnpm-lock.yaml` (both via pnpm only).
- **Change:**
  - First run `git ls-files -v server/package.json`. At planning time it prints `H` (tracked normally). **If it prints `S`, stop and report.**
  - Then `cd server && pnpm add yaml@^2.6.1 fflate@^0.8.3`. The `yaml` range matches the runner's (`agent-runner/package.json` `"yaml": "^2.6.1"`), so the stringifier and parser agree. The `fflate` range matches the client's (`client/package.json:15`).
- **Constraint:** `CLAUDE.md:140-145` (never hand-edit lockfiles); RULE-SKIPWORKTREE.
- **Owner:** implementer
- **Done when:** both packages appear in `server/package.json` `dependencies` and `cd server && pnpm typecheck` passes.

### Step 4 — Ports and adapters: GitHub Actions and contents, runner bundle source, config, container
- **Closes:** R7, R11 (I-checks need these); prerequisite for S7 and S8.
- **Files:** `server/src/vendor/shared/adapters.ts` (edit; mirror to `client/src/vendor/shared/adapters.ts`), `server/src/adapters/github/octokit.ts` (edit), `server/src/adapters/runner-bundle/local.ts` (new), `server/src/adapters/mocks.ts` (edit), `server/src/platform/config.ts` (edit), `server/src/platform/container.ts` (edit).
- **Change:**
  1. Add these methods to the `GitHubClient` port:
     - `listWorkflowRuns(repo, workflowPath, opts:{ perPage:number }): Promise<WorkflowRunInfo[]>`. `WorkflowRunInfo` has `{ id, run_attempt, html_url, event, status, conclusion, head_sha, path, repository_full_name, head_repository_full_name|null, pull_numbers:number[], created_at, run_started_at|null, updated_at }`.
     - `listRunArtifacts(repo, runId): Promise<{ id, name, size_in_bytes, expired }[]>`.
     - `downloadArtifactFile(repo, artifactId, fileName, limits:{ maxZipBytes, maxFileBytes }): Promise<string | null>`. It returns the UTF-8 text of exactly one entry, or `null` if the entry is absent. It throws a typed `ArtifactTooLargeError` if a limit is exceeded.
     - `getBlobShas(repo, ref, paths: string[]): Promise<Record<string, string | null>>` (`null` means the file is missing at that ref).
     - `getCompareDiff(repo, base, head, maxBytes): Promise<string | null>` (`null` means too large or unavailable).
     - `getRepoDefaultBranch(repo): Promise<string>`.
  2. Implement them in `octokit.ts`:
     - For `listWorkflowRuns`, use `GET /repos/{o}/{r}/actions/workflows/{file}/runs?event=pull_request&per_page=N`. The `{file}` is the basename of `workflowPath`; URL-encode it. Map `pull_requests[].number`.
     - `downloadArtifactFile` downloads the artifact zip with a hard cap on the response body (`maxZipBytes`, checking `content-length` and the streamed size). It unzips with `fflate`'s `unzipSync` using a `filter` that admits only `fileName` and rejects `originalSize > maxFileBytes`. It decodes with `TextDecoder('utf-8', { fatal: true })`.
     - `getBlobShas` calls `GET /repos/{o}/{r}/contents/{path}?ref=` and reads the `sha` field per path (404 → `null`).
     - `getCompareDiff` uses `GET /repos/{o}/{r}/compare/{base}...{head}` with `Accept: application/vnd.github.v3.diff` and the byte cap.
     - Map 403 and 404 responses to messages naming the missing scope (Actions read / Workflows write), never including the token.
  3. Add a new port `RunnerBundleSource { read(): Promise<{ contents: string; sha256: string; version: string } | null> }`. The `version` is read from the bundle's embedded `RUNNER_VERSION` marker; if that is unparseable, it is the first 12 hex characters of the sha256.
  4. The implementation in `adapters/runner-bundle/local.ts` reads `config.agentRunnerBundlePath` once, caches it by `mtimeMs`, and returns `null` when the file is missing.
  5. In `config.ts`, add `agentRunnerBundlePath` from env `DEVDIGEST_AGENT_RUNNER_BUNDLE`, defaulting to `resolve(<server dir>, '../agent-runner/dist/index.js')`. Derive the server dir from `import.meta.url` the same way `config.ts` already derives paths. It is a path, not a secret.
  6. In `container.ts`, add a `runnerBundle` getter plus a `ContainerOverrides.runnerBundle?`.
  7. In `mocks.ts`, extend `MockGitHubClient` with deterministic fixtures for every new method (constructor-injectable run/artifact fixtures) and add `MockRunnerBundleSource`.
- **Constraint:** onion `SKILL.md:215-230` (port first; SDK only in adapters; mocks are peers); secrets only via `SecretsProvider`; contract mirror (RULE-CONTRACT-SYNC).
- **Owner:** implementer
- **Done when:**
  - `rg -n "octokit|fflate" server/src --glob '!server/src/adapters/**'` returns nothing.
  - `cd server && pnpm typecheck` passes.
  - `diff -rq server/src/vendor/shared client/src/vendor/shared` is empty.

### Step 5 — Pure generators: slugs, paths, manifest YAML, skills, memory JSONL, workflow YAML, blob SHAs
- **Closes:** R3, R4, R7, R12 (studio side).
- **Files:** `server/src/modules/ci/constants.ts` (new), `server/src/modules/ci/helpers.ts` (new), `server/src/modules/ci/manifest.ts` (new), `server/src/modules/ci/workflow.ts` (new). The runner comments already point at these filenames: `agent-runner/src/manifest.ts:90`, `context.ts:182`, `index.ts:5`.
- **Change:**
  - `constants.ts`:
    - `CI_BRANCH = 'devdigest/ci'`, `CI_PR_TITLE = 'Add DevDigest CI review'`
    - `CI_RUNNER_PATH = '.devdigest/runner.mjs'`, `CI_MEMORY_PATH = '.devdigest/memory.jsonl'`
    - `CI_ARTIFACT_NAME = 'devdigest-result'`, `CI_RESULT_FILE = 'devdigest-result.json'`
    - `CI_WORKFLOW_TEMPLATE_VERSION = 1`, `CI_NODE_VERSION = '22'`
    - the size caps from the Security model, `CI_SYNC_RUNS_PER_INSTALLATION = 30`
    - `CI_SUPPORTED_TARGETS = ['gha']`, `CI_SUPPORTED_PROVIDERS = ['openrouter']`
    - `CI_RESERVED_DIRS = ['specs','docs','insights']`
  - `helpers.ts` (pure; no Container, no Drizzle, no Fastify; phrase the doc comment per `server/INSIGHTS.md:124-131`):
    - `ciSlug(name, taken:Set<string>)`: kebab, `^[a-z0-9][a-z0-9-]{0,62}$`, suffixed `-2`, `-3` on collision, never one of `CI_RESERVED_DIRS`.
    - `ciAgentManifestPath(slug)` returns `.devdigest/agents/<slug>.yaml`. `ciSkillPath(slug)` returns `.devdigest/skills/<slug>.md`. `ciWorkflowPath(agentSlug)` returns `.github/workflows/devdigest-review-<agentSlug>.yml` (see Recommendation, point 1).
    - `gitBlobSha(content)` computes `sha1('blob '+byteLength+'\0'+content)` with `node:crypto`. `sha256(content)`.
    - `toMemoryJsonl(rows)` produces one `MemoryItem`-shaped JSON object per line (`content, scope, kind, confidence ?? 0.5, sources ?? []`), with each item validated by `MemoryItem.parse`.
    - `assertSafeExportPath(path)` allows only `.devdigest/agents|skills/…`, `.devdigest/memory.jsonl`, `.devdigest/runner.mjs` and `.github/workflows/devdigest-review-*.yml`, and rejects `..` and absolute paths.
  - `manifest.ts`: `buildManifestYaml(agent, skillSlugs)` builds the object, runs it through `AgentManifest.parse` (the **same** schema the runner validates with: `agent-runner/src/manifest.ts:149`), then `YAML.stringify`, with a header comment `# generated by DevDigest — agent v<version>`. It also round-trips the output with `YAML.parse` and `AgentManifest.parse`, and throws if the result differs.
  - `workflow.ts`: `buildWorkflowYaml({ agentName, agentSlug, triggers, postAs })` emits:
    - `on.pull_request.types` set to the chosen triggers
    - `permissions: { contents: read, pull-requests: write }`
    - a job `review` with `if: github.event.pull_request.head.repo.full_name == github.repository` and `timeout-minutes: 15`
    - `actions/checkout@v4` (`persist-credentials: false`)
    - `actions/setup-node@v4` (`node-version: CI_NODE_VERSION`)
    - step "Run DevDigest review": `node .devdigest/runner.mjs review --agent <slug>`, with env `OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}`, `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `PR_NUMBER: ${{ github.event.pull_request.number }}` and `DEVDIGEST_POST_AS: <postAs>`
    - `actions/upload-artifact@v4` with `if: always()`, `name: devdigest-result`, `path: devdigest-result.json`, `if-no-files-found: ignore`, `retention-days: 14`

    With `postAs: 'none'` the token env stays (the runner still needs it to fetch the diff) and only `DEVDIGEST_POST_AS` changes. `validateWorkflowYaml(text)` checks that the text parses as YAML, is ≤ 20 000 characters, and still contains the runner invocation for this slug. It returns warnings, not errors, when the user removed the upload step.
- **Constraint:** `AgentManifest` is the single schema (R12); exported paths avoid `CI_RESERVED_DIRS` (project-context root).
- **Owner:** implementer
- **Done when:**
  - The only external imports in `rg -n "from '" server/src/modules/ci/{helpers,manifest,workflow,constants}.ts` are `yaml`, `node:crypto` and `@devdigest/shared`.
  - `cd server && pnpm typecheck` passes.

### Step 6 — CI repository (installations, runs, CI-sourced agent_runs, memory reads)
- **Closes:** R8, R9, R11 (persistence).
- **Files:** `server/src/modules/ci/repository.ts` (new). Split into `repository/{installation,run}.repo.ts` composed by the class if it passes about 300 lines, per onion `SKILL.md:166-170`.
- **Change:** class `CiRepository(db: Db)`. Every method is workspace-scoped through `agents.workspace_id`, with an inner join from `ci_installations` to `agents`.
  - `upsertInstallation(workspaceId, values)` uses `onConflictDoUpdate` on `(agent_id, repo)` and returns the row.
  - `listInstallationsForAgent(workspaceId, agentId)`, with the latest `ci_runs` row per installation via a lateral subquery or a `DISTINCT ON`.
  - `listInstallations(workspaceId, { target:'gha' })` for sync.
  - `getInstallation(workspaceId, id)`, `markSynced(id, at)`.
  - `ingestRun(tx-wrapped)`: in **one transaction**:
    1. Insert `agent_runs`, with values:
       - `{ workspaceId, agentId, prId|null, provider, model, status:'done'|'failed', source:'ci', ranAt }`
       - `durationMs, tokensIn, tokensOut, costUsd, findingsCount, grounding, score:null, blockers, error`
    2. Insert `run_traces` (`RunTrace` parsed before insert).
    3. Insert `ci_runs` with `onConflictDoNothing({ target: githubRunId })`.
    4. If the `ci_runs` insert hits the conflict, **roll back** (throw a sentinel caught outside the tx) so no orphan `agent_runs` row survives.

    It returns `'inserted' | 'duplicate'`.
  - `listRuns(workspaceId, CiRunsQuery)` joins `ci_runs → ci_installations → agents`, plus `agent_runs` for model, with the filters, ordered by `ran_at desc`, limit 200. `existingGithubRunIds(ids)`.
  - `findPullId(workspaceId, repoFullName, prNumber)` joins `repos.full_name` to `pull_requests`. It returns `null` when the repo or PR isn't imported.
  - `listMemoryForExport(workspaceId, repoId|null)` returns `scope='global'` rows plus `scope='repo' AND repo_id = repoId`, ordered by `created_at`.
  - It returns row types or contracts only. DTO mapping to snake_case lives in `helpers.ts` (`toCiInstallationDto`, `toCiRunDto`).
- **Constraint:** onion `SKILL.md:160-176` (only place with SQL; takes `Db` only; workspace scope); `server/CLAUDE.md:45-47` (camelCase columns, snake_case wire).
- **Owner:** implementer
- **Done when:**
  - `rg -n "platform/container" server/src/modules/ci/repository*` is empty.
  - `rg -n "drizzle-orm|db/schema" server/src/modules/ci --glob '!**/repository*'` is empty.
  - `cd server && pnpm typecheck` passes.

### Step 7 — CI service: preview, export (PR or files), update config, overview, runs list
- **Closes:** R2, R3, R5, R6, R9.
- **Files:** `server/src/modules/ci/service.ts` (new); `server/src/platform/container.ts` (edit: no `ci` getter needed unless another module calls it; keep it route-local).
- **Change:** class `CiService(container)`.
  - `preview(ws, agentId, CiPreviewInput)`:
    1. Load the agent via `container.agentsRepo` (404 if outside the workspace).
    2. Resolve the repo among imported repos via `container.reposRepo` by `full_name`. If it isn't imported, set blocking `repo_not_imported`.
    3. Set blocking `provider_unsupported` if `agent.provider` is not in `CI_SUPPORTED_PROVIDERS`, `target_unsupported` if the target is not `gha`, and `runner_bundle_missing` if `container.runnerBundle.read()` returns `null` (message: "run `cd agent-runner && pnpm install && pnpm build`").
    4. Load the linked skills in order with only the enabled ones, through `container.skills`, matching what a run injects.
    5. Read memory through the repository.
    6. Build the files with S5. Return `CiPreview`, with the runner entry's contents omitted and `secret_names: ['OPENROUTER_API_KEY']`.
  - `export(ws, agentId, CiExportInput)`:
    1. Re-run `preview` server-side and refuse (409 `AppError` with `blocking`) if anything blocks.
    2. Regenerate every file server-side. **Only** `workflow_yaml` is taken from the client, after `validateWorkflowYaml`. Never accept file paths or contents for any other file from the client.
    3. Run `assertSafeExportPath` on every path.
    4. Compute `expectedBlobs` with `gitBlobSha` for every file, including the runner.
    5. For `action:'open_pr'`:
       - `github.commitFiles(repo, { branch:'devdigest/ci', base: input.base ?? repo default branch, message:'chore(devdigest): add <agent> CI review', files })`
       - then `findOpenPr(repo,'devdigest/ci') ?? openPullRequest(repo,{ title: CI_PR_TITLE, head:'devdigest/ci', base, body })`
       - The PR body lists the files and the `OPENROUTER_API_KEY` secret instruction.
    6. For `action:'files'`: no GitHub call. Return the files including the runner contents, for the client zip.
    7. In both cases `upsertInstallation` with all metadata (`pr_url` null for files) and return `CiExport`.
  - `updateConfig(ws, agentId)`: for every `open_pr` installation of the agent (those with a non-null `branch`), regenerate the manifest, skills, memory and runner, reuse the stored `workflowYaml`, recommit to `devdigest/ci`, reuse or open the PR, then update the hashes, versions and `updatedAt`. It returns the updated installations.
  - `overview(ws, agentId)` returns `CiAgentOverview`. `outdated` is true when `agent.version !== installation.manifestVersion`, or the regenerated manifest's sha256 differs from the stored one, or the runner sha256 differs from the current bundle.
  - `listRuns(ws, query)` delegates to the repository.
  - GitHub errors are mapped to `AppError` with the scope hint. Missing `GITHUB_TOKEN` gives a 412-style `AppError` "Connect GitHub in Settings → API Keys".
- **Constraint:** onion `SKILL.md:144-158` (no SQL; ports only); cross-module through Container getters (`server/INSIGHTS.md:100-112`); never write to the default branch directly (R6). `commitFiles` creates or fast-forwards `devdigest/ci` only (`adapters.ts:156-161`).
- **Owner:** implementer
- **Done when:**
  - `rg -n "drizzle-orm|db/schema|octokit" server/src/modules/ci/service.ts` is empty.
  - `cd server && pnpm typecheck` passes.

### Step 8 — CI ingest service (pull via artifacts, hardened)
- **Closes:** R8, R11, R12 (trace).
- **Files:** `server/src/modules/ci/ingest.ts` (new), `server/src/modules/ci/helpers.ts` (edit: pure `buildCiRunTrace`, `rejectReason(run, installation)`).
- **Change:** class `CiIngestService(container, repo: CiRepository)` with `sync(ws, { installationId? })`. It implements **I1–I10 and V1–V3 from the [Security model](#security-model)** exactly, in that order, per installation:
  1. List runs (newest `CI_SYNC_RUNS_PER_INSTALLATION`).
  2. Drop the ids already present.
  3. Run the pure reject checks I2–I6.
  4. Fetch the artifact (I7) and parse it (I8, I9).
  5. Get the blob SHAs at `head_sha` for `Object.keys(expectedBlobs)` (V1).
  6. Re-ground the findings with `groundFindings` + `parseUnifiedDiff` over `getCompareDiff(base_sha, head_sha)` (V2). Recompute `findings_count`, `grounding`, and `blockers`/`verdict` via `countBlockers`/`gateTriggered` from `@devdigest/reviewer-core` against the agent's current `ci_fail_on`.
  7. Map the PR via `findPullId`.
  8. Call `ingestRun`.

  `buildCiRunTrace` fills `RunTrace`:
  - `config`: `{ agent: name, version: String(manifest_version), provider, model, pr, source:'ci', commit_sha, base_sha, manifest_sha256, runner_version, dependencies, ci_job_url, verification }`
  - `stats` from the artifact
  - `prompt_assembly`: `{ system:'', user:'' }` (the prompt is assembled in CI and not transmitted)
  - `tool_calls: []`, `raw_output: ''`, `memory_pulled: []`, `specs_read: []`
  - `log`: one `info` line per verification and grounding decision

  Failed runs without an artifact store `status:'failed'` and `error:'runner failed in CI (no result artifact)'`. Single-flight per workspace uses a module-level `Map<workspaceId, Promise>`. Each installation is wrapped in its own try/catch, so one bad repo (for example a missing scope) is reported in the result and does not abort the others. `markSynced` runs after each installation.
- **Constraint:**
  - Untrusted-data handling and grounding are mandatory (`CLAUDE.md:113-115`; `server/CLAUDE.md:71-73`).
  - The only cross-package import is `@devdigest/reviewer-core`'s public exports (`reviewer-core/CLAUDE.md:101-104`).
  - `parseUnifiedDiff` is imported from `server/src/adapters/index.ts`, the same as `modules/eval/helpers.ts:33`.
- **Owner:** implementer
- **Done when:**
  - `cd server && pnpm typecheck` passes.
  - Every reason in `CiSyncResult.rejected` maps to one I-check.
  - `rg -n "verdict" server/src/modules/ci/ingest.ts` shows the verdict assigned only from `gateTriggered`/`countBlockers` output.

### Step 9 — CI routes and module registration
- **Closes:** R1, R5, R8, R9 (API).
- **Files:** `server/src/modules/ci/routes.ts` (new), `server/src/modules/index.ts` (edit: `import ci from './ci/routes.js'`, plus a `ci` entry).
- **Change:** a Fastify plugin with a `ZodTypeProvider`. Every handler resolves the workspace via `getContext` (as in `modules/eval/routes.ts:21`), and all bodies, params and queries are Zod-validated.

  | Method and path | Body / query | Responds | Notes |
  |---|---|---|---|
  | `POST /agents/:id/ci/preview` | `CiPreviewInput` | `CiPreview` | |
  | `POST /agents/:id/export-ci` | `CiExportInput` | `201 CiExport` | rate-limited like the eval routes (`EVAL_RATE_LIMIT_WINDOW` pattern; add `CI_EXPORT_RATE_LIMIT_MAX = 6/min` in `constants.ts`) |
  | `POST /agents/:id/ci/update` | — | `{ installations: CiInstallation[] }` | |
  | `GET /agents/:id/ci` | — | `CiAgentOverview` | |
  | `GET /agents/:id/ci/runner` | — | `{ path, contents, sha256, version }` | lets the zip path fetch the bundle; 409 if missing |
  | `GET /ci/runs` | `CiRunsQuery` | `CiRun[]` | |
  | `POST /ci/sync` | `{ installation_id?: uuid }` | `CiSyncResult` | rate-limited, `CI_SYNC_RATE_LIMIT_MAX = 12/min` |

  The `Fail CI on` change reuses the existing agent update route and the `useUpdateAgent` hook. No new route.
- **Constraint:** `server/CLAUDE.md:53-55, 88-89` (schema validation only, no hand parsing); onion `SKILL.md:118-142` (routes call the service only).
- **Owner:** implementer
- **Done when:**
  - `rg -n "drizzle-orm|db/schema|\.parse\(req" server/src/modules/ci/routes.ts` is empty.
  - The API boots with `cd server && pnpm dev`, and `GET /agents/<id>/ci` returns 200 for a seeded agent (implementer smoke test).

### Step 10 — agent-runner: agent selector, memory, trace-bearing artifact (additive)
- **Closes:** R7, R12 (runner side); the `post_as` gap at `agent-runner/insights/INSIGHTS.md:264` (by workflow env, S5).
- **Files:** `agent-runner/src/index.ts`, `agent-runner/src/manifest.ts`, `agent-runner/src/context.ts`, `agent-runner/src/artifact.ts`, `agent-runner/src/run.ts`, `agent-runner/src/memory.ts` (new), all edits except `memory.ts`.
- **Change:**
  1. `index.ts`:
     - Parse `process.argv` for `review` (optional subcommand) and `--agent <slug>`, with env `DEVDIGEST_AGENT` as a fallback. Pass `agentSlug` to `runCi`.
     - Keep the `isDirectRun` guard working for a `.mjs` file. `import.meta.url` must compare correctly with `pathToFileURL(process.argv[1]).href`, so switch to `pathToFileURL` to be robust to spaces.
  2. `manifest.ts`: `findManifestPath(dir, deps, agentSlug?)`. With a slug, use `agents/<slug>.yaml` (or `.yml`) and fail clearly if it is missing. Without one, keep the existing exactly-one rule. Also return the manifest's raw text so `run.ts` can compute `manifest_sha256` via `node:crypto`.
  3. `memory.ts`: `loadMemory(devdigestDir, readFile)`. If `memory.jsonl` is missing it returns `[]`. Otherwise it parses each non-empty line with `MemoryItem.safeParse`, skips invalid lines with a warning count, caps at 200 items, and returns `content` strings.
  4. `run.ts` passes `memory` into `reviewPullRequest` (`ReviewInput.memory?: string[]`, `reviewer-core/src/review/run.ts:57-58`).
  5. `context.ts`: also read `pull_request.head.sha` and `pull_request.base.sha` from the event payload, plus `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT` from env.
  6. `artifact.ts`: set `RUNNER_VERSION = '2'`. `buildResultArtifact` also emits these v2 fields:
     - `format: 'devdigest-ci-result/v2'`, `agent_slug`, `manifest_version` (from `manifest.version`), `manifest_sha256`, `provider`, `model`
     - `runner_version`, `node_version: process.version` (passed in, not read inside `artifact.ts`)
     - `dependencies: { 'agent-runner': RUNNER_VERSION, 'reviewer-core': <version imported from ../reviewer-core/package.json via resolveJsonModule> }`
     - `repo`, `head_sha`, `base_sha`, `github_run_id`, `github_run_attempt`
     - `verdict` (the deterministic `payload.event` before the APPROVE→COMMENT downgrade), `blockers`, `gate_triggered`, `post_as`, `tokens_in`, `tokens_out` (from the `reviewPullRequest` outcome if exposed, else null), and `findings` (the grounded findings, max 500)

     The artifact is still validated with `CiResultArtifact.safeParse`.

  The hard-fail semantics, grounding, the deterministic gate and the post logic are **unchanged**.
- **Constraint:** `agent-runner/CLAUDE.md:61-74` invariants; `process.env` reads stay confined to `index.ts` (`agent-runner/CLAUDE.md:41-46`); no new runtime dependency (`agent-runner/package.json`).
- **Owner:** implementer
- **Done when:**
  - `cd agent-runner && pnpm typecheck && pnpm test` passes, with the existing 19 tests still green.
  - `rg -n "review.verdict|outcome.review.verdict" agent-runner/src/run.ts` shows no use as the gate.

### Step 11 — Bundle delivery: build in dev.sh, agent-runner CI workflow, confirm the module format
- **Closes:** R7.
- **Files:** `scripts/dev.sh` (edit), `.github/workflows/agent-runner.yml` (new).
- **Change:**
  1. `scripts/dev.sh`: after the `reviewer-core` install (`scripts/dev.sh:78-80`), add: if `agent-runner/dist/index.js` is missing, `log "building agent-runner bundle"` and run `(cd agent-runner && pnpm install && pnpm build)`. Skip it under `--db-only`.
  2. New workflow `agent-runner.yml`, modelled on `.github/workflows/reviewer-core.yml`:
     - Triggers: `push` to main and `pull_request`, with `paths:` set to `agent-runner/**`, `reviewer-core/src/**`, `server/src/vendor/shared/**`, `.github/workflows/agent-runner.yml`, and **`'!**/INSIGHTS.md'` last** (`INSIGHTS.md:16-21`).
     - Jobs: pnpm install in `reviewer-core` (per `agent-runner/insights/INSIGHTS.md:240`; use npm there if `reviewer-core.yml` does), then in `agent-runner/` run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
     - Assert the bundle with `test -s dist/index.js`.
  3. **Module format check (implementer, before finalizing `CI_RUNNER_PATH`):** after `pnpm build`, run `grep -c "import.meta" agent-runner/dist/index.js` and `head -c 400 agent-runner/dist/index.js`.
     - If the bundle is ESM, keep `.devdigest/runner.mjs`.
     - If it is CommonJS, set `CI_RUNNER_PATH = '.devdigest/runner.cjs'`, update S5's command, and record the finding in `agent-runner/insights/INSIGHTS.md`.
- **Constraint:** RULE-ALIAS-CI (`repo-rules.md:24`): agent-runner aliases `../reviewer-core/src` and `../server/src/vendor/shared`, so both must be in `paths:`. Use pnpm for agent-runner (`agent-runner/README.md:171-178`).
- **Owner:** implementer
- **Done when:**
  - `./scripts/dev.sh --no-seed --no-client` builds the bundle from a clean checkout.
  - The workflow's `paths:` ends with `'!**/INSIGHTS.md'`.
  - The module format is recorded in the step's PR note.

### Step 12 — Client hooks and query keys
- **Closes:** R1, R5, R8, R9 (data layer).
- **Files:** `client/src/lib/hooks/ci.ts` (new), `client/src/lib/hooks/keys.ts` (edit: `ciKeys = { agent:(id)=>['ci-agent',id], runs:(q)=>['ci-runs',q], preview:(id)=>['ci-preview',id] }`), `client/src/lib/hooks/index.ts` (edit, if it re-exports hooks).
- **Change:** following the `client/src/lib/hooks/eval.ts` pattern (`api` plus a Zod response schema):
  - `useCiPreview()`: a mutation, because it depends on wizard state.
  - `useExportCi()`: invalidates `ciKeys.agent`.
  - `useUpdateCiConfig()`
  - `useAgentCi(agentId)`
  - `useCiRunner(agentId)`: a lazy query (`enabled:false`), refetched only for the zip.
  - `useCiRuns(query)`
  - `useCiSync()`: invalidates `ciKeys.runs` and `ciKeys.agent`.
  - `useCiAutoSync(enabled)`: calls `useCiSync` on mount and every 120 s while `document.visibilityState === 'visible'`.
- **Constraint:** `client/CLAUDE.md:48-49` (no `fetch` in components; one hook per server call); query keys only via the factory (`keys.ts:1-10`).
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck` passes and `rg -n "fetch\(" client/src/app` shows no new hits.

### Step 13 — Agent CI tab and Export Wizard
- **Closes:** R1, R2, R3, R4, R5, R9.
- **Files:**
  - `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` (edit: add `{ key:'ci', labelKey:'editor.tabs.ci', icon:'GitBranch' }`; pick an icon that exists in `@devdigest/ui` `icons.tsx`) and update the stale comment at `:10-11`.
  - `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` (edit: render `CiTab` for `tab==='ci'` and update the fall-through condition at `:28`).
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/{CiTab.tsx,index.ts,styles.ts,helpers.ts,CiTab.test.tsx}` (new).
  - `…/CiTab/_components/CiFailOnControl/{CiFailOnControl.tsx,index.ts,styles.ts,constants.ts}` (new).
  - `…/CiTab/_components/CiInstallationRow/{CiInstallationRow.tsx,index.ts,styles.ts}` (new).
  - `…/CiTab/_components/ExportWizard/{ExportWizard.tsx,index.ts,styles.ts,helpers.ts,constants.ts,ExportWizard.test.tsx}` (new).
  - `…/ExportWizard/_components/{TargetStep,PreviewStep,ConfigureStep,InstallStep}/{<Name>.tsx,index.ts,styles.ts}` (new).
  - `client/messages/en/ci.json` and `client/messages/en/agents.json` (edit).
- **Change:**
  - **CiTab** (mockup 2):
    - Header "CI deployment" with an "Active in N repos" badge (`active_repos`).
    - Buttons "Update CI config" (`useUpdateCiConfig`; disabled when there are no PR installations; shows a spinner and a result toast) and "Add to CI" (primary; opens the wizard).
    - A `CiFailOnControl` card.
    - Installation rows: repo (mono), target badge "GitHub Actions", last-run status chip and relative time, a link to the open PR, an "Update available" badge when `outdated`, and a warning badge when the last run was `unverified`. Workflow version and manifest version are shown in the row's secondary text.
    - A dashed "Add repository" row that opens the wizard.
    - A short history list with the last 5 `recent_runs` and a link to `/ci-runs?agent_id=`.
    - Calls `useCiAutoSync(true)` while mounted.
  - **CiFailOnControl:**
    - A segmented control with Critical / Warning+ / Never, mapping to `critical` / `warning` / `never` through `useUpdateAgent({ ci_fail_on })`. It uses the explanation text from the mockup.
    - If `agent.ci_fail_on === 'any'`, it renders a fourth read-only pill "Any finding (set in Config)" as selected.
    - Changing the value invalidates `ciKeys.agent`, so `outdated` reflects that the repo manifest now differs.
  - **ExportWizard** (mockups 1, 3, 4, 5):
    - A modal portaled to `document.body` with `createPortal`, as in `client/src/components/eval-case-modal/EvalCaseModal.tsx:103`, with `ExportWizardSteps` labels Target / Preview / Configure / Install. Local state: `step, target, repo, triggers, postAs, workflowYaml|null, installAction`.
    - **Target:**
      - A 2×2 card grid of all four targets with their descriptions.
      - GitHub Actions is selected and has the "recommended" badge.
      - CircleCI, Jenkins and Generic CLI are `aria-disabled`, not focusable as options, dimmed, and show a "coming soon" badge.
      - Below the grid, a repo picker (`SelectInput`) over imported repos from the existing repos hook, defaulting to the shell's active repo. Use the shell context the app-shell already exposes; if none is available, default to the first repo.
    - **Preview:**
      - Calls `useCiPreview` on entry and whenever the repo, triggers or postAs change.
      - Left: the "FILES TO CREATE" list. Right: a read-only `<pre>` viewer, with the workflow file editable in a monospace `Textarea` marked with an "editable" chip.
      - The runner row shows "generated bundle · <size> · not editable" without its content.
      - `blocking[]` renders an error banner and disables Continue.
      - Editing the workflow sets `workflowYaml`. "Reset to generated" clears it.
    - **Configure:**
      - Trigger chips: `opened` and `synchronize` toggled on by default, `reopened` optional, at least one required.
      - "Post results as" radios: GitHub review (recommended) / PR comment / None (exit code only).
      - The info note from the mockup.
      - Changing triggers or postAs after the workflow was edited shows a confirm "regenerate workflow? your edits will be lost" before clearing `workflowYaml`.
    - **Install:**
      - Two option cards. "Open a PR with these files" (recommended) shows the repo and file count. "Copy files as a zip" is labelled "add them manually".
      - A secret note (`OPENROUTER_API_KEY`) and the "GitHub Action setup docs" link pointing to `https://docs.github.com/actions/security-guides/using-secrets-in-github-actions`.
      - **Install** calls `useExportCi`. With `open_pr` it shows success with "View pull request" (`pr_url`). With `files`, the server returns the full files including the runner. `helpers.ts` `buildZip(files)` uses `fflate.zipSync` and triggers a Blob download named `devdigest-ci-<slug>.zip`.
      - Errors (missing scope, missing token, 409 blocking) render inline.
  - **i18n:**
    - Add `editor.tabs.ci` if missing; `agents.json:51` already has `"ci": "CI"`, so verify the key path.
    - Add `ciTab.*` keys for the new copy: "CI deployment", "Active in {count} repos", "Update CI config", "Add to CI", "Fail CI on" with its explanation, "Add repository", "Update available", "Unverified run", "coming soon".
    - Replace the stale `exportWizard.blockMergeTitle`/`blockMergeDesc` with the mockup's required-status-check note (`client/INSIGHTS.md:59-68`).
    - No user-facing literals in `constants.ts`.
- **Constraint:**
  - `client/CLAUDE.md:30-35` (folder layout) and `:42-44` (snake_case DTO seam).
  - Reuse vendored primitives (`client/CLAUDE.md:62-63`): `Modal`/`Tabs`/`SelectInput`/`Textarea`/`Badge`/`Chip`/`Button` from `@devdigest/ui`. If `Modal` cannot portal, wrap it in `createPortal` like `EvalCaseModal`.
  - Findings and repo strings render as text only.
- **Owner:** implementer
- **Done when:**
  - `cd client && pnpm typecheck` passes.
  - Manual check in `pnpm dev`: the CI tab renders, the wizard walks all four steps, and the disabled targets are not selectable.

### Step 14 — CI Runs page and navigation
- **Closes:** R8.
- **Files:**
  - `client/src/app/ci-runs/page.tsx` (new, thin)
  - `client/src/app/ci-runs/_components/CiRunsView/{CiRunsView.tsx,index.ts,styles.ts,helpers.ts,CiRunsView.test.tsx}` (new)
  - `client/src/app/ci-runs/_components/CiRunsView/_components/{CiRunsFilters,CiRunRow}/{<Name>.tsx,index.ts,styles.ts}` (new)
  - `client/src/vendor/ui/nav.ts` (edit: add a `{ section:"GLOBAL", items:[{ key:"ci-runs", label:"CI Runs", icon:<existing icon>, href:"/ci-runs" }] }` group after SKILLS LAB)
  - `client/messages/en/ci.json` (edit `runs.*`)
  - `client/src/components/app-shell/helpers.ts` (no change; `/ci-runs` is already mapped at `:38`)
- **Change:** layout consistent with `client/src/app/eval/page.tsx`:
  - Title "CI Runs", subtitle (existing `runs.subtitle`), an "auto-refresh on" indicator (`useCiAutoSync(true)`) and a Refresh button (`useCiSync`, showing a toast summary of `ingested/rejected` counts).
  - Filters: Last 7 days / agent / repo / status, mirrored to the URL search params (`agent_id` from the CI tab link).
  - Columns:
    - Timestamp
    - Repository
    - Pull request (`#n`, linking to the studio PR page when it is imported, else to GitHub)
    - Agent (linking to `/agents/:id?tab=ci`)
    - Verdict (chip: Request changes / Comment / Approve)
    - Findings (re-grounded count, with a tooltip "CI reported N" when it differs)
    - Cost and Duration ("reported by CI" tooltip)
    - Status, with an `unverified` warning badge
    - "View job" external link (`job_url`, `rel="noopener noreferrer"`)
  - Empty state uses `runs.emptyTitle`/`emptyBody`.
  - Add the `ci.json` keys for the new columns (`repository`, `agent`, `verdict`, `duration`, `job`, `unverified`, `reportedByCi`).
- **Constraint:**
  - `client/INSIGHTS.md:48-57`: the nav label lives in both `nav.ts` and `shell.json` (`nav.ci-runs` already exists).
  - Editing `client/src/vendor/ui/nav.ts` is a known RULE-VENDOR WARNING, with the same precedent as the L06 eval entry (`nav.ts:45-47`).
  - Pages stay thin (`client/CLAUDE.md:16`).
- **Owner:** implementer
- **Done when:** `cd client && pnpm typecheck` passes, `/ci-runs` renders the empty state on a fresh DB, and the sidebar highlights "CI Runs".

### Step 15 — Server and agent-runner documentation of the new surface
- **Closes:** none (keeps the docs true for later sessions).
- **Files:**
  - `server/README.md` (edit: API map rows for the 7 routes, plus the env var `DEVDIGEST_AGENT_RUNNER_BUNDLE`)
  - `agent-runner/README.md` (edit: bundle path `.devdigest/runner.mjs`, `review --agent <slug>`, `DEVDIGEST_AGENT`, `memory.jsonl`, the v2 artifact fields)
  - `agent-runner/CLAUDE.md` (edit: the two path mentions at `:5` and `:16`; the `insights/gotchas.md` link at `:88` points to a file that doesn't exist, so change it to `insights/INSIGHTS.md`)
- **Change:** text only. Keep wording that doesn't name forbidden tokens (`server/INSIGHTS.md:124-131`).
- **Constraint:** editing any `CLAUDE.md` means running `pnpm eval:workflow` from `evals/` (`CLAUDE.md:68-72`, harness evals table).
- **Owner:** implementer
- **Done when:** `rg -n "runner/index.js" agent-runner server/src docs` returns no stale references, except the runner `.gitignore` `dist/` line.

### Step 16 — Tests (typological, per TESTING.md)
- **Closes:** verification for R1–R12.
- **Files:**
  - `server/test/ci-helpers.test.ts` (new)
  - `server/test/ci-ingest.test.ts` (new; hermetic, uses `MockGitHubClient`)
  - `server/test/ci.it.test.ts` (new; DB-backed)
  - `agent-runner/src/{manifest,run}.test.ts` (edit) and `agent-runner/src/memory.test.ts` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.test.tsx`, `…/ExportWizard/ExportWizard.test.tsx` and `client/src/app/ci-runs/_components/CiRunsView/CiRunsView.test.tsx` (new)
  - `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.test.tsx` (edit: CI tab present)
- **Change (kinds of breakage, not coverage):**
  - **server unit, helpers:**
    - The manifest YAML round-trips through `AgentManifest` (the same check the runner performs).
    - The workflow YAML contains the slug invocation, `if:` fork guard, `permissions`, `upload-artifact` with `if: always()`, and the chosen triggers.
    - `ciSlug` collisions and reserved names.
    - `assertSafeExportPath` rejects `../`, absolute paths and `.devdigest/docs/x.md`.
    - `gitBlobSha` matches a known git vector: `gitBlobSha('hello\n') === 'ce013625030ba8dba906f756967f9e9ca394464a'`.
  - **server unit, ingest:** one test per I2–I9 reject reason, plus:
    - I10 duplicate (with the repository faked or stubbed at the service seam)
    - zip over cap
    - V1 unverified when one blob differs
    - V2 a finding outside the diff is dropped and `blockers` recomputed
    - a failed run without an artifact becomes `status:'failed'`
    - one installation throwing does not abort the others
  - **server integration:**
    - `POST /agents/:id/ci/preview` returns 5 files plus the runner, with `blocking: []` for an OpenRouter agent, and `provider_unsupported` for an Anthropic agent.
    - `POST /agents/:id/export-ci` (`open_pr`) calls mock `commitFiles` with branch `devdigest/ci` and never with the base branch, persists the installation and returns `pr_url`.
    - `files` returns runner contents without calling GitHub.
    - `POST /ci/sync` twice with the same mock run produces exactly one `agent_runs` row with `source='ci'`, one `run_traces` row (with `commit_sha`, `manifest_version`, `model` and `dependencies` set) and one `ci_runs` row.
    - `GET /ci/runs` filters work.
    - Workspace isolation: another workspace's agent gives 404.
    - The integration tests provide every provider in their LLM overrides (`server/INSIGHTS.md:42-53`).
  - **agent-runner:**
    - `--agent` selects among two manifests; the existing exactly-one rule still works without it.
    - `memory.jsonl` missing gives `[]`; bad lines are skipped; items reach `reviewPullRequest`.
    - The v2 artifact carries `head_sha`, `manifest_sha256` and a `verdict` from the gate, not the model.
    - Hard-fail still writes no artifact.
  - **client:**
    - The wizard steps advance and go back.
    - Disabled targets cannot be selected.
    - `blocking` disables Continue.
    - Editing the workflow then changing triggers asks for confirmation.
    - Install with zip calls `buildZip` (mock `fflate`/URL APIs).
    - The `CiFailOnControl` mapping, including the `any` case.
    - The CI Runs table renders verdict, findings, cost, duration, an unverified badge and the job link.
    - `fetch` is mocked (`client/CLAUDE.md:54-58`).
- **Constraint:** a DB test must be `*.it.test.ts` (`TESTING.md:88-91`); mocks via `server/src/adapters/mocks.ts` (`TESTING.md:96-97`); no live GitHub or LLM.
- **Owner:** test-writer
- **Done when:** every command in the Test plan table passes.

### Step 17 — Root CLAUDE.md package table and harness eval
- **Closes:** none (the doc accuracy that S11 makes necessary).
- **Files:** `CLAUDE.md` (edit: add the `agent-runner/` row to the Layout table, `@devdigest/agent-runner`, "Bundled CI runner (ncc) executed in target repos' GitHub Actions"; add it to the Commands list as **pnpm**; add it to the per-package CLAUDE.md links).
- **Change:** text only. Do not change any convention text.
- **Constraint:** `CLAUDE.md:68-72` (any `CLAUDE.md` edit means running `pnpm eval:workflow`).
- **Owner:** implementer
- **Done when:** `cd evals && pnpm eval:workflow` completes. Report-only results are acceptable; record them.

### Step 18a — Architecture review
- **Closes:** none (review).
- **Files:** read-only, over the whole diff.
- **Change:** check onion layering (S4–S9), contract sync (S1), the migration being generated-only (S2), the client folder layout (S12–S14), and the scope fence (R10: no diff under `server/src/modules/reviews/run-executor.ts`, `server/src/modules/pulls/**`, `server/src/modules/polling/**`, or the multi-agent code).
- **Owner:** architecture-reviewer
- **Done when:** no CRITICAL remains after the bounded fix loop through `implementer`.

### Step 18b — Security review
- **Closes:** none (review).
- **Files:** read-only. Focus on `server/src/modules/ci/{ingest,service,routes}.ts`, `server/src/adapters/github/octokit.ts` (zip and size caps), `server/src/adapters/runner-bundle/local.ts`, `agent-runner/src/{index,context,memory}.ts`, and the generated workflow template.
- **Change:** verify every I1–I10 and V1–V3 rule of the Security model:
  - no secret reaches the DB, logs, generated files or the artifact
  - the workflow uses least-privilege `permissions` and skips forks
  - nothing from the client controls file paths, repo or run ids
  - untrusted findings are rendered as text
- **Owner:** security-reviewer
- **Done when:** no CRITICAL or HIGH remains after the fix loop.

### Step 19 — Plan verification
- **Closes:** confirms R1–R12.
- **Files:** read-only.
- **Change:** walk every step's "Done when" condition and the Test plan table, and confirm the Requirements table rows are all satisfied.
- **Owner:** plan-verifier
- **Done when:** the verdict is PASS.

---

## Contract changes

All are additive, in `server/src/vendor/shared/contracts/eval-ci.ts` and `trace.ts`, plus the `GitHubClient` and new `RunnerBundleSource` interfaces in `server/src/vendor/shared/adapters.ts`. The `client/src/vendor/shared/**` copy is updated **byte-identically in the same commit** (RULE-CONTRACT-SYNC). agent-runner picks up the same files through its `@devdigest/shared` alias (`agent-runner/tsconfig.json` paths).

- **New:** `CiTrigger`, `CiPostAs`, `CiPreviewInput`, `CiPreview`, `CiAgentOverview`, `CiRunsQuery`, `CiSyncResult`.
- **Extended with nullish fields:** `AgentManifest.version`, `CiFile.role`/`size_bytes`, `CiInstallation.*`, `CiRun.*`, `CiResultArtifact.*` (v2), `RunTrace.config.*`.
- **Narrowed:** `CiExportInput.triggers` becomes an enum array with min 1 and default `['opened','synchronize']`, and it gains `workflow_yaml`. It has no consumers at planning time; S1 re-verifies.

## Migration

Yes. Edit `server/src/db/schema/ci.ts` (S2) only, then run `cd server && pnpm db:generate` and `cd server && pnpm db:migrate`. Never hand-write the `.sql` or the `meta/*` files. Columns and indexes are added only, with no drops or renames in this pass (`server/INSIGHTS.md:186-197`). `agent_runs` needs no change: `source enum('local','ci')` already exists at `server/src/db/schema/runs.ts:56`.

## Test plan

| Suite | Command (verbatim from TESTING.md / package README) | Covers which step |
|---|---|---|
| server-unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | S4, S5, S8 (`ci-helpers.test.ts`, `ci-ingest.test.ts`) |
| server-integration | `cd server && pnpm exec vitest run .it.test` | S2, S6, S7, S9 (`ci.it.test.ts`) |
| server typecheck | `cd server && pnpm typecheck` | S1–S9 |
| agent-runner | `cd agent-runner && pnpm typecheck` · `cd agent-runner && pnpm test` · `cd agent-runner && pnpm build` (from `agent-runner/README.md:173-178`) | S10, S11 |
| reviewer-core (unchanged; alias consumer) | `cd reviewer-core && npm test` | regression only |
| client | `cd client && pnpm test` · `cd client && pnpm typecheck` | S12–S14 |
| contract sync | `diff -rq server/src/vendor/shared client/src/vendor/shared` (must print nothing) | S1, S4 |
| harness | `cd evals && pnpm eval:workflow` (`CLAUDE.md:68-72`) | S15, S17 |

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| The ncc bundle is CommonJS, so `.mjs` fails, or the bundle is ESM but shipped as `.js` | S11 | The S11 module-format check picks the extension before S5's constant is finalized; it is recorded in the runner INSIGHTS |
| The studio's PAT lacks `workflow` or Actions-read scope, so commit or sync returns 403/404 | S4, S7, S8 | Errors are mapped to scope-specific `AppError` messages; per-installation sync failures are isolated |
| A write-access user forges an artifact on a branch | S8 | V1 blob-SHA verification marks the run `unverified`; V2 re-grounds findings and recomputes blockers server-side |
| Unverified false positives when base `.devdigest/` files changed after the PR branched | S8 | Documented in the Security model; the UI wording says "config differs from installed version", not "tampered" |
| Zip bomb or huge artifact | S4 | Streamed `maxZipBytes` cap, a per-entry `originalSize` filter in fflate, a JSON byte cap, and Zod's `findings.max(500)` |
| Two agents in one repo share `devdigest/ci`: an open PR collects both agents' files, and a shared skill file is overwritten by the other agent's version | S7 | Per-agent workflow and manifest paths. Skill files are keyed by skill slug and hold the current enabled body, so the last writer wins with identical bodies for the same skill version. `outdated` flags drift. |
| Merge conflicts on `client/src/vendor/ui/nav.ts` and `shell.json` with the parallel multi-agent worktree (`emdash/multi-agents-review-qyvmj`), which likely also adds a GLOBAL group | S14 | Keep the GLOBAL group edit minimal (one item); call it out in the PR description |
| The unique `(agent_id, repo)` index fails if any dev DB has rows in `ci_installations` | S2 | Nothing writes the table today (verified with `rg`); the implementer checks `SELECT count(*) FROM ci_installations` before migrating |
| Integration tests go live and billed through an unmocked provider | S16 | Override every provider in `ci.it.test.ts` (`server/INSIGHTS.md:42-53`) |
| Changes to the runner's `src/index.ts` affect already-installed bundles | S10 | All runner changes are additive. Old installs keep the old bundle until "Update CI config", and v1 artifacts still parse because every v2 field is nullish. |

## Out of scope

- CircleCI, Jenkins and Generic CLI generators (the cards are shown disabled with "coming soon").
- The push ingest endpoint (option B); see the Security model.
- Publishing `devdigest/review-action@v1`.
- Pushing repo secrets (`OPENROUTER_API_KEY`) to GitHub from the studio.
- Non-OpenRouter providers in CI.
- The agent **Stats** tab shown in the mockups.
- The multi-run service, `multi_agent_runs`, and the PR feed or polling modules.
- Uninstalling or removing an installation.
- Background (server-side cron) CI sync; sync is user-triggered or auto-triggered by the client while a CI view is open.
- A new e2e journey (hermetic e2e cannot reach GitHub).
- Fixing the stale "`server/package.json` is skip-worktree" statements in the root `CLAUDE.md`, `TESTING.md` and `server/CLAUDE.md`.

## Open questions

1. **Workflow filename.** The plan uses `.github/workflows/devdigest-review-<agent-slug>.yml` (Recommendation, point 1) rather than the spec's literal `devdigest-review.yml`, so several agents can share a repo. The user can veto; that is a one-constant change in S5.
2. **Node version.** The generated workflow pins Node 22, not the mockup's 20, because Node 20 is EOL as of April 2026. The user can veto; that is a one-constant change in S5.
3. **Runner bundle source.** Building locally plus the studio reading `../agent-runner/dist/index.js` (Recommendation, point 2) is the planned default, and the coordinator flagged it for confirmation. The alternative is committing `agent-runner/dist/`, which needs both `.gitignore` files changed and a "rebuild before commit" check in CI.
4. **Runner ownership.** S10 edits `agent-runner/src/*`, which the spec's scope line for worktree B ("`ci/`, routes, CI Runs, CI tab") does not name explicitly. The edits are additive and needed for R7 and R12 (agent selection, memory, trace fields). Confirm that worktree B may make them, or name who owns `agent-runner`.
