---
name: pr-self-review
description: >
  Reviews every open change against this repo's own rules before a pull request
  is opened, by routing the diff to the other skills — UI files to the frontend
  skills, backend files to the architecture skills — and blocks the PR when a
  CRITICAL survives. Use for "/pr-self-review", "self review", "review my
  changes before I open a PR", "pre-PR check", "ready to open a PR?", and
  whenever `gh pr create` is about to run. Does NOT hunt for correctness bugs
  in general — that is `/code-review`; this is conformance to the conventions
  this repo already enforces.
---

# PR Self-Review — the local pre-PR gate

Everything CI will check, plus everything CI *can't* check, run against the
working tree before the PR exists. The output is one verdict: a PR with a
surviving CRITICAL does not get opened.

The value is the **routing**: a diff that only touches `client/` never pays for
a backend architecture pass, and a Drizzle schema change never gets reviewed by
a React skill. The map is [routing.md](routing.md); the checks no vendored
skill covers are [repo-rules.md](repo-rules.md).

## Two ways it runs

| Trigger | What happens |
|---|---|
| `/pr-self-review` (manual) | Full run, phases 0→4, writes the verdict artifacts |
| `gh pr create` (automatic) | `.claude/hooks/pr-self-review-gate.sh` intercepts the Bash call, reads the verdict, and **denies** the tool call when it is missing, stale, or blocked |

The hook never reviews anything itself — it only reads `verdict.json`. When it
denies with *"no verdict"* or *"stale verdict"*, run this skill and retry the
`gh pr create` command unchanged.

It matches the CLI invocation at a **command position** only, so a command that
merely mentions the phrase is not gated — and a PR opened in the browser is not
gated either. That is a known hole, not a bug to route around: the gate is a
guardrail for the flow that runs in this session, not a substitute for branch
protection on GitHub.

Flags: `--staged` (only the index), `--full` (phase 0 also runs the test
suites of the touched packages), `--report-only` (write the report, set
`blocked: false`, never gate).

## Severity — the product's own scale, not a new one

`CRITICAL | WARNING | SUGGESTION` and `request_changes | approve | comment`,
exactly as [`findings.ts`](../../../server/src/vendor/shared/contracts/findings.ts)
defines them. Two hard rules copied from the engine:

- **Grounding.** Every finding cites `file:start_line-end_line` that intersects
  a real changed hunk. A finding that cannot cite one is **dropped**, not
  softened — same rule as `reviewer-core/src/grounding.ts`.
- **Score is computed, never estimated.** `100 − 35×CRITICAL − 12×WARNING −
  3×SUGGESTION`, floored at 0 — by
  [`write-verdict.js`](../../hooks/write-verdict.js) in phase 4, never by you.
  You hand it findings; it hands back the number.

Verdict follows from the findings: ≥1 CRITICAL, or any failed phase-0 check,
⇒ `request_changes` and `blocked: true`; otherwise `comment`; no findings and
a clean phase 0 ⇒ `approve`. Also computed by the script, not assembled by
hand.

**Do not inflate.** Only a CRITICAL blocks, so a skill rule labelled HIGH or
MEDIUM in its own file maps to WARNING or SUGGESTION here — never to CRITICAL.
A CRITICAL is: CI would fail, a boundary the codebase depends on is broken, a
[Do not touch](../../../CLAUDE.md#do-not-touch) rule is violated, or a secret
is exposed. Taste is a SUGGESTION. An empty findings list is a good outcome.

---

## Phase 0 — deterministic gate (no LLM)

Cheap, exact, and it mirrors CI. Run only the rows whose trigger paths appear
in the diff, from the listed directory.

| Trigger paths in diff | Command | cwd |
|---|---|---|
| `client/src/vendor/shared/**` or `server/src/vendor/shared/**` | `diff -r client/src/vendor/shared server/src/vendor/shared` | repo root |
| `server/**` or `reviewer-core/**` | `pnpm typecheck` | `server/` |
| `server/**` or `reviewer-core/**` | `pnpm exec depcruise src --config .dependency-cruiser.cjs` | `server/` |
| `client/**` or `server/src/vendor/shared/**` | `pnpm typecheck` | `client/` |
| `reviewer-core/**` or `server/src/vendor/shared/**` | `npm run typecheck` | `reviewer-core/` |
| `e2e/**` | `npm run typecheck` | `e2e/` |

Then run every rule in [repo-rules.md](repo-rules.md) — they are greps, not
judgement, and they produce the most reliable CRITICALs in the whole run.

**The two feed the artifact differently.** The six commands in the table above
are whole-command pass/fail — they go into `phase0`, never into `findings`,
because they have no single `file:line` to cite. Repo-rules hits are the
opposite: each one names a real file and line, so each is a `findings` entry
(most at CRITICAL, per its own severity column), not a `phase0` entry.

- **A failing command is a `phase0` entry with `status: "fail"`**, not a
  `findings` entry — `write-verdict.js` already blocks on any failed check, so
  turning it into a CRITICAL too would double-count it against the score. Put
  the command in `check` and the first real error line in `detail`.
- **Phase 0 short-circuits.** Any failing command here and the LLM lanes do
  **not** run: go straight to phase 4 with an empty `findings` array and the
  failing `phase0` entries. Typecheck output is more actionable than a review
  of code that doesn't compile, and it costs nothing to re-run.
- `server/`'s typecheck resolves `../reviewer-core/src` through a path alias, so
  it needs `reviewer-core/node_modules`. `Cannot find module 'zod'` from
  reviewer-core means `cd reviewer-core && npm ci` — an environment problem, not
  a finding. Fix it and re-run rather than reporting it.

## Phase 1 — classify the diff

The review scope is **everything not yet on the base branch**, in three layers,
merged into one file set:

```sh
BASE=$(.claude/hooks/pr-self-review-gate.sh --print-base)   # merge-base with origin/main
git diff --name-status "$BASE"                              # committed + staged + unstaged
git ls-files --others --exclude-standard                    # untracked
```

`git diff "$BASE"` already covers committed, staged and unstaged changes.
**Untracked files are listed separately and must be included** — a new
component that was never `git add`ed is the single most common thing a
self-review misses, and it is exactly the kind of file that carries new
violations. With `--staged`, use `git diff --cached` alone.

Never review: lockfiles, `server/clones/**`, `**/INSIGHTS.md`, `dist/`,
`.next/`, `.claude/skills/**` (vendored upstream code), binaries, and anything
`git check-ignore` matches. They are still *listed* in phase 0's rules — a
hand-edited lockfile is a finding about the act, not about its contents.

If the diff exceeds ~1500 changed lines, run the lanes package by package
rather than compressing; never sample a subset silently.

Then map every remaining file to its skills with [routing.md](routing.md).

## Phase 2 — run the lanes

One lane per matched skill, **sequentially**, in the order routing.md lists.

- **Load the skill before reviewing with it.** The lane's rules come from the
  skill file, not from memory of it.
- **A lane sees only the files that routed to it.** `react-best-practices` does
  not get an opinion on a Drizzle schema in the same PR. This is the whole
  point of the routing step — do not widen a lane because the diff is small.
- **A lane that matched nothing does not run.** A backend-only diff never loads
  a frontend skill, and vice versa.
- Review the change, not the file: a pre-existing violation on an untouched
  line is out of scope, however tempting. If it sits on a line the diff
  touches, it is in scope.
- Files that routed to **no** skill still get the repo-rules pass, and their
  paths go into `uncovered_files` so the report is honest about what was only
  checked deterministically.

## Phase 3 — consolidate

1. **Ground.** Drop every finding without a `file:start_line-end_line` inside a
   changed hunk. Dropping is silent; do not list dropped findings.
2. **Dedupe.** Same file and overlapping lines from two lanes ⇒ one finding,
   keeping the higher severity, with both skills named in `skill`.
3. **Re-check severity** against the anti-inflation rule above.

Stop there. Do **not** compute `score`, `verdict`, or `blocked` yourself —
phase 4 does that deterministically, for the same reason the product itself
never trusts a model's self-reported score
([docs/agent-prompts/README.md](../../../docs/agent-prompts/README.md#how-the-engine-uses-the-output-why-the-conventions-matter)):
a model that can miscount CRITICALs must not also be the one deciding whether
the PR is blocked.

## Phase 4 — write the artifacts

Pipe the consolidated findings to the gate script — it computes `score`,
`verdict`, `blocked`, `state_key`, `base_sha`, `head_sha`, `generated_at`, and
writes both `.claude/.cache/pr-self-review/verdict.json` (read by the hook)
and `report.md` (git-ignored; the directory is created for you):

```sh
echo "$PAYLOAD" | .claude/hooks/pr-self-review-gate.sh --write-verdict
```

`$PAYLOAD` is JSON with exactly these four keys — no `score`, `verdict`,
`blocked`, or `state_key` field; the script rejects anything else silently
passed through and computes them itself:

```json
{
  "phase0": [{ "check": "server pnpm typecheck", "status": "pass", "detail": "" }],
  "skills_run": ["onion-architecture", "react-best-practices"],
  "uncovered_files": ["scripts/dev.sh"],
  "findings": [
    {
      "severity": "CRITICAL",
      "category": "style",
      "skill": "onion-architecture",
      "title": "Repository imported directly from routes.ts",
      "file": "server/src/modules/repos/routes.ts",
      "start_line": 12,
      "end_line": 18,
      "rationale": "…",
      "suggestion": "…"
    }
  ]
}
```

`category` uses the product enum (`bug | security | perf | style | test`);
layering, placement and convention findings are `style`. Each `phase0` entry's
`status` is exactly `"pass"` or `"fail"` — any other value counts as a failure
and blocks, same as a CRITICAL.

The script validates every finding (required fields, a real `severity`, a real
`category` when present) and **exits non-zero without writing anything** on a
malformed payload — fix the JSON and re-run, don't hand-patch `verdict.json`.
A failing phase0 check blocks (`request_changes`) even with zero findings; it
would be self-contradictory for a broken typecheck to produce `approve`.

In chat: the verdict, the score, the CRITICAL titles, and the next command to
run. Don't paste the whole report.

## When it blocks

Say plainly that the PR is blocked, list the CRITICALs with their locations,
and stop. Do not open the PR as a draft instead, do not re-run with
`--report-only` to get a green result, and do not set `PR_SELF_REVIEW_BYPASS=1`
on the user's behalf — the bypass exists for the user to invoke deliberately,
and the hook records it in the report when they do.

After the fixes land, re-run the skill: the state key changes with any edit, so
the previous verdict is dead the moment the working tree moves.

## Boundaries

Does not: replace `/code-review` (general correctness bugs) or
`/security-review`; run the e2e browser suite; write to any `INSIGHTS.md`
(that is [engineering-insights](../engineering-insights/SKILL.md)); comment on
GitHub; commit, stage, push, or fix the code it reviews. It reads the diff,
writes two files under `.claude/.cache/`, and reports.
