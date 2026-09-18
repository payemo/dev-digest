# CLAUDE.md — DevDigest

Local-first AI pull-request review, and the **course starter template**: a
minimal-but-working tool that imports a PR and runs an agent review on it. Each
course lesson (L01–L08) adds one feature back — see the table in
[README.md](README.md#what-you-build-in-the-course).

## Layout

Four **standalone packages** — no monorepo workspace. Each has its own
`package.json` and lockfile; cross-package code is shared through **tsconfig
path aliases**, never published/built modules.

| Folder           | Package                    | What it is                                         | Port |
|------------------|----------------------------|----------------------------------------------------|------|
| `server/`        | `@devdigest/api`           | Fastify 5 + Drizzle/Postgres (pgvector)            | 3001 |
| `client/`        | `@devdigest/web`           | Next.js 15 App Router (the studio)                 | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | Pure engine: diff → prompt → LLM → findings        | —    |
| `e2e/`           | `@devdigest/e2e`           | Deterministic browser e2e (agent-browser)          | —    |
| `server/src/vendor/shared` | `@devdigest/shared` | Zod contracts shared by every package             | —    |

`repo-intel` (codebase indexer behind the **Indexed** badge, feeds project
context into reviews) lives inside the server at
[`server/src/modules/repo-intel`](server/src/modules/repo-intel).

**Each package has its own `CLAUDE.md` — read it before touching that package**:
[client](client/CLAUDE.md) · [server](server/CLAUDE.md) ·
[reviewer-core](reviewer-core/CLAUDE.md) · [e2e](e2e/CLAUDE.md).

## Commands

Run everything **from the package directory**, not the root — there is no root
`package.json`.

- `./scripts/dev.sh` — the whole stack from zero: Postgres (Docker) → `.env`
  files → install → migrate → seed → API `:3001` + web `:3000`.
  Flags: `--no-seed` · `--no-client` · `--db-only`.
- `./scripts/e2e.sh` — hermetic e2e: isolated freshly-seeded stack on alternate
  ports, torn down after.
- `server/`, `client/`: `pnpm dev` · `build` · `typecheck` · `test`
  (+ server `db:migrate` / `db:seed` / `db:generate`).
- `reviewer-core/`, `e2e/`: **npm**, not pnpm (`npm test`, `npm run typecheck`).
- **No linter is configured in any package.** `typecheck` is the enforced
  static-analysis gate; there is no `lint` script and no ESLint config to run
  alongside it.

Only **Postgres** runs in Docker; API and web run on the host.

## Where things live

- `scripts/` — `dev.sh` (local bootstrap) and `e2e.sh` (hermetic e2e stack).
- `docker-compose.yml` — Postgres + pgvector only, volume `devdigest_pgdata`.
- `docs/agent-prompts/` — human-readable originals of the built-in reviewer
  system prompts, plus how a prompt is assembled and how to pick a model.
- `.claude/skills/` — the vendored skill catalog (canonical location; see its
  [README](.claude/skills/README.md)); `skills-lock.json` at the root pins each
  skill's upstream source and hash.
- `.github/workflows/` — one workflow per test suite, each **path-filtered**.
- Per package: `README.md` (diagrams/maps) · `docs/` · `specs/` ·
  `INSIGHTS.md` (append non-obvious findings here as they come up).
- [`INSIGHTS.md`](INSIGHTS.md) at the root — the cross-cutting one, for findings
  no single package owns.

## Insights loop

Each package has an `INSIGHTS.md` holding what its README and docs don't.
**Read the one for the package you're about to work in, and treat it as
high-confidence guidance unless it contradicts the code in front of you.**
When you learn something non-obvious — mid-session, not only at the end —
invoke the [`engineering-insights`](.claude/skills/engineering-insights/SKILL.md)
skill to append it to the right file. The root [`INSIGHTS.md`](INSIGHTS.md) is
for findings no package owns; read it only when working above package level.

## Naming

- **Packages** are `@devdigest/<short-name>` (`api`, `web`, `reviewer-core`,
  `shared`), matching the folder table above.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  — `type(scope): summary` (`feat(reviews):`, `docs:`, `revert:`); `git log`
  is the reference for scope names already in use.
- **Integration tests** are `*.it.test.ts` — the only thing splitting the
  DB-backed lane from the hermetic one (see below).
- **Drizzle migrations** keep their generator-assigned name
  (`NNNN_<word>_<word>.sql`, e.g. `0010_wooden_maggott.sql`) — never renamed
  by hand; see [Do not touch](#do-not-touch).
- Per-package naming (component folders, hooks, module layout, DTO casing)
  lives in that package's own `CLAUDE.md` under its own `## Naming` section.

## Non-default conventions

- **No workspace.** Never add a root `package.json`, hoist deps, or convert the
  four packages into a pnpm workspace — the split is deliberate, and CI's
  path filters depend on it.
- **Package managers differ**: `server`/`client` use pnpm, `reviewer-core`/`e2e`
  use npm. Use the one the package already has a lockfile for.
- **`@devdigest/shared` is the one contract source.** A request/response shape
  changes in `server/src/vendor/shared` and propagates by alias — don't retype
  it per package.
- **Migrations never run on boot.** After a schema change or a fresh DB, run
  `cd server && pnpm db:migrate` explicitly.
- **Integration tests are `*.it.test.ts`.** That suffix is the only thing
  splitting the DB-backed lane from the hermetic one
  (`vitest run --exclude '**/*.it.test.ts'` vs `vitest run .it.test`).
- **Testing is typological, not exhaustive** — cover the *kinds* of breakage per
  layer, mock the outside world (`server/src/adapters/mocks.ts`); don't chase
  coverage. Full strategy in [TESTING.md](TESTING.md).
- **Secrets live in `~/.devdigest/secrets.json`** (mode `0600`) via
  `SecretsProvider`, with `process.env` as fallback — never in `AppConfig`,
  the DB, or git.
- **Grounding is mandatory**: a finding without a real diff-line citation is
  dropped and the score is recomputed from the survivors — the model's
  self-reported score is never trusted.

## Gotchas

- `server/package.json` is **`skip-worktree`** (a local variant diverges from the
  committed file), which is why CI invokes `pnpm exec vitest run …` instead of
  committed `test:unit` / `test:integration` scripts. `git checkout` won't
  restore it.
- CI path filters encode **cross-package aliases** — e.g. `reviewer-core/**`
  triggers `server-unit` because the server type-checks against
  `../reviewer-core/src`. Change an alias, update the workflow's `paths:`.
- `server/clones/**` is runtime data (git-ignored) — never collected by any
  test suite, never committed.
- A rogue `openrouter-api-key` file sits untracked at the root and is **not**
  in `.gitignore`. Don't `git add -A` without checking.

## Do not touch

- **Never `docker compose down -v`** to "reset" — `-v` deletes the
  `devdigest_pgdata` volume, wiping every imported repo and review, not just
  test data. (Only do it when you actually mean a full reset, per
  [README's troubleshooting](README.md#troubleshooting).)
- **Never hand-edit a file under `server/src/db/migrations/`** — the `.sql`
  files and `meta/*_snapshot.json` / `meta/_journal.json` are generated by
  `pnpm db:generate` (Drizzle Kit) and its journal hash desyncs the moment one
  is edited by hand. To change the schema, edit `server/src/db/schema/*` and
  regenerate; see [server/CLAUDE.md](server/CLAUDE.md#do-not-touch).
- **Never hand-edit a lockfile** (`pnpm-lock.yaml` or `package-lock.json`) —
  change dependencies through that package's own package manager (pnpm for
  `server`/`client`, npm for `reviewer-core`/`e2e`; see
  [Non-default conventions](#non-default-conventions)). Related:
  `server/package.json` itself is `skip-worktree` (see
  [Gotchas](#gotchas)) — a different, narrower case, not a lockfile.
- Don't add features from the lesson table (L01–L08) to `main` unprompted —
  this branch is deliberately the starter state; homework belongs in forks.
- Don't turn `reviewer-core` into a built/published package or give it a real
  network/DB dependency — it is consumed as TS source through an alias.

## More

[README.md](README.md) (architecture diagram, quick start, troubleshooting) ·
[TESTING.md](TESTING.md) (suite map, CI strategy) ·
[docs/agent-prompts/](docs/agent-prompts/README.md)
