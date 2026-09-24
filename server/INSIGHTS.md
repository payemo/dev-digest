# Insights — `@devdigest/api`

Non-obvious decisions, gotchas, and learnings for this package that aren't
covered by [README.md](README.md) or [docs/](docs/) — `repo-intel` and the
`@devdigest/shared` contracts included. Append as they come up — the
`engineering-insights` skill knows the format.

## What Works

_Nothing yet._

## What Doesn't Work

### 2026-09-18 — Gate a seed's dependent-row insert on the dependent rows, not on "was the parent row just inserted"

`seedPr482Timeline()` was gated on `pr482IsNew` (true only when the PR row
itself was freshly inserted), so it silently no-op'd for any DB that already
had PR #482 — the rich timeline never landed. Gate on whether the PR has any
`agent_runs` row yet instead.
Evidence: `server/src/db/seed.ts` (the `existingRun` guard before `seedPr482Timeline`).

### 2026-09-21 — A dedupe key for LLM-proposed rows must never include user-editable text

The Conventions re-scan dedupe key first included the (normalized) rule text
alongside category + evidence location. The first time a user edited a
candidate's rule and then re-scanned, the edited row and the model's original
wording survived as two separate rows, because their keys now differed. Key
purely on the physical identity of the observation (category + evidence_path +
evidence_line) — never on text a human might change.
Evidence: `server/src/modules/conventions/helpers.ts` (`ruleKey`).

### 2026-09-24 — `now()` bakes in the column name `created_at`, so it cannot be reused for any other timestamp column

`db/schema/_shared.ts`'s helper is `timestamp('created_at', …)` — the name is
hardcoded, not derived from the property it is assigned to. Reusing it for a
differently named column silently produces a `created_at` column that
contradicts the contract. Spell out `timestamp(name, { withTimezone: true })`
for anything not actually called `created_at`.
Evidence: `server/src/db/schema/_shared.ts:9` vs the `derivedAt` column at
`server/src/db/schema/reviews.ts:99`.

### 2026-09-24 — Pointing a `FEATURE_MODELS` default at a provider the integration tests don't mock turns the hermetic lane live and billed

`container.llm(id)` falls through to the REAL provider when a test's `llm`
overrides lack that provider, taking the key from `~/.devdigest/secrets.json`.
Defaulting `review_intent` to `openrouter` made the review integration tests
issue a live ~11s call: 52/54 in 56.8s with a local key, vs 54/54 in 25.0s under
`env -u OPENROUTER_API_KEY HOME=<empty dir>`. So CI stays green while local dev
goes red, and which test loses the timeout race varies. Adding a feature to the
review pre-work means adding its provider to every review test's overrides.
Evidence: `server/src/vendor/shared/contracts/platform.ts:57`; failures in
`server/test/reviews.it.test.ts`.

## Codebase Patterns

### 2026-09-19 — A `reviews` row only ever exists for a successful run

`insertReview` has exactly one call site, and it sits *inside* the `try`
block of `runOneAgent`, right before the success-path `completeAgentRun(status:
'done')` — the `catch` block (failure/cancellation) never reaches it. So a
`reviews` row implies its producing `agent_runs` row was `status: 'done'` at
insert time; joining `reviews.run_id → agent_runs.id` to filter on `status`
is a no-op and unnecessary when aggregating findings/scores by review.
Evidence: `server/src/modules/reviews/run-executor.ts:219` (insert) vs `:244`
(success) and `:300-311` (failure/cancel, no insert).

### 2026-09-21 — A "links X to a run" join table belongs in `schema/runs.ts`, not X's own file

`run_skills` (skill -> agent_runs attribution) can't live in `schema/skills.ts`:
`skills.ts` importing `runs.ts` would close the cycle
`skills -> runs -> agents -> skills` (`agents.ts` already imports `skills.ts`
for the FK, and `runs.ts` imports `agents.ts`). `runs.ts` is the only
cycle-free home for any future run-attribution join table.
Evidence: `server/src/db/schema/runs.ts` (`runSkills`, with the doc comment
explaining the cycle).

### 2026-09-21 — Skill bodies are the one prompt block `assemblePrompt` does NOT wrap in `<untrusted>` — the enabled-on-create gate is security, not UX

`PromptParts.skills` is injected as trusted instructions (unlike diff/PR-body/
repo-map/specs/callers, which are all `wrapUntrusted`-ed). So
`mayBeEnabledOnCreate` forcing `enabled: false` for any non-`'manual'` source
is the ONLY thing between "user imports an archive" and "a stranger's text
becomes unwrapped model instructions." Never relax that gate without also
adding delimiter-wrapping to the skills block.
Evidence: `reviewer-core/src/prompt.ts:42` (`skills?: string[]` doc comment,
"trusted-ish"); `server/src/modules/skills/helpers.ts` (`mayBeEnabledOnCreate`).

### 2026-09-21 — A stats denominator over historical runs must exclude pre-feature rows, not just leave them uncounted in the numerator

`SkillStats.pull_frequency_pct`'s denominator (`linked_agent_runs`) only counts
runs with at least one `run_skills` row — i.e. runs from after this table
existed. Without that filter, every skill's pull frequency reads near-zero
forever, because old runs have no attribution rows at all. General pattern for
any join table added after the fact to attribute a new dimension onto
historical rows: the denominator query needs an explicit "has attribution"
guard, or it silently averages in a mountain of unattributed history.
Evidence: `server/src/modules/skills/repository.ts` (`runCounts`, the
`EXISTS (SELECT 1 FROM run_skills ...)` clause).

### 2026-09-21 — Depending on another module's write-side logic means promoting its Service onto the Container, not importing the class directly

When a new module needs another module's business logic (not just its
repository), promote that module's Service onto `Container` as a lazy getter —
the same way `repoIntel` already is — rather than `new OtherService(container)`
inside your own service. Added `container.skills` for this (Conventions
creates/updates the `repo-conventions` skill through it, going through
`SkillsService`'s own rules like the enabled-on-create gate). A module's own
`routes.ts` may still construct a local instance directly for its own
job-handler registration (`repo-intel/routes.ts` does this) — that's a
narrower, different case.
Evidence: `server/src/platform/container.ts` (`get skills()`);
`server/src/modules/conventions/service.ts`.

### 2026-09-24 — To keep a degradable enrichment's failure at `info`, the try/catch must sit INSIDE the function passed to `RunLogger.step`

`step()` catches, emits via `this.error(...)`, and rethrows — so a catch wrapped
*around* `step` still logs an `error` event and still propagates. In review
pre-work that propagation reaches `failAll` and fails every queued run.
`IntentService.ensureForRun` swallows internally instead, which is what lets
intent degrade to a single `info` line while the review continues.
Evidence: `server/src/platform/run-logger.ts:87-90` vs
`server/src/modules/intent/service.ts:168-188`.

## Tool & Library Notes

### 2026-09-21 — `drizzle-kit generate` prompts interactively when one pass both drops and adds columns on the same table, and the prompt can't be answered non-interactively

Dropping an old column and adding new ones to the same table in one schema
edit makes drizzle-kit ask "Is `<col>` created or renamed from `<old_col>`?" —
an arrow-key TTY prompt. Piped stdin does not answer it; the process just
exits without generating a migration. Split the change into two schema edits
+ `pnpm db:generate` passes instead: add the new columns first (nothing
dropped, no rename guess needed), then drop the old one in a second pass.
Evidence: `server/src/db/schema/knowledge.ts` (the `conventions` table's
`category`/`rationale`/`evidence_line`/`status`/`updated_at` columns added in
migration `0013_solid_pepper_potts.sql`, `accepted` dropped in
`0014_steep_molten_man.sql`).

### 2026-09-20 — `exclude: node_modules` makes every dependency-cruiser npm rule pass vacuously

`exclude` removes matching modules from the graph entirely, so a rule whose
`to` names an npm package (`fastify`, `drizzle-orm`, …) matches nothing and the
whole config reports "no dependency violations found" while enforcing nothing.
Use `doNotFollow` — it keeps the node and only skips traversal into it. Always
confirm a new rule fires by introducing a deliberate violation.
Evidence: `server/.dependency-cruiser.cjs` (`options.doNotFollow`, and the
comment above it).

### 2026-09-20 — Under pnpm, an anchored package regex in a depcruise `to.path` never matches

`to.path` is tested against the *resolved* path. pnpm resolves to
`node_modules/.pnpm/fastify@5.8.5/node_modules/fastify/fastify.js`, so `^fastify`
matches nothing. Match the trailing segment instead — `node_modules/(fastify)/`
— which is correct on both pnpm and npm. `server/.dependency-cruiser.cjs` wraps
this in a `pkg(...names)` helper.
Evidence: `server/.dependency-cruiser.cjs:41` (`const pkg = ...`).

### 2026-09-20 — `no-circular` needs `viaOnly.dependencyTypesNot`, not `to.dependencyTypesNot`, to ignore type-only cycles

`to.dependencyTypesNot: ['type-only']` filters only the cycle's *first* hop, so
a cycle whose first edge is a value import still reports even when a later hop
is type-only. `to.viaOnly.dependencyTypesNot: ['type-only']` requires *every*
hop to be non-type-only, which is what "ignore compile-time-erased cycles"
actually means. This matters here because `import type { Container }` in a
service and `import type { FooRow } from './repository.js'` in a helper both
create type-only cycles by design.
Evidence: `server/.dependency-cruiser.cjs` (the `no-circular` rule).

## Recurring Errors & Fixes

### 2026-09-20 — depcruise: "has an unsafe regular expression. Bailing out."

dependency-cruiser runs a ReDoS check over every rule regex and refuses the
whole run — not just the rule — when one has a nested quantifier.
`^src/modules/[^/]+/repository(/[^/]+)?\.ts$` is rejected. Split it into an
array of two plain alternatives (`.../repository\.ts$` and
`.../repository/[^/]+\.ts$`); `path` accepts a string or an array.
Evidence: `server/.dependency-cruiser.cjs` (`const REPOSITORY`).

### 2026-09-18 — An integration test's fixture assumptions go stale silently when a shared seed changes

`run-cost.it.test.ts` asserted PR #482 sums to exactly `0.43` on the claim it
"has zero `agent_runs`" — but `seedPr482Timeline` (added later) gives it two
real `done` runs ($0.0012 + $0.0008), so the true sum is `0.432`. The test
kept passing at the wrong number until an unrelated `status='done'` filter
change perturbed the total enough to fail.
Evidence: `server/test/run-cost.it.test.ts`.

## Open Questions

_Nothing yet._
