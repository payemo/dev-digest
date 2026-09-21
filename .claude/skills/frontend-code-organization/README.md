# Frontend Code Organization Skill

## Motivation

`react-best-practices` covers how to *write* a React component well. It did not
usefully answer the question that comes first — **where does this file go?**
Its `## Code Organization (MEDIUM)` section was eight lines, had no examples,
and pointed at folders this repo does not have:

> - Colocate component + hook + helpers + tests per feature
> - Shared utilities go in `utils/` or `components/ui/`

There is no `utils/` in `client/`, and no `components/ui/` — shared primitives
are vendored at `src/vendor/ui`. So the one skill an agent would load for a
placement question actively sent it to the wrong place.

Meanwhile `client/src` already follows a strict and consistent layout across
115 `.tsx` files. `client/CLAUDE.md` records it in condensed reference form,
but as *facts about the codebase*, not as *rules applicable to a new file* —
no thresholds, no promotion rule, no rationale, and it omits tiers that exist
on disk (route-level `constants.ts`/`helpers.ts`, nested `_components/`,
component-scoped `hooks/`).

This skill closes that gap. It is deliberately **specific to this repo**: every
rule names a real path, and the two places where the codebase currently
contradicts its own convention are documented as counter-examples rather than
quietly omitted.

### Decisions taken

| Question | Choice | Why |
|---|---|---|
| Extend `react-best-practices` or add a skill? | **New skill** | Placement and authoring are different questions asked at different moments; one 400-line skill triggers poorly for both. |
| Generic guide or repo-specific? | **Repo-specific** | A generic guide would restate the sources; the value here is that the answer is a path you can create today. |
| Present alternatives or pick one? | **One recommendation + short "why"** | An agent needs a default it can act on. The rationale is there so a human can overrule it. |
| Add to `skills-lock.json`? | **No** | That file pins *vendored* skills. Locally authored ones (`engineering-insights`, `react-testing-library`, `security`) are absent by design. |

### Changes to `react-best-practices`

Its `## Code Organization` section was replaced with a cross-link, so the two
skills cannot drift into contradicting each other.

### Where this skill deviates from its sources

Worth stating plainly, since the sources are widely cited:

- **Bulletproof React** and **Feature-Sliced Design** both organize around a
  top-level `features/` (or layers/slices) directory. This repo colocates in
  the App Router instead — `_components/` next to the route. The FSD *ideas*
  (narrow slices, a curated public API per slice, imports only downward) are
  adopted; its directory layout is not.
- **Bulletproof React advises against barrel files entirely.** This repo keeps
  a one-line `index.ts` per component folder. The skill splits the difference:
  thin explicit re-exports are fine and already universal here; new *wide*
  `export *` barrels are not.
- The **PascalCase vs kebab-case** debate is recorded as settled, not reopened
  — PascalCase for route-local component folders, kebab-case for shared ones,
  because the casing encodes which tier you are in.

---

## Sources

These sources informed the skill. ✓ marks a source read in full rather than
via search summary.

### Architecture methodologies

- ✓ [Bulletproof React — project structure](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — feature-folder layout; the unidirectional `shared → features → app` rule; "it is recommended to import the files directly" over barrels; don't import across features, compose them at the app level.
- [Bulletproof React — project standards](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) — the ESLint `no-restricted-imports` config that mechanically enforces the layering.
- ✓ [Feature-Sliced Design — overview](https://feature-sliced.design/docs/get-started/overview) — layers/slices/segments; the `ui`/`api`/`model`/`lib`/`config` segment vocabulary; "modules on one layer can only import from layers strictly below"; public API per slice.
- [Feature-Sliced Design — homepage](https://feature-sliced.design/) · [documentation repo](https://github.com/feature-sliced/documentation)
- [Screaming Architecture — Evolution of a React folder structure — profy.dev](https://dev.to/profydev/screaming-architecture-evolution-of-a-react-folder-structure-4g25) — Uncle Bob's principle applied to React: a `components/ hooks/ contexts/` tree "screams: I'm a React app" instead of naming the domain. *(profy.dev was unreachable when this was written; DEV mirror linked.)*
- [React Handbook — Project Standards](https://reacthandbook.dev/project-standards) — "don't spend more than 5 minutes trying to plan a folder structure"; let 10+ files reveal the pattern.
- [Robin Wieruch — React Folder Structure Best Practices (2026)](https://www.robinwieruch.de/react-folder-structure/) — the 5-step growth path from one file to feature folders; "start with components/, hooks/, and one of utils/ or lib/, then add more as the codebase tells you it needs them".
- ✓ [Alex Kondov — Tao of React](https://alexkondov.com/tao-of-react/) — group by route/module from the start; a directory per component with colocated styles and tests; absolute import prefixes over relative climbs; data lives closest to where it is used.
- [Sandro Roth — How to structure your React projects](https://sandroroth.com/blog/project-structure/) — side-by-side comparison of the above.

### Colocation and locality

- ✓ [Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation) — "place code as close to where it's relevant as possible"; the maintainability / applicability / ease-of-use argument; the caveat that e2e tests belong at the root because they span systems.
- ✓ [htmx essays — Locality of Behaviour](https://htmx.org/essays/locality-of-behaviour/) — Richard Gabriel on locality as the primary feature for easy maintenance; the distinction between inlining an *implementation* and inlining an *invocation*; LoB vs DRY vs SoC as a context-dependent trade-off.
- [Matias Kinnunen — Locality of Behavior / Co-location](https://mtsknn.fi/blog/locality-of-behaviour-and-co-location/) — the same principle applied to frontend files specifically.

### Official React / Next.js

- ✓ [React — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — when extraction is warranted; the `use` prefix rule and why a non-hook must *not* carry it; "don't create custom Hooks like `useMount`"; hooks share stateful logic, not state; if you can't name it, it isn't ready to extract.
- ✓ [React — Thinking in React](https://react.dev/learn/thinking-in-react) — a component "should ideally only be concerned with one thing"; split along the data model, since UI and data share an information architecture.
- [React — `'use client'` reference](https://react.dev/reference/rsc/use-client) — the directive marks a boundary, not a file.
- ✓ [Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure) — colocation inside `app/` is safe because a route is not public without `page`/`route`; `_folder` private folders; `(group)` route groups; the three file-splitting strategies; "Next.js is unopinionated about how you organize".
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — where to place the boundary and how composition crosses it.
- [Next.js — `use client` directive](https://nextjs.org/docs/app/api-reference/directives/use-client)

### Business logic placement

- [profy.dev — Path To A Clean(er) React Architecture, pt.6: Business Logic & Dependency Injection](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection)
- [profy.dev — pt.7: Domain Logic](https://profy.dev/article/react-architecture-domain-logic) — separating domain rules from use-case orchestration.
- [Felix Gerschau — Separation of concerns with React hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/) — hooks as the seam between UI and logic.
- [Dan Abramov — Presentational and Container Components](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0) — cited **for its retraction**: "I wrote this article a long time ago and my views have since evolved. In particular, I don't suggest splitting your components like this anymore." Hooks remove the arbitrary division, which is why this skill routes logic by *kind* rather than prescribing container/presenter pairs.
- [patterns.dev — Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) — the pattern and why hooks superseded it.
- [TkDodo — Deriving Client State from Server State](https://tkdodo.eu/blog/deriving-client-state-from-server-state) — keep server state in the query cache and derive the rest; why a store mirroring server data is a mistake.
- [TkDodo — React Query and Forms](https://tkdodo.eu/blog/react-query-and-forms) — tracking only user-made changes as client state.

### Splitting components

- [Sunscrapers — Single Responsibility Principle in React applications](https://sunscrapers.com/blog/single-responsibility-principle-in-react-applications-part-1/)
- [cekrem — SRP in React: The Art of Component Focus](https://cekrem.github.io/posts/single-responsibility-principle-in-react/)
- [Your React Component Isn't Too Big. It Has Too Many Reasons to Change. — DEV](https://dev.to/bishoy_bishai/your-react-app-is-probably-doing-too-much-4a20) — reasons-to-change over line count, and the "and" test. This is the source for the skill declining to set a line-count threshold.

### Barrel files and imports

- [Barrel Files: Why index.ts Re-Exports Hurt Tree Shaking, Next.js Dev Memory, and tsc (2026) — DEV](https://dev.to/childrentime/barrel-files-why-indexts-re-exports-hurt-tree-shaking-nextjs-dev-memory-and-tsc-2026-3kpm) — the three costs: defeated tree-shaking, slower builds and `tsc`, and barrels as the most common way import cycles appear.
- [webpack discussion #16863 — barrel files, tree-shaking and code-splitting](https://github.com/webpack/webpack/discussions/16863) — why a barrel is only optimizable when it is a thin pure re-export.
- [The Index.ts Dilemma — Medium](https://krishnavadlamudi44.medium.com/the-index-ts-dilemma-balancing-convenience-and-performance-in-typescript-projects-85e9dd4fc18f) — when a thin barrel still earns its place; the basis for this skill allowing one-line component barrels.
- [eslint-plugin-boundaries](https://www.npmjs.com/package/eslint-plugin-boundaries) · [Taking frontend architecture serious with dependency-cruiser — Xebia](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) — mechanical enforcement of layer and import rules. **Reference only:** no linter is configured in any package in this repo (root `CLAUDE.md` — `typecheck` is the sole enforced static gate), so the skill notes that these rules are unenforced and hold only through review.

### Constants, utils and naming

- [Semaphore — How To Organize Constants in a Dedicated Layer in JavaScript](https://semaphore.io/blog/constants-layer-javascript) — split constants into contextual files rather than one module.
- [Are utils a code smell? — DEV](https://dev.to/noway/are-utils-folder-where-you-put-random-stuff-you-don-t-know-where-to-put-otherwise-a-code-smell-3054) — the argument against an unnamed `utils/` bucket, adopted here as "never `src/lib/utils.ts`".
- [Lib vs Utils vs Services Folders](https://indie-starter.dev/blog/lib-vs-utils-vs-services-folders-simple-explanation-for-developers) — the `lib` = finished and reusable vs `utils` = grab bag distinction.
- [Naming Conventions in React — Sufle](https://www.sufle.io/blog/naming-conventions-in-react) · [PascalCase or Kebab-Case — Medium](https://medium.com/@sadeqshahmoradi76/pascalcase-or-kebab-case-best-or-bad-practice-in-file-naming-7382635d517e) — the file-casing debate, including the case-insensitive-filesystem argument for kebab-case.

### In-repo sources

- `client/CLAUDE.md` — `## Where things live`, `## Naming`, `## Non-default conventions`.
- `client/INSIGHTS.md` — the `SeverityBadge` vs `Chip` entry, evidence for both folder shapes in practice.
- `client/tsconfig.json` — the `@/*`, `@devdigest/shared`, `@devdigest/ui` path aliases.
- `.claude/skills/react-testing-library/README.md` — the Motivation + Sources format this file follows.
