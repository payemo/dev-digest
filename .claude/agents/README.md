# Agents

Subagents for the `Agent` tool — each runs in its own isolated context (no
shared conversation history with the caller or with each other) and returns
only a final report. This file is a map of the set; read the linked agent
file itself for its full method and constraints.

## Catalog

| Agent | Responsibility | Tools | Model |
|---|---|---|---|
| [researcher](researcher.md) | Answers one research question (repo or external) with citations | `Read, Grep, Glob, Bash, WebFetch, WebSearch` | `sonnet` |
| [planner](planner.md) | Turns a change request into a self-contained Development Plan | `Read, Grep, Glob, Bash, Skill` | `opus` |
| [implementer](implementer.md) | Executes an approved plan across `client/`/`server/`, runs its tests | `Read, Grep, Glob, Edit, Write, Bash, Skill` | `opus` |
| [test-writer](test-writer.md) | Writes and runs tests for existing client/server/reviewer-core code | `Read, Grep, Glob, Edit, Write, Bash, Skill` (+ `skills: react-testing-library`) | `opus` |
| [architecture-reviewer](architecture-reviewer.md) | Physically read-only; reviews onion-architecture boundaries only, with evidence | `Read, Grep, Glob, Bash` (+ `skills: onion-architecture`) | `opus` |
| [plan-verifier](plan-verifier.md) | Read-only; reconciles a finished diff against a specific Development Plan, step by step | `Read, Grep, Glob, Bash, Skill` | `opus` |
| [doc-writer](doc-writer.md) | Turns a plan/diff/feature into documentation in the correct `docs/`/`specs/` location | `Read, Grep, Glob, Bash, Write, Edit, Skill` | `sonnet` |

None of the seven has `Agent` in its tool list — none can spawn further
agents. `architecture-reviewer` covers layering and dependency direction
**only** — not general correctness, not security. Security review and PR
creation remain **not** covered by any agent here; `pr-self-review` (a skill,
not an agent) gates `gh pr create` via `.claude/hooks/pr-self-review-gate.sh`.

## Responsibilities, permissions, artifacts

### researcher

- **Does:** answers a single bounded question — "how does this repo do X",
  "where does Y live", or an external library/API question — and returns a
  report with a citation per finding.
- **Does not:** write or edit anything, decide, implement, or spawn agents.
- **Permissions:** read-only + web (`Read, Grep, Glob, Bash, WebFetch,
  WebSearch`). `Write`/`Edit` are absent entirely; `Bash` is inspection-only
  by convention in the prompt (no redirection, no `git commit`/`apply`).
- **Input:** a question, handed in the delegation prompt (no shared history).
- **Output:** its final message — a markdown report (repo-research or
  external-research shape) ending in a self-check list. Nothing is written to
  disk.

### planner

- **Does:** reads the affected package(s)' `CLAUDE.md` and `INSIGHTS.md`, the
  root `CLAUDE.md`, and [`pr-self-review/routing.md`](../skills/pr-self-review/routing.md)
  to predict which skills the implementer will apply, then writes a
  Development Plan with concrete file paths, steps, constraints, and a test
  plan.
- **Does not:** write product code, run migrations, install dependencies,
  commit, open PRs, or spawn agents. `Write` is scoped by the prompt to the
  one plan file it produces.
- **Permissions:** `Read, Grep, Glob, Bash, Skill`. `Bash` is inspection-only.
  `Skill` is capped at ~3 loads per plan — only the skills that would actually
  change a decision, per its own foresight step.
- **Input:** a change request, handed in the delegation prompt.
- **Output:** a plan file at `docs/plans/<slug>.plan.md`, plus a short summary
  in its final message (path, goal, step count, open questions). The file is
  the deliverable, not the chat reply — see [Handoff](#handoff-planner--implementer).

### implementer

- **Does:** executes an existing plan file step by step, selecting skills per
  file from the same `routing.md` map, writing the changes, then running the
  verbatim test commands from [`TESTING.md`](../../TESTING.md) for every
  package it touched.
- **Does not:** plan, research alternatives, hand-edit a migration or
  lockfile, commit, open a PR, do architecture/security review of its own
  work, or spawn agents. Findings outside its mandate go into the report, not
  into a fix.
- **Permissions:** `Read, Grep, Glob, Edit, Write, Bash, Skill`. No
  `WebSearch`/`WebFetch` — a step that needs external research is a stop
  condition, handed back rather than guessed through.
- **Input:** the path to a plan file written by `planner` (or handed directly).
- **Output:** its final message — an implementation report (changes, skills
  applied, verbatim verification output, deviations, not-done, and a
  "not verified — for the review agents" section). The working tree is left
  uncommitted.

### test-writer

- **Does:** writes tests for existing `client/`, `server/`, and
  `reviewer-core/` code, then runs them with the verbatim `TESTING.md`
  commands and fixes its own test failures.
- **Does not:** modify the code under test to make a test pass (that's a
  finding, reported not fixed), report coverage/mutation percentages, write
  `e2e/` browser flows, review architecture or security, or spawn agents.
- **Permissions:** `Read, Grep, Glob, Edit, Write, Bash, Skill`, with
  `react-testing-library` preloaded via `skills:`. `fastify-best-practices`
  is loaded on demand for server test files, closing a gap in
  `pr-self-review/routing.md` (it has no lane for `server/test/**`).
- **Input:** a named file, module, component, or behaviour to test.
- **Output:** its final message — a test report (files written, kinds of
  breakage covered — never a percentage, skills applied, verbatim
  verification output, what was deliberately not tested, suspected bugs
  found but not fixed).

### architecture-reviewer

- **Does:** reviews a backend diff against this repo's onion-architecture
  boundaries only, running `depcruise` as the machine check, and returns
  findings with a `file:line` citation and a 0.0–1.0 confidence score each
  (floor 0.7).
- **Does not:** review correctness, security, tests, naming, React/Next
  code, or performance; fix what it finds; compute a score/verdict; open a
  PR; or spawn agents.
- **Permissions:** `Read, Grep, Glob, Bash` — no `Write`/`Edit`/`Agent`, and
  `Skill` is deliberately absent from `tools:` since `onion-architecture` is
  preloaded via `skills:` — the agent cannot reach for an unrelated skill
  mid-review.
- **Input:** a diff or target to review.
- **Output:** its final message — a findings table (or an explicit "no
  findings" line), the `depcruise`/`typecheck` output verbatim, and what was
  outside its single concern and therefore not reviewed.

### plan-verifier

- **Does:** reconciles a finished diff against a specific Development Plan
  file, step by step — checking each step's own "Done when", the plan's
  Contract changes/Migration/Test plan fields, and whether anything outside
  the plan's scope changed. Re-runs the plan's test commands rather than
  trusting the implementer's report.
- **Does not:** give general code-quality advice, review architecture or
  security, fix a gap it finds, commit, open a PR, or spawn agents. A finding
  not traceable to a named step or an explicit requirement goes to a separate
  "Observed, out of scope" list, never the verdict.
- **Permissions:** `Read, Grep, Glob, Bash, Skill` — no `Write`/`Edit`/`Agent`.
- **Input:** the path to a plan file (and, ideally, the original request it
  was written against).
- **Output:** its final message — a per-step traceability table (one of five
  fixed statuses per step), a summary computed from that table, and separate
  "Observed, out of scope" / "Couldn't verify" sections.

### doc-writer

- **Does:** turns a Development Plan, a finished diff, or a described
  feature into documentation, placed in the correct `<pkg>/specs/`,
  `<pkg>/docs/`, `docs/specs/`, or `<pkg>/README.md` location, with a diagram
  only when one earns its place.
- **Does not:** write product code, invent behaviour it hasn't read, write
  directly to any `INSIGHTS.md` (routes through the `engineering-insights`
  skill instead), touch `.claude/skills/**`, commit, open a PR, or spawn
  agents.
- **Permissions:** `Read, Grep, Glob, Bash, Write, Edit, Skill`. `Write`/`Edit`
  are scoped to Markdown under `docs/**` by **prose constraint** — no
  frontmatter field restricts a write tool to a subdirectory.
- **Input:** a plan file path, a diff, or a described feature.
- **Output:** the doc file(s) themselves, plus a final message giving the
  path(s), the placement reasoning, and whether a diagram was added and why.

## Handoff: planner → implementer

Because a subagent inherits none of the caller's conversation, `planner`
cannot hand `implementer` a chat summary — it hands a **file path**.
`implementer` reads that file itself; it never receives the plan as pasted
text. This is why every plan step must name exact file paths and be readable
with zero shared context (enforced in `planner.md`'s own self-containment
rule and quality-bar checklist).

## Handoff: planner/implementer → plan-verifier / doc-writer

The same zero-shared-context rule applies to the two newer agents.
`plan-verifier` is handed the same plan file path `implementer` was handed —
it never receives the plan or the implementer's report as pasted chat text,
and it re-runs verification itself rather than trusting either report.
`doc-writer` is handed a plan path or a diff, never a chat summary of what
was built — if the material handed to it is too thin to document without
guessing, it stops and asks rather than inventing behaviour.

## Sources the rules in planner/implementer are grounded in

Frontmatter shape, tool-permission model, and behavioral rules for these two
agents were checked against Anthropic's own documentation (via a `researcher`
run, 2026-09-23) plus this repo's existing `researcher.md` as house style.
Each row names the rule and where it lands.

| Source | Rule | Where applied |
|---|---|---|
| [Subagents](https://code.claude.com/docs/en/sub-agents) — Tools Field Semantics | An explicit `tools:` list is a strict allowlist; omitting it inherits everything | `tools:` is listed explicitly in both — [planner.md:12](planner.md#L12), [implementer.md:11](implementer.md#L11) |
| Same page — Agent Tool Restrictions | Omitting `Agent` from `tools` is the enforced way to stop a subagent spawning children — not a prompt instruction | `Agent` absent from both allowlists; each still states "never spawn other agents" in prose as belt-and-suspenders |
| Same page — Description Field and Automatic Delegation | `description` should state trigger conditions, not a role label, and stay short (combined agent descriptions >15k tokens warn at startup) | Both `description` fields open with the action + explicit trigger phrases, detail deferred to the body |
| [Subagents blog](https://claude.com/blog/subagents-in-claude-code) | Specificity in `description` beats a generic capability label | Both descriptions name concrete trigger phrases ("plan this", "implement the plan") over role nouns |
| [Subagents](https://code.claude.com/docs/en/sub-agents) — Context Isolation | A subagent inherits its own system prompt, the delegation message, and CLAUDE.md — **not** prior conversation, already-read files, or already-invoked skills; it returns only a summary | Drives the file-based [handoff](#handoff-planner--implementer); `planner.md`'s explicit "no 'as discussed above'" rule |
| [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | A subagent needs an objective, an output format, tool/source guidance, and clear task boundaries; prefer subagents storing work externally and returning a lightweight reference over routing everything through the caller's context | Each agent's prompt has those four as separate sections; `planner` writes to `docs/plans/` and returns a path, not the plan text |
| [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) | Subagents suit research-heavy or fresh-perspective work, not sequential/dependent steps; named failure patterns include the trust-then-verify gap and unscoped exploration | Basis for splitting planner/implementer at all rather than one agent; `implementer.md`'s "Stop conditions" section |
| Same page — adversarial review pattern | A reviewer subagent should see only the diff and stated criteria, not the reasoning that produced it | Basis for keeping architecture/security review as separate agents, never done by `implementer` on its own diff |
| [Extend Claude Code](https://code.claude.com/docs/en/features-overview) — Skill vs Subagent | Skills can be preloaded (`skills:` field, no progressive disclosure) or discovered on demand via the `Skill` tool (progressive disclosure intact) | Neither agent preloads `skills:` — both call `Skill` on demand against `routing.md`, since the set depends on the diff, not on the agent's identity |
| [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Keep file references one level deep from the entry file; avoid offering many equally-valid options over one default with an escape hatch | Both agents link `routing.md`/`SKILL.md` directly (no chained references) and specify one default path per decision point |
| [Configure permissions](https://code.claude.com/docs/en/permissions) | An agent's own `tools:` and `settings.json`'s permission rules are independent, additive filters; deny wins | Neither agent's `tools:` is treated as a substitute for the `pr-self-review` `PreToolUse` hook, which still gates `gh pr create` regardless of either agent's allowlist |
| [researcher.md:1-16](researcher.md#L1-L16) (this repo) | Frontmatter uses exactly `name`, `description`, `tools`, `model` — no other fields | Same four fields in [planner.md:1-14](planner.md#L1-L14) and [implementer.md:1-13](implementer.md#L1-L13) |
| [researcher.md:212](researcher.md#L212) (this repo) | Prompt ends with a `## Quality bar before you return` self-check list | Present at the end of both `planner.md` and `implementer.md` |
| [`pr-self-review/routing.md`](../skills/pr-self-review/routing.md) (this repo) | A single path→skill map already exists, including content-triggered cross-cutting lanes | Both agents reference this file directly instead of duplicating the routing table |
| [`TESTING.md`](../../TESTING.md) (this repo) | Server tests run via `pnpm exec vitest run --exclude '**/*.it.test.ts'` / `vitest run .it.test`, not `pnpm test:unit`, because `server/package.json` is `skip-worktree` | Verbatim commands in `implementer.md`'s Verification section |
| Root [`CLAUDE.md`](../../CLAUDE.md) — Do not touch / Insights loop | Never hand-edit migrations or lockfiles; `INSIGHTS.md` is high-confidence guidance to read before working in a package | `implementer.md` Hard constraints; `planner.md` Required inputs |

### Sources for test-writer / architecture-reviewer / plan-verifier / doc-writer

Research for these four ran as four independent `researcher` calls plus one
`planner` call, all dated 2026-09-23.

| Source | Rule | Where applied |
|---|---|---|
| [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices) — "Add an adversarial review step" | A reviewer subagent sees only the diff and stated criteria, not the reasoning that produced the change; flag only gaps affecting correctness or stated requirements, treat the rest as optional | Basis for `architecture-reviewer`'s and `plan-verifier`'s single-concern scoping and exclusion lists |
| Same page — worked read-only-reviewer example | `tools: Read, Grep, Glob, Bash`, no Write/Edit, for a reviewer subagent | Literal frontmatter of `architecture-reviewer.md` and `plan-verifier.md` |
| Same page — worked example pairing test-writing with running | "write tests… run the test suite and fix any failures" | Basis for giving `test-writer` `Bash` to run, not just write, tests — **labelled as an inference; no Anthropic source names a "test-writer" role directly** |
| Same page — "Give Claude a way to verify its work" | "Have Claude show evidence rather than asserting success… a fresh model try to refute the result, so the agent doing the work isn't the one grading it" | Basis for `plan-verifier` re-running, not re-reading, the implementer's claimed verification |
| Same page — plan-vs-diff worked example | "Review the diff against PLAN.md. Check that every requirement is implemented… Report gaps, not style preferences" | Literal basis for `plan-verifier`'s scope-discipline rule |
| [Subagents](https://code.claude.com/docs/en/sub-agents) — `skills:` field | `skills:` preloads one fixed skill's full content at startup; independent of `Skill` in `tools:`, which allows on-demand loading | `test-writer` preloads `react-testing-library`; `architecture-reviewer` preloads `onion-architecture` **and omits `Skill` from `tools:`** so it can't reach for an unrelated skill mid-review |
| [`claude-code-security-review`](https://github.com/anthropics/claude-code-security-review/blob/main/.claude/commands/security-review.md) (Anthropic's own shipped skill) | 0.0–1.0 confidence score with a hard floor (below 0.7, don't report); explicit single-concern scope statement plus a named exclusion list; "better to miss some theoretical issues than flood the report with false positives" | `architecture-reviewer` reuses this repo's existing `confidence: 0-1` field on `Finding` with a 0.7 floor, and its exclusion-list scope statement |
| [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | Citation-accuracy grounding is the primary anti-fabrication control; confidence tiers are secondary | `architecture-reviewer` states grounding first, confidence second |
| [Configure permissions](https://code.claude.com/docs/en/permissions) | No frontmatter field scopes `Write`/`Edit` to a subdirectory; a `settings.json` path rule must use `Edit(path)`, never `Write(path)`, which is silently never consulted | `doc-writer` scopes its own `Write`/`Edit` in prose, mirroring `planner.md`'s existing `docs/plans/` scoping |
| [Kent C. Dodds](https://kentcdodds.com/blog/write-tests) | Test behavior, not implementation; never assert on internal state, hook calls, or DOM structure | `test-writer`'s named anti-patterns, already quoted in `react-testing-library/SKILL.md` |
| [Yegor Bugayenko, "Unit Testing Anti-Patterns"](https://www.yegor256.com/2018/12/11/unit-testing-anti-patterns.html) (2018, primary catalog) | Named anti-patterns: Mockery, The Line Hitter, The Liar | `test-writer`'s hard constraints |
| [Autonoma AI, "Useless Unit Tests"](https://getautonoma.com/blog/useless-unit-tests-tautological-anti-pattern) — secondary | Tautological assertions: expected value computed by calling the function under test | `test-writer`'s hard constraints |
| [Zhao/Zhou/Cohen, arXiv:2607.22880](https://arxiv.org/abs/2607.22880) (2026, primary academic) | Coverage/mutation scores are unreliable signals for LLM-written tests, especially against already-buggy code | `test-writer` never reports a coverage percentage as evidence of quality |
| [NIST CSRC glossary, "traceability matrix"](https://csrc.nist.gov/glossary/term/traceability_matrix) (primary-adjacent) | A traceability matrix records the relationship between requirements and the artifact that satisfies each one | Shape of `plan-verifier`'s per-step output table |
| [2020 Scrum Guide](https://scrumguides.org/scrum-guide.html) (primary) | A Definition of Done is a formal, checkable completion bar per item | Each plan step's own "Done when" is treated as a per-step Definition of Done |
| [Google technical writing style guide — illustrations](https://developers.google.com/tech-writing/two/illustrations) (primary) | Only instructive graphics help readers; cap complexity; skip a diagram that says what the prose already says | `doc-writer`'s "whether to diagram" check, upstream of `mermaid-diagram`'s type choice |
| [Mintlify, "When and how to use diagrams"](https://www.mintlify.com/library/when-and-how-to-use-diagrams) — secondary, corroborating | Diagram flows/state machines/schemas/fan-out; skip linear steps | Same, corroborating |
| [`pr-self-review/routing.md:25`](../skills/pr-self-review/routing.md) (this repo) | `server/test/**` and `server/**/*.test.ts` route to no skill, unlike the client-side test lane | `test-writer`'s agent-local skill-selection table closes this gap in its own prompt, not by editing the vendored `routing.md` |
| [`pr-self-review/repo-rules.md:116-123`](../skills/pr-self-review/repo-rules.md) and `.github/workflows/client.yml` (this repo) | `client/src/vendor/shared` is a **physical copy** of `server/src/vendor/shared`, not an alias — corrects the "propagates by alias" wording in root `CLAUDE.md` | `plan-verifier`'s contract-field check re-runs `diff -r client/src/vendor/shared server/src/vendor/shared` rather than trusting a report |
| [`docs/agent-prompts/README.md:71`](../../docs/agent-prompts/README.md) (this repo) | "Do not describe the JSON shape, field names, or a markdown layout in the prompt" | `doc-writer`'s "explain mechanism, never restate a signature" rule |

Two items flagged during research are **not** adopted here and are called out
rather than silently skipped:

- Extended frontmatter fields (`isolation: worktree`, `maxTurns`,
  `omitClaudeMd`, `experimental.cacheTtl`) exist in current docs but are
  version-gated; the CLI version in this environment wasn't verifiable, so
  none of the seven agents uses them.
- "Does NOT cover X" negative-scoping in a `description` (used by all seven
  descriptions above) matches this repo's own precedent in
  [`pr-self-review/SKILL.md:11`](../skills/pr-self-review/SKILL.md#L11), not a
  documented Anthropic pattern — the research explicitly could not confirm it
  as official guidance, only as community convention.
- A `FindingCategory` value for "architecture" was considered and rejected —
  `architecture-reviewer` emits `category: "style"` instead, matching
  `pr-self-review`'s existing choice for layering findings, to avoid a
  contract change touching both physical copies of `vendor/shared`.
