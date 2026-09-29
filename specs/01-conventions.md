# Spec — Conventions Extractor (repo → candidates → skill)

Status: **implemented** (2026-09-21) · Scope: `server/` · `client/` · shared contracts

Scan a cloned repository for the house rules it already follows, show each one
with the code that proves it, let a maintainer Accept / Reject / Edit them, and
merge the accepted set into a `repo-conventions` skill.

The feature's whole design premise: **a model is good at noticing a pattern and
bad at remembering where it saw it.** So the model only ever proposes; code
chooses what it reads and code verifies what it claims.

```
repo-intel + config wish-list      ONE cheap structured call        re-read the file
        │                                    │                              │
   ┌────▼─────┐   line-numbered  ┌───────────▼──────────┐   candidates ┌────▼──────┐   pending rows
   │  SAMPLE  ├─────listing─────►│       PROPOSE        ├─────────────►│  VERIFY   ├──────────────►
   │  (code)  │                  │       (model)        │              │  (code)   │
   └──────────┘                  └──────────────────────┘              └───────────┘
```

## 1. Decisions taken

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | Sampling is **100% code**, never a model call | deterministic cost, reproducible scan; the model cannot browse or choose files |
| D2 | The evidence gate is **code, not a second model** | a candidate whose snippet is not in the cited file is *dropped*, not "low-confidence" |
| D3 | The displayed snippet is **re-read from the file**, not the model's text | the UI cannot show a paraphrase as if it were code |
| D4 | A wrong line number is **corrected**, not fatal | miscounting is a formatting slip; inventing code is not |
| D5 | Triage is a three-state `status` (`pending`/`approved`/`rejected`) | a re-scan replaces only `pending`, so a decided rule never comes back |
| D6 | Re-scan dedup keys on **evidence location + category**, never on rule text | editing a rule's wording can't split it into two rows on the next scan |
| D7 | The model comes from `Settings → Feature Models → Conventions` | picking a cheap model is a user setting, not a hardcoded constant |
| D8 | Linking the created skill to an agent is the **existing Agents → Skills** flow, not automated | reuses the additive `POST /agents/:id/skills` link the Skills feature already ships; no new UI surface for a one-click action the product already has |

## 2. Data model

`server/src/db/schema/knowledge.ts`'s `conventions` table, extended by
migrations `0013_solid_pepper_potts.sql` (add) and `0014_steep_molten_man.sql`
(drop the old `accepted` boolean — split into two passes because drizzle-kit's
rename-detection prompt can't be answered non-interactively when a drop and an
add happen in the same pass; see `server/INSIGHTS.md`):

| Column | Why |
|--------|-----|
| `category` | grouping chip + skill section; one of 8 fixed values, `text({enum})` (this schema does not use Postgres `CHECK` constraints anywhere — narrowing is TS-only, matching every other enum column in the file) |
| `rationale` | one sentence on what a reviewer should flag; editable, nullable |
| `evidence_line` | 1-based, **as verified by code**, not as claimed by the model |
| `status` | `pending` / `approved` / `rejected` |
| `created_at` / `updated_at` | ordering + change tracking |

## 3. Contracts

`ConventionCandidate` (extended in place, `server/src/vendor/shared/contracts/knowledge.ts`)
plus a new sibling file `contracts/conventions.ts` — `ConventionExtractResult`,
`ConventionUpdate`, `ConventionSkillDraft`, `ConventionSkillCreate` — mirroring
how `skills.ts` splits module DTOs out of `knowledge.ts` while the entity type
stays there. Hand-mirrored byte-for-byte into `client/src/vendor/shared/`.

## 4. Server — `src/modules/conventions/`

| File | Holds |
|------|-------|
| `constants.ts` | sample sizes, per-file and whole-sample caps, gate thresholds |
| `prompt.ts` | `ExtractionSchema` (`schemaName: 'ConventionExtraction'`) + the system prompt |
| `helpers.ts` | pure: sample rendering, the evidence gate, dedupe, DTO, skill assembly |
| `repository.ts` | `conventions` table only |
| `service.ts` | the three stages + skill draft/create orchestration |
| `routes.ts` | the six endpoints |

```
GET    /repos/:id/conventions              → candidates for the repo
POST   /repos/:id/conventions/extract      → scan (one model call)
GET    /repos/:id/conventions/skill-draft  → skill DRAFT from approved (writes nothing)
POST   /repos/:id/conventions/skill        → create/replace `repo-conventions`
PATCH  /conventions/:id                    → accept / reject / edit
DELETE /conventions/:id                    → drop a candidate
```

### 4.1 Sampling (stage 1, no model)

A config-file wish-list (package.json, tsconfig, eslint/prettier/editorconfig,
CONTRIBUTING/CLAUDE/AGENTS.md — a missing one is skipped silently) followed by
`repoIntel.getConventionSamples(repoId, 12)`. Every file is rendered with a
**1-based line-number gutter** inside a `wrapUntrusted()` block — that gutter is
what makes a citation checkable, and the wrapping is this repo's one shared
prompt-injection defense (`reviewer-core/src/prompt.ts`'s `wrapUntrusted`,
`assemblePrompt`'s `INJECTION_GUARD` itself is private to the review domain and
not reusable verbatim here, so the system prompt states the equivalent rule for
this domain directly). A repo with nothing readable 422s before any model call.

### 4.2 Proposal (stage 2, the only model call)

One `completeStructured` at `temperature 0.1`, model resolved via
`resolveFeatureModel(container, workspaceId, 'conventions')` — never a
constant.

**Schema field order is load-bearing**, same finding as the reverted prior
attempt at this feature (`git show 641b637:docs/specs/conventions.md`):
`category` and `confidence` must come *after* `rule` and its evidence in
`ExtractionSchema`, because structured-output field order is generation order —
a model asked for its category before it has written the rule commits to a
label (and a flat score) before it knows what it's about to say.

### 4.3 The evidence gate (stage 3, no model)

`verifyCandidate()` checks, in order: rule non-empty; cited path has no `..`
traversal and resolves to a sampled file (exact match, or a *unique* suffix
match — ambiguous suffixes are not guessed); line is a sane integer; snippet is
substantial (`>= MIN_SNIPPET_CHARS` after stripping a leading comment marker) —
**a snippet whose first line is entirely a comment is rejected outright**,
regardless of length, since a comment proves nothing about the code itself;
snippet is actually found in the file (whitespace/case-insensitive, nearest to
the claimed line wins); confidence is in `[0, 1]`. The kept snippet is sliced
**from the file**, never from the model's text, and a wrong line number is
corrected rather than treated as fatal.

### 4.4 Re-scan and the dedupe key

A scan writes through `repository.replacePending`, which deletes only
`pending` rows for the repo and inserts the freshly-verified set — approved and
rejected rows are never touched. Before insert, candidates are deduped against
each other and against every already-decided row's `ruleKey` — **keyed on
category + evidence_path + evidence_line, deliberately not on rule text**, so
a user's edit to the wording can't cause the model's original phrasing to
reappear as a second row on the next scan (see `server/INSIGHTS.md`).

### 4.5 Skill creation and the `repo-conventions` conflict

The draft is built from **approved rows only**, grouped by category, each rule
citing `` `path:line` ``, via `container.skills` — a `SkillsService` promoted
onto the composition root the same way `repoIntel` already is, so Conventions
creates/updates the skill through Skills' own rules rather than around them.

Two frictions handled deliberately:

- **`mayBeEnabledOnCreate` only allows `source: 'manual'`** — the skills
  block is the one prompt section `assemblePrompt` does not wrap in
  `<untrusted>`, so this gate is the only thing between a non-typed body and
  unwrapped model instructions (`server/INSIGHTS.md`). Conventions creates with
  `source: 'extracted'` (lands disabled) and, only when the user left the
  modal's `Enabled` toggle on, follows with a second `update({enabled: true})`
  — the human enabling it *is* that toggle, on a body they just read and
  edited. `mayBeEnabledOnCreate` itself is untouched.
- **Name conflict** — an existing skill under the requested name (default
  `repo-conventions`) 409s with `existing_skill_id` in the error details
  instead of silently duplicating or overwriting; the modal offers an explicit
  "Replace existing" that re-submits with `replace_skill_id`, landing as a new
  **version** of that skill via `SkillsService.update`.

## 5. Client

`client/src/app/repos/[repoId]/conventions/` — repo-scoped route, nav entry
under **SKILLS LAB** (`client/src/vendor/ui/nav.ts`). Six scan states (initial,
scanning, results, no-valid-candidates, recoverable error, creating-skill), all
driven from server state — "no valid candidates" vs. "never scanned" is
disambiguated by whether a scan mutation resolved this session, since both
states return an empty list from `GET /repos/:id/conventions`.

`ConventionCard`'s Edit is fully inline (Save/Cancel swap the rule + category
into inputs in place, no navigation, no second modal); Accept/Reject are
toggles that revert to `pending` on a second click of the same button.
`CreateSkillModal` seeds Name/Description/Type/Enabled/Body from the draft,
all editable, and posts the user's edited body verbatim — never a
silently-regenerated one.

## 6. Testing

| Lane | File | Covers |
|------|------|--------|
| server unit | `test/conventions-helpers.test.ts` (25) | gutter rendering, budget cutoff, every gate outcome including comment-only and traversal, line correction, ambiguous-suffix rejection, dedupe key stability under an edited rule, skill-draft assembly |
| server unit | `test/conventions-prompt.test.ts` (10) | `ExtractionSchema`: valid, malformed, missing fields, invalid enum/line/confidence |
| server integration | `test/conventions.it.test.ts` (9) | sampling before the one LLM call, valid persists, invented evidence dropped, malformed response → controlled error with nothing persisted, 404, empty-result success, model from settings not a constant, accept/reject/edit persistence, re-scan preserving decisions without duplication, zero-approved skill create rejected, skill visible via `GET /skills`, name-conflict → 409 → versioned replace |
| client unit | `helpers.test.ts` (11) | status counts, filtering, confidence formatting, GitHub evidence links |
| client component | `ConventionCard.test.tsx` (8), `CreateSkillModal.test.tsx` (5), `page.test.tsx` (7) | rendering, Accept/Reject toggles, inline edit, double-click guard, Create-skill gating, conflict → replace flow |

`pnpm exec depcruise src --config .dependency-cruiser.cjs` (server) is clean —
no onion-architecture layering violations introduced.

## 7. Known limitation

Linking the created `repo-conventions` skill to a reviewing agent is a manual
step on **Agents → Skills** (the existing additive link), not automated by this
feature — see D8. The endpoint (`POST /agents/:id/skills {skill_id}`) already
supports doing this from the modal if a future iteration wants it.
