# Examples — Onion Architecture in `server/`

Every snippet below is real code from this repo (lightly trimmed). Paths are
relative to the repo root.

---

## 1. Routes hold no logic

### ❌ `server/src/modules/pulls/routes.ts`

The handler resolves the repo, calls GitHub, and upserts every PR — three
layers' worth of work inside one route:

```ts
import { and, desc, eq, inArray } from 'drizzle-orm';
import * as t from '../../db/schema.js';

app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
  const { workspaceId } = await getContext(container, req);
  const [repo] = await container.db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
  if (!repo) throw new NotFoundError('Repo not found');

  let gh: GitHubClient | null = null;
  try { gh = await container.github(); } catch (err) { /* … */ }

  if (gh) {
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    for (const pr of pulls) {
      await container.db.insert(t.pullRequests).values({ /* 13 fields */ })
        .onConflictDoUpdate({ /* … */ });
    }
  }
  // … 350 more lines
});
```

Three things are wrong: the route imports `drizzle-orm`, it holds the
local-first sync rule (a business rule), and none of it is reachable from a job
or a test without standing up HTTP.

### ✅ `server/src/modules/reviews/routes.ts`

Same shape of work, correctly layered — ten endpoints in 150 lines:

```ts
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ReviewService } from './service.js';

export default async function reviewsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ReviewService(container);

  app.get('/pulls/:id/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  app.get('/runs/:id/trace', { schema: { params: IdParams } }, async (req) => {
    await getContext(container, req);
    const trace = await service.getRunTrace(req.params.id);
    if (!trace) throw new NotFoundError('Run trace not found');
    return trace;
  });
}
```

Context → service → map → throw. Nothing else.

---

## 2. A service is callable without HTTP

### ✅ `server/src/modules/repos/service.ts`

The same service methods back an HTTP route *and* a background job, which is
only possible because nothing in the service names Fastify:

```ts
export class RepoService {
  private repo: RepoRepository;

  constructor(private container: Container) {
    this.repo = new RepoRepository(container.db);
  }

  registerCloneJobHandler(): void {
    this.container.jobs.register(CLONE_JOB_KIND, async (payload) => {
      await this.runCloneJob(payload as CloneJobPayload);
    });
  }

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const { repoId, owner, name, url } = payload;
    const token = await this.container.secrets.get(GITHUB_TOKEN_SECRET);
    const cloneUrl = token ? withGitHubToken(url, token) : url;
    const { path } = await this.container.git.clone({ owner, name }, cloneUrl, {
      depth: CLONE_DEPTH,
    });
    await this.repo.updateClonePath(repoId, path);
  }
}
```

Note `container.git` — the `GitClient` **port**, not `SimpleGitClient`. And
`withGitHubToken` is a pure helper, so the URL-munging rule is unit-testable
with no clone.

---

## 3. Repository owns the SQL, splits by aggregate

### ✅ `server/src/modules/reviews/repository.ts`

One public class, three colocated implementation modules, one import surface:

```ts
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Finding, Intent, RunSummary, RunTrace } from '@devdigest/shared';
import type { FindingRow, PullRow } from '../../db/rows.js';

export type { FindingRow, PullRow };
export type ReviewRow = typeof t.reviews.$inferSelect;

import * as reviewRepo from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';

export class ReviewRepository {
  constructor(private db: Db) {}
  // composes the three modules; public API stays flat
}
```

`constructor(private db: Db)` — a `Db`, never a `Container`. Growing past one
aggregate splits the *implementation*, not the interface.

---

## 4. Row types: type-only, and never on the wire

### ❌ `server/src/modules/repos/helpers.ts`

A pure helper pulling in the whole schema module to name one row:

```ts
import * as t from '../../db/schema.js';

export function toRepoDto(row: typeof t.repos.$inferSelect): Repo {
  return { id: row.id, workspace_id: row.workspaceId, /* … */ };
}
```

The mapper is correct — camelCase row → snake_case DTO is exactly right. The
*import* is the problem: a value import of the schema in the application layer.

### ✅ `server/src/modules/reviews/helpers.ts`

```ts
import type { Finding } from '@devdigest/shared';
import type { FindingRow, PullRow, ReviewRow } from './repository.js';
```

Type-only, via the repository's re-export. `db/rows.ts` exists for the same
purpose across modules:

```ts
// server/src/db/rows.ts
export type FindingRow = typeof t.findings.$inferSelect;
export type PullRow = typeof t.pullRequests.$inferSelect;
```

The fix for `repos/helpers.ts` is one line: add `RepoRow` to `db/rows.ts` and
`import type { RepoRow } from '../../db/rows.js'`.

---

## 5. Ports and adapters

### ✅ Port — `server/src/vendor/shared/adapters.ts`

```ts
/**
 * Adapter interfaces. ALL external calls go behind these interfaces.
 * Real implementations live in `apps/api/src/adapters/*`; mock implementations
 * live alongside for tests/dev (Services depend on the interface, not the impl).
 */
export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}
```

### ✅ Composition root — `server/src/platform/container.ts`

Lazy, cached, resolved through `SecretsProvider`, overridable in tests:

```ts
get git(): GitClient {
  if (this.overrides.git) return this.overrides.git;
  this._git ??= new SimpleGitClient(this.config.cloneDir);
  return this._git;
}

async github(): Promise<GitHubClient> {
  if (this.overrides.github) return this.overrides.github;
  if (this._github) return this._github;
  const token = await this.secrets.get('GITHUB_TOKEN');
  if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
  this._github = new OctokitGitHubClient(token);
  return this._github;
}
```

The `ConfigError` throws when the feature is *used*, not at boot — that is what
keeps a missing key from breaking unrelated endpoints.

### ❌ What this prevents

```ts
// in a service — two rules broken at once
import { Octokit } from 'octokit';
const gh = new Octokit({ auth: process.env.GITHUB_TOKEN });
```

The SDK escapes `adapters/`, and the secret escapes `SecretsProvider`.

---

## 6. The pure core

### ✅ `reviewer-core/package.json`

The description is the architectural contract, and it is currently true:

```json
"description": "DevDigest review engine — pure logic (prompt assembly, citation grounding, structured output, reduce, reviewPullRequest). No DB/GitHub/FS; the only side effect is an injected LLMProvider. Consumed by server (local reviews) and agent-runner (CI) as source via tsconfig path alias."
```

Its only runtime dependencies are `openai` and `zod`. It is consumed through a
tsconfig path alias:

```json
"paths": {
  "@devdigest/reviewer-core": ["../reviewer-core/src/index.ts"],
  "@devdigest/shared": ["./src/vendor/shared/index.ts"]
}
```

That alias is why the CI runner can share the engine with no build step — and
why turning `reviewer-core` into a built package would break more than it fixes.

---

## 7. Adding a module — the full shape

```
server/src/modules/<domain>/
├── routes.ts        ← required. zod schema + getContext + service call
├── service.ts       ← the use case. ports + repository. no SQL, no Fastify
├── repository.ts    ← the only drizzle-orm / db/schema import
├── helpers.ts       ← pure. type-only row imports
└── constants.ts     ← job kinds, secret names, thresholds
```

Only `routes.ts` is mandatory — but a module with a DB query and no
`repository.ts` is one of the four cases in §9 of
[SKILL.md](SKILL.md#9-known-violations--do-not-copy), not a precedent.

Register it statically in `server/src/modules/index.ts`.

Then verify:

```bash
cd server && pnpm exec depcruise src --config .dependency-cruiser.cjs
```
