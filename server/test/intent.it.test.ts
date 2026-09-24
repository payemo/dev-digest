/**
 * Intent endpoints + the widened `pr_intent` table (L03, plan Steps 3, 8, 10) —
 * DB-backed, against a real Postgres via testcontainers.
 *
 * What only a real DB can prove: the migration landed every new column, the
 * upsert round-trips jsonb (`risk_areas`, `sources`) and doubles (`confidence`,
 * `cost_usd`) unchanged, the route serializes the record through
 * `PrIntentRecord`, and `is_stale` flips when the PR's `head_sha` moves — it is
 * computed on read, so no write is involved in that flip.
 *
 * HERMETICITY: `review_intent` defaults to provider `openrouter`, so the mock
 * MUST be injected under that key. Injecting only `openai` (as the older review
 * integration tests do) makes `container.llm('openrouter')` fall through to the
 * real provider and use whatever key is in `~/.devdigest/secrets.json` — a live,
 * billed network call from a test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrIntentRecord } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** What the cheap model is stubbed to propose for schema `PrIntent`. */
const PROPOSAL = {
  intent: 'Stop one API client from exhausting the shared Redis connection pool.',
  in_scope: ['Per-token rate limiting on public endpoints'],
  out_of_scope: ['Authenticated internal endpoints'],
  risk_areas: [
    { label: 'Secret handling', evidence_path: 'src/config.ts' },
    // Cites a file this PR does not touch → must be dropped in code (D4).
    { label: 'Invented worry', evidence_path: 'src/never-touched.ts' },
  ],
};

let repoSeq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string, body: string | null) {
  const name = `intent-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body,
    })
    .returning();
  await db
    .insert(t.prFiles)
    .values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0 });
  await db.insert(t.prCommits).values([
    {
      prId: pr!.id,
      sha: 'c1',
      message: 'Add rate limiter middleware',
      author: 'marisa.koch',
      committedAt: new Date('2026-06-01T01:00:00Z'),
    },
    {
      prId: pr!.id,
      sha: 'c2',
      message: 'Cover the limiter with tests',
      author: 'marisa.koch',
      committedAt: new Date('2026-06-01T02:00:00Z'),
    },
  ]);
  return { repo: repo!, pr: pr! };
}

d('L03 intent endpoints (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  // ONE app for the whole file: every test here drives the same two routes, and
  // each extra `buildApp` is another module graph + JobRunner competing with the
  // other integration files running in parallel.
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: {} }),
        github: new MockGitHubClient(),
        // Keyed 'openrouter' on purpose — see the file header.
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { PrIntent: PROPOSAL },
          }),
        },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('GET returns null before any derivation, and 422 for a non-uuid id', async () => {
    const { pr } = await setupPr(pg.handle.db, workspaceId, null);

    const before = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toBeNull();

    const bad = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/intent' });
    expect(bad.statusCode).toBe(422);
  });

  it('POST derives, persists every widened column, and GET then returns the record', async () => {
    const body = [
      '## Summary',
      'Adds per-token rate limiting to the public API endpoints so that one',
      'client cannot exhaust the shared Redis connection pool during a spike.',
      'Closes #471.',
    ].join('\n');
    const { pr } = await setupPr(pg.handle.db, workspaceId, body);

    const posted = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(posted.statusCode).toBe(200);
    const record = posted.json() as PrIntentRecord;

    expect(record.pr_id).toBe(pr.id);
    expect(record.intent).toBe(PROPOSAL.intent);
    expect(record.in_scope).toEqual(PROPOSAL.in_scope);
    expect(record.out_of_scope).toEqual(PROPOSAL.out_of_scope);
    // The risk citing a path outside this PR's changed files did not survive.
    expect(record.risk_areas).toEqual([
      { label: 'Secret handling', evidence_path: 'src/config.ts' },
    ]);
    // issue + body + commits + branch + paths = 0.25+0.25+0.10+0.05+0.05
    expect(record.sources).toEqual(['issue:471', 'body', 'commits', 'branch', 'paths']);
    expect(record.confidence).toBeCloseTo(0.7, 5);
    expect(record.provider).toBe('openrouter');
    expect(record.head_sha).toBe('a1b2c3d4');
    expect(record.is_stale).toBe(false);
    // The derivation's OWN usage, persisted here and not on `agent_runs` (D7).
    expect(record.tokens_in).toBe(100);
    expect(record.tokens_out).toBe(50);
    expect(record.cost_usd).toBeCloseTo(0.001, 6);
    expect(typeof record.derived_at).toBe('string');

    // Persisted, not just serialized: read the row back through Drizzle.
    const [row] = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(row!.confidence).toBeCloseTo(0.7, 5);
    expect(row!.riskAreas).toEqual([{ label: 'Secret handling', evidence_path: 'src/config.ts' }]);
    expect(row!.sources).toEqual(['issue:471', 'body', 'commits', 'branch', 'paths']);
    expect(row!.headSha).toBe('a1b2c3d4');
    expect(row!.derivedAt instanceof Date).toBe(true);

    const got = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual(record);
  });

  it('flips is_stale when the PR head moves, and clears it on re-derive (one row, upserted)', async () => {
    const { pr } = await setupPr(pg.handle.db, workspaceId, null);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });

    // New commits land: same PR, different head.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: 'f9e8d7c6' })
      .where(eq(t.pullRequests.id, pr.id));

    const stale = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` })).json();
    expect(stale.is_stale).toBe(true);
    expect(stale.head_sha).toBe('a1b2c3d4');

    const rederived = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` })
    ).json() as PrIntentRecord;
    expect(rederived.is_stale).toBe(false);
    expect(rederived.head_sha).toBe('f9e8d7c6');

    // Re-derivation REPLACES the row (pr_id is the primary key) — the row is the
    // cache, so a second derivation must not accumulate history.
    const rows = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.headSha).toBe('f9e8d7c6');
  });

  it('422s a PR with no changed files rather than persisting a guess', async () => {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'empty-pr', fullName: 'acme/empty-pr' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Nothing yet',
        author: 'nobody',
        branch: 'wip',
        base: 'main',
        headSha: 'deadbeef',
        status: 'needs_review',
        body: null,
      })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/intent` });
    expect(res.statusCode).toBe(422);
    const rows = await pg.handle.db
      .select()
      .from(t.prIntent)
      .where(eq(t.prIntent.prId, pr!.id));
    expect(rows).toEqual([]);
  });

  it('404s a PR that is not in the caller’s workspace', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other' })
      .returning();
    const { pr } = await setupPr(pg.handle.db, otherWs!.id, null);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(res.statusCode).toBe(404);
  });
});
