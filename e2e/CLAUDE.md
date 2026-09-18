# CLAUDE.md — `@devdigest/e2e`

## Stack

[agent-browser](https://github.com/vercel-labs/agent-browser) (Rust + CDP
browser-automation CLI) — **no Playwright, no LLM, no API key**. `run.ts`
plays a flow's commands in order against one shared browser session.

## Commands

- `npm test` (= `tsx run.ts`) — against your own running dev stack. Only safe
  if that DB has *only* the seeded demo repo.
- `npm run e2e:hermetic` / `../scripts/e2e.sh` — **preferred**: boots an
  isolated, freshly-seeded stack on alternate ports and tears it down after.
- `npm run typecheck`.

## Where things live

- `specs/NN-name.flow.json` — one flow = a JSON list of agent-browser
  commands (see [README's "How a flow works"](README.md#how-a-flow-works)
  for the schema).
- `run.ts` — the runner; `lib/assert.ts` — assertion helpers.
- `agent-browser.json` — CLI config.

## Naming

- Flows are `specs/NN-name.flow.json`, numbered in the order they're meant to
  run (`01-app-boot` before `02-repo-pulls-detail`, etc.) — the number is a
  run-order hint, not an id referenced elsewhere.

## Non-default conventions

- Locators are deterministic only — `--url`, `--text`, `find role|text|label`.
  Never the AI `chat` command; that would make runs non-deterministic and
  need a key.
- Flows target **read-only seeded data** (`acme/payments-api`, PR #482) so no
  flow ever triggers a real model call.

## Gotchas

- Flows `02`/`04`/`05` assume the seeded repo is the *only* repo in the DB —
  running against a dev DB with other imported repos makes them land on the
  wrong repo and fail. Use the hermetic runner instead of debugging that.
- Failure screenshots land in `e2e/test-results/` (git-ignored, uploaded as a
  CI artifact).

## Do not touch

- Never run `docker compose down -v` to "reset" for a flow — `-v` deletes the
  `devdigest_pgdata` volume, wiping every real repo/review you've imported,
  not just test data.
- **Never hand-edit `package-lock.json`** — add/bump/remove deps with `npm`
  so the lockfile stays consistent.

## More

[README.md](README.md) (flow format, run modes, coverage table) ·
[docs/](docs/) · [specs/](specs/) · [INSIGHTS.md](INSIGHTS.md)
