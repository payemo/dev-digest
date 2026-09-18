# CLAUDE.md — `@devdigest/web`

## Stack

Next.js 15 (App Router), React 19, TanStack Query, `next-intl`, Tailwind 4,
`recharts`, `mermaid`, `react-markdown`. Vitest + jsdom for tests (`fetch`
mocked, no real API/browser needed).

## Commands

- `pnpm dev` — serve on `:3000`.
- `pnpm test` — vitest (jsdom, mocked fetch). `pnpm typecheck`. `pnpm build`.

## Where things live

- `src/app/**/page.tsx` — routes (App Router). Pages stay thin.
- `src/lib/api.ts` + `src/lib/hooks/*` — every server call goes through a
  TanStack Query hook here; API base is `NEXT_PUBLIC_API_BASE` (default
  `http://localhost:3001`).
- `src/components/app-shell/` — nav, breadcrumbs, `g`-then-key shortcuts.
- Feature logic sits in colocated `_components/<Name>/` next to the route,
  each with its own `*.test.tsx`.
- `src/vendor/ui` (`@devdigest/ui`) — vendored UI primitives.
- `src/vendor/shared` (`@devdigest/shared`) — Zod contracts shared with the
  server.
- `messages/<locale>/*.json` — `next-intl` translations.

## Naming

- Route-colocated components: `_components/<PascalCase>/` holding
  `<Name>.tsx`, an `index.ts` barrel, and `<Name>.test.tsx`, plus whichever of
  `styles.ts` (exports `s`), `constants.ts`, `helpers.ts` a component needs.
- Cross-route shared components use the same internal layout but live under
  `src/components/<kebab-case>/` (e.g. `src/components/findings-summary/`),
  not inside any one route's `_components/`.
- Hooks are `use<Thing>` in `src/lib/hooks/*`, one TanStack Query hook per
  server call (see [Non-default conventions](#non-default-conventions)).
- Routes are `page.tsx`; dynamic segments are bracketed
  (`[repoId]`, `[number]`).
- i18n keys are dotted camelCase in `messages/<locale>/<area>.json`
  (`panel.hideLowConfidence`, `runStatus.usage`).
- **API DTO fields are snake_case** (`cost_usd`, `start_line`) straight from
  `@devdigest/shared`; local component props/state stay camelCase — that
  casing seam marks the wire boundary, it isn't a style slip.

## Non-default conventions

- Never `fetch` directly from a component — add/extend a hook in
  `src/lib/hooks/*` instead, so tests can mock at one seam.
- Full browser journeys (client + API + seeded DB) live in
  [`../e2e`](../e2e/README.md), not here — this package's tests are
  component/interaction level only.

## Gotchas

- Component tests mock `fetch`, so a real API response shape change won't
  fail them — only [`../e2e`](../e2e/README.md) or the server's own tests
  catch that.

## Do not touch

- Don't duplicate a UI primitive that already exists under `src/vendor/ui` —
  it's vendored, not generated per-feature.
- **Never hand-edit `pnpm-lock.yaml`** — add/bump/remove deps with `pnpm`
  so the lockfile stays consistent.

## More

[README.md](README.md) (UI route map) ·
[docs/](docs/) · [specs/](specs/) · [INSIGHTS.md](INSIGHTS.md)
