---
name: workflow-retro
description: >
  Retrospective on one run of the SDD / implement pipeline: per-agent cost,
  context that was loaded more than once, and concrete prompt edits to make
  the next run cheaper — then appends one row to docs/retros/ledger.md so the
  trend across runs is visible. Use after /sdd or /implement finishes, and for
  "retro the pipeline", "what did that run cost", "/workflow-retro".
---

# Workflow retro

Run once, after a pipeline run (`/sdd`, `/implement`) has finished. Read-only
on product code; the only writes are a report and one ledger row.

## 1. Gather the run

Identify the run: the spec (`specs/**` / `<pkg>/specs/**`), the plan
(`docs/plans/*.plan.md`) and the branch. Take per-agent figures from the
session transcript(s) under `~/.claude/projects/<project>/*.jsonl` — each
subagent call records its `usage` (input, output, cache-read, cache-creation
tokens) and tool calls. If a figure is not recoverable, write `n/a`; never
estimate silently.

## 2. Measure

Per agent (`spec-creator`, `researcher`×n, `implementation-planner`,
`implementer`, `test-writer`, `architecture-reviewer`, `security-reviewer`,
`plan-verifier`):

| Agent | Calls | Input | Output | Cache read | Tool calls | Fix-loop round |
|---|---|---|---|---|---|---|

**Duplicated context** — files read by two or more agents (same path in
several agents' `Read`s): list path, readers, and which agent's brief could
have carried the excerpt instead. Highlight a whole `INSIGHTS.md` or
`CLAUDE.md` read by every agent.

## 3. Recommend

At most five concrete edits, each naming the file to change and the change:

- *prompt* — a line to add/remove in `.claude/agents/<name>.md`;
- *handoff* — what the orchestrator should pass in the spawn prompt so the
  agent skips a read;
- *skip* — a stage that added nothing this run (e.g. a second fix round).

No generic advice ("be concise"). If nothing stands out, say so.

## 4. Write

- Report: `docs/retros/<yyyy-mm-dd>-<topic-slug>.md` with sections Run,
  Cost table, Duplicated context, Recommendations.
- Ledger: append one row to [`docs/retros/ledger.md`](../../../docs/retros/ledger.md)
  (create it with the header below if missing) — never edit earlier rows.

```markdown
| Date | Topic | Pipeline | Total tokens | Costliest agent | Fix rounds | Duplicated reads | Δ vs previous |
|---|---|---|---|---|---|---|---|
```

`Δ vs previous` compares *Total tokens* with the row above (`+12%`, `-8%`,
`first run`). That column is the trend; keep it filled.

## Don't

- Don't edit agent prompts yourself — recommend; the user applies.
- Don't invent numbers. `n/a` beats a guess.
