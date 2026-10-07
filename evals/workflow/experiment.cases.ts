import type { WorkflowCase } from "../src/index.js";

/**
 * Experiment set — one case per mechanism of the harness. 5 Claude sessions
 * (dispatch 1 + activation pair 2 + contrast treatment/control 2).
 *
 * Every session reads the LIVE repo with a hard read-only tool set (see WORKFLOW_ALLOWED_TOOLS /
 * WORKFLOW_DISALLOWED_TOOLS): no Bash, Write or Edit — none of these cases needs them.
 *
 * Prompts never name the artifact under test (agent / skill / file) — that is what is measured.
 */
export const cases: WorkflowCase[] = [
  // --- dispatch: an architecture-review task must create architecture-reviewer -----------------
  {
    kind: "dispatch",
    name: "architecture-review task dispatches architecture-reviewer",
    prompt:
      "Зроби архітектурне рев'ю такого плану (нічого не реалізуй): новий ендпоінт GET /reviews/:id/export " +
      "у server — хендлер у routes.ts сам робить db.select через Drizzle і форматує markdown, " +
      "а потім викликає fetch до GitHub. Чи не ламає це шари бекенду?",
    expectSubagent: "architecture-reviewer",
    maxTurns: 8,
  },

  // --- activation pair: positive + near-miss negative ------------------------------------------
  {
    kind: "activation",
    name: "positive — a found bug cause activates engineering-insights",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 6,
  },
  {
    kind: "activation",
    name: "negative — a plain question must NOT activate engineering-insights",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 6,
  },

  // --- contrast: CLAUDE.md effect (treatment = real repo, control = empty tmpdir) --------------
  {
    kind: "contrast",
    // The task description only: nothing asks to read docs. The root CLAUDE.md is what sends the
    // agent to server/CLAUDE.md. NB: api-contracts.md from the original brief does not exist in
    // this repo, so the routed file is server/CLAUDE.md (the per-package one).
    name: "CLAUDE.md routes a server task to server/CLAUDE.md (treatment reads, control does not)",
    prompt:
      "Мені треба змінити схему БД у server: додати колонку до таблиці reviews. " +
      "Опиши кроки, нічого не змінюй.",
    expectFileRead: "server/CLAUDE.md",
    tools: ["Read", "Grep", "Glob"],
    maxTurns: 8,
  },
];
