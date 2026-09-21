# Routing — diff → skills

Which skill reviews which changed file. Match every file against the tables
below; a file may match several rows, and its lanes are the union. A skill runs
**once**, over all the files that routed to it.

Lane order (matters only for deduping — the first lane to report a line owns
the wording): backend → frontend → cross-cutting.

## Backend lanes

| Changed path | Skills |
|---|---|
| `server/src/modules/**/routes.ts` | [fastify-best-practices](../fastify-best-practices/SKILL.md), [onion-architecture](../onion-architecture/SKILL.md), [zod](../zod/SKILL.md) |
| `server/src/app.ts`, `server/src/server.ts`, Fastify plugins | fastify-best-practices, onion-architecture |
| `server/src/modules/**/service.ts`, `run-executor.ts`, `helpers.ts`, `findings.ts`, `diff-loader.ts` | onion-architecture |
| `server/src/modules/**/repository.ts`, `server/src/modules/**/repository/**` | onion-architecture, [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md) |
| `server/src/modules/repo-intel/**` | onion-architecture (+ drizzle for its repository files) |
| `server/src/adapters/**`, `server/src/platform/**` | onion-architecture |
| `server/src/db/schema/**`, `server/src/db/schema.ts` | drizzle-orm-patterns, [postgresql-table-design](../postgresql-table-design/SKILL.md) |
| `server/src/db/client.ts`, `seed.ts`, `seed-prompts.ts`, `rows.ts` | drizzle-orm-patterns |
| `server/src/db/migrations/**` | **none** — see `RULE-MIGRATION` in [repo-rules.md](repo-rules.md) |
| `server/src/vendor/shared/contracts/**`, `adapters.ts` | zod — plus `RULE-CONTRACT-SYNC` and `RULE-CONTRACT-BREAK` |
| `server/src/prompts/**` | **none** — `RULE-PROMPT` checks it against `docs/agent-prompts/README.md` |
| `server/test/**`, `server/**/*.test.ts` | **none** — `RULE-IT-SUFFIX` only |
| `reviewer-core/src/**` | onion-architecture (it covers reviewer-core's purity), `RULE-CORE-PURITY` |
| `reviewer-core/test/**` | **none** |

`server/src/modules/_shared/**` routes to onion-architecture: it is edge-layer
context, and a change there touches every module.

## Frontend lanes

| Changed path | Skills |
|---|---|
| `client/src/app/**/{page,layout,template,loading,error,not-found,default}.tsx`, `client/src/app/**/route.ts` | [next-best-practices](../next-best-practices/SKILL.md), [frontend-code-organization](../frontend-code-organization/SKILL.md) |
| `client/src/app/**/_components/**/*.tsx` | [react-best-practices](../react-best-practices/SKILL.md), frontend-code-organization |
| `client/src/components/**/*.tsx` | react-best-practices, frontend-code-organization |
| `client/src/lib/hooks/**` | react-best-practices, frontend-code-organization |
| `client/src/lib/**/*.ts` (non-hook) | frontend-code-organization |
| `client/src/i18n/**`, `client/messages/**` | frontend-code-organization (user-facing strings live here, never in constants) |
| `client/**/*.test.tsx`, `client/src/test/**` | [react-testing-library](../react-testing-library/SKILL.md) |
| `client/src/app/**/_components/**` *new folder* | frontend-code-organization (placement is the point) |
| `client/src/vendor/**` | **none** — vendored; `RULE-VENDOR` and `RULE-CONTRACT-SYNC` |
| `client/next.config.*`, `client/tsconfig.json` | **none** — `RULE-ALIAS-CI` |

A `.tsx` under `app/` that is *not* one of Next's file conventions is an
ordinary component: react-best-practices + frontend-code-organization.

## No lane — deterministic only

`e2e/**`, `scripts/**`, `.github/workflows/**`, `docker-compose.yml`,
`docs/**`, `*.md`, `.claude/**`. No vendored skill covers them; they get
[repo-rules.md](repo-rules.md) and nothing else, and their paths are listed in
`uncovered_files` so the report says so out loud.

Exception: a `.md` file that adds or edits a Mermaid block routes to
[mermaid-diagram](../mermaid-diagram/SKILL.md).

## Cross-cutting lanes — triggered by content, not path

These are the ones that go wrong if you route them by directory. Grep the
**added lines** of the diff; a match anywhere adds the lane, for the matching
files only.

| Lane | Add it when the added lines contain |
|---|---|
| [security](../security/SKILL.md) | `process.env`, `SecretsProvider`, token / apiKey / password / secret, auth or workspace-scoping logic, `child_process`, `exec(`, `sql\`` raw SQL, file upload or path joins from input, `dangerouslySetInnerHTML`, a new public route, an outbound `fetch` to a non-fixed URL |
| [zod](../zod/SKILL.md) | `z.`, a new schema, `safeParse`, `z.infer`, a changed contract |
| [typescript-expert](../typescript-expert/SKILL.md) | `any`, `as unknown as`, `@ts-expect-error`, `@ts-ignore`, a new generic signature, a conditional or mapped type, a new `.d.ts` |
| [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md) | a Drizzle query (`db.select`, `db.insert`, `.where(`, `eq(`) **outside** a repository file — which is also an onion-architecture CRITICAL |

`typescript-expert` is deliberately conditional: routing every `.ts` file to it
buries the real findings under type-golf suggestions.

## Worked examples

| Diff | Lanes that run |
|---|---|
| `client/src/app/repos/_components/RepoCard/RepoCard.tsx` + its `styles.ts` | react-best-practices, frontend-code-organization |
| `server/src/modules/pulls/routes.ts` + `service.ts` | fastify-best-practices, onion-architecture, zod |
| `server/src/db/schema/pulls.ts` + a generated migration | drizzle-orm-patterns, postgresql-table-design, `RULE-MIGRATION` (generated, so it passes) |
| `reviewer-core/src/grounding.ts` | onion-architecture, `RULE-CORE-PURITY` |
| `.github/workflows/client.yml` only | none — repo-rules only, listed in `uncovered_files` |
| `server/src/vendor/shared/contracts/findings.ts` | zod, `RULE-CONTRACT-SYNC`, `RULE-CONTRACT-BREAK` |
