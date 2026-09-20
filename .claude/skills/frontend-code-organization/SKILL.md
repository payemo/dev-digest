---
name: frontend-code-organization
description: >
  Decides where frontend code goes in `client/` (@devdigest/web) — which folder
  a component belongs in, how to split a component folder, where constants,
  helpers, styles, types and business logic live, and when something graduates
  from route-local to shared. Use when adding a component, extracting a helper
  or constant, splitting an oversized component, placing a new hook, deciding
  between `helpers.ts` and `src/lib/`, adding a barrel or `index.ts`, choosing
  a server vs client component, or reviewing a diff for misplaced files. Also
  for "where should this go", "where do I put", "is this the right folder",
  "should this be shared". Does NOT cover how to write the component itself —
  hooks rules, state, rendering and performance live in
  [react-best-practices](../react-best-practices/SKILL.md).
---

# Frontend Code Organization — `client/`

Where code goes in `@devdigest/web`. Every rule below is the layout `client/src`
already follows; the point of this skill is to make it applicable to a *new*
file instead of something you infer by reading neighbours.

This is the **placement** half of the pair. The **authoring** half — purity,
hooks, derived state, memoization, keys, a11y — is
[react-best-practices](../react-best-practices/SKILL.md). Don't duplicate rules
across the two.

Stack: Next.js 15 App Router, React 19, TanStack Query, `next-intl`, Tailwind 4,
Vitest + jsdom. Alias `@/*` → `src/*`.

## Severity Levels

Same scheme as `react-best-practices`, so the two read as one body of rules:

- **CRITICAL** — breaks a boundary the codebase depends on; will be reverted in review
- **HIGH** — creates drift or a dumping ground that costs real cleanup later
- **MEDIUM** — inconsistency; cheap to fix now, annoying to fix in bulk

---

## Decision table (start here)

| I have a new… | It goes in |
|---|---|
| Component used by one route | `src/app/<route>/_components/<PascalCase>/` |
| Private sub-part of a component | a **nested** `_components/` inside that component's folder |
| Component used by 2+ routes | `src/components/<kebab-case>/` |
| Generic UI primitive (Button, Skeleton) | already exists in `src/vendor/ui` — **use it, don't rebuild it** |
| Constant used by one component | that component's `constants.ts` |
| Constant used across one route | the route's own `constants.ts` (sibling of `page.tsx`) |
| Constant used app-wide | a **named** file in `src/lib/` — never `src/constants/` |
| Pure function used by one component | that component's `helpers.ts` |
| Pure function used app-wide | a **named** file in `src/lib/` (`format.ts`, `github-urls.ts`) |
| Server call | a TanStack Query hook in `src/lib/hooks/<domain>.ts` |
| Hook internal to one shared component | that component's `hooks/` folder (only `app-shell/` does this today) |
| Inline `style={}` objects | that component's `styles.ts`, exported as `s` |
| User-facing string | `messages/<locale>/<area>.json` — **never** a constant |
| Contract / DTO type | `@devdigest/shared`, re-exported through `src/lib/types.ts` |
| Component test | `<Name>.test.tsx` next to the component |

If two rows apply, take the **narrower** one. Widening later is a two-line move;
narrowing after three routes import it is not.

---

## 1. Where components live (CRITICAL)

Four tiers, narrowest first:

```
src/app/<route>/_components/<PascalCase>/     ← route-local
  └── _components/<PascalCase>/               ← private sub-part of that component
src/components/<kebab-case>/                  ← cross-route shared
src/vendor/ui                                 ← vendored primitives (@devdigest/ui)
```

- **Start route-local.** A component begins life in the `_components/` of the
  route that needs it. `_components` is a Next.js private folder — the `_`
  prefix opts it out of routing, so it can sit inside `app/` safely.
- **Nest private sub-parts.** When a route-local component grows its own
  internal pieces, they go in a nested `_components/` *inside it*, not as
  siblings — `AgentEditor/_components/ConfigTab/`,
  `RunTraceDrawer/_components/TraceBody/`. The nesting is the documentation:
  it says these parts are not usable on their own.
- **Promote on the second consumer, not before.** A component moves to
  `src/components/<kebab-case>/` when a *second* route actually imports it.
  Not when you suspect it might. Premature promotion is how a shared folder
  turns into a junk drawer.
- **Never import another route's `_components/`.** That import is illegal, and
  it is also the signal: the moment you want to write it, promote the component
  instead. This is the one boundary that keeps routes independently editable.
- **Never rebuild a `src/vendor/ui` primitive.** It is vendored, not generated
  per feature.

Note the casing seam: **PascalCase** folders for route-local components,
**kebab-case** folders for shared ones. It is not a style slip — it tells you
which tier you are in at a glance, from the path alone.

## 2. What goes in a component folder (HIGH)

```
<Name>/
├── <Name>.tsx         ← required: the component, and only this component
├── index.ts           ← required: one-line re-export
├── styles.ts          ← when it has more than a couple of inline styles
├── constants.ts       ← when it has lookup maps or magic numbers
├── helpers.ts         ← when it has pure functions
└── <Name>.test.tsx    ← when it has behaviour worth asserting
```

Add a file when the need appears; do not scaffold empty ones. The thresholds:

- **`styles.ts`** — exports a single object named `s`. Entries are either
  `CSSProperties` objects (`satisfies CSSProperties`) or functions returning one
  when the style depends on props. Extract as soon as inline styles stop being
  glanceable.
- **`constants.ts`** — lookup maps, thresholds, grid templates, enumerations of
  keys. See §5 for what must *not* go here.
- **`helpers.ts`** — pure functions only. **If it imports from `react`, it is
  not a helper** — it is a hook or part of the component. This is the test.
- **`index.ts`** — see §8.

## 3. When to split a component (HIGH)

Count **reasons to change**, not lines. The largest component here is 259 lines
and that is fine; a 90-line component that does three unrelated things is not.

- **The "and" test.** If describing the component needs "and" — "renders the
  run list *and* owns the filter state *and* formats costs" — split it.
- **Split along the data model,** which is what React's own guidance
  recommends: each component matches one piece of the data it renders.
- **Extraction target matters.** Pull rendering into a nested
  `_components/<Part>/`; pull pure derivation into `helpers.ts`; pull a server
  call into `src/lib/hooks/`. Don't extract a sibling component whose only
  caller is its former parent — that is a nested part, not a peer.
- **Don't split to hit a number.** A component split into three files that must
  be read together is worse than the one file.

## 4. Pages stay thin (HIGH)

`page.tsx` reads route params and search params, calls hooks, and composes
components. Filtering, sorting and shaping belong in `helpers.ts`; the
thresholds and key lists they use belong in `constants.ts`.

`src/app/repos/[repoId]/pulls/page.tsx` is the codebase's own counter-example:
it inlines a three-stage filter/sort chain and declares a module-level
`OPEN_STATUSES` set that belongs in the `constants.ts` sitting right next to it.
Follow the rule, not that file. If you touch it, move those two things.

## 5. Constants (HIGH)

Three tiers, narrowest first: component `constants.ts` → route `constants.ts` →
a named file in `src/lib/`.

- **No `src/constants/` folder.** A single global constants module becomes a
  dumping ground with no owner. Constants live next to what they configure.
- **A route can own constants.** `src/app/repos/[repoId]/pulls/constants.ts`
  holds what that route's components share but nothing outside it needs —
  `STATUS_META`, `GRID`, `SIZE_SMALL_MAX`. This middle tier is easy to miss;
  use it instead of duplicating into each `_components/` child.
- **User-facing strings are not constants.** They belong in
  `messages/<locale>/<area>.json` under dotted camelCase keys. A `constants.ts`
  may hold the *key* (`labelKey: "needs_review"`), never the English text.
- **Colours are CSS custom properties.** `constants.ts` maps *to* a token
  (`CRITICAL: "var(--crit)"`); it never holds a hex value.
- **Types may ride along.** Where a constant defines a shape, its type can be
  exported from the same `constants.ts` (`PrSize`, `SizeInfo`) rather than
  forcing a separate `types.ts`.

## 6. `helpers.ts` vs `src/lib/` (HIGH)

| | `helpers.ts` | `src/lib/<name>.ts` |
|---|---|---|
| Scope | one component or one route | two or more unrelated features |
| Imports React? | no — never | no |
| Named after | its component | what it does |

- **Promote on the second unrelated consumer**, same rule as components.
- **Name the file for its subject**: `format.ts`, `github-urls.ts`,
  `model-label.ts`, `feature-models.ts`. **Never create `src/lib/utils.ts`** —
  an unnamed bucket attracts everything and explains nothing.
- **Keep helpers pure.** Pure means testable without rendering, which is why
  `src/lib/format.test.ts` can exist as a plain unit test.

## 7. Business logic (CRITICAL)

Three destinations, by kind:

- **Anything crossing the network → a TanStack Query hook** in
  `src/lib/hooks/<domain>.ts` (`core`, `agents`, `reviews`, `trace`,
  `repo-intel`). **Never `fetch` from a component.** One seam means tests mock
  in one place, and every caller inherits caching and invalidation.
- **Deriving, filtering, formatting → `helpers.ts`** as a pure function over
  data already in hand. `visibleFindings(findings, hideLow, severityFilter)` is
  the shape to copy: data in, data out, no hooks.
- **Orchestration → the component.** Which hook to call, what to do with
  loading/error/empty, which handler fires on click. That is the component's
  actual job.

Do not add a store that mirrors server data. Server state lives in the query
cache; derive everything else from it at render time, and keep only genuine
user intent (a filter toggle, a draft) in local state.

## 8. Barrels (HIGH)

Every component folder gets a **one-line** `index.ts`:

```ts
export { FindingCard, FindingCard as default } from "./FindingCard";
```

- **Keep it to explicit named re-exports** of that one component. Prefer this
  over `export * from "./X"` — a star export hides what the folder's surface is
  and re-exports anything added later by accident.
- **A shared folder's `index.ts` is its public API.** `diff-viewer/index.ts`
  exports `DiffViewer` and the `DiffCommentApi` type, and nothing else — the
  seven internal component folders stay internal. Copy that: curate the surface,
  don't mirror the directory.
- **Do not add new wide barrels.** `src/lib/hooks/index.ts` is an intentional
  `export *` aggregator and is the only one; it stays. Wide barrels are the main
  way import cycles enter a codebase and they defeat tree-shaking, so new ones
  need a reason beyond convenience.
- **Never create a barrel that re-exports across tiers** — no
  `src/components/index.ts` collecting every shared component.

## 9. Imports (MEDIUM)

- **`@/` for anything outside the current folder**: `@/lib/hooks`,
  `@/components/app-shell`, `@/lib/types`.
- **Relative only within a component folder** — `./constants`, `./styles`,
  `./_components/ConfigTab`.
- **No deep relative climbs.** `src/app/repos/[repoId]/pulls/constants.ts`
  currently imports `"../../../../lib/types"`; that should be `@/lib/types`.
  Four levels of `../` is unreadable and breaks silently when the route moves.
- **Contracts come from `@devdigest/shared`**, either directly or via
  `@/lib/types` — never retyped locally.

There is **no linter in this repo** (root `CLAUDE.md`: `typecheck` is the only
enforced static gate). Nothing mechanically catches an illegal import, so these
rules hold only if applied while writing and checked in review.

## 10. Server and client components (HIGH)

`"use client"` is the common case here — 61 of 115 `.tsx` files carry it, and
only `app/layout.tsx`, `agents/page.tsx` and `settings/[section]/page.tsx` are
server components. That is a consequence of a TanStack Query studio UI, not an
excuse to stop thinking.

- **Default to a server component; add `"use client"` at the leaf that needs
  interactivity.** The directive marks a boundary, not a file: everything a
  client module imports joins the client bundle.
- **Compose across the boundary with `children`.** To render server content
  inside a client component, pass it as `children` rather than importing it —
  importing pulls it client-side.
- **Put the directive at the top of the file, before imports.**

## 11. Types (MEDIUM)

- **Contracts** (API DTOs) come from `@devdigest/shared` via `src/lib/types.ts`,
  which is a pure re-export and the single source of truth.
- **DTO fields stay snake_case** (`cost_usd`, `start_line`); local props and
  state are camelCase. That seam marks the wire boundary — do not "fix" it.
- **Props types live next to the component** that takes them, not in a shared
  types file.

## 12. Tests (MEDIUM)

- `<Name>.test.tsx` sits **in the component's folder**, so a component and its
  test move together.
- Pure modules take a sibling unit test (`src/lib/format.test.ts`).
- **`*.it.test.ts` means nothing here** — that suffix splits the server's
  DB-backed lane. Client tests are component/interaction level with `fetch`
  mocked; full browser journeys belong in `e2e/`.

---

## Review checklist

- [ ] New component in the narrowest tier that works — route-local unless a second route imports it
- [ ] Private sub-parts nested in `_components/`, not siblings
- [ ] No import reaching into another route's `_components/`
- [ ] Constants at the narrowest tier; no `src/constants/`; no user-facing strings in them
- [ ] `helpers.ts` imports nothing from `react`
- [ ] No `fetch` outside `src/lib/hooks/`
- [ ] `page.tsx` wires; it does not filter, sort or derive
- [ ] `index.ts` is a one-line explicit re-export; no new wide barrels
- [ ] `@/` used instead of `../../..`
- [ ] Types from `@devdigest/shared`; DTO casing left alone
- [ ] Test colocated with its component

See [examples.md](examples.md) for each of these as a before/after from real
paths in `client/src`.
