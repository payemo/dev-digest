import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[run-cost] Docker not available — skipping integration tests.');
}

/**
 * Run Cost Badge — the main correctness proof. The seed (deliberately left
 * untouched) creates PR #482 with zero `agent_runs`, so this test inserts its
 * own runs with KNOWN costs and asserts the exact numbers surfaced at every
 * read path: per-run (GET /pulls/:id/runs), per-PR sum (GET /repos/:id/pulls),
 * and trace-stats fallback (GET /runs/:id/trace) for a pre-cost-badge document.
 *
 * `MockSecretsProvider()` (all keys undefined) guarantees the PriceBook never
 * sees a real OPENROUTER_API_KEY, so it stays on the static price table — the
 * derived numbers below are exact, not "close to live pricing".
 */
d('Run Cost Badge (PR-list SUM + per-run + trace fallback)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    const [repo] = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    repoId = repo!.id;

    const [pr] = await pg.handle.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
    prId = pr!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), secrets: new MockSecretsProvider() },
    });
  }

  const MODEL = 'deepseek/deepseek-v4-flash'; // priced in the static table: {in: 0.14, out: 0.28} per 1M

  it('sums exactly across provider-reported, derived, and unknown-model runs — and a PR with none is 0, not null', async () => {
    // A: provider-reported cost wins over any derivation.
    const [runA] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        prId,
        provider: 'openrouter',
        model: MODEL,
        tokensIn: 10_000,
        tokensOut: 2_000,
        costUsd: 0.01,
        status: 'done',
        source: 'local',
      })
      .returning();
    // B: no reported cost, priced model → derives to exactly 0.14 + 0.28 = 0.42.
    const [runB] = await pg.handle.db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        prId,
        provider: 'openrouter',
        model: MODEL,
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
        costUsd: null,
        status: 'done',
        source: 'local',
      })
      .returning();
    // C: no reported cost, unpriced model → null alone, contributes 0 to the sum.
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      prId,
      provider: 'openrouter',
      model: 'totally/unknown-model',
      tokensIn: 5_000,
      tokensOut: 500,
      costUsd: null,
      status: 'failed',
      source: 'local',
    });
    // A second, run-less PR on the same repo — must sum to 0, never null/dash.
    const [barePr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9001,
        title: 'No runs yet',
        author: 'nobody',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
      })
      .returning();

    const app = await makeApp();

    // ---- per-PR SUM (GET /repos/:id/pulls) --------------------------------
    const listRes = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json() as { number: number; cost_usd: number | null }[];
    const pr482 = list.find((p) => p.number === 482);
    const pr9001 = list.find((p) => p.number === 9001);
    expect(pr482?.cost_usd).toBeCloseTo(0.43, 6); // 0.01 + 0.42 + 0 — proves decision A, no double-count, unknown→0
    expect(pr9001?.cost_usd).toBe(0); // no runs → 0, never null/dash

    // ---- per-run values (GET /pulls/:id/runs) ------------------------------
    const runsRes = await app.inject({ method: 'GET', url: `/pulls/${prId}/runs` });
    expect(runsRes.statusCode).toBe(200);
    const runs = runsRes.json() as { run_id: string; cost_usd: number | null }[];
    const byId = new Map(runs.map((r) => [r.run_id, r.cost_usd]));
    expect(byId.get(runA!.id)).toBe(0.01); // provider-reported, verbatim
    expect(byId.get(runB!.id)).toBeCloseTo(0.42, 9); // derived from tokens
    const runC = runs.find((r) => r.cost_usd === null);
    expect(runC).toBeDefined(); // unpriced model → honest null, not 0 or dropped

    // ---- trace-stats fallback for a pre-cost-badge document (GET /runs/:id/trace) ----
    // Simulate a trace persisted before this feature: `stats` has NO cost_usd key.
    await pg.handle.db.insert(t.runTraces).values({
      runId: runB!.id,
      trace: {
        config: { agent: 'Security Reviewer', version: '1', provider: 'openrouter', model: MODEL, pr: 482, source: 'local' },
        stats: { duration_ms: 1000, tokens_in: 1_000_000, tokens_out: 1_000_000, findings: 0, grounding: '0/0 passed' },
        prompt_assembly: { system: 's', user: 'u' },
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [],
      },
    });

    const traceRes = await app.inject({ method: 'GET', url: `/runs/${runB!.id}/trace` });
    expect(traceRes.statusCode).toBe(200);
    const trace = traceRes.json() as { stats: { cost_usd: number | null } };
    expect(trace.stats.cost_usd).toBeCloseTo(0.42, 6); // derived on read, doc never mutated in storage

    await app.close();
  });
});
