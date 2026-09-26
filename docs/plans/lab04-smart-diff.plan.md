# Development Plan: Smart Diff (L04) — group PR files by role and surface review findings inside the diff

**Branch:** `lab04-smart-diff` · **Date:** 2026-09-24
**Packages touched:** server · client · shared (`server/src/vendor/shared`)
**Estimated steps:** 17 · **Migration required:** no · **Contract change:** yes (enum widened, additive)

## Goal

After this is implemented, the **Files changed** tab no longer shows GitHub's
raw file order. A new `GET /pulls/:id/smart-diff` endpoint classifies every
changed file into one of five roles — `core` → `tests` → `wiring` → `docs` →
`boilerplate` — with a pure, HTTP-free `classifyFile(path)` function, and the
client renders one collapsible group per role (label + file count; `docs` and
`boilerplate` collapsed on open). The review's findings appear **inside** the
diff: a dot on every file card that has one, a per-group counter of
files-with-findings, and, under the matching code line, a finding comment with
severity, title, rationale and working Accept/Dismiss — plus a coloured stripe
and a `blocker`/`warning`/`suggestion` label on the line itself. An "Original
order" toggle restores GitHub's order. Grouping involves **no LLM call and no
new table**, and works on a PR that has never been reviewed.

## Inputs read

| File | What it constrained |
|---|---|
| `CLAUDE.md:59-83` (Non-default conventions) | No workspace; pnpm for server/client; `@devdigest/shared` is the one contract source; `*.it.test.ts` is the lane split |
| `CLAUDE.md:108-127` (Do not touch) | No hand-edited migrations, no lockfile edits — this plan needs neither |
| `server/CLAUDE.md:36-49` (Naming) | Module split `routes.ts`/`service.ts`/`repository.ts`/`helpers.ts`; contracts are PascalCase const+type; camelCase column → snake_case wire |
| `server/CLAUDE.md:53-55` | Routes validate via zod `params`/`response` schemas, never a hand-rolled parse |
| `server/CLAUDE.md:61-62` | A DB-backed test file must use `*.it.test.ts` |
| `server/INSIGHTS.md:100-112` | Cross-module dependency on another module's **Service** goes through a `Container` getter — which is why this plan's pure classifier does *not* get one (it is a helper, not a service) |
| `server/INSIGHTS.md:42-52` | Adding work to the review pre-work path can turn the hermetic lane live and billed — this feature deliberately stays off the review run path entirely |
| `client/CLAUDE.md:28-44` (Naming) | Route-local `_components/<PascalCase>/` with `<Name>.tsx` + `index.ts` + `<Name>.test.tsx`; shared components are `src/components/<kebab-case>/`; DTO fields stay snake_case |
| `client/CLAUDE.md:48-49` | Never `fetch` from a component — one TanStack Query hook per server call |
| `client/CLAUDE.md:62-63` | Don't duplicate a `src/vendor/ui` primitive |
| `client/INSIGHTS.md:17-24` | `SeverityBadge` is a `<span>`, `Chip` is a `<button>` — the severity label on a diff line must be queried as text, not as a role=button |
| `client/INSIGHTS.md:73-80` | Vendored `Badge` takes no `title` prop — a tooltip needs a wrapping `<span title>` |
| `TESTING.md:63-69` | The verbatim server/client test commands used in the Test plan |
| `TESTING.md:78-95` (Conventions) | `*.it.test.ts` suffix is the lane split; mock at `server/src/adapters/mocks.ts`; CI is path-filtered per package |
| `.claude/skills/onion-architecture/SKILL.md` "Decision table" | Pure transform → `modules/<domain>/helpers.ts`; magic numbers/pattern tables → `modules/<domain>/constants.ts`; HTTP endpoint → `modules/<domain>/routes.ts` |
| `.claude/skills/onion-architecture/SKILL.md` §8 | Cross-cutting repositories are built on the Container (`container.reviewRepo`) so one module never reaches into another's data layer; **new services should take explicit deps rather than `Container`** |
| `.claude/skills/onion-architecture/SKILL.md` §9 | `pulls/routes.ts` is a listed violation — "do not add a new query to them" |
| `.claude/skills/frontend-code-organization/SKILL.md` §1 | "Promote on the second **route** consumer, not before"; never import another route's `_components/` |
| `.claude/skills/frontend-code-organization/SKILL.md` §5, §8 | User-facing strings live in `messages/<locale>/<area>.json`, never in a `constants.ts`; a shared folder's `index.ts` **is** its public API (`diff-viewer/index.ts` is cited there as the model to copy) |
| `.claude/skills/pr-self-review/routing.md:12-58` | The lane lookup reproduced in *Skills the implementer will apply* |

## Architectural constraints binding this change

- **The endpoint belongs in a new `smart-diff` module — and the binding reason
  is the module registry, not a debt list.** Verified against the tree:
  `server/src/modules/pulls/routes.ts` is now **64 lines with zero
  `drizzle-orm`/`db/schema` references**, and `server/.dependency-cruiser.cjs:53-57`
  records that `pulls` and `polling` were already extracted into
  `pulls/repository.ts` + `pulls/service.ts`; the remaining legacy list is
  `^src/modules/(settings|workspace)/(routes|feature-models)\.ts$`
  (`.dependency-cruiser.cjs:57`). The "397 lines, ~12 inline queries" framing is
  therefore **stale**. The conclusion is unchanged, resting on the real reason:
  `server/src/modules/index.ts:24` names `intent/smart-diff` as a per-lesson
  module by design, and the registry is how a lesson feature is added "without
  touching any other module or the shared schema"
  (`server/src/modules/index.ts:23-25`). *Observation, no action:*
  `.claude/skills/onion-architecture/SKILL.md` §9 still carries the same stale
  text about `pulls/routes.ts` — it is a vendored skill and this plan does not
  change it.
- **A lesson feature is its own module registered in `modules/index.ts`**, which
  already names `intent/smart-diff` as a per-lesson module by design — source:
  `server/src/modules/index.ts:24`, and the `intent` entry at
  `server/src/modules/index.ts:10,36`.
- **The route template is `intent/routes.ts`**: `async function xRoutes(appBase:
  FastifyInstance)`, `.withTypeProvider<ZodTypeProvider>()`, the service
  constructed **once above the handlers**, `schema: { params: IdParams,
  response: { 200: … } }`, `getContext` first in every handler — source:
  `server/src/modules/intent/routes.ts:20-31`; `IdParams` at
  `server/src/modules/_shared/schemas.ts:11`; `getContext` at
  `server/src/modules/_shared/context.ts:14-23`.
- **PR files are read through the cross-cutting review repository**, not a
  newly constructed `PullsRepository` — `getPrFiles(prId)` at
  `server/src/modules/reviews/repository.ts:39-41`, exposed by the
  `container.reviewRepo` getter at `server/src/platform/container.ts:105-107`
  (onion §8: "cross-cutting repositories are built here so one module never
  reaches into another module's data layer").
- **"Latest review" is the first row of `reviewsForPull`**, which orders
  `desc(t.reviews.createdAt)` — source:
  `server/src/modules/reviews/repository/review.repo.ts:57-74`, exposed at
  `server/src/modules/reviews/repository.ts:64-66`.
- **A Drizzle row must never reach an HTTP response.** `reviewsForPull` returns
  `FindingRow[]` (camelCase `startLine`); the service maps to the snake_case
  contract before returning — source: `.claude/skills/onion-architecture/SKILL.md`
  §4; the existing row→DTO mapper at
  `server/src/modules/reviews/helpers.ts:35-54`.
- **`helpers.ts` is pure**: no `Container`, no I/O, unit-testable with no mocks
  — source: `.claude/skills/onion-architecture/SKILL.md` §5. This is what makes
  `classifyFile` importable without HTTP for L08.
- **`@devdigest/shared` is the one contract source, and the client keeps a
  byte-identical physical copy** enforced in CI by
  `diff -r client/src/vendor/shared server/src/vendor/shared` — source:
  `CLAUDE.md:66-69`; `.github/workflows/client.yml:50`;
  `.github/workflows/server-unit.yml:55`. There is no symlink and no sync
  script: edit the server copy, hand-copy it over the client copy, commit both.
  (Verified clean at plan time: `diff -r` reports no differences.)
- **Never `fetch` from a component** — one TanStack Query hook per server call,
  in `src/lib/hooks/*` — source: `client/CLAUDE.md:48-49`;
  `.claude/skills/frontend-code-organization/SKILL.md` §7.
- **A shared component may not import route-local code.** `DiffViewer` lives in
  `client/src/components/diff-viewer/`; `FindingCard` lives in
  `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/`.
  Source: `.claude/skills/frontend-code-organization/SKILL.md` §1 ("never import
  another route's `_components/`"). See **D3**.
- **User-facing strings go in `client/messages/en/prReview.json`**, never in a
  `constants.ts`; colours map to CSS custom properties, never hex — source:
  `.claude/skills/frontend-code-organization/SKILL.md` §5. `en` is the only
  locale.
- **`diff-viewer/index.ts` is that folder's whole public API** — it exports
  exactly `DiffViewer` and the `DiffCommentApi` type today
  (`client/src/components/diff-viewer/index.ts:3-4`), and the skill cites it as
  the model to copy. Any new prop type must be added there explicitly.
- **No new dependency.** Glob matching is done with plain regexes; `picomatch`/
  `minimatch` are not installed and adding one would touch a lockfile for a
  40-line matcher (`CLAUDE.md:114-118`).

## Skills the implementer will apply

Lookup per `.claude/skills/pr-self-review/routing.md`.

| Path to be touched | Lane | Skills (per routing.md) |
|---|---|---|
| `server/src/modules/smart-diff/routes.ts` (new) | backend + cross-cutting | fastify-best-practices, onion-architecture, zod (routing.md:14); **security** — the added lines declare a new public route (routing.md:68) |
| `server/src/modules/smart-diff/service.ts` (new) | backend | onion-architecture (routing.md:16) |
| `server/src/modules/smart-diff/helpers.ts` (new) | backend | onion-architecture (routing.md:16) |
| `server/src/modules/smart-diff/constants.ts` (new) | backend | onion-architecture — no exact row; nearest is routing.md:16 (a non-route file under `server/src/modules/**`) |
| `server/src/modules/index.ts` (edit) | backend | fastify-best-practices, onion-architecture (routing.md:15 — plugin registration) |
| `server/src/vendor/shared/contracts/brief.ts` (edit) | backend | zod, plus `RULE-CONTRACT-SYNC` and `RULE-CONTRACT-BREAK` (routing.md:23) |
| `server/test/smart-diff-classify.test.ts`, `server/test/smart-diff-service.test.ts`, `server/test/smart-diff.it.test.ts` (new) | backend | **none** — `RULE-IT-SUFFIX` only (routing.md:25) |
| `client/src/vendor/shared/contracts/brief.ts` (mirror edit) | frontend | **none** — `RULE-VENDOR`, `RULE-CONTRACT-SYNC` (routing.md:44) |
| `client/src/lib/hooks/reviews.ts`, `client/src/lib/hooks/keys.ts` (edit) | frontend | react-best-practices, frontend-code-organization (routing.md:39) |
| `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx`, `FileCard/FileCard.tsx`, `CodeLine/CodeLine.tsx` (edit) | frontend | react-best-practices, frontend-code-organization (routing.md:38) |
| `client/src/components/diff-viewer/findings.ts` (new), `styles.ts`, `index.ts` (edit) | frontend | frontend-code-organization — no exact row (routing.md:38 covers `.tsx` only); nearest non-hook `.ts` rule is routing.md:40 |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffGroups/**` (new folder) | frontend | react-best-practices, frontend-code-organization — *placement is the point* (routing.md:37, :43) |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (edit) | frontend | react-best-practices, frontend-code-organization (routing.md:37) |
| `client/messages/en/prReview.json` (edit) | frontend | frontend-code-organization — strings live here, never in constants (routing.md:41) |
| `client/**/SmartDiffGroups.test.tsx`, `DiffTab.test.tsx`, `FileCard.test.tsx` (new) | frontend | react-testing-library (routing.md:42) |
| `docs/plans/lab04-smart-diff.plan.md` (this file) | **no lane** | none — `docs/**` is uncovered by design (routing.md:52); it contains no Mermaid block, so the routing.md:58 exception does not apply |

Cross-cutting lanes checked and **not** triggered: `typescript-expert`
(routing.md:70) — no `any`, no `as unknown as`, no new generic signature, no
`.d.ts`; `drizzle-orm-patterns` (routing.md:71) — no Drizzle call is added
outside a repository file, and this plan adds **no** query at all;
`postgresql-table-design` — no schema file is touched.

---

## Design decisions (settled here so no step re-litigates them)

### D1 — The classifier is a pure helper, not a Container-mounted service

Two shapes were on the table, and L08 decides between them: on L08 the same
classifier runs as a **filter before prompt assembly**, i.e. it is called from
the reviews prompt path, not from a route.

**Decision:**

- `classifyFile(path): SmartDiffRole` and `groupFilesByRole(files)` live in
  `server/src/modules/smart-diff/helpers.ts`; the pattern table and the role
  order live in `server/src/modules/smart-diff/constants.ts`. The
  onion-architecture decision table puts a *pure transform* in `helpers.ts` and
  *magic numbers / pattern tables* in `constants.ts`, and §5 requires a helper
  to be unit-testable with no mocks and no container.
- **No Container entry.** `server/INSIGHTS.md:100-112` is specific: it is
  another module's **Service** (write-side business logic) that must be promoted
  onto `Container`. A pure function has no lifetime, no dependencies and no
  state to share; L08 imports it directly
  (`import { classifyFile } from '../smart-diff/helpers.js'`) with no runtime
  coupling beyond the function itself, and no layer inversion — `helpers.ts` and
  the reviews prompt path sit in the same application layer.
- `SmartDiffService` is constructed **in `smart-diff/routes.ts` only**, the
  narrower case that `server/INSIGHTS.md:108-110` explicitly allows and that
  `server/src/modules/intent/routes.ts:22` already does. It is promoted onto
  `Container` the day a second module calls it — which L08 will not, because
  L08 needs the classifier, not the HTTP use case.
- Its constructor takes the repository **typed as `Container['reviewRepo']`** —
  not the concrete `ReviewRepository` class, and not the whole `Container`. This
  is load-bearing, not style: naming the class forces
  `import … from '../reviews/repository.js'` inside `smart-diff/service.ts`, and
  that edge trips **`no-cross-module-repository`**
  (`server/.dependency-cruiser.cjs:246-258` — `from: '^src/modules/([^/]+)/'` →
  `to: '^src/modules/([^/]+)/repository'` with `pathNot: '^src/modules/$1/'`,
  severity `warn`). `import type` does **not** escape it:
  `tsPreCompilationDeps: true` (`.dependency-cruiser.cjs:300`) puts type-only
  imports in the graph, and unlike `no-circular` (`:271`, which carries
  `viaOnly: { dependencyTypesNot: ['type-only'] }`) this rule has no type-only
  exemption. No such edge exists anywhere under `server/src/modules/` today, so
  it would be the first. The indexed-access type is the idiom already in use:
  `server/src/modules/reviews/service.ts:31` declares
  `private agents: Container['agentsRepo'];`.
  **Correction to an earlier reading of this plan:** onion §8's "new services may
  take explicit **ports**" does not justify the shape — `ReviewRepository` is a
  concrete infrastructure class, not a port from
  `server/src/vendor/shared/adapters.ts`, so §8 never covered it. The real
  justification is narrower and stronger: one dependency, resolved at the call
  site by the composition root (`new SmartDiffService(app.container.reviewRepo)`,
  Step 7), which keeps the unit test a two-line fake instead of a container
  override and keeps the module graph clean.

### D2 — Classification rules: ordered, first match wins

One ordered table in `constants.ts`. Order is the rule, not an implementation
detail — the three contested cases below exist to prove it.

| # | Role | Globs (as written in the lesson spec) |
|---|---|---|
| 1 | `boilerplate` | `*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `dist/**`, `build/**`, `**/__snapshots__/**`, `*.snap`, `*.generated.*`, `*.min.js` |
| 2 | `tests` | `**/*.test.ts(x)`, `**/*.it.test.ts`, `**/*.spec.ts`, `**/test/**`, `**/tests/**`, `**/__tests__/**`, `e2e/**` |
| 3 | `wiring` | `index.ts`/`index.js` (barrels), `*.config.*`, `tsconfig*.json`, `.eslintrc*`, `.env*`, `docker-compose*.yml`, `.github/**`, `.claude/**` |
| 4 | `docs` | `**/*.md`, `docs/**`, `README*`, `CHANGELOG*`, `LICENSE` |
| 5 | `core` | everything else (the fallthrough) |

Matching order is **the array order**, and `ROLE_ORDER = ['core', 'tests',
'wiring', 'docs', 'boilerplate']` is a *separate* constant: the display order is
not the matching order, and conflating the two is the bug this note prevents.

**`e2e/README.md` → `tests`, recorded deliberately.** Under first-match-wins,
rule 2's `e2e/**` fires before rule 4's `**/*.md`, so the e2e package's README
is grouped with tests rather than docs. We keep it: the alternative — hoisting
`docs` above `tests` — would drag every in-package test README out of the test
bucket and, worse, would put `.claude/**` markdown into `docs` instead of
`wiring`, breaking the second contested case. One package's README landing next
to its tests is a smaller wrong answer than either alternative. **Settled by the
user: keep this order, no `README*` carve-out.** The rationale above and the
`e2e/README.md → tests` row in Step 4's table stand as written; this is no longer
an open question.

### D3 — Findings in the shared viewer: a generic render slot (option b)

The tension: `DiffViewer` is **shared** (`client/src/components/diff-viewer/`),
`FindingCard` is **route-local**
(`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/`), and a
shared component may not import route-local code
(frontend-code-organization §1).

**(a) Promote `FindingCard` to `client/src/components/` — rejected.** The
promotion rule is "promote on the second **route** consumer, not before", and
`DiffTab` sits in the *same* route as `FindingCard`
(`client/src/app/repos/[repoId]/pulls/[number]/_components/`). Promoting to
satisfy an import inside one route is exactly the premature promotion §1 warns
about. It would also force rewriting `FindingCard`'s
`../../../../../../../lib/github-urls` import (`FindingCard.tsx:22`) and moving
its test — churn in a file this feature has no functional reason to change.
This becomes the right answer the day a second route renders findings; it is
not that day.

**(c) Adapt findings into `CommentThread` / `DiffCommentApi` — rejected.** The
shapes do not fit: `CommentThread` is keyed by a numeric GitHub comment id with
`in_reply_to_id`/`created_at` (`comments.ts:24-31`, built from
`PrReviewComment`), while a finding is keyed by a uuid and carries severity,
confidence and an Accept/Dismiss action with persisted timestamps. Coercion
means fabricating numeric ids and then special-casing them back out at render
time — and it would quietly make `commentCount` (`FileCard.tsx:51-53`, the
MessageSquare counter) include findings, which the spec explicitly says is a
*different* thing from the finding dot. The one thing findings and comments
genuinely share is the **visibility toggle**, and that is a boolean, not a data
structure (see D7).

**(b) A generic findings slot — chosen.** `diff-viewer` gains a second optional
API next to `DiffCommentApi`, in a new
`client/src/components/diff-viewer/findings.ts`:

```ts
export interface DiffFindingAnchor {
  id: string;                         // opaque to the viewer
  path: string;
  line: number;                       // the finding's start_line (RIGHT side)
  severity: Severity;                 // from @devdigest/ui — a shared token type
  label: string;                      // caller-supplied, already translated
}

export interface DiffFindingApi {
  anchors: DiffFindingAnchor[];
  /** Gated by the same boolean as comments (see D7). */
  showFindings: boolean;
  /** Route-local renderer. The viewer never imports FindingCard. */
  render: (id: string) => React.ReactNode;
  /** Heading for the "line not in this patch" footer block. */
  unanchoredLabel: string;
}
```

Why this and not "pass `FindingRecord[]`": the viewer would then import a
PR-review DTO and own severity→label copy, i.e. it would stop being a generic
diff viewer. With anchors it knows three things — where the marker goes, what
colour it is, and what to call to render the body — and nothing about reviews.
The `severity` field is the one shared vocabulary item, and it comes from
`@devdigest/ui`'s `Severity` (`client/src/vendor/ui/primitives/tokens.ts:3`),
already a vendored cross-cutting type; the viewer maps it to a colour through
`SEV[severity].c` (`tokens.ts:6-14`), which is a CSS custom property, never a
hex (frontend-code-organization §5).

`DiffFindingAnchor` and `DiffFindingApi` are exported from
`client/src/components/diff-viewer/index.ts` — that barrel is the folder's
public API (§8), and a prop type that is not exported cannot be constructed by
the caller.

### D4 — Grouping happens in `DiffTab`; `DiffViewer` keeps its flat signature

`DiffViewer(files: PrFile[], commenting?)` (`DiffViewer.tsx:14-20`) does not
learn about groups. A new route-local component `_components/SmartDiffGroups/`
renders one collapsible group header per role and, inside each, **one
`<DiffViewer>` with that group's files**. Reasons:

1. Role grouping is a Smart Diff product concept; the viewer's job is rendering
   a unified diff. Pushing groups into the shared tier would make every future
   consumer carry a concept it does not use.
2. The group header (role label, file count, files-with-findings counter,
   collapsed-by-default state) is all i18n copy from `prReview.json` — a
   `prReview`-scoped concern, whereas `DiffViewer`/`FileCard` read
   `useTranslations("shell")` (`DiffViewer.tsx:21`, `FileCard.tsx:34`).
3. It is a pure composition change: with the toggle off, `DiffTab` renders the
   single flat `<DiffViewer files={files} …>` it renders today, byte-for-byte.

### D5 — The `/smart-diff` response is an ordering index; patches stay on `pr.files`

`SmartDiffFile` carries `path`/`additions`/`deletions`/`finding_lines` and **no
patch** (`server/src/vendor/shared/contracts/brief.ts:97-103`). The client
therefore **joins the response back onto `pr.files`** (which carry `patch` —
`PrFile` at `client/src/vendor/shared/contracts/platform.ts:210-216`) by path,
in a pure helper. We do not widen the contract to carry patches: it would double
the payload of the largest response on the page for data the client already has
from `usePullDetail`.

Defensive rule for the join: a file present in `pr.files` but absent from the
response is appended to the **end of the `core` group in GitHub order**. Both
sides read the same `pr_files` rows, so this should never fire; it exists so a
race after a PR refresh cannot make a file silently vanish from the diff.

### D6 — Finding visuals derive from the finding records, not from `finding_lines`

The route fills `finding_lines` from each finding's `start_line` (spec, P2, and
it is what L08 and any API consumer read). The **UI**, however, derives the dot,
the group counter and the inline cards from the latest review's
`FindingRecord[]` already fetched by `usePrReviews(prId)`
(`client/src/app/repos/[repoId]/pulls/[number]/page.tsx:41`).

Why one source for everything visual:

1. The inline card needs the full record anyway (`id`, `severity`, `title`,
   `rationale`, `accepted_at`, `dismissed_at`) to render `FindingCard` and to
   call `useFindingAction` — `finding_lines` is a bare number array.
2. A line number alone cannot tell you whether that line is **in the patch**.
   P2 requires an unanchored finding to appear in a footer block rather than
   vanish; that decision needs the parsed lines and the record together (the
   existing `partitionThreads` precedent, `comments.ts:89-106`).
3. Two sources for one number is a drift class: a dot with no card under it.

`finding_lines` stays contract-correct and is asserted in the **server** tests
(Steps 6, 8), not read for pixels.

### D7 — One toggle for comments and findings; one for order

- **Visibility.** `DiffTab` already owns `showComments` (`DiffTab.tsx:22`,
  forced `true` after a successful post at `:34`). The same boolean is passed as
  `findings.showFindings`. The Show/Hide button currently renders only when
  `commentCount > 0` (`:48`); it becomes `commentCount > 0 || findingCount > 0`,
  and its label/count move into `prReview.json` (they are hardcoded English
  today at `DiffTab.tsx:55`, and P3 requires captions to come from the message
  catalog).
- **Order.** A second `grouped` boolean in `DiffTab`, default `true`. Off →
  today's flat `<DiffViewer files={files}>`. On → `<SmartDiffGroups>`. The
  button label reads "Original order" / "Smart order" from `prReview.json`.
- Group open/closed state lives in `SmartDiffGroups` and is seeded from
  `DEFAULT_COLLAPSED_ROLES = ['docs', 'boilerplate']`; flipping the order toggle
  does not reset it, because the state is keyed by role and `SmartDiffGroups` is
  not unmounted while it is rendered.

### D8 — Loading and failure: the Files changed tab never depends on `/smart-diff`

- **Loading** → render the flat viewer exactly as today, order toggle disabled.
- **Error** → flat viewer, order toggle disabled, one muted line from
  `prReview.json` ("couldn't group this diff by role"). No toast, no retry
  button: the tab is still fully usable.
- **No review yet** → groups render normally with no counters and no dots, plus
  the `smartDiff.noReviewYet` line in place of a zero counter (P3). This is
  guaranteed server-side: the route reads `reviewsForPull(prId)` and an empty
  array simply yields empty `finding_lines`
  (`server/src/modules/reviews/repository/review.repo.ts:62-65` returns `[]`).

### D9 — All five groups render, always — response *and* client

The response contains all five `SmartDiffGroup`s in `ROLE_ORDER`, including
empty ones, so the shape is stable for every consumer and the role order is
asserted once, server-side.

**Settled by the user: the client renders all five headers too, including a
group with zero files** (which reads `0 files`). This overturns an earlier draft
of this decision that hid empty groups as visual noise. The reason it loses:
P1 says "five groups in fixed order", and the lesson's own prescribed demo PR
(lock file + logic file + test + config/barrel) need not contain a `.md` at
all — hiding empty groups would put **four** groups on the demo video and invite
a mentor to fail criterion 1 on the letter of it. An empty group still obeys
`DEFAULT_COLLAPSED_ROLES`, so an empty `docs` group renders as a collapsed
header row reading `Docs · 0 files`.

### D10 — The prototype shell, read off the four screenshots

The four prototype screenshots pin down the chrome. Everything below is a
render detail of the components already scheduled in Steps 13/15; none of it
changes D1-D9.

**Section header (screenshots 1 and 4).** The section label reads
**`‹› REVIEWER-ORDERED DIFF`** — `SectionLabel` already uppercases and
letter-spaces its children (`client/src/vendor/ui/primitives/SectionLabel.tsx:18-26`),
so the message value is written in sentence case and the primitive does the
rest. The label no longer carries the file count: a **sub-row below it** shows
`9 files · +247 -38`, i.e. the count plus repo-wide addition/deletion totals
summed from `pr.files` (today's `Files changed · {filesCount} files` at
`DiffTab.tsx:60` is replaced by this two-line arrangement).

**Where both controls live.** `SectionLabel`'s `right` slot
(`SectionLabel.tsx:9,28`, already used at `DiffTab.tsx:47-58`) holds **one flex
row containing both**: the order control first, then the existing
show/hide-comments `Button` to its right. The visibility button keeps its
current `kind="ghost" size="sm"` + Eye/EyeOff form (`DiffTab.tsx:49-56`); only
its render condition and its label source change (D7).

**The order control is a segmented pair, not a checkbox.** `Smart order` |
`Original order`, the active one filled. There is no segmented-control
primitive in `src/vendor/ui`: `kit/Tabs.tsx` is an underline tab bar with a
bottom border and is already in use for the page-level Overview / Agent runs /
Files changed tabs directly above, so reusing it would produce two competing tab
bars. The closest existing primitive is **`Chip`**, which renders a `<button>`
whose `active` state paints `border: 1px solid var(--accent)` +
`background: var(--accent-bg)` (`client/src/vendor/ui/primitives/Chip.tsx:34-37`)
— exactly the filled/unfilled pair in the screenshot. So: two `Chip`s inside a
`<div role="group" aria-label=…>`, `active` on the current mode. Using a
`<button>`-based primitive is **correct** here (unlike the severity label of
D3/Step 11) because this control really is interactive — `client/INSIGHTS.md:17-24`
is about not confusing the two, not about avoiding `Chip`. **Do not rebuild a
segmented control from scratch** (`client/CLAUDE.md:62-63`).

**Group header row (screenshots 1, 2, 4), left to right:** chevron · a small
filled colour **swatch** · the role name · a muted one-line **description** ·
then, pushed right, `● {n}` (a red dot + the count of files with findings) and
`{n} files`.

- Swatch colours come from existing tokens only (`client/src/vendor/ui/styles.css:20-37`),
  never new hex: `core → var(--accent)` (blue, as drawn), `wiring → var(--warn)`
  (amber, as drawn), `boilerplate → var(--info)` (grey, as drawn), and for the
  two roles the prototype does not show, `tests → var(--ok)` (green) and
  `docs → var(--text-secondary)`. `docs` deliberately does **not** use
  `var(--info)` or `var(--stale)`: both resolve to `#6b7280` in dark mode
  (`styles.css:31,37`), so they cannot distinguish two adjacent grey groups.
- The `● {n}` dot uses `var(--crit)` — it is a presence indicator, the same
  semantic as the file-card dot in Step 12.
- The **role name in the prototype is "Core logic"**, while
  `client/messages/en/prReview.json:76` currently says `"coreLabel": "Core"`.
  Step 9 updates that value; `wiringLabel` ("Wiring") and `boilerplateLabel`
  ("Boilerplate") already match the screenshots as-is.
- The one-line descriptions ("The substance of the change — review closely",
  "Hooks the core into the app", "Generated / mechanical — skim") are **not** in
  the current `smartDiff` block and are added as new keys in Step 9.

**Group collapse binds at the group level.** Screenshot 2 shows all three groups
collapsed to bare header rows with chevrons — so "`docs` and `boilerplate`
collapsed on open" means the **group** is collapsed, not merely its files. That
is what `DEFAULT_COLLAPSED_ROLES` (Step 13) implements, and it sits *on top of*
the untouched per-file `AUTO_EXPAND_MAX_LINES` heuristic
(`client/src/components/diff-viewer/constants.ts:4`): a group can be open while
a large file inside it is still collapsed.

**File-card header (screenshots 1, 3, 4).** Chevron · file icon · path · the red
finding **dot immediately after the path** · then, right-aligned, a `summary`
chip and the `+84 -0` stat. This is exactly the arrangement Step 12 specifies —
and it is the visual argument for the "don't confuse them" requirement: the
finding dot sits hard against the path on the left while the GitHub comment
counter stays on the far right (`FileCard.tsx:79-86`), so the two indicators are
never adjacent.

**`What this does:` and the `summary` chip are out of scope.** That line is the
contract's `pseudocode_summary` (`brief.ts:99`), it needs a model call, and it
is in no acceptance criterion. The field stays `null` (Step 5) and neither the
chip nor the line is built. Listed under *Out of scope*.

**Line marking (screenshot 3)** confirms Step 11: a coloured left stripe on the
code row plus a right-aligned chip on the same row — blue `suggestion`, amber
`warning`, red `blocker` — i.e. the CRITICAL→blocker / WARNING→warning /
SUGGESTION→suggestion mapping of Step 9's `severityLabel`.

**The inline finding card (screenshot 3) is `FindingCard` as it already exists,
with `defaultExpanded`.** Do **not** rewrite it. Mapping each prototype detail
to what it costs:

| Prototype detail | Status |
|---|---|
| Coloured left border on the card | **already there** — `s.card(focused, sevColor, muted)` with `SEV_COLOR[f.severity]` (`FindingCard.tsx:44,54`) |
| `SUGGESTION` badge + title + category tag (`style`, `bug`) | **already there** — `SeverityBadge` + `CategoryTag`, imported at `FindingCard.tsx:9-18` |
| `Line 28 ● 62% conf` meta row | **already there** — `lineLabel` + `ConfidenceNum` (`FindingCard.tsx:14,22`) |
| Rationale as prose, boxed `SUGGESTED FIX` | **already there** — `Markdown` + the `finding.suggestedFix` string (`prReview.json:5`) |
| `✓ Accept` / `✗ Dismiss` | **already there** — `finding.accept` / `finding.dismiss` (`prReview.json:6-7`), driven by `onAction` (Step 15) |
| Card opens expanded inline | **existing prop** — pass `defaultExpanded` (`FindingCard.tsx:28,43`) |
| `X` close control, top-right | **needs a new optional prop** (`onClose?`) — **P3, not built in this plan** |

**"Mechanical changes — diff collapsed by default" (screenshot 4)** is a
placeholder body shown when a `wiring`/`boilerplate` file card is *expanded* but
its diff is intentionally not rendered — a third state between "collapsed" and
"showing the patch". It is **optional polish, not P1**: Step 9 adds the string
(`smartDiff.mechanicalPlaceholder`) so the copy exists, and Step 12 notes the
one-line hook, but shipping it is not required by any acceptance criterion.

---

## Steps

### Step 1 — Contract: widen `SmartDiffRole` from 3 to 5 roles
- **Files:** `server/src/vendor/shared/contracts/brief.ts` (edit, line 94)
- **Change:** replace
  `export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);`
  with `z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate'])`, in the
  fixed display order. Add a doc comment above it stating that the enum order
  **is** the display order and that the *matching* order is a separate concern
  owned by `server/src/modules/smart-diff/constants.ts` (D2). Nothing else in
  the `// ---- Smart Diff ----` block (lines 93-126) changes: `SmartDiffFile`,
  `SmartDiffGroup`, `ProposedSplit` and `SmartDiff` are used as-is, and
  `SmartDiffResponse = SmartDiff` at
  `server/src/vendor/shared/contracts/review-api.ts:92-94` needs no edit.
- **Constraint:** contracts import zod and nothing else
  (`.claude/skills/onion-architecture/SKILL.md` §7). This widens an enum with
  **zero** implementations and zero callers today (verified: no `SmartDiff*`
  reference in `server/src`, `client/src` or `reviewer-core/src` outside
  `vendor/shared` and the `client/src/lib/types.ts:35` type re-export), so
  `RULE-CONTRACT-BREAK` is satisfied — no consumer can be narrowed by it.
- **Done when:** `cd server && pnpm typecheck` passes and
  `SmartDiffRole.parse('tests')` and `SmartDiffRole.parse('docs')` both succeed.

### Step 2 — Mirror the contract into the client's vendored copy
- **Files:** `client/src/vendor/shared/contracts/brief.ts` (edit, line 94)
- **Change:** apply Step 1's edit byte-identically. The two trees are physical
  copies with no symlink and no sync script; hand-copy and commit both.
- **Constraint:** `RULE-CONTRACT-SYNC` — CI fails the job if
  `diff -r client/src/vendor/shared server/src/vendor/shared` reports anything
  (`.github/workflows/client.yml:50`, `.github/workflows/server-unit.yml:55`).
- **Done when:** `diff -r client/src/vendor/shared server/src/vendor/shared`
  is silent and `cd client && pnpm typecheck` passes.

### Step 3 — Server: the pattern table and the role order, in one constants file
- **Files:** `server/src/modules/smart-diff/constants.ts` (new)
- **Change:** export exactly two things:
  1. `ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'tests', 'wiring', 'docs', 'boilerplate']`
     — the **display** order.
  2. `ROLE_PATTERNS: readonly { role: SmartDiffRole; patterns: readonly RegExp[] }[]`
     — the **matching** order of D2 (boilerplate, tests, wiring, docs), each
     glob from that table written as a comment above its regex. `core` is not in
     this array; it is the fallthrough.
  `DEFAULT_COLLAPSED_ROLES`, the swatch colours and the group descriptions are
  deliberately **not** here — they are client presentation and live in the
  client component's own `constants.ts` / `messages` (D10, Step 13, Step 9).
  Regexes only: no glob library is installed and adding one would touch a
  lockfile for a 40-line matcher (`CLAUDE.md:114-118`). Paths are matched
  repo-relative with `/` separators. A `DO NOT REORDER` comment sits above
  `ROLE_PATTERNS` naming the three contested cases as the reason.
- **Constraint:** `constants.ts` imports nothing but the `SmartDiffRole` type
  from `@devdigest/shared` (onion decision table: "magic number, job kind →
  `modules/<domain>/constants.ts`, may import nothing").
- **Done when:** `cd server && pnpm typecheck` passes and `ROLE_PATTERNS` has
  four entries in the order boilerplate → tests → wiring → docs.

### Step 4 — Server: the `path → role` test table (written before the classifier)
- **Files:** `server/test/smart-diff-classify.test.ts` (new)
- **Change:** a table-driven `describe`/`it.each` over `classifyFile`, modelled
  on `server/test/pulls-status.test.ts:1-30` (file-header comment explaining
  what the pure function decides, then flat cases). Minimum table:

  | path | expected | why it is in the table |
  |---|---|---|
  | `client/src/__tests__/__snapshots__/x.snap` | `boilerplate` | **contested** — the snapshot rule outranks `__tests__` |
  | `.claude/skills/security/SKILL.md` | `wiring` | **contested** — `.claude/**` outranks `**/*.md` |
  | `e2e/README.md` | `tests` | **contested** — `e2e/**` outranks `**/*.md` (D2, deliberate) |
  | `pnpm-lock.yaml` | `boilerplate` | the acceptance criterion's named case |
  | `client/pnpm-lock.yaml` | `boilerplate` | same rule, nested |
  | `server/dist/app.js` | `boilerplate` | `dist/**` at any depth |
  | `client/public/vendor/thing.min.js` | `boilerplate` | `*.min.js` |
  | `server/src/db/schema.generated.ts` | `boilerplate` | `*.generated.*` |
  | `server/test/pulls-status.test.ts` | `tests` | `**/test/**` and `**/*.test.ts` agree |
  | `server/test/reviews.it.test.ts` | `tests` | this repo's own integration suffix |
  | `client/src/lib/format.spec.ts` | `tests` | `**/*.spec.ts` |
  | `client/src/components/diff-viewer/index.ts` | `wiring` | a barrel with real code is still wiring |
  | `client/next.config.ts` | `wiring` | `*.config.*` |
  | `server/tsconfig.json` | `wiring` | `tsconfig*.json` |
  | `docker-compose.yml` | `wiring` | |
  | `.github/workflows/client.yml` | `wiring` | |
  | `server/.env.example` | `wiring` | `.env*` |
  | `README.md` | `docs` | |
  | `docs/plans/lab04-smart-diff.plan.md` | `docs` | |
  | `LICENSE` | `docs` | |
  | `server/src/modules/reviews/service.ts` | `core` | the fallthrough |
  | `client/src/app/repos/[repoId]/pulls/[number]/page.tsx` | `core` | |
  | `server/src/modules/reviews/constants.ts` | `core` | a constants file is **not** wiring — only barrels and `*.config.*` are |

  Plus one `it` asserting `ROLE_ORDER` equals
  `['core','tests','wiring','docs','boilerplate']`, so the display order is
  pinned by a test and not only by a comment.
- **Constraint:** this file is written and run **before** Step 5 and is expected
  to fail to compile (no `classifyFile` yet) — that is the point of the
  ordering. It is a hermetic unit test, so it must **not** carry the
  `.it.test.ts` suffix (`TESTING.md:79-82`, `RULE-IT-SUFFIX`).
- **Done when:** the file exists with every row above and
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` fails only on
  the missing `classifyFile` import — not on anything else.

### Step 5 — Server: `classifyFile` + `groupFilesByRole` (pure)
- **Files:** `server/src/modules/smart-diff/helpers.ts` (new)
- **Change:**
  - `classifyFile(path: string): SmartDiffRole` — normalize (strip a leading
    `./`, collapse `\` to `/`), then walk `ROLE_PATTERNS` in order and return
    the first matching role; fall through to `'core'`. No I/O, and no imports
    beyond `@devdigest/shared` types and `./constants.js`.
  - `groupFilesByRole(files: { path; additions; deletions; findingLines }[]): SmartDiffGroup[]`
    — buckets by `classifyFile`, emits **all five** groups in `ROLE_ORDER` (D9),
    preserves input order inside each group (GitHub order), and maps to the
    snake_case contract shape (`finding_lines`, and
    **`pseudocode_summary: null`** — the `What this does:` line is out of scope,
    D10).
  - `totalChangedLines(files)` — the `additions + deletions` sum for
    `split_suggestion.total_lines`, coalescing null counts to 0.
- **Constraint:** `helpers.ts` is pure — no `Container`, no I/O, no `this`,
  unit-testable with no mocks (`.claude/skills/onion-architecture/SKILL.md` §5).
  It must not import `db/schema` or `drizzle-orm`; a Drizzle row may only be
  passed in as a plain object shaped by the caller (§4: a row must never reach
  an HTTP response, so the camelCase→snake_case mapping happens here, on the way
  out). This purity is the L08 requirement: `classifyFile` must be importable
  with no HTTP and no DB.
- **Implementer trap — do not reach for a row type.** `server/src/db/rows.ts`
  has **no `PrFileRow`** (it stops at `ConventionRow`, `rows.ts:12-21`), and
  `ReviewRepository.getPrFiles` returns an inline
  `(typeof t.prFiles.$inferSelect)[]` (`server/src/modules/reviews/repository.ts:39-41`).
  Importing `db/schema` here to name that shape trips `no-schema-in-helpers` at
  severity **error** in `server/.dependency-cruiser.cjs`. Keep the
  structurally-typed parameter this step already specifies —
  `{ path; additions; deletions; findingLines }[]` — and let the caller shape it.
  Do **not** add a `PrFileRow` to `db/rows.ts` for this: nothing outside the
  service needs the name.
- **Done when:** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  is green on `smart-diff-classify.test.ts` including all three contested rows,
  and `grep -n "container\|drizzle\|db/schema" server/src/modules/smart-diff/helpers.ts`
  returns nothing.

### Step 6 — Server: `SmartDiffService`
- **Files:** `server/src/modules/smart-diff/service.ts` (new)
- **Change:** `export class SmartDiffService { constructor(private repo: Container['reviewRepo']) {} }`
  — the **indexed-access type**, never the concrete `ReviewRepository` class:
  naming the class creates a `smart-diff → reviews/repository` edge that trips
  `no-cross-module-repository` (`server/.dependency-cruiser.cjs:246-258`), and
  `import type` does not avoid it because `tsPreCompilationDeps: true` (`:300`)
  keeps type-only imports in the graph (D1). Precedent:
  `server/src/modules/reviews/service.ts:31`. One method,
  `async forPull(workspaceId: string, prId: string): Promise<SmartDiff>`:
  1. `const pull = await this.repo.getPull(workspaceId, prId)` — throw
     `NotFoundError('Pull request not found')` when absent, matching
     `server/src/modules/reviews/service.ts:173-175`. This is the workspace
     scope check; there is no second one.
  2. `const files = await this.repo.getPrFiles(prId)`
     (`server/src/modules/reviews/repository.ts:39-41`).
  3. `const reviews = await this.repo.reviewsForPull(prId)`
     (`server/src/modules/reviews/repository.ts:64-66`); the **latest** review is
     `reviews[0]`, because the query orders `desc(t.reviews.createdAt)`
     (`server/src/modules/reviews/repository/review.repo.ts:57-74`).
     `reviews.length === 0` → no findings, not an error.
  4. Build `finding_lines` per file: the `startLine` values of
     `reviews[0].findings` whose `file` equals that file's `path`, deduped and
     sorted ascending. `FindingRow` is camelCase (`startLine`);
     `server/src/modules/reviews/helpers.ts:35-54` is the precedent for the
     row→wire rename, and the rename happens here / in `helpers.ts`, never by
     letting a row escape (onion §4).
  5. Return `{ groups: groupFilesByRole(...), split_suggestion: { too_big: false,
     total_lines: totalChangedLines(files), proposed_splits: [] } }`.
  **No LLM call, no persistence, no new table, nothing written.**
- **Constraint:** services hold no SQL and no Fastify
  (`.claude/skills/onion-architecture/SKILL.md` §2). The dependency is the single
  repository, typed `Container['reviewRepo']` so no cross-module `repository`
  import is created (D1, `server/.dependency-cruiser.cjs:246-258`); the
  repository itself is constructed only by the composition root
  (`server/src/platform/container.ts:105-107`) and injected at the call site in
  Step 7. Consume `getPrFiles`'s return type **by inference only** — there is no
  `PrFileRow` in `server/src/db/rows.ts`, and importing `db/schema` to name it
  trips `no-db-in-service` at severity **error**.
- **Done when:** `server/test/smart-diff-service.test.ts` (hermetic, a hand-rolled
  fake repo object — no container, no DB) asserts: a PR with files and **zero**
  reviews still returns five groups with the right files and all-empty
  `finding_lines`; a PR with two reviews uses only `reviews[0]`'s findings; a
  finding on a file that is not in `pr_files` does not create a phantom file;
  `total_lines` equals the additions+deletions sum; an unknown `prId` rejects
  with `NotFoundError`.

### Step 7 — Server: the route + module registration
- **Files:** `server/src/modules/smart-diff/routes.ts` (new),
  `server/src/modules/index.ts` (edit)
- **Change:** a default Fastify plugin copying
  `server/src/modules/intent/routes.ts:20-31` exactly:
  ```ts
  export default async function smartDiffRoutes(appBase: FastifyInstance) {
    const app = appBase.withTypeProvider<ZodTypeProvider>();
    const service = new SmartDiffService(app.container.reviewRepo);

    app.get(
      '/pulls/:id/smart-diff',
      { schema: { params: IdParams, response: { 200: SmartDiff } } },
      async (req) => {
        const { workspaceId } = await getContext(app.container, req);
        return service.forPull(workspaceId, req.params.id);
      },
    );
  }
  ```
  Then in `server/src/modules/index.ts`: one import
  (`import smartDiff from './smart-diff/routes.js';`, next to the `intent`
  import at line 10) and one entry `smartDiff,` in the `modules` record
  (lines 27-39). A file-header doc comment states that the endpoint is
  deliberately **not** on `pulls/routes.ts` and why (onion §9).
- **Constraint:** routes hold no logic and never import `drizzle-orm`/`db/schema`
  (onion §1); the service is constructed **once above the handlers**, not per
  request; validation is the route's zod schema, never a hand-rolled parse
  (`server/CLAUDE.md:53-55`); `getContext` on every authenticated route
  (`server/src/modules/_shared/context.ts:14-23`) — it is the only workspace
  scoping seam. The `response: { 200: SmartDiff }` schema is what makes P2's
  "validates against the `SmartDiff` contract" true at runtime, not just at
  compile time.
- **Done when:** `GET /pulls/<uuid>/smart-diff` returns 200 with five groups for
  a seeded PR; a non-uuid id returns **422** before the handler runs; a uuid
  from another workspace returns **404**; and
  `grep -n "drizzle\|db/schema" server/src/modules/smart-diff/routes.ts` is
  empty.

### Step 8 — Server: the integration test
- **Files:** `server/test/smart-diff.it.test.ts` (new)
- **Change:** a DB-backed test on the seeded stack (copy the harness usage of an
  existing `*.it.test.ts`) asserting, in order: (1) the response parses with
  `SmartDiff.parse(...)`; (2) `groups.map(g => g.role)` equals
  `['core','tests','wiring','docs','boilerplate']`; (3) a PR **with no review**
  returns groups whose `finding_lines` are all empty — the P2 "grouping works
  before the first review" guarantee; (4) once a seeded review exists, its
  findings' `start_line`s appear in the right file's `finding_lines`; (5)
  `split_suggestion` is `{ too_big: false, total_lines: <sum>, proposed_splits: [] }`;
  (6) a non-uuid id → 422, a foreign-workspace id → 404.
- **Constraint:** the `.it.test.ts` suffix is mandatory for a DB-backed file —
  without it the test runs in the hermetic lane and fails (`TESTING.md:79-82`;
  `server/CLAUDE.md:61-62`). It self-skips without Docker (`TESTING.md:48-50`).
- **Done when:** `cd server && pnpm exec vitest run .it.test` is green with
  Docker available, and skips cleanly without it.

### Step 9 — Client: the i18n strings
- **Files:** `client/messages/en/prReview.json` (edit, the `smartDiff` key at
  lines 75-83)
- **Change:**
  - **Change one existing value:** `coreLabel` `"Core"` → `"Core logic"`, the
    prototype's wording (`prReview.json:76`). `wiringLabel` ("Wiring") and
    `boilerplateLabel` ("Boilerplate") already match the screenshots and are
    left alone.
  - **New role labels:** `testsLabel` ("Tests"), `docsLabel` ("Docs") — required
    by the contract task.
  - **New group descriptions** (D10; the muted one-liner in each group header):
    `coreDesc` "The substance of the change — review closely", `testsDesc`
    "Proof the change works", `wiringDesc` "Hooks the core into the app",
    `docsDesc` "Prose, not behaviour — skim", `boilerplateDesc`
    "Generated / mechanical — skim". The three shown in the screenshots are
    copied verbatim; `testsDesc`/`docsDesc` are new and follow their cadence.
  - **New section header + summary:** `sectionTitle` "Reviewer-ordered diff"
    (`SectionLabel` uppercases it, `SectionLabel.tsx:18-26`) and
    `summaryLine` `"{files} files · +{additions} −{deletions}"`.
  - **New controls:** `smartOrder` "Smart order", `originalOrder`
    "Original order", `orderControlLabel` "Diff order" (the `aria-label` on the
    segmented group), `showFindings` / `hideFindings` (the combined
    comments+findings toggle label, `{count}` interpolated).
  - **New states/labels:** `filesWithFindings` `"{count} with findings"`,
    `noReviewYet` "No review has been run yet", `unanchored` "Findings not in
    this patch", `groupingFailed` "Couldn't group this diff by role — showing
    GitHub order", `mechanicalPlaceholder` "Mechanical changes — diff collapsed
    by default" (D10; the string exists even though shipping the behaviour is
    P3), and a `severityLabel` object
    `{ CRITICAL: "blocker", WARNING: "warning", SUGGESTION: "suggestion", INFO: "info" }`
    — the mapping confirmed by screenshot 3.
  - Keep `filesCount`, `findingLines`, `groupedByRole`, `largeTitle`,
    `largeBody` untouched. Reuse the existing `finding.accept` /
    `finding.dismiss` / `finding.suggestedFix` copy (`prReview.json:2-12`) —
    `FindingCard` already reads it; do **not** add a second Accept/Reject
    string.
- **Constraint:** user-facing strings live here, never in a `constants.ts`
  (`.claude/skills/frontend-code-organization/SKILL.md` §5); keys are dotted
  camelCase (`client/CLAUDE.md:40-41`); `en` is the only locale, so there is no
  second file to update.
- **Done when:** the file is valid JSON, `cd client && pnpm test` still passes
  (`FindingCard.test.tsx:5` imports this file wholesale as its message source, so
  a malformed edit breaks it immediately), and no English literal for any of
  these strings exists anywhere under `client/src`.

### Step 10 — Client: the generic findings surface in `diff-viewer`
- **Files:** `client/src/components/diff-viewer/findings.ts` (new),
  `client/src/components/diff-viewer/index.ts` (edit),
  `client/src/components/diff-viewer/styles.ts` (edit)
- **Change:** `findings.ts` exports `DiffFindingAnchor` and `DiffFindingApi`
  exactly as in **D3**, plus two pure helpers mirroring `comments.ts:63-106`:
  - `anchorsForLine(ln: Line, byLine: Map<number, DiffFindingAnchor[]>)` — a
    finding anchors on the **RIGHT** side only, i.e. `ln.newNo` for `add`/`ctx`
    lines (`client/src/components/diff-viewer/helpers.ts:25-34` is where `newNo`
    is assigned; `keysForLine` at `comments.ts:63-74` is the shape to copy,
    minus the LEFT branch, because a finding cites the post-change file).
  - `partitionAnchors(anchors, renderedLines: Set<number>)` →
    `{ matched: Map<number, DiffFindingAnchor[]>, unanchored: DiffFindingAnchor[] }`
    — the direct analogue of `partitionThreads` (`comments.ts:89-106`), which is
    this repo's own precedent for "nothing is silently dropped".
  `index.ts` gains
  `export type { DiffFindingAnchor, DiffFindingApi } from "./findings";` —
  explicit named re-exports only, no `export *`
  (frontend-code-organization §8). `styles.ts` gains `findingStripeFor(severity)`
  (a left `borderInlineStart` using `SEV[severity].c`) and `findingLabel` (the
  right-aligned `blocker`/`warning`/`suggestion` chip of screenshot 3: small,
  rounded, `SEV[severity].bg` fill with `SEV[severity].c` text) — both returning
  `CSSProperties` from the existing `s`-object file, colours via `SEV`
  (`client/src/vendor/ui/primitives/tokens.ts:6-14`), never hex.
- **Constraint:** `findings.ts` is pure — it must not import `react` beyond the
  `React.ReactNode` **type** in the API interface, and must not import anything
  under `src/app/**` (frontend-code-organization §1, §6). No new wide barrel
  (§8).
- **Done when:** `cd client && pnpm typecheck` passes;
  `grep -rn "app/repos\|FindingCard\|FindingRecord" client/src/components/diff-viewer/`
  returns nothing; and `client/src/components/diff-viewer/index.ts` exports
  exactly four names (`DiffViewer`, `DiffCommentApi`, `DiffFindingAnchor`,
  `DiffFindingApi`).

### Step 11 — Client: `CodeLine` renders the stripe, the label and the finding body
- **Files:** `client/src/components/diff-viewer/CodeLine/CodeLine.tsx` (edit)
- **Change:** add two optional props, `anchors?: DiffFindingAnchor[]` and
  `findings?: DiffFindingApi`. When `anchors` is non-empty (screenshot 3):
  - apply `findingStripeFor(anchors[0].severity)` on top of
    `lineRowFor(ln.kind)` (`CodeLine.tsx:44`) — the coloured left stripe;
  - render a right-aligned `<span>` with `anchors[0].label` inside the code row,
    styled by `findingLabel` — a plain `<span>`, **not** `Chip`/`Badge`:
    `client/INSIGHTS.md:17-24` records that a `<button>`-based primitive is
    announced as interactive and silently steals RTL role queries, and
    `client/INSIGHTS.md:73-80` records that `Badge` accepts no `title`. (The
    order control of D10 *is* a `Chip`, because that one is genuinely
    interactive; this label is not.)
  - render `findings.render(a.id)` for each anchor **under** the code row,
    inside the existing `cs.rowWrap` container and immediately after the
    comment-thread block at `CodeLine.tsx:67-71`, gated by
    `findings && findings.showFindings` — the exact gating shape already used
    for comments.
  Order within the wrapper: code row → findings → comment threads → composer,
  so a finding sits closest to the line it cites, as drawn.
- **Constraint:** `CodeLine` must not learn what a finding *is* — it receives an
  opaque `id` and calls `render` (D3). No new `useTranslations` call: every
  string it displays arrives pre-translated on the anchor.
- **Done when:** `cd client && pnpm typecheck` passes and a diff rendered with
  `findings` omitted produces markup identical to today's (asserted in Step 16
  by rendering `FileCard` with and without the prop).

### Step 12 — Client: `FileCard` gets the dot and the unanchored footer
- **Files:** `client/src/components/diff-viewer/FileCard/FileCard.tsx` (edit),
  `client/src/components/diff-viewer/DiffViewer/DiffViewer.tsx` (edit)
- **Change:**
  - `FileCard` takes `findings?: DiffFindingApi`. It filters `findings.anchors`
    to `a.path === file.path`, builds `renderedLines` from the parsed lines (the
    `newNo` analogue of the `renderedKeys` set at `FileCard.tsx:46-47`) and calls
    `partitionAnchors` in the **same** `useMemo` family as `partitionThreads`
    (`FileCard.tsx:43-49`).
  - Header (screenshots 1, 3, 4): when this file has ≥ 1 anchor, render a
    **dot** — a small filled circle coloured by the highest severity present —
    **immediately after `file.path`** (`FileCard.tsx:72-74`), before the `+/-`
    stat. It carries no number, and it is rendered separately from the existing
    MessageSquare comment counter at `FileCard.tsx:79-86`, which stays on the
    far right. The prototype's layout is the argument: the two indicators are
    never adjacent, so they cannot be read as the same thing.
  - Body: after the line list and next to the existing
    `<OutdatedComments threads={outdated} />` (`FileCard.tsx:103`), render an
    unanchored-findings block using `cs.outdatedWrap` / `cs.outdatedTitle`
    (`comments.ts:158-172`) with `findings.unanchoredLabel` as its heading and
    `findings.render(a.id)` per entry — the P2 "a finding whose line is not in
    the patch must not vanish" requirement, built on the existing precedent.
  - A file with `patch: null` parses to zero lines
    (`client/src/components/diff-viewer/helpers.ts:12-13`) and already renders
    `diffViewer.noDiffText` (`FileCard.tsx:90-91`); in that case **every** anchor
    is unanchored, so the footer block is the only place its findings appear.
    That path gets its own test.
  - **Not built:** the `summary` chip and the `What this does:` line of
    screenshots 1/3/4 — that is `pseudocode_summary`, out of scope (D10).
  - **Optional (P3), noted not built:** the
    `smartDiff.mechanicalPlaceholder` body of screenshot 4 would be a third
    branch in the `open &&` block at `FileCard.tsx:88-105` for `wiring`/
    `boilerplate` files; it needs the role threaded into `FileCard`, which the
    generic viewer does not know today. Leave the string unused rather than
    teaching the shared viewer about roles.
  - `DiffViewer` threads `findings` through to each `FileCard`
    (`DiffViewer.tsx:27-29`) — one new optional prop, no other change; the
    `files.map` stays flat (D4).
- **Constraint:** the collapse heuristic at `FileCard.tsx:35-37`
  (`additions + deletions <= AUTO_EXPAND_MAX_LINES`, 200,
  `client/src/components/diff-viewer/constants.ts:4`) is **unchanged** —
  role-based collapsing binds at the *group* level, not the file's (D10,
  Step 13). Do not add a second collapse rule here.
- **Done when:** `cd client && pnpm typecheck` passes, and `FileCard.test.tsx`
  covers: no `findings` prop → no dot, no footer; an anchor on a rendered line →
  dot + inline body; an anchor on a line not in the patch → footer block, dot
  still shown; `showFindings: false` → dot still shown, bodies hidden.

### Step 13 — Client: the `SmartDiffGroups` route-local component
- **Files:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/SmartDiffGroups/SmartDiffGroups.tsx` (new),
  `.../SmartDiffGroups/index.ts` (new), `.../SmartDiffGroups/styles.ts` (new),
  `.../SmartDiffGroups/constants.ts` (new), `.../SmartDiffGroups/helpers.ts` (new)
- **Change:**
  - `constants.ts`: `ROLE_LABEL_KEY` and `ROLE_DESC_KEY`, two
    `Record<SmartDiffRole, string>` maps holding `prReview.json` **keys**
    (`smartDiff.coreLabel`/`smartDiff.coreDesc`, …) — keys, never English text
    (frontend-code-organization §5); `ROLE_SWATCH: Record<SmartDiffRole, string>`
    holding **CSS custom properties**, never hex (§5) — `core: "var(--accent)"`,
    `tests: "var(--ok)"`, `wiring: "var(--warn)"`,
    `docs: "var(--text-secondary)"`, `boilerplate: "var(--info)"` (D10 explains
    why `docs` cannot also be `var(--info)`/`var(--stale)`: both are `#6b7280`,
    `client/src/vendor/ui/styles.css:31,37`); and
    `DEFAULT_COLLAPSED_ROLES = ['docs', 'boilerplate'] as const`.
  - `helpers.ts` (pure; it imports nothing from `react` — §6 makes that the
    test): `joinGroups(groups: SmartDiffGroup[], files: PrFile[]): { role; files: PrFile[] }[]`
    implementing **D5**'s path join, including the "absent from the response →
    end of `core`" fallback; `filesWithFindings(files, anchors)` returning the
    header counter of D6; and `diffTotals(files)` returning
    `{ files, additions, deletions }` for the section summary line of D10.
  - `SmartDiffGroups.tsx` (`"use client"`): props
    `{ groups, files, commenting, findings, hasReview }`. **All five** groups
    render, in response order, including any with zero files (D9, settled by the
    user) — each as the header row of D10 — chevron ·
    `ROLE_SWATCH` square · translated role label · muted
    `t(ROLE_DESC_KEY[role])` · then, right-aligned, `● {n}` +
    `t("smartDiff.filesWithFindings", { count })` when `n > 0`, and
    `t("smartDiff.filesCount", { count })`; when `hasReview` is false,
    `t("smartDiff.noReviewYet")` replaces the counter (D8, P3) — followed, when
    open, by
    `<DiffViewer files={groupFiles} commenting={commenting} findings={findings} />`.
    An **empty group** renders its header with
    `t("smartDiff.filesCount", { count: 0 })` → `0 files`, no `● n`, and no body
    — it is not special-cased away, and it still obeys
    `DEFAULT_COLLAPSED_ROLES`, so an empty `docs` group shows as a collapsed
    `Docs · 0 files` row.
    **The group itself is collapsible** (screenshot 2): open state is
    `Record<SmartDiffRole, boolean>` seeded from `DEFAULT_COLLAPSED_ROLES`, and
    a collapsed group renders its header row only. The header is a
    `role="button"` + `aria-expanded` div with Enter/Space handling, copying
    `FileCard.tsx:57-68` so its keyboard behaviour matches the file cards
    directly below it.
- **Constraint:** route-local `_components/<PascalCase>/` with a one-line
  explicit `index.ts` barrel (frontend-code-organization §1, §8); this component
  may import the **shared** `@/components/diff-viewer` and the sibling
  `../FindingCard` (same route) but nothing from another route's `_components/`;
  `helpers.ts` must not import `react`; props are camelCase while the DTO fields
  it reads stay snake_case (`client/CLAUDE.md:42-44`).
- **Done when:** `cd client && pnpm typecheck` passes and
  `SmartDiffGroups.test.tsx` (Step 16) shows **five** ordered group headers with
  label + description + file count — including a `0 files` header for a role
  with no files — `docs`/`boilerplate` collapsed to header rows on first render,
  and `pnpm-lock.yaml` under the Boilerplate header once it is expanded.

### Step 14 — Client: the `useSmartDiff` hook, its key, and invalidation
- **Files:** `client/src/lib/hooks/keys.ts` (edit, the `reviewKeys` factory at
  lines 11-17), `client/src/lib/hooks/reviews.ts` (edit)
- **Change:**
  - `keys.ts`: add `smartDiff: (prId) => ["pr-smart-diff", prId] as const` to
    `reviewKeys` — through the factory, never a hand-built array (that file's own
    doc comment at `:1-10` is the rationale).
  - `reviews.ts`: `useSmartDiff(prId)` calling
    `api.get<SmartDiff>('/pulls/${prId}/smart-diff', SmartDiff)`, `enabled` on a
    non-null `prId`, mirroring `usePrReviews`
    (`client/src/lib/hooks/reviews.ts:58`).
  - Add `qc.invalidateQueries({ queryKey: reviewKeys.smartDiff(prId) })` to the
    `onSuccess` of the run-review mutation
    (`client/src/lib/hooks/reviews.ts:180-185`, which already invalidates
    `reviews`/`activeRuns`/`runs`) and of `useFindingAction` (`:209-211`) — this
    is what makes counters and indicators update after **Run review** with no
    page reload (P3).
- **Constraint:** every server call is a TanStack Query hook in
  `src/lib/hooks/*`; never `fetch` from a component (`client/CLAUDE.md:48-49`,
  frontend-code-organization §7). `SmartDiff` is already re-exported through
  `client/src/lib/types.ts:35`, so no type is retyped locally.
- **Done when:** `cd client && pnpm typecheck` passes, and
  `grep -rn '"pr-smart-diff"' client/src` matches **only** `keys.ts`.

### Step 15 — Client: wire `DiffTab` (the section header, both controls, degradation)
- **Files:**
  `client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx` (edit)
- **Change:**
  - No new props are needed: `DiffTab` already receives `prId` and `files`
    (`client/src/app/repos/[repoId]/pulls/[number]/page.tsx:159-166`). Inside it,
    call `useSmartDiff(prId)` and `usePrReviews(prId)` — the latter is already
    fetched on this page (`page.tsx:41`), so it is a cache hit, not a second
    request.
  - **Section header (D10).** `SectionLabel` keeps `icon="Code"` and its text
    becomes `t("smartDiff.sectionTitle")` ("Reviewer-ordered diff"; the
    primitive uppercases it, `SectionLabel.tsx:18-26`), replacing today's
    `Files changed · {filesCount} files` at `DiffTab.tsx:60`. Directly below it,
    a muted sub-row renders `t("smartDiff.summaryLine", diffTotals(files))` →
    `9 files · +247 −38`.
  - **Both controls share the `right` slot.** `SectionLabel`'s `right`
    (`SectionLabel.tsx:9,28`; already used at `DiffTab.tsx:47-58`) receives one
    flex row: first the **order control** — two `Chip`s (`Smart order` /
    `Original order`) in a `<div role="group" aria-label={t("smartDiff.orderControlLabel")}>`,
    `active` on the current mode
    (`client/src/vendor/ui/primitives/Chip.tsx:34-37` gives the filled/unfilled
    pair) — then the existing show/hide `Button`, unchanged in form
    (`kind="ghost" size="sm"`, Eye/EyeOff, `DiffTab.tsx:49-56`) but with its
    render condition widened to `commentCount > 0 || findingCount > 0` and its
    label read from `prReview.json` instead of the hardcoded English at
    `DiffTab.tsx:55` (D7). **Do not build a new segmented primitive** —
    `client/CLAUDE.md:62-63`.
  - Build the `DiffFindingApi` from the **latest** review's findings
    (`reviews[0]` — the list is newest-first,
    `server/src/modules/reviews/repository/review.repo.ts:57-74`): one anchor per
    finding (`id`, `path: f.file`, `line: f.start_line`, `severity: f.severity`,
    `label: t('smartDiff.severityLabel.' + f.severity)`),
    `showFindings: showComments` (D7), `unanchoredLabel: t('smartDiff.unanchored')`,
    and `render: (id) => <FindingCard f={byId.get(id)!} defaultExpanded
    pending={action.isPending} repoFullName={…} headSha={…}
    onAction={(act) => action.mutate({ findingId: id, action: act, prId })} />`
    with `const action = useFindingAction()` — the exact call-site pattern of
    `FindingsPanel.tsx:29` and `:83`, which is what makes Accept/Dismiss change
    the finding's persisted state (P2). `defaultExpanded` is what reproduces the
    screenshot-3 card; every other detail in that screenshot is already
    `FindingCard` behaviour (D10's table), and **`FindingCard` is not modified
    by this plan**.
  - `const [grouped, setGrouped] = React.useState(true)`. Render
    `<SmartDiffGroups …>` when `grouped && smartDiff.data`; otherwise the
    existing flat
    `<DiffViewer files={files} commenting={commenting} findings={findingApi} />`
    (`DiffTab.tsx:62`). While loading or on error, `grouped` is forced off and
    the order control disabled, with `t('smartDiff.groupingFailed')` shown as a
    muted line on error (D8).
- **Constraint:** `page.tsx` stays thin — no new prop plumbing, no filtering or
  sorting moved into it (frontend-code-organization §4). `FindingCard` is
  imported from the **sibling** `../FindingCard`, which is legal: same route.
  The shared viewer still imports nothing route-local (D3).
- **Done when:** `cd client && pnpm test && pnpm typecheck` pass, and manually:
  the tab reads `REVIEWER-ORDERED DIFF` over `N files · +A −D`, with the
  segmented order control and the comments toggle side by side; groups show
  swatch + label + description + `● n` + `n files`; `docs`/`boilerplate` are
  collapsed; "Original order" restores the pre-lesson flat list; a finding
  renders under its line with a stripe and a `blocker` chip; Accept greys the
  card out and survives a reload.

### Step 16 — Client: the tests
- **Files:** `.../SmartDiffGroups/SmartDiffGroups.test.tsx` (new),
  `client/src/components/diff-viewer/FileCard/FileCard.test.tsx` (new),
  `.../DiffTab/DiffTab.test.tsx` (new)
- **Change:** each wraps the tree in `NextIntlClientProvider` seeded from the
  real `client/messages/en/prReview.json`, copying
  `FindingCard.test.tsx:1-31` (including its `afterEach(cleanup)` and the
  module-level typed fixture). Assertions, minimum:
  - `SmartDiffGroups`: **exactly five** group headers in
    `core, tests, wiring, docs, boilerplate` order, each showing its label
    **and** its description; the per-header file count; a fixture whose `docs`
    group is empty still renders a `Docs` header reading `0 files`, collapsed,
    with no `● n` counter and no file cards (D9, settled by the user);
    `docs` and `boilerplate` render **collapsed to header rows** (their file
    cards absent until the header is clicked, and clicking reveals them —
    screenshot 2); `pnpm-lock.yaml` under Boilerplate once expanded; the
    files-with-findings counter reads `2` for a fixture with two
    findings-bearing files holding five findings between them (the spec's exact
    case).
  - `FileCard`: the four cases from Step 12's done-condition, plus one
    asserting that a file with GitHub comments but **no** findings shows the
    MessageSquare counter and no dot.
  - `DiffTab`: "Original order" swaps the grouped view for the flat one and
    "Smart order" swaps back (query the two `Chip`s by their accessible name);
    the visibility toggle hides finding bodies while leaving the dot; a rejected
    `/smart-diff` query falls back to the flat list without throwing.
  - Query the severity label (`blocker`/`warning`/`suggestion`) with
    `getByText`, **never** `getByRole('button', …)` — `client/INSIGHTS.md:17-24`.
    The order control, by contrast, *is* queried by role, because those really
    are buttons.
- **Constraint:** tests are colocated with their component
  (`client/CLAUDE.md:30-32`); `*.it.test.ts` means nothing on the client
  (frontend-code-organization §12); `fetch` is mocked, so these tests cannot
  catch a real response-shape change — Step 8 is what covers that
  (`client/CLAUDE.md:56-58`).
- **Done when:** `cd client && pnpm test` is green.

### Step 17 — Pre-PR gate and the human deliverables
- **Files:** none (no source change)
- **Change:** run, in order: `cd server && pnpm typecheck`;
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`;
  `cd server && pnpm exec vitest run .it.test`;
  `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs`;
  `cd client && pnpm typecheck`; `cd client && pnpm test`; then
  `diff -r client/src/vendor/shared server/src/vendor/shared`. Then invoke
  [`pr-self-review`](../../.claude/skills/pr-self-review/SKILL.md) — a
  `PreToolUse` hook denies `gh pr create` while a CRITICAL stands or the verdict
  is stale (`CLAUDE.md:100-105`). Prepare the human deliverables listed in the
  acceptance table: the demo recording and the PR description (implementation
  summary, which subagents were used, what `plan-verifier` checked).
- **Constraint:** the commit message is Conventional Commits with a scope
  already in use — `feat(smart-diff): …` (`CLAUDE.md:87-90`). Before staging,
  check for the untracked `openrouter-api-key` file at the repo root: it is
  **not** in `.gitignore`, so never `git add -A` (`CLAUDE.md:99-101`).
- **Done when:** every command above exits 0 (the integration lane may skip
  without Docker), `pr-self-review` writes a verdict with no CRITICAL, and the
  PR is open with the description and the video attached.

---

## Contract changes

**Yes — one widened enum, additive.**

`server/src/vendor/shared/contracts/brief.ts:94` — `SmartDiffRole` goes from
`z.enum(['core', 'wiring', 'boilerplate'])` to
`z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate'])`. `SmartDiffFile`
(`:97-103`), `SmartDiffGroup` (`:106-109`), `ProposedSplit` (`:112-115`) and
`SmartDiff` (`:118-125`) are used **unchanged**; `SmartDiffResponse = SmartDiff`
at `server/src/vendor/shared/contracts/review-api.ts:92-94` needs no edit.
`pseudocode_summary` (`brief.ts:99`) stays nullish and is always sent as `null`.

**Not a break:** the enum has zero implementations and zero callers today — a
grep over `server/src`, `client/src` and `reviewer-core/src` finds no
`SmartDiff*` reference outside `vendor/shared` and the type re-export at
`client/src/lib/types.ts:35`. Widening an enum only ever accepts more input.

**Propagation:** hand-copied byte-identically into
`client/src/vendor/shared/contracts/brief.ts` (Step 2). The two trees are
physical copies — no symlink, no sync script — and CI enforces equality with
`diff -r` in **both** `.github/workflows/client.yml:50` and
`.github/workflows/server-unit.yml:55`. Nothing is retyped per package
(`CLAUDE.md:66-69`).

## Migration

**None.** This feature adds no table and no column: `finding_lines` is computed
per request from the existing `findings` rows
(`server/src/db/schema/reviews.ts:33-53`), and file roles are computed from
`pr_files.path`. Nothing under `server/src/db/schema/**` or
`server/src/db/migrations/**` is touched, so `pnpm db:generate` is not run and
the "never hand-edit a migration" rule (`CLAUDE.md:110-115`) is satisfied
vacuously. If a later lesson persists classifications, that is a new plan.

## Test plan

| Suite | Command (verbatim from TESTING.md) | Covers which step |
|---|---|---|
| server-unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | Steps 4, 5, 6 — the `path → role` table incl. the three contested cases, `ROLE_ORDER`, `groupFilesByRole`, `SmartDiffService` against a fake repo (no review / two reviews / phantom file / `NotFoundError`) |
| server-integration | `cd server && pnpm exec vitest run .it.test` | Steps 7, 8 — `SmartDiff.parse` of the live response, role order, grouping with zero reviews, `finding_lines` after a review, 422/404 |
| server | `cd server && pnpm typecheck` | Steps 1, 3-7 |
| client | `cd client && pnpm test` | Steps 9, 11-13, 15, 16 — group header (label, description, counts), group collapse defaults, file dot, inline and unanchored findings, both controls, `/smart-diff` failure fallback |
| client | `cd client && pnpm typecheck` | Steps 2, 10-15 — the mirrored enum, the new `diff-viewer` prop types, the hook |
| architecture | `cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs` | Steps 5-7 — no SQL outside a repository, no `drizzle-orm`/`db/schema` in the new routes/service/helpers, **no `smart-diff → reviews/repository` edge** (`no-cross-module-repository`), `smart-diff/` not added to any exception list |
| vendor sync | `diff -r client/src/vendor/shared server/src/vendor/shared` | Steps 1-2 — the same check CI runs |

**The architecture gate is not optional, and it is not a linter.** Root
`CLAUDE.md:53-55` says no linter is configured and `typecheck` is the enforced
static gate — `depcruise` is a *layering* gate that sits alongside it, and it is
the only thing that catches the `no-cross-module-repository` trap of D1/Step 6.
Baseline on this tree **before** any change (run at plan time):
`✔ no dependency violations found (166 modules, 548 dependencies cruised)`. After
the change it must still report **0 violations**, and `cd server && pnpm typecheck`
must exit 0. A `warn`-severity finding still counts as a regression here: the
graph is clean today, so any new warning is this feature's.

Conventions that bind here: the DB-backed file **must** be `*.it.test.ts` or it
runs in the hermetic lane and fails (`TESTING.md:79-82`); testing is
typological — one happy path plus the edge that matters per layer, not coverage
chasing (`TESTING.md:8-24`); client tests mock `fetch`, so only the server suite
can catch a response-shape regression (`client/CLAUDE.md:56-58`). CI path
filters are per package and this change touches both `server/**` and
`client/**`, so both workflows run.

## Risks

| Risk | Step | Mitigation |
|---|---|---|
| **Classification order regresses silently** — someone reorders `ROLE_PATTERNS` and `__snapshots__` starts landing in `tests` | 3, 4 | The three contested cases are explicit rows in `smart-diff-classify.test.ts`, written **before** the implementation, plus a `DO NOT REORDER` comment naming them; `ROLE_ORDER` is pinned by its own assertion |
| **Display order and matching order get conflated** — they genuinely differ (`core` is last to match, first to display) | 3, 5 | Two separate constants with opposite orders, documented as such; the integration test asserts the *response* order independently of the unit test's matching order |
| **The prototype turns into a `FindingCard` rewrite** — screenshot 3 has an `X` close control the current card lacks | 15 | D10 maps every prototype detail to "already there / existing prop / P3-optional"; only `defaultExpanded` is used, and `FindingCard.tsx` is **not** in any step's file list |
| **A segmented control gets hand-rolled** instead of reusing a primitive | 15 | D10 picks two `Chip`s (`Chip.tsx:34-37` already renders the active/inactive pair); `kit/Tabs.tsx` is rejected with a reason (it is the underline tab bar already used directly above) |
| **The dot and the GitHub comment counter get merged** — the spec says they are different things | 12 | They are separate elements with separate data sources (`findings.anchors` vs `commenting.comments`, `FileCard.tsx:51-53`) and sit at opposite ends of the header row, as drawn; a test asserts a file with comments but no findings shows the counter and no dot |
| **`FindingCard` gets promoted to `src/components/` to satisfy an import** — premature promotion turns the shared folder into a junk drawer | 10, 13, 15 | D3 settles it: the viewer takes an opaque `render` slot; a grep gate is in Step 10's done-condition (`FindingCard`/`FindingRecord` must not appear anywhere under `client/src/components/diff-viewer/`) |
| **Dot/counter drift from the cards actually rendered** — two sources for "does this file have findings" | 14, 15 | D6: everything visual derives from the single `usePrReviews` record set; `finding_lines` is contract-filled and asserted server-side only. Both queries are additionally invalidated together (Step 14) |
| **Findings vanish when their line is not in the patch** (truncated patch, `patch: null`, a finding citing a deleted line) | 12 | `partitionAnchors` mirrors `partitionThreads` (`comments.ts:89-106`) and routes the remainder into a footer block built on the existing `OutdatedComments` precedent; the `patch: null` case is its own test |
| **Two grey groups become indistinguishable** — `docs` and `boilerplate` swatches | 13 | `--info` and `--stale` are both `#6b7280` in dark mode (`client/src/vendor/ui/styles.css:31,37`), so `docs` uses `var(--text-secondary)` and `boilerplate` `var(--info)`; no new hex is introduced (frontend-code-organization §5) |
| **A large PR renders five `DiffViewer`s and gets slower** | 12, 13 | Group-level collapse for `docs`/`boilerplate` (a collapsed group renders **no** `DiffViewer` at all) cuts the default render set; the per-file `AUTO_EXPAND_MAX_LINES` heuristic (`client/src/components/diff-viewer/constants.ts:4`) is untouched |
| **`/smart-diff` failure breaks the Files changed tab** | 15 | D8: the grouped view is strictly additive — loading/error falls back to the exact flat render that ships today, order control disabled, one muted line. The tab never awaits the new query |
| **An accidental LLM call sneaks into the Smart Diff path** (P2 forbids it) | 6, 7 | `SmartDiffService` takes only `Container['reviewRepo']` — it has no `container.llm` to reach for, by construction; the constructor signature is the check. `pseudocode_summary`, the one field that would need a model, is out of scope (D10) |
| **`smart-diff` imports `reviews/repository` and adds the graph's first cross-module repository edge** — and `import type` does not save it | 6 | D1/Step 6 type the constructor parameter `Container['reviewRepo']` (the `reviews/service.ts:31` idiom) instead of naming the class; `no-cross-module-repository` is `warn`-severity (`server/.dependency-cruiser.cjs:246-258`) but the baseline is 0 violations, so any new warning is this feature's. The Test plan makes `depcruise` a gate, not a suggestion |
| **`db/schema` imported to name the `pr_files` row shape** — there is no `PrFileRow` in `server/src/db/rows.ts` | 5, 6 | Step 5's helper takes a structural `{ path; additions; deletions; findingLines }[]`; Step 6 consumes `getPrFiles`'s return type by inference. `no-db-in-service` / `no-schema-in-helpers` are severity **error**, so this fails the gate outright rather than warning |
| **Workspace scoping forgotten on a new public route** | 7 | `getContext` is the first line of the handler and `repo.getPull(workspaceId, prId)` the first call in the service — a foreign-workspace id 404s, asserted in Step 8. This is also why `routes.ts` routes to the **security** lane (routing.md:68) |
| **Vendor trees drift** — the client copy is edited but not the server one (or vice versa) | 1, 2 | Both edited in adjacent steps; `diff -r` is in the Test plan and in CI twice (`client.yml:50`, `server-unit.yml:55`) |
| **`e2e/README.md` lands in `tests` and a reviewer calls it a bug** | 3, 4 | Recorded as a deliberate decision in D2 with the rejected alternatives; it is a named row in the test table, so the behaviour is asserted rather than accidental, and the user has since **settled** it (no `README*` carve-out) |

## Out of scope

- **`pseudocode_summary` — the `What this does:` line and the `summary` chip in
  screenshots 1, 3 and 4.** It needs a model call, it is in no acceptance
  criterion, and P2 forbids a new model call in this view. The contract field is
  sent as `null` (D10, Step 5).
- The `X` close control on an inline finding card (screenshot 3) — it would need
  a new `FindingCard` prop; P3-optional, not built (D10).
- Shipping the `Mechanical changes — diff collapsed by default` body
  (screenshot 4): the string is added, the behaviour is not — it would require
  teaching the shared `FileCard` about roles (D10, Step 12).
- Persisting classifications — no table, no column, no migration.
- Wiring the classifier into the reviewer prompt as a filter; that is L08.
- Any other PR Brief block (`brief.ts:16-91` — blast radius, risks, history).
- Touching `pulls/routes.ts`, or extending `PrDetail` with roles.
- Modifying `FindingCard` itself.
- Reordering or grouping anywhere but the Files changed tab (no PR-list column,
  no Agent runs tab change).
- Changing the per-file `AUTO_EXPAND_MAX_LINES` collapse heuristic.
- Sticky group headers and collapsible finding comments (P3 "nice to have").
- A second locale — `en` is the only one in `client/messages/`.
- Any e2e spec: `e2e/` flows are deterministic and model-free
  (`TESTING.md:88-90`), and the finding half of this feature needs a real review
  to be visible.

## Acceptance criteria → steps

| # | Criterion | Priority | Delivered by |
|---|---|---|---|
| 1 | Five groups in fixed order `core → tests → wiring → docs → boilerplate`, each with a role label and a file count | P1 | Steps 1, 3, 5 (server order), 9 (labels + descriptions), 13 (**all five headers render, including empty ones as `0 files`** — D9, settled by the user), 16 (asserted: exactly five headers) |
| 2 | The lock file lands in `boilerplate` | P1 | Steps 3, 4 (test row), 5 |
| 3 | `docs` and `boilerplate` collapsed on open — at the **group** level, per screenshot 2 (D10) | P1 | Steps 13 (`DEFAULT_COLLAPSED_ROLES`, a collapsed group renders header-only; an *empty* `docs` group is still rendered, still collapsed), 16 |
| 4 | Group header shows a counter of **files** that have findings (2 files / 5 findings → `2`) | P1 | Steps 13 (`filesWithFindings`, the `● n` of D10), 15 (anchors), 16 (the exact 2-of-5 fixture) |
| 5 | A file card with findings shows a dot (no number), distinct from the MessageSquare comment counter | P1 | Steps 12 (dot immediately after the path; counter stays far right), 16 |
| 6 | A finding comment under the right code line: severity, title, rationale, Accept/Dismiss | P1 | Steps 10, 11 (the slot), 15 (`FindingCard` + `defaultExpanded` + `useFindingAction`) |
| 7 | "Original order" toggle restores GitHub order | P1 | Steps 15 (the segmented `Chip` pair of D10), 16 |
| 8 | An open PR with an implementation description | P1 — **human deliverable** | Step 17. Implementer prepares: a description covering the five roles, the D3 and D10 decisions and the `e2e/README.md` call, ending with the repo's attribution line |
| 9 | A 1-3 min demo video | P1 — **human deliverable** | Step 17. Implementer prepares: a PR that exercises all five groups (it must include a lock file, a `.md`, a test file and a barrel), runs a review, then records group collapse → dot → inline finding → Accept → Original order |
| 10 | Patterns + role order in **one** constants file, with a unit test table `path → role` including the three contested cases | P2 | Steps 3, 4 |
| 11 | Route response validates against the `SmartDiff` contract; the enum extended in **both** `brief.ts` copies | P2 | Steps 1, 2, 7 (`response: { 200: SmartDiff }`), 8 (`SmartDiff.parse`) |
| 12 | No new model call in the Smart Diff view logs; grouping works before the first review | P2 | Steps 6 (the service has no LLM dependency to reach for), 8 (zero-review integration assertion), D8, and `pseudocode_summary` left out of scope (D10) |
| 13 | The finding line carries a coloured stripe and a `blocker`/`warning`/`suggestion` label | P2 | Steps 9 (`severityLabel`), 10 (`findingStripeFor`/`findingLabel`), 11 — mapping confirmed by screenshot 3 |
| 14 | Accept/Dismiss in the inline comment work and change the finding's state | P2 | Steps 15 (`useFindingAction`, the `FindingsPanel.tsx:29,83` pattern), 14 (invalidation) |
| 15 | A finding whose line is not in the patch appears in an end-of-file block | P2 | Steps 10 (`partitionAnchors`), 12 (footer next to `OutdatedComments`), 16 |
| 16 | Finding comments hide with the **same** toggle as GitHub comments | P2 | Steps 15 (D7 — one `showComments` boolean feeds `showFindings`; both controls sit in the same `right` slot, D10), 16 |
| 17 | PR description says which subagents were used and what `plan-verifier` checked | P2 — **human deliverable** | Step 17. Implementer prepares: the list of subagents actually invoked (planner, implementer, reviewers) and the `plan-verifier` verdict summary |
| 18 | Sticky group header | P3 | **Not delivered** — listed in *Out of scope* |
| 19 | Collapsible finding comment | P3 | Already satisfied: `FindingCard` owns its own expand/collapse (`FindingCard.tsx:43`) and is passed `defaultExpanded` in Step 15. No extra work |
| 20 | Empty state "no review has been run yet" instead of zero counters | P3 | Steps 9 (`noReviewYet`), 13 |
| 21 | Counters and indicators update after Run review without a page reload | P3 | Step 14 (invalidate `reviewKeys.smartDiff` alongside `reviews` on run success and on a finding action) |
| 22 | All group labels and captions come from `prReview.json`, not hardcoded | P3 | Steps 9 (section title, summary line, group descriptions, both control labels), 13 (`ROLE_LABEL_KEY`/`ROLE_DESC_KEY` hold keys, never text), 15 (moves the hardcoded toggle label at `DiffTab.tsx:55` into the catalog) |

Prototype-only details, mapped for completeness (none is an acceptance
criterion): the `‹› REVIEWER-ORDERED DIFF` label and `9 files · +247 −38`
summary → Steps 9, 15; group swatch colours and descriptions → Steps 9, 13;
`What this does:` / the `summary` chip → **out of scope**; the inline card's `X`
close → **P3, not built**; `Mechanical changes — diff collapsed by default` →
string added in Step 9, behaviour **not built**.

## Open questions

Two earlier questions have been **settled by the user** and are no longer open:

- **Empty groups** — all five headers always render, an empty one reading
  `0 files`. Folded into D9, Step 13, Step 16 and mapping criteria 1 and 3.
- **Classification order** — `e2e/README.md → tests` stands, with no `README*`
  carve-out. Folded into D2; Step 4's test row is unchanged.

1. **Which findings should the diff show when a PR has several reviews from
   different agents?** This plan uses the single latest review
   (`reviewsForPull`'s first row,
   `server/src/modules/reviews/repository/review.repo.ts:57-74`), matching the
   spec's "the latest review's findings". Showing the union across agents would
   need a dedupe rule that does not exist yet. *(Default if unanswered: latest
   review only, as specified.)*
2. **Swatch colours for `tests` and `docs` are a judgement call.** The prototype
   only shows `core`/`wiring`/`boilerplate`; D10 picks `var(--ok)` and
   `var(--text-secondary)` from the existing token set rather than inventing
   two. If the design owner has intended tokens for those two roles, they
   replace `ROLE_SWATCH`'s entries and nothing else changes. *(Default if
   unanswered: ship D10's mapping.)*
