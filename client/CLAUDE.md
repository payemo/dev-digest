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

## More

[README.md](README.md) (UI route map) ·
[docs/](docs/) · [specs/](specs/) · [INSIGHTS.md](INSIGHTS.md)
