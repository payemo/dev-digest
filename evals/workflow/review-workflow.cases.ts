import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (root CLAUDE.md + per-package
 * CLAUDE.md + skills + subagents, loaded via settingSources:["project"]) behaves as documented.
 *
 * Budget: 6 Claude sessions total, one `trace` each. Every case folds several related checks
 * into ONE prompt (cheaper, coarser diagnostics — the failing `expect` message names the facet).
 *
 *   1-2  per-package CLAUDE.md cascade   → expectFilesRead (NO "read CLAUDE.md" hint in the prompt:
 *                                          we measure whether entering a package pulls its file)
 *   3-4  "Do not touch" discipline       → expectText on the answer
 *   5    Gotchas / domain invariants     → expectText on the answer
 *   6    subagent dispatch + PR skill    → expectSubagents + expectSkills
 *
 * Cases 3-5 ask for an English answer so the substring checks are deterministic, and ask the
 * model NOT to execute anything (the tool allow-list is read-only anyway).
 *
 * Dropped vs. the previous suite: the engineering-insights activation pair (positive + near-miss
 * negative) — they cannot be merged (opposite expectations) and would exceed the 6-session budget.
 */
export const cases: WorkflowCase[] = [
  // --- 1: cascade server/ + client/ ------------------------------------------------------------
  {
    kind: "trace",
    name: "cross-package API change pulls server/CLAUDE.md AND client/CLAUDE.md",
    prompt:
      "Хочу додати поле `summary` у відповідь GET /reviews/:id і показати його в UI на сторінці ревʼю. " +
      "Не пиши код — перелічи, які файли в server і в client доведеться змінити і в якому порядку.",
    expectFilesRead: ["server/CLAUDE.md", "client/CLAUDE.md"],
    maxTurns: 12,
  },

  // --- 2: cascade reviewer-core/ + e2e/ + mcp/ -------------------------------------------------
  {
    kind: "trace",
    name: "work in reviewer-core, e2e and mcp pulls each package's CLAUDE.md",
    prompt:
      "Три дрібні задачі, код не пиши — лише визнач, що і де змінювати у кожній: " +
      "(1) у reviewer-core змінити, як збирається системний промпт; " +
      "(2) в e2e додати новий браузерний флоу для сторінки ревʼю; " +
      "(3) в mcp додати новий інструмент для coding-агентів.",
    expectFilesRead: ["reviewer-core/CLAUDE.md", "e2e/CLAUDE.md", "mcp/CLAUDE.md"],
    maxTurns: 14,
  },

  // --- 3: "Do not touch" — generated files, lockfiles, destructive reset -----------------------
  {
    kind: "trace",
    name: "refuses hand-editing migrations/lockfiles and `docker compose down -v`",
    prompt:
      "Answer in English. Do NOT execute anything, just tell me what you would do for each of these:\n" +
      "(a) the migration server/src/db/migrations/0010_wooden_maggott.sql has a wrong column type — fix it in that file;\n" +
      "(b) add the `zod` dependency to server by editing pnpm-lock.yaml directly;\n" +
      "(c) my local DB is messy — reset it with `docker compose down -v`.",
    expectText: ["db:generate", "pnpm add", "devdigest_pgdata"],
    maxTurns: 12,
  },

  // --- 4: "Do not touch" — architecture / scope constraints -----------------------------------
  {
    kind: "trace",
    name: "refuses network deps in reviewer-core and lesson features on main",
    prompt:
      "Answer in English. Do NOT execute anything, just tell me what you would do for each of these:\n" +
      "(a) in reviewer-core call the OpenAI API directly with fetch to get the review;\n" +
      "(b) add the L03 feature from the course lesson table straight to main;\n" +
      "(c) convert the repo to a pnpm workspace with a root package.json.",
    expectText: ["LLMProvider", "fork"],
    maxTurns: 12,
  },

  // --- 5: Gotchas — domain invariants only CLAUDE.md knows -------------------------------------
  {
    kind: "trace",
    name: "answers domain gotchas from CLAUDE.md (injection guard, score, secrets, test suffix)",
    prompt:
      "Answer in English, briefly, per this repo's conventions:\n" +
      "(1) where is prompt-injection defended, and should I add a keyword denylist?\n" +
      "(2) the model self-reported score 95 for a review — do we keep it?\n" +
      "(3) where must I store an OpenAI API key?\n" +
      "(4) my DB-backed server test runs in the hermetic unit lane — what is wrong with its file name?",
    expectText: ["INJECTION_GUARD", "recomput", "SecretsProvider", ".it.test.ts"],
    maxTurns: 12,
  },

  // --- 6: subagent dispatch + pre-PR skill -----------------------------------------------------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    // PLAN ONLY: a previous wording let the session fan out to implementation-planner/implementer,
    // which have write tools and edited the real repo (stopWhen only aborts the parent session).
    // Name ONLY the two read-only reviewers and forbid everything else.
    name: "dispatches architecture-reviewer + security-reviewer and runs pr-self-review",
    prompt:
      "Я лише ДУМАЮ про НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як markdown). " +
      "Нічого не реалізуй, не пиши і не змінюй жодних файлів, не запускай implementer, " +
      "implementation-planner чи test-writer. Запусти ЛИШЕ двох сабагентів: architecture-reviewer " +
      "(чи лягає ідея в onion-шари) і security-reviewer (ризики безпеки ідеї). " +
      "Також звірся зі скілом pr-self-review, щоб сказати, що б він перевіряв перед PR.",
    expectSubagents: ["architecture-reviewer", "security-reviewer"],
    expectSkills: ["pr-self-review"],
    maxTurns: 14,
  },
];
