/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   any CLAUDE.md (root, .claude/, per-package) / any agent / engine change → run the workflow tier
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 * The same goes for an eval whose artifact no longer exists on disk (deleted / never committed):
 * the case would throw "agent not found", so it is skipped with its own reason instead.
 *
 * EVAL_ALL=1 ignores the diff and selects every artifact that has evals (manual / scheduled runs).
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT. Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, appendFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(EVALS_DIR, "..");

const ALL = process.env.EVAL_ALL === "1";

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/** Does the artifact the evals exercise exist in .claude/? (an eval without its artifact can only crash) */
const artifactExists = {
  skills: (name) => existsSync(join(REPO_ROOT, ".claude", "skills", name, "SKILL.md")),
  agents: (name) => existsSync(join(REPO_ROOT, ".claude", "agents", `${name}.md`)),
};

/** Every name that has an eval folder (for EVAL_ALL). */
function allWithEvals(tier) {
  const dir = join(EVALS_DIR, tier);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && hasEvals(tier, n))
    .sort();
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const skillNames = ALL
  ? allWithEvals("skills")
  : touched(/^\.claude\/skills\/([^/]+)\//, /^evals\/skills\/([^/]+)\//);
const agentNames = ALL
  ? allWithEvals("agents")
  : touched(/^\.claude\/agents\/([^/]+)\.md$/, /^evals\/agents\/([^/]+)\//);

/** Split touched names into runnable vs skipped-with-reason. */
function partition(tier, names) {
  const run = [];
  const skipped = [];
  for (const n of names) {
    if (!hasEvals(tier, n)) skipped.push(`${n} (no evals)`);
    else if (!artifactExists[tier](n)) skipped.push(`${n} (evals exist but .claude/${tier}/${n} is missing)`);
    else run.push(n);
  }
  return { run, skipped };
}

const { run: skills, skipped: skippedSkills } = partition("skills", skillNames);
const { run: agents, skipped: skippedAgents } = partition("agents", agentNames);

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it:
// the root or .claude CLAUDE.md, any agent definition, the workflow cases, or the engine itself.
// The workflow cases read per-package CLAUDE.md files too (server/, client/, …), so ANY CLAUDE.md counts.
const runWorkflow =
  ALL ||
  changed.some(
    (f) =>
      /(^|\/)CLAUDE\.md$/.test(f) ||
      /^\.claude\/agents\/.+\.md$/.test(f) ||
      /^evals\/workflow\//.test(f) ||
      /^evals\/src\//.test(f),
  );

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

// Static SKILL.md gate (eval:quality) covers every changed skill that exists — with or without evals.
// Not the whole catalog: a vendored upstream skill with a pre-existing lint error must not turn
// every unrelated PR red.
const qualitySkills = skillNames.filter((n) => artifactExists.skills(n));

write("skills", JSON.stringify(skills));
write("quality_skills", qualitySkills.join(" "));
write("agents", JSON.stringify(agents));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join("; "));
write("skipped_agents", skippedAgents.join("; "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`workflow tier : ${runWorkflow ? "run" : "skip"}`);
for (const s of skippedSkills) console.error(`SKIP skill ${s}`);
for (const a of skippedAgents) console.error(`SKIP agent ${a}`);

// Same picture on the run's summary page, so a skip is visible without opening the step log.
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const row = (k, v) => `| ${k} | ${v || "—"} |\n`;
  appendFileSync(
    summary,
    `### Eval selection${ALL ? " (all)" : ""}\n\n| tier | what |\n|---|---|\n` +
      row("skills → run", skills.join(", ")) +
      row("agents → run", agents.join(", ")) +
      row("workflow tier", runWorkflow ? "run" : "skip (no CLAUDE.md / agent / workflow change)") +
      row("⏭ skills skipped", skippedSkills.join("; ")) +
      row("⏭ agents skipped", skippedAgents.join("; ")) +
      "\n",
  );
}
