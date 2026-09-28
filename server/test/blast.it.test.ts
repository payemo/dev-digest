/**
 * `GET /pulls/:id/blast` (L04, plan Steps 5-6) — DB-backed, against a real
 * Postgres via testcontainers.
 *
 * What only a real request can prove:
 *   - the response validates against BOTH the route-local `BlastRadiusResponse`
 *     AND the shared `BlastRadius` contract as it is actually serialized (the
 *     route declares it as `response.200`, so a drifted shape 500s),
 *   - `degraded` / `reason` SURVIVE that serialization — the two fields are not
 *     in the shared contract, and a schema that stripped unknown keys would
 *     delete them silently and make the UI's degraded badge unreachable,
 *   - the facade is handed the seeded PR's own `repoId` and its real `pr_files`
 *     paths, i.e. workspace resolution and file lookup are genuinely wired,
 *   - the two edge cases of the route itself — 422 before the handler for a
 *     non-uuid id, 404 for a PR in another workspace.
 *
 * No LLM override is injected on purpose: this endpoint makes no model call at
 * all, so a regression that adds one fails here by reaching a real provider
 * instead of passing quietly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { BlastRadius } from '@devdigest/shared';
import { BlastRadiusResponse } from '@devdigest/shared';
import type { BlastResult, RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[blast] Docker not available — skipping integration tests.');
}

const FILES = [
  { path: 'src/api/rate-limit.ts', additions: 40, deletions: 6 },
  { path: 'src/api/public/index.ts', additions: 12, deletions: 1 },
];

/**
 * A repo-intel double that answers `getBlastRadius` with a caller-supplied
 * result and records the arguments it was handed. Every other method throws, so
 * this fails loudly if the blast path ever reaches for a capability it should
 * not need.
 */
class FakeRepoIntel implements RepoIntel {
  readonly seen: { repoId: string; files: string[] }[] = [];
  constructor(private result: BlastResult) {}
  async getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult> {
    this.seen.push({ repoId, files: changedFiles });
    return this.result;
  }
  setResult(result: BlastResult): void {
    this.result = result;
  }
  indexRepo(): never {
    throw new Error('not used by blast');
  }
  refreshIndex(): never {
    throw new Error('not used by blast');
  }
  getIndexState(): never {
    throw new Error('not used by blast');
  }
  getRepoMap(): never {
    throw new Error('not used by blast');
  }
  getFileRank(): never {
    throw new Error('not used by blast');
  }
  getSymbolsInFiles(): never {
    throw new Error('not used by blast');
  }
  getCallerSignatures(): never {
    throw new Error('not used by blast');
  }
  getUnresolvedReferences(): never {
    throw new Error('not used by blast');
  }
  getConventionSamples(): never {
    throw new Error('not used by blast');
  }
  getTopFilesByRank(): never {
    throw new Error('not used by blast');
  }
  getCriticalPaths(): never {
    throw new Error('not used by blast');
  }
}

/** The persistent path's shape: resolved callers plus per-file facts. */
const INDEXED: BlastResult = {
  changedSymbols: [
    { name: 'rateLimit', file: 'src/api/rate-limit.ts', kind: 'function' },
    { name: 'resetBuckets', file: 'src/api/rate-limit.ts', kind: 'function' },
  ],
  callers: [
    {
      file: 'src/api/public/items.ts',
      symbol: 'listItems',
      viaSymbol: 'rateLimit',
      line: 23,
      rank: 90,
    },
    {
      file: 'src/jobs/hourly.ts',
      symbol: 'run',
      viaSymbol: 'resetBuckets',
      line: 8,
      rank: 10,
    },
  ],
  impactedEndpoints: ['GET /api/public/items'],
  factsByFile: {
    'src/api/public/items.ts': { endpoints: ['GET /api/public/items'], crons: [] },
    'src/jobs/hourly.ts': { endpoints: [], crons: ['reset-rate-buckets (hourly)'] },
  },
  degraded: false,
};

d('L04 blast radius endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let intel: FakeRepoIntel;
  let repoSeq = 0;

  async function setupPr(ownerWorkspaceId: string) {
    const name = `blast-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ownerWorkspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ownerWorkspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4',
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db
      .insert(t.prFiles)
      .values(FILES.map((f) => ({ prId: pr!.id, ...f, patch: null })));
    return { pr: pr!, repoId: repo!.id };
  }

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    intel = new FakeRepoIntel(INDEXED);
    app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        secrets: new MockSecretsProvider(),
        repoIntel: intel,
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('returns the contract, and asks the facade for the PR\'s own repo and files', async () => {
    intel.setResult(INDEXED);
    intel.seen.length = 0;
    const { pr, repoId } = await setupPr(workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);

    // The response is the contract, not merely shaped like it — and it
    // satisfies the SHARED one as well as the route-local extension.
    const body = BlastRadiusResponse.parse(res.json());
    expect(() => BlastRadius.parse(res.json())).not.toThrow();

    // Workspace resolution and the pr_files lookup are really wired: the
    // hermetic service test can only assert this against its own fake.
    expect(intel.seen).toEqual([{ repoId, files: FILES.map((f) => f.path) }]);

    expect(body.changed_symbols.map((s) => s.name)).toEqual(['rateLimit', 'resetBuckets']);
    // maxRank descending: `rateLimit`'s caller ranks 90, `resetBuckets`'s 10.
    expect(body.downstream.map((entry) => entry.symbol)).toEqual(['rateLimit', 'resetBuckets']);
    expect(body.downstream[0]!.callers).toEqual([
      { name: 'listItems', file: 'src/api/public/items.ts', line: 23 },
    ]);
    expect(body.downstream[0]!.endpoints_affected).toEqual(['GET /api/public/items']);
    expect(body.downstream[1]!.crons_affected).toEqual(['reset-rate-buckets (hourly)']);
    // A healthy response carries neither degraded key.
    expect(res.json()).not.toHaveProperty('degraded');
    expect(res.json()).not.toHaveProperty('reason');
  });

  it('surfaces degraded and reason THROUGH the response schema', async () => {
    intel.setResult({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    });
    const { pr } = await setupPr(workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);

    // The regression this guards: a response schema that strips unknown keys
    // deletes both fields silently, and the UI can never say the index is stale.
    const body = BlastRadiusResponse.parse(res.json());
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe('no_data');
    expect(body.downstream).toEqual([]);
    // Still the shared contract, degraded or not.
    expect(() => BlastRadius.parse(res.json())).not.toThrow();
  });

  it('422s a non-uuid id before the handler, and 404s a PR in another workspace', async () => {
    intel.setResult(INDEXED);
    const bad = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/blast' });
    expect(bad.statusCode).toBe(422);

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const foreign = await setupPr(otherWs!.id);
    intel.seen.length = 0;
    const res = await app.inject({ method: 'GET', url: `/pulls/${foreign.pr.id}/blast` });
    expect(res.statusCode).toBe(404);
    // Tenancy is decided before the facade is touched — repo-intel's tables
    // carry no workspace_id, so there is no second line of defence.
    expect(intel.seen).toEqual([]);
  });
});
