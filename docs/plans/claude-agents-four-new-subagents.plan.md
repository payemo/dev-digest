# Development Plan: add four Claude Code subagents — `test-writer`, `architecture-reviewer`, `plan-verifier`, `doc-writer`

**Branch:** `lab03-intent-layer` · **Date:** 2026-09-23
**Packages touched:** tooling (`.claude/agents/`) — plus `server/src/vendor/shared/contracts/findings.ts` **and** its physical copy `client/src/vendor/shared/contracts/findings.ts` **only if** Open question **OQ-2** resolves as option (b). No product code otherwise.
**Estimated steps:** 9 (Step 1 satisfied by OQ-1's resolution below; Step 8 confirmed DO NOT EXECUTE per OQ-2) · **Migration required:** no · **Contract change:** none — OQ-2 resolved as option (a)

## Why one plan file, not four

One file with four clearly separated step-groups (A–D) plus a shared group (E).
The four agents are not independent deliverables: they share one frontmatter
shape, one ending self-check convention, one catalog table and one sources
table in `.claude/agents/README.md:10-14` and `:90-107`, and three of them
(`architecture-reviewer`, `plan-verifier`, `doc-writer`) reuse the *same*
severity/grounding rules from `.claude/skills/pr-self-review/SKILL.md:48-69`.
Four separate plan files would duplicate that shared contract four times and
invite four divergent frontmatter shapes — the exact failure the house style
exists to prevent. The step-groups are independently executable in any order
except that Step 1 gates Steps 2 and 3, and Steps 7–8 must come last.

## Goal

After this is implemented, `.claude/agents/` contains seven agent files instead
of three: the existing `researcher`, `planner`, `implementer` plus a
`test-writer` that writes and runs tests, an `architecture-reviewer` that is
physically read-only and reports only onion-architecture boundary findings with
`file:line` evidence, a `plan-verifier` that reconciles a finished diff against
a specific Development Plan step by step, and a `doc-writer` that turns
implemented work into documentation in the correct `docs/`/`specs/` location.
All four match the existing house style exactly — frontmatter of only `name`,
`description`, `tools`, `model` (plus `skills:` only if OQ-1 resolves
supported), a trigger-phrase-first `description` that names what the agent does
NOT cover, `Agent` absent from every `tools:` list, and a closing
`## Quality bar before you return` checklist — and `.claude/agents/README.md`
documents all seven with their sources.

## Inputs read

| File | What it constrained |
|---|---|
| `CLAUDE.md:97-121` (Non-default conventions) | "Testing is typological, not exhaustive" and "Grounding is mandatory … the model's self-reported score is never trusted" — both become hard constraints in `test-writer` and in the two reviewer agents |
| `CLAUDE.md:64-72` (Insights loop) | `doc-writer` must route INSIGHTS entries through the `engineering-insights` skill, not write them directly |
| `CLAUDE.md:136-157` (Do not touch) | Nothing in this change may hand-edit a migration, a lockfile, or add a root `package.json`; each new write-capable agent restates this |
| `CLAUDE.md:43-44` | "No linter is configured in any package. `typecheck` is the enforced static-analysis gate" — `test-writer` must always run `typecheck`, never look for a `lint` script |
| `.claude/agents/researcher.md:1-16` | Frontmatter is exactly `name`, `description`, `tools`, `model`; read-only agents omit `Write`/`Edit` entirely and restate "no `Bash` redirection" in prose |
| `.claude/agents/researcher.md:212-227` | The closing `## Quality bar before you return` checklist shape, and "Your final message **is** the report" |
| `.claude/agents/planner.md:24-26` | The precedent for scoping `Write` to a directory **in prose**, not by a tool field — the mechanism `doc-writer` must copy |
| `.claude/agents/implementer.md:83-99` | The verbatim `TESTING.md` commands and the reason they are verbatim (`server/package.json` is `skip-worktree`) — reused by `test-writer` and `plan-verifier` |
| `.claude/agents/implementer.md:137-139` | The `Deviations from the plan` table with a `Why` column — the artifact `plan-verifier` adjudicates |
| `.claude/agents/README.md:10-19` | Catalog table shape, and the current sentence that architecture review "is deliberately **not** covered by any agent here" — which this change invalidates and must rewrite |
| `.claude/agents/README.md:90-107` | The `Source \| Rule \| Where applied` table every new rule must be appended to |
| `.claude/agents/README.md:109-120` | The precedent for calling out *unadopted* research items explicitly instead of silently skipping them — used for OQ-1 |
| `.claude/skills/pr-self-review/routing.md:50-58` | `.claude/**`, `docs/**` and `*.md` have **no skill lane**; the only exception is a `.md` that adds a Mermaid block |
| `.claude/skills/pr-self-review/routing.md:25` | `server/test/**` and `server/**/*.test.ts` route to **no** skill — the gap `test-writer`'s prompt must close with an agent-local rule |
| `.claude/skills/pr-self-review/routing.md:42` | `client/**/*.test.tsx` and `client/src/test/**` route to `react-testing-library` — the one test lane that *does* exist |
| `.claude/skills/pr-self-review/SKILL.md:48-69` | `CRITICAL/WARNING/SUGGESTION`, the grounding rule ("dropped, not softened"), "Do not inflate", "An empty findings list is a good outcome" — reused by both reviewer agents |
| `.claude/skills/pr-self-review/SKILL.md:162-167` | Score/verdict are computed by a script, never by the model — the precedent for `plan-verifier` computing its summary counts from its own table |
| `.claude/skills/pr-self-review/SKILL.md:205-207` | `category` uses the product enum and "layering, placement and convention findings are `style`" — option (a) of OQ-2 |
| `.claude/skills/onion-architecture/SKILL.md:35-43` | `depcruise` is the machine check and "Every CRITICAL rule below is encoded there"; CRITICAL = breaks the dependency rule |
| `.claude/skills/onion-architecture/SKILL.md:275-296` | The four known-violation modules are exceptions in `.dependency-cruiser.cjs` — `architecture-reviewer` must not re-report them as new findings |
| `.claude/skills/mermaid-diagram/SKILL.md:24-30` | The Decision Guide answers *which* diagram type, never *whether* to draw one — the gap `doc-writer`'s prompt must close |
| `server/src/vendor/shared/contracts/findings.ts:14` | `FindingCategory` = `bug \| security \| perf \| style \| test` — no `architecture` value exists (OQ-2) |
| `server/src/vendor/shared/contracts/findings.ts:57` | `confidence: z.number().min(0).max(1)` already exists on `Finding` — reuse it, don't invent a scale |
| `TESTING.md:8-24` | "Philosophy — typological, not exhaustive", "Test behaviour at the seams", "Mock the outside world" (`server/src/adapters/mocks.ts`) — `test-writer`'s core method |
| `TESTING.md:27-33` | The suite map has **no row** for `.claude/**` — no existing suite verifies this change |
| `TESTING.md:61-75` | The verbatim per-package run commands `test-writer` and `plan-verifier` must use |
| `TESTING.md:78-86` | `*.it.test.ts` is the only thing splitting the DB lane from the hermetic one; CI uses `pnpm exec vitest run …` because `server/package.json` is `skip-worktree` |
| `client/CLAUDE.md:21-22`, `:31-33` | Client component tests are colocated as `_components/<PascalCase>/<Name>.test.tsx` — the path `test-writer` must write to |
| `client/CLAUDE.md:48-52`, `:56-57` | Never `fetch` from a component (mock at the `src/lib/hooks/*` seam); browser journeys live in `e2e/`, not `client/`; component tests mock `fetch` so contract drift is invisible to them |
| `server/CLAUDE.md` (Commands / Naming) | `pnpm test` is unit + integration; `*.it.test.ts` is DB-backed via testcontainers and self-skips without Docker |
| `reviewer-core/CLAUDE.md:15-16` | `npm test` is fully hermetic with a stubbed `LLMProvider` — no keys, no network |
| `e2e/CLAUDE.md:19`, `:33-34` | `e2e` "tests" are `specs/NN-name.flow.json` batch JSON with deterministic locators only — **not** TS test files, which is why `e2e/` is out of `test-writer`'s scope |
| `server/docs/README.md:3-5`, `server/specs/README.md:3-4` (same shape in `client/`, `reviewer-core/`, `e2e/`) | `<pkg>/docs/` = deeper design/architecture notes, one file per topic; `<pkg>/specs/` = feature/API specifications, one file per feature or lesson — `doc-writer`'s placement table |
| `docs/specs/conventions.md:1-20` | A cross-package feature spec lives at root `docs/specs/`, and this one uses **ASCII art**, not Mermaid — the precedent `doc-writer` must deliberately not follow |
| `README.md:27`, `server/README.md:33`, `server/README.md:64`, `reviewer-core/README.md:16`, `client/README.md:24` | README-level diagrams in this repo are Mermaid — the convention `doc-writer` follows |
| `docs/agent-prompts/README.md:71`, `:141` | "Do not describe the JSON shape, field names, or a markdown layout in the prompt" — the in-repo precedent for `doc-writer`'s "explain mechanism, never restate a signature" rule |
| `INSIGHTS.md:1-12` | Root `INSIGHTS.md` owns `.claude/` findings, capped at 15 entries × 2 lines — where an insight from this work would go |
| `.claude/skills/pr-self-review/repo-rules.md:116-123` | `client/src/vendor/shared` is a **physical copy** of `server/src/vendor/shared`; the fix for drift is to copy file-for-file |
| `.github/workflows/client.yml:6-11` | Confirms the physical-copy mechanism in CI's own words and states root `CLAUDE.md`'s "propagates by alias" "describes the intent, not the current mechanism" |
| `.github/workflows/` (all five files) | None references `.claude/**` — a `.claude/**`-only change triggers **zero** CI jobs |

## Architectural constraints binding this change

- **Frontmatter is exactly four fields** — `name`, `description`, `tools`, `model`. No other field appears in any existing agent — source: `.claude/agents/researcher.md:1-16`, `.claude/agents/planner.md:1-14`, `.claude/agents/implementer.md:1-13`, stated as a rule at `.claude/agents/README.md:103`. Adding `skills:` is therefore a deliberate deviation gated on OQ-1.
- **`Agent` is never in a `tools:` list** — omitting it is the enforced way to stop a subagent spawning children; each agent *also* says so in prose as belt-and-suspenders — source: `.claude/agents/README.md:16-17`, `:93`.
- **`description` opens with what the agent does plus trigger phrases, and names what it does NOT cover** — source: `.claude/agents/README.md:94`, `:118-120`; live examples at `.claude/agents/implementer.md:3-10` and `.claude/agents/planner.md:3-11`.
- **Every agent prompt ends with `## Quality bar before you return`** — source: `.claude/agents/researcher.md:212`, `.claude/agents/planner.md:176`, `.claude/agents/implementer.md:157`, stated as a rule at `.claude/agents/README.md:104`.
- **A subagent inherits no conversation history** — so when an agent's real output is a file, the handoff is a *path*, not pasted text — source: `.claude/agents/README.md:74-81`, `:96`.
- **Directory-scoping a write tool is a prose constraint, not a tool field** — `planner` already does exactly this for `docs/plans/` — source: `.claude/agents/planner.md:24-26`; corroborated externally by [Configure permissions](https://code.claude.com/docs/en/permissions) (no frontmatter field scopes `Write`/`Edit` to a subdirectory).
- **`.claude/**` and `docs/**`/`*.md` have no skill lane** — they get `repo-rules.md` and nothing else, and their paths are listed in `uncovered_files` so the report says so out loud. The sole exception is a `.md` that adds a Mermaid block — source: `.claude/skills/pr-self-review/routing.md:50-58`. **Every file this plan creates or edits falls in that no-lane set.**
- **Grounding is mandatory and a finding without a citation is dropped, not softened** — source: `CLAUDE.md:118-120`, `.claude/skills/pr-self-review/SKILL.md:52-54`. Both reviewer agents inherit this as their first-line anti-fabrication control.
- **Severity must not be inflated; an empty findings list is a good outcome** — source: `.claude/skills/pr-self-review/SKILL.md:65-69`.
- **Score/verdict are computed, never self-reported** — source: `.claude/skills/pr-self-review/SKILL.md:55-58`, `:162-167`; the product rule it mirrors is `CLAUDE.md:118-120`.
- **Onion CRITICAL = breaks the dependency rule, and it is machine-checked** by `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` — source: `.claude/skills/onion-architecture/SKILL.md:35-43`.
- **The four known-violation modules are registered exceptions, not new findings** — `pulls/routes.ts`, `polling/routes.ts`, `settings/routes.ts`, `workspace/routes.ts`, plus `repos/helpers.ts` — source: `.claude/skills/onion-architecture/SKILL.md:275-296`.
- **`@devdigest/shared` is the one contract source, but the propagation mechanism is a physical copy, not an alias** — source: `.claude/skills/pr-self-review/repo-rules.md:116-123` and `.github/workflows/client.yml:6-11`, which explicitly overrides the "propagates by alias" wording at `CLAUDE.md:104-106`. Any OQ-2 option (b) work must edit **both** copies.
- **Verbatim test commands only** — `pnpm exec vitest run …`, never `pnpm test:unit`, because `server/package.json` is `skip-worktree` — source: `TESTING.md:83-86`, `CLAUDE.md:124-126`, applied at `.claude/agents/implementer.md:88-94`.
- **`typecheck` is the only enforced static-analysis gate; there is no linter anywhere** — source: `CLAUDE.md:43-44`.
- **Vendored skill files are not edited by this change** — `.claude/skills/**` is vendored upstream code, excluded from review and pinned by `skills-lock.json` — source: `.claude/skills/pr-self-review/SKILL.md:126-128`, `CLAUDE.md:55-58`. Every rule the new agents need that a vendored skill lacks goes in the **agent prompt**, never as an edit to a `SKILL.md`.

## Skills each new agent will preload or route to

**Template adaptation, stated explicitly:** the normal *Skills the implementer
will apply* table asks which skills route to each **file being edited**. That
table would be empty and useless here — every file this plan touches is under
`.claude/agents/`, which `.claude/skills/pr-self-review/routing.md:50-58`
assigns to **no lane** (the Mermaid exception at `routing.md:57-58` does not
apply: none of these files contains a Mermaid block). The table below therefore
replaces it with the design-relevant question: which skills each **new agent**
will load at runtime, and by which mechanism. The literal per-file lookup is
recorded in the short table underneath it, for the quality-bar check.

### Runtime skill access, per new agent

| New agent | Skills it needs | Mechanism (default) | Mechanism if OQ-1 resolves "`skills:` supported" | Grounding |
|---|---|---|---|---|
| `test-writer` | `react-testing-library` for `client/**` test files; `fastify-best-practices` (specifically `rules/testing.md`) for `server/**` test files | `Skill` on demand, driven by an **agent-local** table in the prompt that extends `routing.md` | `skills: react-testing-library` preloaded; `fastify-best-practices` still on demand via `Skill` | `routing.md:42` maps `client/**/*.test.tsx` → `react-testing-library`; `routing.md:25` maps `server/test/**` and `server/**/*.test.ts` → **none**, so the server side is a documented gap the prompt must close itself. `.claude/skills/fastify-best-practices/rules/testing.md` exists and is indexed at that skill's `SKILL.md:55` |
| `architecture-reviewer` | `onion-architecture` — exactly one, never any other | `tools: … Skill` + a hard prose rule: "load `onion-architecture` and nothing else" | `skills: onion-architecture` **and `Skill` omitted from `tools:`** — physically prevents reaching for an unrelated skill mid-review | `.claude/skills/onion-architecture/SKILL.md:35-43` is the whole rule set; scope-narrowing precedent at `.claude/skills/pr-self-review/SKILL.md:140-142` ("A lane sees only the files that routed to it… do not widen a lane because the diff is small") |
| `plan-verifier` | Whatever the plan under verification names; `pr-self-review`'s severity/grounding rules as shared vocabulary | `Skill` on demand, per the plan's own *Skills the implementer will apply* table | unchanged — the set is plan-dependent, not identity-bound, so preloading is wrong here | Same reasoning `.claude/agents/README.md:100` already gives for `planner`/`implementer` not preloading |
| `doc-writer` | `mermaid-diagram` when a diagram is warranted; `engineering-insights` when the material belongs in an `INSIGHTS.md` | `Skill` on demand | unchanged — both are conditional on the material, not on the agent | `.claude/skills/mermaid-diagram/SKILL.md:24-30`; `CLAUDE.md:64-72` requires the `engineering-insights` skill for INSIGHTS writes |

### Per-file routing lookup (the literal template check)

| Path to be touched | Lane per `routing.md` | Skills |
|---|---|---|
| `.claude/agents/test-writer.md` (new) | **No lane** — `.claude/**` (`routing.md:52-55`) | none; `repo-rules.md` only. No Mermaid block, so the `routing.md:57-58` exception does not apply |
| `.claude/agents/architecture-reviewer.md` (new) | **No lane** — same | none |
| `.claude/agents/plan-verifier.md` (new) | **No lane** — same | none |
| `.claude/agents/doc-writer.md` (new) | **No lane** — same | none |
| `.claude/agents/README.md` (edit) | **No lane** — `.claude/**` *and* `*.md` (`routing.md:52-55`) | none |
| `server/src/vendor/shared/contracts/findings.ts` (edit — **conditional, Step 8 only**) | `routing.md:23` + worked example `routing.md:85` | `zod`, plus `RULE-CONTRACT-SYNC` and `RULE-CONTRACT-BREAK` |
| `client/src/vendor/shared/contracts/findings.ts` (edit — **conditional, Step 8 only**) | `routing.md:44` | **none** — vendored; `RULE-VENDOR` and `RULE-CONTRACT-SYNC` |

## Steps

### Step 1 — Decide the `skills:` frontmatter question before writing any frontmatter

- **Files:** none — read-only gate. Writes nothing.
- **Change:** Establish whether the `skills:` frontmatter field is supported by the Claude Code version in use, because Steps 2 and 3 have two different frontmatter shapes depending on the answer. Try, in order: (1) `claude --version`, compared against the `skills:` field's documented availability on [Subagents](https://code.claude.com/docs/en/sub-agents); (2) `grep -rn "^skills:" ~/.claude/agents/ .claude/agents/ 2>/dev/null` to see whether any agent on this machine already uses it. If neither settles it, **take the documented default below and stop** — do not experiment by writing a file and watching for a startup warning.
- **Constraint:** `.claude/agents/README.md:113-116` sets the precedent for exactly this situation: extended frontmatter fields "exist in current docs but are version-gated; the CLI version in this environment wasn't verifiable, so neither agent uses them." Apply the same conservatism.
- **Default when unresolved (this is the shape to write):** omit `skills:` entirely. `test-writer` gets `Skill` in `tools:` plus an agent-local routing table in its prompt; `architecture-reviewer` gets `Skill` in `tools:` plus a hard prose rule naming `onion-architecture` as the only skill it may load.
- **Done when:** the report states, in one line, which frontmatter shape was chosen for Steps 2 and 3 and on what evidence — a `claude --version` output, an existing `skills:` usage, or "unresolved, took the documented default."

---

### Group A — `test-writer`

### Step 2 — Create `.claude/agents/test-writer.md`

- **Files:** `.claude/agents/test-writer.md` (new)
- **Change:** A subagent definition with this frontmatter (the `skills:` line present only if Step 1 resolved "supported"):

  ```yaml
  ---
  name: test-writer
  description: >
    Writes tests for existing client/ (@devdigest/web) and server/ (@devdigest/api)
    code — and for reviewer-core/ — then runs them with the verbatim commands from
    TESTING.md and fixes its own failures. Use for "write tests for", "add a test
    covering", "this has no test". It tests behaviour at the seams, mocks the
    outside world, and does NOT change the code under test to make a test pass,
    chase coverage percentages, write e2e browser flows, or review architecture or
    security — those are separate agents.
  tools: Read, Grep, Glob, Edit, Write, Bash, Skill
  model: opus
  ---
  ```

  The prompt body must contain these sections, in this order:
  1. **Hard constraints** — (a) *Never modify the code under test.* If the only way to make a test pass is to change the implementation, that is a **finding to report, not a fix to apply** — either the behaviour is wrong or the test is wrong, and both are handed back. (b) Never hand-edit a migration or a lockfile (`CLAUDE.md:142-153`). (c) Never `git add -A` — an untracked `openrouter-api-key` sits at the repo root and is not in `.gitignore` (`CLAUDE.md:133-134`). (d) Never commit or open a PR. (e) Never spawn other agents. (f) No `WebSearch`/`WebFetch` — it has neither; a step needing external research is a stop condition.
  2. **Step 0 — is the target concrete?** Needs a named file, module, component, or behaviour. "Add tests to the client" gets 2–4 clarifying questions and a stop, mirroring `.claude/agents/planner.md:39-56`.
  3. **Method — typological, not exhaustive.** Quote the repo's own rule: cover the *kinds* of breakage in that layer, "one happy path plus the edge that actually matters per workflow", skip the rest (`TESTING.md:8-24`, `CLAUDE.md:113-115`). Mock the outside world via `server/src/adapters/mocks.ts` (`TESTING.md:16-18`). Client tests mock `fetch` at the `src/lib/hooks/*` seam, never inside a component (`client/CLAUDE.md:48-49`).
  4. **Skill selection, per target file** — an agent-local table, because `routing.md` does not cover the server side: `client/**/*.test.tsx`, `client/src/test/**` → `react-testing-library` (this one *is* in `routing.md:42`); `server/test/**`, `server/**/*.test.ts` → **`routing.md:25` assigns no lane, so load `fastify-best-practices` and read its `rules/testing.md`** for route tests via `inject()`; `reviewer-core/test/**` → `routing.md:27` assigns no lane and none is needed (a pure engine with a stubbed `LLMProvider`, `reviewer-core/CLAUDE.md:15-16`). State the `routing.md:25` gap in the prompt as the reason this table exists, so a future reader does not "fix" the divergence.
  5. **Where a test file goes** — client: colocated `client/src/app/**/_components/<PascalCase>/<Name>.test.tsx` (`client/CLAUDE.md:21-22`, `:31-33`); server DB-backed: **must** end `.it.test.ts` or the unit/integration split breaks (`TESTING.md:78-82`, `CLAUDE.md:110-112`); server hermetic: anything else under `server/test/`.
  6. **Named anti-patterns — hard constraints, not advice.** Each is a reason to delete and rewrite a test, not to ship it with a caveat: **tautological assertion** (the expected value is computed by calling the function under test) — [Autonoma AI, "Useless Unit Tests"](https://getautonoma.com/blog/useless-unit-tests-tautological-anti-pattern) (secondary); **Mockery** (so much mocked that only the mocks are exercised), **The Line Hitter** (executes lines, asserts nothing meaningful), **The Liar** (name and assertions describe different things) — [Yegor Bugayenko, "Unit Testing Anti-Patterns"](https://www.yegor256.com/2018/12/11/unit-testing-anti-patterns.html) (2018, primary catalog); **testing implementation rather than behaviour** — [Kent C. Dodds](https://kentcdodds.com/blog/write-tests), already quoted in this repo at `.claude/skills/react-testing-library/SKILL.md:12-18`, whose own list adds "never assert on internal state, hook calls, or DOM structure" and "each test must justify its existence."
  7. **Never report a coverage or mutation percentage as evidence of quality.** Coverage and mutation scores are empirically unreliable signals for LLM-written tests, especially against already-buggy code — [Zhao/Zhou/Cohen, arXiv:2607.22880](https://arxiv.org/abs/2607.22880) (2026, primary). Report the *kinds* of breakage now covered, in `TESTING.md:8-24`'s own language. Do not add a coverage tool or flag.
  8. **Verification — run what you wrote.** The verbatim block from `TESTING.md:61-75`, identical to `.claude/agents/implementer.md:88-94`: `cd client && pnpm test && pnpm typecheck`; `cd reviewer-core && npm test && npm run typecheck`; `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `cd server && pnpm exec vitest run .it.test` (needs Docker — say so if unavailable, never skip silently); `cd server && pnpm typecheck`. Always run `typecheck`: it is the only enforced static-analysis gate and there is no linter to run alongside it (`CLAUDE.md:43-44`).
  9. **Stop conditions** — the same test fails twice after two distinct fix attempts; the only fix is to change the code under test; Docker is unavailable and an `.it.test.ts` suite cannot run; the target has no observable behaviour to assert on without reaching into internals.
  10. **Output — final report** — files written, kinds of breakage covered (never a percentage), skills loaded, verbatim command output on failure, tests deliberately not written and why, and a "suspected bugs in the code under test — not fixed" section.
  11. **`## Quality bar before you return`** — closing checklist.
- **Constraint:** `Bash` here is genuinely for running tests, not inspection-only — the one new agent whose `Bash` scope is wider than `researcher`/`planner`. Justify it in the prompt with the verbatim `TESTING.md` command list so the scope reads as a named allowlist, not open-ended. External support for pairing writing with running is Anthropic's own worked example on [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) ("write tests… run the test suite and fix any failures") — **note in the prompt or the README sources table that no Anthropic source names a "test-writer" role directly; this is an inference from an adjacent example.**
- **Done when:** the file exists; frontmatter has exactly the four fields (plus `skills:` only if Step 1 said so); `Agent` is absent from `tools:`; all eleven sections are present; the closing heading is exactly `## Quality bar before you return`; every relative link resolves (Step 9 check 6); `e2e/` is explicitly named out of scope.

---

### Group B — `architecture-reviewer`

### Step 3 — Create `.claude/agents/architecture-reviewer.md`

- **Files:** `.claude/agents/architecture-reviewer.md` (new)
- **Change:** A **physically read-only** subagent definition:

  ```yaml
  ---
  name: architecture-reviewer
  description: >
    Checks a backend diff against the onion-architecture boundaries this repo
    enforces — routes vs service vs repository, ports vs adapters, what may touch
    Drizzle or Fastify, reviewer-core's purity — and returns findings with a
    file:line citation each. Use for "review the layering", "does this break the
    dependency rule", "architecture review of this diff". It is read-only and
    single-concern: it does NOT review correctness, security, tests, naming,
    React/Next code, or performance, does not fix what it finds, and does not open
    PRs.
  tools: Read, Grep, Glob, Bash
  model: opus
  ---
  ```

  If Step 1 resolved "`skills:` supported", add `skills: onion-architecture` and **keep `Skill` out of `tools:`** — that combination physically prevents the agent reaching for an unrelated skill mid-review, which is stronger than a prose instruction. If Step 1 was unresolved, `tools:` becomes `Read, Grep, Glob, Bash, Skill` and the prompt carries the rule instead: *load `onion-architecture` and no other skill; if a finding seems to need another skill, it is out of scope by definition.* The prompt body must contain:
  1. **Hard constraints** — read-only: no `Write`, no `Edit`, and no working around it (no `Bash` redirection `>`/`>>`/`tee`, no `sed -i`, no `patch`, no `git commit`/`checkout`/`stash`/`apply`, no installs, no migrations, no `docker compose`), copied in shape from `.claude/agents/researcher.md:28-33`. Never spawn other agents. Never fix what it finds.
  2. **Single-concern scope statement, expressed as an exclusion list.** *This is not a general code review — it reviews layering and dependency direction only.* Then name what is out of scope and who owns it: correctness bugs (`/code-review`), security (`/security-review` and the `security` skill), test quality (`test-writer`), Fastify authoring details (`fastify-best-practices`), Drizzle query syntax (`drizzle-orm-patterns`), React/Next/frontend placement (the frontend skills), plan conformance (`plan-verifier`). The named-exclusion-list pattern and the line *"Better to miss some theoretical issues than flood the report with false positives"* come from Anthropic's own shipped [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review/blob/main/.claude/commands/security-review.md) command (primary). The adversarial-review framing — *"A reviewer running in a fresh subagent context sees only the diff and the criteria you give it, not the reasoning that produced the change… Tell the reviewer to flag only gaps that affect correctness or the stated requirements, and treat the rest as optional"* — is from [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) (primary).
  3. **Scope of the diff** — the same three-layer file set `pr-self-review` uses, so the two agree on what "the change" means: `git diff --name-status "$BASE"` plus `git ls-files --others --exclude-standard` for untracked files, with `BASE` from `.claude/hooks/pr-self-review-gate.sh --print-base` (`.claude/skills/pr-self-review/SKILL.md:113-124`). Review the *change*, not the file: a pre-existing violation on an untouched line is out of scope; on a touched line it is in scope (`SKILL.md:147-149`).
  4. **Run the machine check first.** `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` — every onion CRITICAL is encoded there (`.claude/skills/onion-architecture/SKILL.md:35-43`). A `depcruise` violation is the highest-confidence finding available; a judgement call that `depcruise` passes is at most a WARNING. Also run `cd server && pnpm typecheck` when the diff touches `server/**` or `reviewer-core/**`, because a diff that does not compile is not reviewable (`.claude/skills/pr-self-review/SKILL.md:81-82`, `:101-103`).
  5. **Known violations are not findings.** `pulls/routes.ts`, `polling/routes.ts`, `settings/routes.ts`, `workspace/routes.ts` and `repos/helpers.ts` predate the rule and are registered exceptions in `server/.dependency-cruiser.cjs`; the exception list is a debt list that should only shrink. Re-reporting them as new is noise. **But** a *new* query added to one of them **is** a finding, and a diff that touches one of them without extracting the queries it touched is a WARNING — the skill's own instruction at `.claude/skills/onion-architecture/SKILL.md:275-296`.
  6. **Grounding is the first-line defence against fabrication** — every finding cites `file:start_line-end_line` intersecting a real changed hunk; a finding that cannot cite one is **dropped, not softened** (`CLAUDE.md:118-120`, `.claude/skills/pr-self-review/SKILL.md:52-54`). Anthropic's own [multi-agent research write-up](https://www.anthropic.com/engineering/multi-agent-research-system) frames citation accuracy as the *primary* anti-fabrication control with confidence tiers as secondary — so state grounding first and confidence second, in that order.
  7. **Confidence — reuse the field that already exists.** `confidence: z.number().min(0).max(1)` is already on `Finding` (`server/src/vendor/shared/contracts/findings.ts:57`) and is currently unpopulated by `pr-self-review`'s payload (`.claude/skills/pr-self-review/SKILL.md:189-201`). Reuse that 0.0–1.0 scale — do **not** invent a new vocabulary such as CONFIRMED/PLAUSIBLE. Adopt a hard floor: **below 0.7, do not report**, matching the shipped [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review/blob/main/.claude/commands/security-review.md) precedent. See OQ-3.
  8. **Severity — the product's own scale, not a new one.** `CRITICAL | WARNING | SUGGESTION` exactly as `server/src/vendor/shared/contracts/findings.ts:11` defines them, with `pr-self-review`'s anti-inflation rule: onion HIGH → WARNING, onion MEDIUM → SUGGESTION, and only a genuine dependency-rule break (or a `Do not touch` violation) is CRITICAL (`.claude/skills/pr-self-review/SKILL.md:65-69`). **"An empty findings list is a good outcome"** must appear in the prompt, quoted from `SKILL.md:69`.
  9. **`category`** — see OQ-2. Until a human resolves it, emit `style`, the choice `pr-self-review` already makes for layering findings (`.claude/skills/pr-self-review/SKILL.md:205-207`), and state in the prompt that `FindingCategory` has no `architecture` value (`findings.ts:14`) so nobody "fixes" it by inventing one.
  10. **Never compute a score or a verdict.** Hand back findings; `write-verdict.js` is the only thing that computes a score, for the documented reason that a model which can miscount CRITICALs must not also decide whether the PR is blocked (`.claude/skills/pr-self-review/SKILL.md:162-167`). This agent does **not** write `verdict.json` and does not touch `.claude/.cache/`.
  11. **Output — final report** — a findings table (`Severity | Confidence | Category | file:lines | Rule (§ of onion SKILL.md) | Rationale`), the `depcruise`/`typecheck` results verbatim, files reviewed, **files that were in the diff but outside this agent's single concern, listed by path** so the caller knows what was *not* reviewed (mirroring `uncovered_files` at `.claude/skills/pr-self-review/SKILL.md:150-152`), and an explicit "no findings" line when there are none.
  12. **`## Quality bar before you return`.**
- **Constraint:** `tools: Read, Grep, Glob, Bash` with no `Write`/`Edit`/`Agent` is the literal frontmatter from Anthropic's own worked read-only-reviewer example on [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices); the repo-side precedent is `.claude/agents/researcher.md:14`. `Bash` must be described in the prompt as inspection-plus-`depcruise`/`typecheck` only.
- **Done when:** the file exists; `tools:` contains no `Write`, no `Edit`, no `Agent`; the single-concern statement and its named exclusion list are both present; the `depcruise` command appears verbatim; the five known-violation paths are named; the 0.7 confidence floor is stated; `category: style` with the OQ-2 note is stated; "an empty findings list is a good outcome" appears; the closing `## Quality bar before you return` is present.

---

### Group C — `plan-verifier`

### Step 4 — Create `.claude/agents/plan-verifier.md`

- **Files:** `.claude/agents/plan-verifier.md` (new)
- **Change:** A read-only subagent definition:

  ```yaml
  ---
  name: plan-verifier
  description: >
    Reconciles finished code against a specific Development Plan file under
    docs/plans/ and the original requirements — step by step, including each
    step's own "Done when", the plan's Contract changes / Migration / Test plan
    fields, and whether anything outside the plan's scope changed. Use for "verify
    the plan was implemented", "check the diff against docs/plans/X.plan.md", "did
    step N actually land". It re-runs the plan's test commands rather than trusting
    the implementer's report, and it reports gaps, NOT style preferences, general
    code-quality advice, architecture review, or fixes.
  tools: Read, Grep, Glob, Bash, Skill
  model: opus
  ---
  ```

  The prompt body must contain:
  1. **Hard constraints** — read-only, with the same no-workaround list as `.claude/agents/researcher.md:28-33`. Never fix a gap it finds. Never commit. Never spawn other agents. It has no `WebSearch`/`WebFetch`.
  2. **Step 0 — do you have a plan?** It needs an actual plan file path and, ideally, the original request. With no plan path it asks for one and stops — the same gate as `.claude/agents/implementer.md:44-47`. It must read the plan **in full before looking at the diff**, so the criteria are fixed before the evidence is seen (the adversarial-review point in [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices): the reviewer sees the diff and the criteria, not the reasoning that produced the change).
  3. **Scope discipline — the section that keeps it out of code review.** A finding counts **only** if it traces to one of: a named plan Step, that step's `Files` / `Change` / `Constraint` / `Done when`, the plan's `Contract changes` / `Migration` / `Test plan` fields, or an explicit original requirement. Everything else goes into a separate **"Observed, out of scope"** list and never into the verdict. Quote the doc's own worked example as the basis — *"Use a subagent to review the rate limiter diff against PLAN.md. Check that every requirement is implemented, the listed edge cases have tests, and nothing outside the task's scope changed. Report gaps, not style preferences"* — and its fix for reviewer scope creep — *"Tell the reviewer to flag only gaps that affect correctness or the stated requirements, and treat the rest as optional"* — both [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) (primary).
  4. **The closed status set, per step** — exactly these five, no others, no invented middle ground: `Done as planned` · `Done, deviated (justified)` · `Done, deviated (unjustified/undisclosed)` · `Not done` · `Can't verify`. `Can't verify` is a legitimate answer and must be used rather than guessed past; it names what would settle it.
  5. **Each step's own `Done when` is the acceptance test.** `.claude/agents/planner.md:143` makes `Done when` a per-step checkable condition — functionally a Definition of Done at step granularity ([2020 Scrum Guide](https://scrumguides.org/scrum-guide.html), primary). Check that condition, not a general impression of the step.
  6. **Adjudicate deviations, don't just count them.** `.claude/agents/implementer.md:137-139` produces a `Step | Plan said | I did | Why` table. For each row, check the `Why` against that step's `Constraint` field in the plan — a reason was *given* is not the same as a reason that *holds*. A deviation whose stated reason contradicts the step's own constraint is `Done, deviated (unjustified/undisclosed)`. **Label this rule in the prompt as an inference of this repo's own making, not something an external source prescribes.**
  7. **Re-run, don't re-read.** Execute the plan's `Test plan` commands and the verbatim `TESTING.md` block for every package the plan touched (`TESTING.md:61-75`, identical to `.claude/agents/implementer.md:88-94`), plus `typecheck` for each — `typecheck` being the only enforced static-analysis gate (`CLAUDE.md:43-44`). The justification to state in the prompt: *"Have Claude show evidence rather than asserting success… a fresh model try to refute the result, so the agent doing the work isn't the one grading it"* — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices). If Docker is unavailable, the `.it.test.ts` lane is `Can't verify`, never silently skipped.
  8. **Check the plan's own contract fields against reality** — if the plan says `Migration: none` but `server/src/db/schema/*` changed, that is a finding; if it says `Contract change: none` but `server/src/vendor/shared/contracts/**` changed, that is a finding, and the two `vendor/shared` copies must still be identical (`diff -r client/src/vendor/shared server/src/vendor/shared`, `.claude/skills/pr-self-review/repo-rules.md:116-123`). A hand-written rather than generated migration is a `Do not touch` violation (`CLAUDE.md:142-146`).
  9. **Severity and grounding — reuse, reaxis.** Reuse `CRITICAL | WARNING | SUGGESTION` and the grounding rule from `.claude/skills/pr-self-review/SKILL.md:48-69`, but the axis is **plan conformance, not code quality**: a missing planned step is CRITICAL; an undisclosed deviation is CRITICAL; a disclosed-but-thin justification is a WARNING; a cosmetic difference from the plan's wording is a SUGGESTION at most. Every finding cites `file:line` **and** a plan Step number.
  10. **Output — the per-step traceability table plus computed counts.** One row per plan step (`Step | Status | Evidence (file:line / command output) | Note`) — a requirements-traceability-matrix shape ([NIST CSRC glossary, "traceability matrix"](https://csrc.nist.gov/glossary/term/traceability_matrix)) — then a summary line whose counts are **derived from the table, not asserted**, mirroring how `write-verdict.js` computes `pr-self-review`'s score rather than trusting the model (`.claude/skills/pr-self-review/SKILL.md:55-58`, `:162-167`). Then `Observed, out of scope`, then `Couldn't verify — and what would settle it`.
  11. **`## Quality bar before you return`** — must include "every row's status is one of the five; no row is blank" and "the summary counts add up to the number of steps in the plan."

  Add one short **Naming note** near the top of the file: root `README.md:87` lists a *product* feature also called "Plan Verifier" in the L06 lesson row — a DevDigest app feature students build in `client/`/`server/`. It is unrelated to this dev-tooling subagent. Do not conflate them; this agent never touches that feature's code.
- **Constraint:** `tools: Read, Grep, Glob, Bash, Skill` with no `Edit`/`Write`/`Agent` — the read-only reviewer shape from [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) ("a reviewer that should stay read-only… omit `Agent` from its tools list"), with the repo precedent at `.claude/agents/researcher.md:14`.
- **Done when:** the file exists; `tools:` has no `Write`/`Edit`/`Agent`; the five-status set appears verbatim and no sixth status is used anywhere; the per-step table and the "counts computed from the table" rule are both present; "Observed, out of scope" exists as a separate section from the verdict; the `README.md:87` naming note is present; the closing `## Quality bar before you return` is present.

---

### Group D — `doc-writer`

### Step 5 — Create `.claude/agents/doc-writer.md`

- **Files:** `.claude/agents/doc-writer.md` (new)
- **Change:** A subagent definition:

  ```yaml
  ---
  name: doc-writer
  description: >
    Documents work that already exists — turns a Development Plan, a finished
    diff, or a described feature into a doc in the right place: <pkg>/specs/ for a
    package feature spec, <pkg>/docs/ for a deeper design note, docs/specs/ for a
    cross-package feature, <pkg>/README.md for "what this package looks like now".
    Use for "document this feature", "write up what we built", "turn this plan into
    a spec", "add a diagram for this flow". It writes and edits Markdown only, and
    does NOT write product code, invent behaviour it has not read, write directly
    to any INSIGHTS.md (that is the engineering-insights skill), or touch
    .claude/skills/** (vendored upstream).
  tools: Read, Grep, Glob, Bash, Write, Edit, Skill
  model: opus
  ---
  ```

  The prompt body must contain:
  1. **Hard constraints, with the write scope stated in prose.** `Write` and `Edit` are scoped to Markdown under `docs/`, `<pkg>/docs/`, `<pkg>/specs/`, and `<pkg>/README.md` / root `README.md` — never to `client/`, `server/`, `reviewer-core/`, `e2e/` source, config, schema, or a lockfile; never to `.claude/skills/**` (vendored upstream, pinned by `skills-lock.json`, `CLAUDE.md:55-58`); never to any `INSIGHTS.md` directly. **State explicitly that this scoping is a prose constraint, exactly as `.claude/agents/planner.md:24-26` scopes its own `Write` to `docs/plans/`, because no frontmatter field scopes a write tool to a subdirectory** ([Configure permissions](https://code.claude.com/docs/en/permissions)). Also: never commit, never open a PR, never spawn other agents.
  2. **Why `Edit` and not just `Write`** — updating an existing `README.md`/`docs/` file is in scope, unlike `planner`, which only ever creates one new file (`.claude/agents/planner.md:19-20`).
  3. **Step 0 — is the material real?** It documents what exists. It needs a plan file path, a diff, a named feature, or files to read. If the material is thin enough that the doc would be invention, it asks 2–4 questions and stops (`.claude/agents/planner.md:39-56` shape). **Never document behaviour it has not read in code, a test, or a plan** — an undocumented gap is a line in the doc saying so, not a guess.
  4. **Placement table — the decision it must get right**, grounded in this repo's own layout rather than external advice:

     | Material | Destination | Grounding |
     |---|---|---|
     | Package-scoped feature / API spec, acceptance criteria | `<pkg>/specs/<feature>.md` | `server/specs/README.md:3-4`, `client/specs/README.md:3-4`, `reviewer-core/specs/README.md:3-4` — "One file per feature or lesson" |
     | Package-scoped deep design / architecture note | `<pkg>/docs/<topic>.md` | `server/docs/README.md:3-5`, `client/docs/README.md:3-5`, `reviewer-core/docs/README.md:3-5`, `e2e/docs/README.md:3-5` — "Add one file per topic" |
     | Cross-package feature spec | `docs/specs/<feature>.md` | `docs/specs/conventions.md:1-3` is exactly this: one spec whose `Scope:` line names `server/` + `client/` + shared contracts |
     | "What does this package look like now" — route map, API map, commands | `<pkg>/README.md` (edit) | `CLAUDE.md:59-61` — "Per package: `README.md` (diagrams/maps)" |
     | Reviewer-prompt documentation | `docs/agent-prompts/` | `CLAUDE.md:51-53`; conventions in `docs/agent-prompts/README.md` |
     | A non-obvious operational finding | the owning package's `INSIGHTS.md` — **invoke the `engineering-insights` skill, do not write the file directly** | `CLAUDE.md:64-72`; root `INSIGHTS.md:1-12` sets the 15-entry × 2-line budget and says `.claude/` findings belong at root |

     **`e2e/specs/` is the exception:** it holds `NN-name.flow.json` agent-browser batch files, not Markdown specs (`e2e/CLAUDE.md:19`, `:33-34`). An e2e write-up goes in `e2e/docs/`, never `e2e/specs/`.
  5. **Whether to diagram — the upstream decision `mermaid-diagram` does not make.** `.claude/skills/mermaid-diagram/SKILL.md:24-30` is a *type* chooser (flowchart vs sequence vs ER vs state); it has no "should there be a diagram at all" section. So this agent decides first: diagram a flow, a state machine, a schema/data model, or a multi-service fan-out; **skip** linear step lists, skip anything prose already says as well, and cap at **one diagram per doc** unless the subject is genuinely multi-subsystem ([Google technical writing style guide — illustrations](https://developers.google.com/tech-writing/two/illustrations), primary; [Mintlify, "When and how to use diagrams"](https://www.mintlify.com/library/when-and-how-to-use-diagrams), secondary, corroborating). Only after deciding *yes* does it load `mermaid-diagram` for the type.
  6. **Use Mermaid, not ASCII art.** This repo contains both: Mermaid at `README.md:27`, `server/README.md:33` and `:64`, `reviewer-core/README.md:16`, `client/README.md:24`, `server/src/modules/repo-intel/README.md:16`; ASCII art at `docs/specs/conventions.md:13-20`. **Follow the Mermaid convention going forward and say so in the prompt**, so the ASCII precedent is not read as permission. A `.md` that adds a Mermaid block is the one documentation path that *does* have a review lane (`.claude/skills/pr-self-review/routing.md:57-58`) — a reason to keep the block valid and small.
  7. **Anti-patterns, as hard rules.** (a) **Explain mechanism and consequence; never restate a diff, a type signature, or a field list in prose** — the in-repo precedent is `docs/agent-prompts/README.md:71` ("Do not describe the JSON shape, field names, or a markdown layout in the prompt") and its checklist item at `:141`; `docs/specs/conventions.md:26-34` shows the target shape, a `Decision | Consequence` table. (b) **Link to `CLAUDE.md` / `INSIGHTS.md` / a `SKILL.md` instead of duplicating them** — a copied rule is a rule that will go stale; Anthropic's own CLAUDE.md guidance on [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) makes the same call for "detailed API documentation — link to docs instead." (c) No changelog-as-documentation: the doc describes the state now, not the sequence of commits that got there. (d) Don't create a new top-level docs directory; the layout in `CLAUDE.md:49-62` is the whole map.
  8. **Register the new file.** A new file under `<pkg>/docs/` or `<pkg>/specs/` sits in a directory whose own `README.md` says "one file per topic/feature" — check whether that `README.md` or the package `README.md` should link to it, and if so, `Edit` it in the same pass. An orphan doc nobody links to is a half-done job.
  9. **Output — final report**: the path(s) written or edited, why that location won per the placement table, whether a diagram was added and the one-line reason, and what was deliberately left undocumented. The file is the deliverable; the report is a path plus a short summary, mirroring `.claude/agents/planner.md:170-174`.
  10. **`## Quality bar before you return`** — must include "every claim in the doc traces to a file, a test, or the plan", "no rule was copied out of `CLAUDE.md`/`INSIGHTS.md` instead of linked", "at most one diagram unless multi-subsystem", and "nothing outside Markdown was written".
- **Constraint:** `Write` is present but prose-scoped — the honest mechanism, since no frontmatter field restricts it by directory ([Configure permissions](https://code.claude.com/docs/en/permissions)). **Do not add a `settings.json` permission rule as part of this step** (see Risks): if one is ever added for defence-in-depth it must be written `Edit(docs/**)` — Claude Code accepts a `Write(...)` path rule but never consults it and warns at startup instead.
- **Done when:** the file exists; the placement table has all six rows plus the `e2e/specs/` exception; the whether-to-diagram rule appears *above* any reference to `mermaid-diagram`; the Mermaid-over-ASCII choice is stated with both in-repo citations; the prose-scoping of `Write`/`Edit` is stated as prose scoping, not implied; `INSIGHTS.md` is routed through the `engineering-insights` skill; the closing `## Quality bar before you return` is present.

---

### Group E — register the four agents

### Step 6 — Update the catalog and per-agent sections in `.claude/agents/README.md`

- **Files:** `.claude/agents/README.md` (edit)
- **Change:** Three edits to the existing structure — do not restructure the file:
  1. Append four rows to the catalog table at `.claude/agents/README.md:10-14`, in the same `Agent | Responsibility | Tools | Model` shape, with the `tools:` strings matching Steps 2–5 **exactly** (a divergence between the table and the file is the most likely stale-doc failure here).
  2. **Rewrite the paragraph at `.claude/agents/README.md:16-19.`** It currently reads "None of the three has `Agent` in its tool list" and "Architecture review, security review, and PR creation are deliberately **not** covered by any agent here." Both clauses are now wrong: there are seven agents, and architecture review *is* covered. The replacement must keep the two facts that remain true — no agent has `Agent` in its tools, and `pr-self-review` (a skill, not an agent) still gates `gh pr create` via `.claude/hooks/pr-self-review-gate.sh` — while stating that **security review and PR creation** remain uncovered by any agent, and that `architecture-reviewer` covers layering **only**, not security or general correctness.
  3. Add four `### <agent>` subsections under `## Responsibilities, permissions, artifacts` (after `### implementer`, which ends at `.claude/agents/README.md:72`), each with the existing five bullets: **Does / Does not / Permissions / Input / Output**.

  Also add one short subsection after `## Handoff: planner → implementer` (`:74-81`) covering the two new file-based handoffs this change creates: `planner` → `plan-verifier` (both read the same plan file path; `plan-verifier` never receives the plan as pasted text, for the zero-shared-context reason already stated at `:74-81`) and `planner`/`implementer` → `doc-writer` (a plan path or a diff, never a chat summary).
- **Constraint:** The README is the map of the set (`.claude/agents/README.md:4-7`); a row that disagrees with the agent file it points at is worse than no row. Copy `tools:` strings mechanically from the files written in Steps 2–5.
- **Done when:** the catalog table has seven rows; every `Tools` cell string-matches its file's `tools:` line character for character; the `:16-19` paragraph no longer says "three" or claims architecture review is uncovered; seven `###` subsections exist under `## Responsibilities, permissions, artifacts`; the new handoff subsection names both new handoffs.

### Step 7 — Append the new sources to the grounding table in `.claude/agents/README.md`

- **Files:** `.claude/agents/README.md` (edit)
- **Change:** Append rows to the `Source | Rule | Where applied` table at `.claude/agents/README.md:90-107`, one per external and in-repo rule the four new agents introduce, in the existing style (link, the rule in one clause, where it landed). At minimum: the adversarial-review pattern, the read-only-reviewer frontmatter, and the "show evidence rather than asserting success" line, all [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices); the plan-vs-PLAN.md worked example and the "flag only gaps that affect correctness or the stated requirements" scope fix, same page; the write-tests-and-run-them loop, same page, **labelled as an inference — no Anthropic source names a "test-writer" role**; the confidence-floor + single-concern-with-exclusion-list + "better to miss some theoretical issues" precedent, [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review/blob/main/.claude/commands/security-review.md); citation-grounding as the primary anti-fabrication control, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system); `skills:` preloading vs the `Skill` tool as independent mechanisms, [Subagents](https://code.claude.com/docs/en/sub-agents); no frontmatter field scopes `Write`/`Edit` by directory, plus the `Edit(...)`-not-`Write(...)` path-rule trap, [Configure permissions](https://code.claude.com/docs/en/permissions); the test anti-pattern catalogues ([Bugayenko](https://www.yegor256.com/2018/12/11/unit-testing-anti-patterns.html), [Autonoma](https://getautonoma.com/blog/useless-unit-tests-tautological-anti-pattern) — mark secondary, [Kent C. Dodds](https://kentcdodds.com/blog/write-tests)); coverage/mutation unreliability for LLM-written tests ([arXiv:2607.22880](https://arxiv.org/abs/2607.22880)); the traceability-matrix shape ([NIST CSRC](https://csrc.nist.gov/glossary/term/traceability_matrix)); Definition of Done at step granularity ([2020 Scrum Guide](https://scrumguides.org/scrum-guide.html)); whether-to-diagram ([Google technical writing](https://developers.google.com/tech-writing/two/illustrations), [Mintlify](https://www.mintlify.com/library/when-and-how-to-use-diagrams) — mark secondary). Add in-repo rows for `routing.md:25`'s no-lane-for-server-tests gap and `repo-rules.md:116-123`'s physical-copy correction to `CLAUDE.md:104-106`.

  Then extend the "not adopted, called out rather than silently skipped" list at `.claude/agents/README.md:109-120` with: the `skills:` frontmatter field (OQ-1) and, if OQ-2 is still unresolved, the `FindingCategory` question.
- **Constraint:** Preserve that table's existing convention of marking primary vs secondary sources and labelling inferences as inferences (`.claude/agents/README.md:109-120` is the precedent for the negative list). All research behind these rows is dated 2026-09-23 — state it once, as `:86-87` already does for the earlier run.
- **Done when:** every external URL cited anywhere in Steps 2–5 appears exactly once in the README table; each secondary source is marked secondary; the two agent-prompt claims that are inferences (the `test-writer` `Bash` rationale, the `plan-verifier` deviation-adjudication rule) are labelled as inferences in the table; the unadopted list names OQ-1.

### Step 8 — **CONDITIONAL — DO NOT EXECUTE** unless a human resolves OQ-2 as option (b)

- **Files:** `server/src/vendor/shared/contracts/findings.ts` (edit) **and** `client/src/vendor/shared/contracts/findings.ts` (edit)
- **Change:** Add `'architecture'` to the `FindingCategory` enum at `server/src/vendor/shared/contracts/findings.ts:14`, then copy the file over its physical twin at `client/src/vendor/shared/contracts/findings.ts` so the two directories stay byte-identical. Then update `architecture-reviewer.md`'s `category` rule (Step 3, item 9). **Note that updating `.claude/skills/pr-self-review/SKILL.md:205-207`'s payload documentation to match is itself blocked by the vendored-skill rule (`CLAUDE.md:55-58`) — part of why option (a) is the cheaper default.**
- **Constraint:** `client/src/vendor/shared` is a **physical copy**, not an alias — `RULE-CONTRACT-SYNC` is CRITICAL and `client.yml` fails the build on drift before it installs anything (`.claude/skills/pr-self-review/repo-rules.md:116-123`; `.github/workflows/client.yml:6-11`, which says root `CLAUDE.md`'s "propagates by alias" wording "describes the intent, not the current mechanism"). Adding an enum *value* is additive, so `RULE-CONTRACT-BREAK` (removal/rename/required, `repo-rules.md:126-135`) does not fire. No migration is implied: `FindingCategory` is a Zod enum in a contract file, not a Drizzle column — confirm with `grep -rn "category" server/src/db/schema/` before assuming, and if a DB column turns out to constrain it, **stop and hand back** rather than generating a migration off-plan.
- **Done when:** this step is either (i) untouched, with the report stating "OQ-2 unresolved, Step 8 not executed, `architecture-reviewer` emits `category: style`" — the expected outcome — or (ii) executed, with `diff -r client/src/vendor/shared server/src/vendor/shared` producing no output and all four typechecks passing.

### Step 9 — Verify (deterministic checks only — no test suite covers `.claude/**`)

- **Files:** none — verification only.
- **Change:** Run these from the repo root. **State in the report that `TESTING.md:27-33`'s suite map has no row for `.claude/**`, and that no workflow under `.github/workflows/` references `.claude` — a `.claude/**`-only change triggers zero CI jobs.** These checks exist because nothing else will catch a broken agent file.

  ```sh
  # 1. All seven agent files present
  ls .claude/agents/

  # 2. Frontmatter — exactly name/description/tools/model (+ skills only if Step 1 allowed it)
  for f in .claude/agents/{test-writer,architecture-reviewer,plan-verifier,doc-writer}.md; do
    echo "== $f"; sed -n '1,16p' "$f"
  done

  # 3. `Agent` must not appear in any tools: line  -> expect NO output
  grep -n '^tools:' .claude/agents/*.md | grep -i agent

  # 4. architecture-reviewer and plan-verifier must be read-only -> expect NO output
  grep -n '^tools:' .claude/agents/{architecture-reviewer,plan-verifier}.md | grep -E 'Write|Edit'

  # 5. Every agent prompt ends with the house self-check -> expect 7
  grep -l '^## Quality bar before you return' .claude/agents/*.md | wc -l

  # 6. Every relative link resolves -> expect NO "BROKEN:" line
  cd .claude/agents && grep -ohE '\]\([^)#]+' *.md | sed 's/.*](//' \
    | grep -v '^http' | sort -u \
    | while read -r p; do [ -e "$p" ] || echo "BROKEN: $p"; done
  ```

  Run nothing else **unless Step 8 executed**, in which case also run, from the repo root: `diff -r client/src/vendor/shared server/src/vendor/shared`; then `cd server && pnpm typecheck`; `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs`; `cd client && pnpm typecheck`; `cd reviewer-core && npm run typecheck` — the phase-0 rows `.claude/skills/pr-self-review/SKILL.md:78-85` triggers for a `vendor/shared` change.
- **Constraint:** `typecheck` is the only enforced static-analysis gate and there is no linter anywhere (`CLAUDE.md:43-44`) — but it checks TypeScript, and this change is Markdown, so it does not apply unless Step 8 ran. Do not invent a Markdown linter or add a dependency to get one.
- **Done when:** checks 1–6 all give their expected results and the report quotes the actual output of checks 3, 4, 5 and 6 (not a paraphrase), plus the Step 8 commands' output if Step 8 ran.

## Contract changes

**None, unless the `FindingCategory` extension option is chosen for
`architecture-reviewer` — see Open questions (OQ-2).**

Under the default (option (a)), `architecture-reviewer` emits
`category: "style"`, which is what `pr-self-review` already does for layering
and placement findings (`.claude/skills/pr-self-review/SKILL.md:205-207`), and
no contract file is touched.

Under option (b), the change is: add `'architecture'` to the `z.enum([...])` at
`server/src/vendor/shared/contracts/findings.ts:14`. Propagation is **not by
alias** — `client/src/vendor/shared` is a physical copy of
`server/src/vendor/shared`, and the fix for drift is to copy the file over,
directory for directory (`.claude/skills/pr-self-review/repo-rules.md:116-123`).
`.github/workflows/client.yml:6-11` states this in CI's own words and notes that
root `CLAUDE.md:104-106`'s "propagates by alias" phrasing "describes the intent,
not the current mechanism." A PR touching the server copy alone fails
`RULE-CONTRACT-SYNC` (CRITICAL) and the `client.yml` contract step. Adding an
enum value is additive, so `RULE-CONTRACT-BREAK` does not fire. Step 8 is the
only step that may touch either copy, and it is marked DO NOT EXECUTE.

## Migration

**None.** No step edits `server/src/db/schema/*`, so `pnpm db:generate` is never
run and nothing under `server/src/db/migrations/**` is created or touched —
which is also the only safe state, since every `.sql` file plus
`meta/*_snapshot.json` and `meta/_journal.json` there is generated and
hand-editing one desyncs the journal hash (`CLAUDE.md:142-146`, plus
`server/CLAUDE.md`'s own "Do not touch"). If Step 8 is ever executed, confirm
with `grep -rn "category" server/src/db/schema/` that no Drizzle column
constrains `FindingCategory` before concluding "still no migration"; if one
does, stop and hand back rather than generating a migration off-plan.

## Test plan

**Template adaptation, stated explicitly:** the normal *Test plan* table wants
verbatim commands from `TESTING.md`. `TESTING.md:27-33`'s suite map has **five
rows — `client`, `server-unit`, `server-integration`, `reviewer-core`, `e2e
web` — and none covers `.claude/**`**, and no file under `.github/workflows/`
references `.claude`, so a `.claude/**`-only change runs **zero** existing
suites and **zero** CI jobs. The table below therefore lists the deterministic
checks from Step 9 — adapted, not invented: rows 1–6 are structural greps over
the new files, and the conditional rows *are* verbatim `TESTING.md` /
`pr-self-review` phase-0 commands, applicable only if Step 8 runs.

| Suite | Command | Covers which step |
|---|---|---|
| structural — files exist | `ls .claude/agents/` | 2, 3, 4, 5 |
| structural — frontmatter shape | `for f in .claude/agents/{test-writer,architecture-reviewer,plan-verifier,doc-writer}.md; do echo "== $f"; sed -n '1,16p' "$f"; done` | 1, 2, 3, 4, 5 |
| structural — no `Agent` in any allowlist (expect no output) | `grep -n '^tools:' .claude/agents/*.md \| grep -i agent` | 2, 3, 4, 5 |
| structural — reviewers are read-only (expect no output) | `grep -n '^tools:' .claude/agents/{architecture-reviewer,plan-verifier}.md \| grep -E 'Write\|Edit'` | 3, 4 |
| structural — house self-check present (expect `7`) | `grep -l '^## Quality bar before you return' .claude/agents/*.md \| wc -l` | 2, 3, 4, 5 |
| structural — links resolve (expect no `BROKEN:`) | the `grep -ohE` / `while read` loop in Step 9 check 6, run from `.claude/agents/` | 2, 3, 4, 5, 6, 7 |
| contract sync — **only if Step 8 ran** (expect no output) | `diff -r client/src/vendor/shared server/src/vendor/shared` (repo root) | 8 |
| server unit — **only if Step 8 ran** | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (verbatim, `TESTING.md:67`) | 8 |
| server typecheck + depcruise — **only if Step 8 ran** | `cd server && pnpm typecheck`, then `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` | 8 |
| client — **only if Step 8 ran** | `cd client && pnpm test && pnpm typecheck` (verbatim, `TESTING.md:63`) | 8 |
| reviewer-core — **only if Step 8 ran** | `cd reviewer-core && npm test`, then `npm run typecheck` (verbatim, `TESTING.md:64`) | 8 |

**Behavioural verification is out of this plan's automated reach.** Whether
`architecture-reviewer` actually stays in its lane, or `plan-verifier` actually
refuses to drift into style advice, can only be established by invoking each
agent on a real target. See Risks for the one-time smoke-test sequence.

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| Nothing reviews this change. `routing.md:50-55` gives `.claude/**` and `*.md` no skill lane, `TESTING.md:27-33` has no suite for it, and no workflow path filter mentions `.claude` — the four prompts' own text is the entire quality bar | 2, 3, 4, 5 | Step 9's six structural checks, plus a one-time human smoke test: invoke `architecture-reviewer` on a deliberately layering-breaking scratch diff, `plan-verifier` on this very plan file, `test-writer` on one untested client component, `doc-writer` on one small finished feature |
| `skills:` is unsupported in this environment and a frontmatter field silently degrades the agent (or warns at startup and is ignored) | 1, 2, 3 | Step 1 gates both affected files and the documented default omits `skills:` entirely; the fallback (`Skill` in `tools:` + a prose rule) is fully specified, so the implementer is never blocked. Precedent for this conservatism: `.claude/agents/README.md:113-116` |
| `architecture-reviewer` drifts into general code review — the failure its whole design guards against | 3 | The single-concern statement *plus* a named exclusion list naming the owner of each excluded concern, *plus* (if OQ-1 allows) `Skill` omitted from `tools:` so an unrelated skill is physically unreachable |
| `architecture-reviewer` re-reports the four known-violation modules every run, drowning real findings | 3 | Step 3 item 5 names all five paths and distinguishes "pre-existing, registered exception" from "a *new* query added to one of them", per `.claude/skills/onion-architecture/SKILL.md:275-296` |
| `plan-verifier` substitutes general code-quality advice for plan conformance | 4 | The traceability rule (a finding must trace to a named Step, a step field, a plan contract/migration/test field, or an explicit original requirement) plus a separate "Observed, out of scope" bucket that never enters the verdict |
| `plan-verifier` rubber-stamps the implementer's own claimed verification | 4 | It re-runs the verbatim `TESTING.md` commands rather than reading the implementer's report, and its summary counts are computed from its own table |
| `doc-writer`'s write scope is prose-only, so a mis-parse could write outside `docs/`. No frontmatter field prevents it | 5 | The scope is stated as the first hard constraint with the exact directory list, mirroring `.claude/agents/planner.md:24-26`, which has the same exposure and the same mitigation. **If defence-in-depth is later wanted, the `settings.json` rule must be `Edit(docs/**)` — a `Write(...)` path rule is accepted but never consulted** ([Configure permissions](https://code.claude.com/docs/en/permissions)); adding it is out of scope here because a `settings.json` rule is session-wide, not scoped to one agent |
| `doc-writer` cannot be tested end-to-end against a real plan: `docs/plans/` did not exist before this file, so this plan is the first and only example available | 5 | Sequencing note, not a blocker — use **this** plan file as `doc-writer`'s first smoke-test input, and `plan-verifier`'s too |
| The README catalog drifts from the agent files (a `Tools` cell that no longer matches a `tools:` line) | 6 | Step 6's *Done when* requires character-for-character equality; Step 9 check 2 prints every frontmatter block so the two can be compared on one screen |
| `test-writer` "fixes" a failing test by changing the code under test, producing a green suite over broken behaviour | 2 | Hard constraint 1(a), plus a stop condition, plus a dedicated "suspected bugs in the code under test — not fixed" report section |
| `test-writer` reports coverage as proof of quality | 2 | Explicit prohibition grounded in [arXiv:2607.22880](https://arxiv.org/abs/2607.22880) and in `TESTING.md:8-24`'s own typological framing; report kinds of breakage instead |
| The seven combined agent `description` fields grow past the point where Claude Code warns at startup (>15k tokens, per `.claude/agents/README.md:94`) | 2, 3, 4, 5 | Keep each `description` to the ~6–8 lines the existing three use; all detail belongs in the body |
| Someone later conflates `plan-verifier` (this tooling agent) with the L06 product feature also called "Plan Verifier" (`README.md:87`) | 4 | An explicit naming note near the top of `plan-verifier.md`; also worth a clause in its README catalog row |

## Out of scope

- Writing the four agent prompts' final prose here — this plan specifies their required sections and constraints; the implementer writes the text.
- A `security-reviewer` agent. Security review remains uncovered by any agent, as `.claude/agents/README.md:16-19` says today (Step 6 must preserve that clause while fixing the architecture-review one).
- A `pr-opener` agent. `gh pr create` stays gated by `pr-self-review` via `.claude/hooks/pr-self-review-gate.sh` (`CLAUDE.md:74-80`).
- Any edit under `.claude/skills/**` — vendored upstream code pinned by `skills-lock.json` (`CLAUDE.md:55-58`). Rules the new agents need that a skill lacks (the `routing.md:25` server-test gap, the whether-to-diagram decision) live in the **agent prompts**.
- Adding a lane for `.claude/**` or `docs/**` to `.claude/skills/pr-self-review/routing.md`. That is both an edit to a vendored skill and a change to the review surface — a separate decision.
- Any `settings.json` change, including an `Edit(docs/**)` permission rule for `doc-writer`. A permission rule is session-wide, not per-agent.
- Extending `test-writer` to `e2e/`. Those are `specs/NN-name.flow.json` agent-browser batch files with deterministic locators only, not TS test files (`e2e/CLAUDE.md:19`, `:33-34`).
- Making `plan-verifier` write a `verdict.json` or gate anything. Only `pr-self-review` writes to `.claude/.cache/`.
- Any product code (`client/`, `server/`, `reviewer-core/`, `e2e/`) — with the single conditional exception of Step 8's contract enum, which is marked DO NOT EXECUTE.
- Adding a Markdown linter or link checker as a dependency. Step 9's checks are shell only; no package manager is invoked.

## Open questions

Four, all genuinely needing a human. **Resolved by the repo owner, 2026-09-23**
— recorded here before execution so the plan and the files it produced never
disagree:

- **OQ-1 → supported.** The CLI in use supports `skills:`. `test-writer` and
  `architecture-reviewer` use the "if OQ-1 resolves supported" branch of their
  Step 2/3 specs (preloaded `skills:`, `Skill` omitted from `architecture-reviewer`'s
  `tools:`). Step 1's read-only gate is satisfied by this answer directly —
  no `claude --version` probe was needed.
- **OQ-2 → option (a).** `architecture-reviewer` emits `category: "style"`.
  **Step 8 is confirmed DO NOT EXECUTE** — no contract change, no edit to
  either `vendor/shared/contracts/findings.ts` copy.
- **OQ-3 → confirmed.** The 0.0–1.0 `confidence` field with a hard 0.7 floor
  stands as specified in Step 3.
- **OQ-4 → split.** `doc-writer` uses `model: sonnet` (prose from material it's
  handed, the cheapest of the four). `test-writer`, `architecture-reviewer`,
  `plan-verifier` use `model: opus`, as originally specified.

The original analysis for each question is kept below for context; treat the
resolutions above as authoritative over any "default if unresolved" text that
follows.

**OQ-1 — Is the `skills:` frontmatter field supported by the Claude Code version
in use?** The research that motivated preloading (`skills: onion-architecture`
for `architecture-reviewer`, plus omitting `Skill` from its `tools:` so an
unrelated skill is physically unreachable; and `skills: react-testing-library`
for `test-writer`) could not confirm version support — `claude --version` was
not reachable during that run. A secondary unknown sits inside it: whether
`skills:` accepts **multiple** skills or exactly one, which matters for
`test-writer`. **Default if unresolved:** omit `skills:` from all four files;
`architecture-reviewer` and `test-writer` get `Skill` in `tools:` plus a hard
prose rule naming which skill(s) they may load. This mirrors
`.claude/agents/README.md:113-116`, where version-gated frontmatter fields were
deliberately not adopted for the same reason. Affects Steps 1, 2, 3, 7.

**OQ-2 — What `category` does an architecture finding carry?**
`FindingCategory` is `bug | security | perf | style | test`
(`server/src/vendor/shared/contracts/findings.ts:14`) — there is **no
`architecture` value**. Two options, both real:

(a) **Map to `style`, no contract change.** `pr-self-review` already does exactly
this — "layering, placement and convention findings are `style`"
(`.claude/skills/pr-self-review/SKILL.md:205-207`). Zero product-code churn,
zero CI surface; the cost is that an architecture CRITICAL is indistinguishable
from a naming nit by `category` alone (severity still separates them).

(b) **Extend the enum** (Step 8). Gains a first-class category; costs a real
contract change that must land in **both** physical copies of `vendor/shared`
(`.claude/skills/pr-self-review/repo-rules.md:116-123`), triggers the
`client.yml` contract check plus four typechecks, and any matching update to
`pr-self-review/SKILL.md`'s payload documentation would itself be an edit to a
vendored skill (`CLAUDE.md:55-58`).

**Default if unresolved:** option (a). Step 8 stays unexecuted. Affects Steps 3,
7, 8.

**OQ-3 — Should `architecture-reviewer`'s confidence floor be `0.7`, and is the
0.0–1.0 field the right shape at all?** The plan reuses the existing
`confidence: z.number().min(0).max(1)` on `Finding`
(`server/src/vendor/shared/contracts/findings.ts:57` — present in the contract
but not currently populated by `pr-self-review`'s payload,
`.claude/skills/pr-self-review/SKILL.md:189-201`) with a hard "below 0.7, do not
report" floor, following Anthropic's own shipped
[`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review/blob/main/.claude/commands/security-review.md).
A coarser three-bucket vocabulary over the same idea is defensible, and the
floor value is a precision/recall dial only the person reading the reports can
set. **Default if unresolved:** the numeric field with a 0.7 floor, since it
reuses a field the product already defines rather than inventing a parallel
scale. Affects Step 3.

**OQ-4 — `model:` per agent.** The plan specifies `opus` for all four. The
existing set splits it: `researcher` is `sonnet`, `planner` and `implementer`
are `opus` (`.claude/agents/README.md:12-14`). `doc-writer` is the most
plausible `sonnet` candidate (prose generation from material it is handed), but
it does make a real placement decision, and `test-writer` writes code that must
compile. This is a cost/quality call whose price only the repo owner knows.
**Default if unresolved:** `opus` for all four; downgrading a `model:` line
later is a one-word edit and the cheapest thing in this plan to change.
Affects Steps 2, 3, 4, 5, 6.

**Not an open question, recorded so it is not raised as one:** root
`README.md:87` lists a *product* feature also named "Plan Verifier" in the L06
lesson row. It is a DevDigest app feature students build in `client/`/`server/`,
at a different layer entirely from this `.claude/agents/` dev-tooling subagent.
Step 4 puts a naming note in the agent file. This is **not** a reason to rename
the agent or to skip it.
