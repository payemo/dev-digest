---
name: dependency-checker
description: >
  Audits the dependencies of every package in this repo (server, client,
  reviewer-core, e2e, mcp, evals) and produces one structured report: a Mermaid
  dependency map, a per-package size breakdown (own + transitive weight on
  disk), health findings (unused, undeclared, version drift, misplaced, outdated,
  vulnerable), and a prioritized action list with advice. Use for "/dependency-checker",
  "check our dependencies", "what is the heaviest package", "dependency audit",
  "draw the dependency graph", "what can we remove / upgrade", "why is node_modules
  so big". Read-only — it never edits manifests, lockfiles or installs anything;
  it does NOT upgrade packages (that is a separate, explicit step).
---

# Dependency checker

One run → one report in a fixed shape (see [report-template.md](report-template.md)).
Numbers come from a script, never from estimation; judgement (priority, advice)
comes from you, and must cite those numbers.

Read-only by contract: no `pnpm add/remove/update`, no `npm install`, no
lockfile or `package.json` edits — those break
[root CLAUDE.md](../../../CLAUDE.md#do-not-touch). Output is a report only.

Flags: `--pkg=server,client` (limit packages) · `--online` (also run phase 2's
network checks) · `--save` (write the report to `docs/dependency-reports/YYYY-MM-DD.md`).
Default is offline, report printed in chat.

## Phase 0 — scope

Packages are the folders with a `package.json` (root has none — no workspace).
Managers differ: `server`/`client`/`evals` → pnpm, `reviewer-core`/`e2e`/`mcp` →
npm. If a package has no `node_modules`, say so in the report and skip its sizes
(`n/a`, never `0`) — don't install to fill the gap.

## Phase 1 — collect (deterministic, offline)

```bash
node .claude/skills/dependency-checker/scripts/collect.mjs [--pkg=a,b] > <scratchpad>/deps.json
```

The JSON gives, per package: manager, dep counts by kind, `installedBytes`
(de-duplicated), and for every dependency `ownBytes`, `totalBytes` (own +
transitive closure), `transitiveCount`, `importedInFiles`, `unusedCandidate`,
`misplaced`, `undeclaredImports`. Cross-package: `internalEdges` (tsconfig path
aliases — `server → reviewer-core`, `* → shared`), `duplicates`, `drift`.

Read `notes` in the JSON before interpreting sizes: `totalBytes` of different
deps **overlap**, so never sum them; sizes are on-disk bytes, not bundle or
gzip size. `unusedCandidate` is a static heuristic — **verify with a grep
before recommending removal** (CLI tools, config-loaded plugins, dynamic
imports false-positive).

## Phase 2 — enrich (only with `--online`, otherwise mark "not checked")

Run from each package dir, with its own manager; capture, don't fix:

| Check | pnpm (`server`, `client`, `evals`) | npm (`reviewer-core`, `e2e`, `mcp`) |
|---|---|---|
| Outdated | `pnpm outdated --format json` | `npm outdated --json` |
| Vulnerabilities | `pnpm audit --json` | `npm audit --json` |

A non-zero exit from these commands means "found something", not "failed".
If the network is unavailable, report the section as `not checked (offline)` —
an absent section must never read as "all clean".

## Phase 3 — analyse

Derive, from the JSON (and phase 2 if run):

1. **Weight** — top 10 deps repo-wide by `totalBytes`; per package the share of
   `installedBytes` taken by its top 3. Separate **prod** from **dev**: a heavy
   devDependency costs install time, a heavy prod one costs deploy/runtime.
2. **Hygiene findings**, each with the package and evidence:
   - *unused candidate* (verified by grep) · *undeclared import* · *misplaced*
     (dev tool in `dependencies`) · *version drift* (same dep, different ranges
     across packages — name the split) · *duplicate heavy dep* (same large dep
     in 2+ packages).
   - *Outdated* (major vs minor/patch) and *vulnerabilities* (by severity), if
     phase 2 ran.
3. **Repo-specific traps** — check, don't assume:
   - `@devdigest/*` aliases are source-shared, so they add **no** installed
     weight but do couple packages: flag a new edge that breaks the intended
     direction (`reviewer-core` must not depend on `server`; it stays pure — see
     its CLAUDE.md).
   - `server/package.json` is `skip-worktree`: the working-tree copy may differ
     from git. Say which one the report reflects if it matters.
   - Don't recommend turning packages into a workspace or hoisting
     deps to dedupe drift — the split is deliberate. Align *ranges* per package
     with its own manager instead.

## Phase 4 — prioritise

Score every action, then sort. Use the fixed scale:

| Priority | Meaning | Examples |
|---|---|---|
| **P0 — now** | Security or breakage risk | high/critical advisory in a prod dep; undeclared import that works only by hoisting |
| **P1 — soon** | Clear, cheap, measurable win | verified-unused dep ≥ 5 MB; dev tool in `dependencies`; drift on a core lib |
| **P2 — planned** | Worth doing, needs effort or a decision | major-version upgrade; replacing a heavy dep with a lighter one |
| **P3 — nice to have** | Marginal | patch/minor bumps; small unused dev deps |

Rank within a tier by `bytes saved ÷ effort`, then by blast radius. Every action
states **what**, **where** (package), **why** (the number), **how** (the exact
command for that package's manager — written as advice for a human to run, not
executed by you), and **risk**. An empty P0 is a good result; don't invent
items to fill tiers, and don't inflate priority — only a security or breakage
risk is P0.

## Output contract

Emit exactly the sections of [report-template.md](report-template.md), in
order, with no extra top-level sections. Rules:

- Sizes as human units (`MB`, one decimal) with the raw package count beside them.
- Every claim about a dependency carries its package and a number or file reference.
- Sections that were not run say `not checked` + why — never silently omitted.
- The diagram is Mermaid (see [mermaid-diagram](../mermaid-diagram/SKILL.md)):
  one node per package, edges from `internalEdges`, node labels carry
  `installed MB`. Heavy-dependency diagram is a second chart, capped at 10 nodes.
- Close with **Verdict** (a one-line health summary) and the P0/P1 count — the
  part a developer reads first.
