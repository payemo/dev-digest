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

None of the three has `Agent` in its tool list — none can spawn further
agents. Architecture review, security review, and PR creation are
deliberately **not** covered by any agent here; `pr-self-review` (a skill, not
an agent) gates `gh pr create` via `.claude/hooks/pr-self-review-gate.sh`.

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

## Handoff: planner → implementer

Because a subagent inherits none of the caller's conversation, `planner`
cannot hand `implementer` a chat summary — it hands a **file path**.
`implementer` reads that file itself; it never receives the plan as pasted
text. This is why every plan step must name exact file paths and be readable
with zero shared context (enforced in `planner.md`'s own self-containment
rule and quality-bar checklist).

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

Two items flagged during research are **not** adopted here and are called out
rather than silently skipped:

- Extended frontmatter fields (`isolation: worktree`, `maxTurns`,
  `omitClaudeMd`, `experimental.cacheTtl`) exist in current docs but are
  version-gated; the CLI version in this environment wasn't verifiable, so
  neither agent uses them.
- "Does NOT cover X" negative-scoping in a `description` (used in both
  `planner`'s and `implementer`'s descriptions above) matches this repo's own
  precedent in [`pr-self-review/SKILL.md:11`](../skills/pr-self-review/SKILL.md#L11),
  not a documented Anthropic pattern — the research explicitly could not
  confirm it as official guidance, only as community convention.
