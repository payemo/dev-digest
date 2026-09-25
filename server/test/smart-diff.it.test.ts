/**
 * `GET /pulls/:id/smart-diff` (L04, plan Steps 7-8) — DB-backed, against a
 * real Postgres via testcontainers.
 *
 * What only a real request can prove: the response actually validates against
 * the `SmartDiff` contract as it is serialized (the route declares it as
 * `response.200`, so a drifted shape 500s rather than leaking), the five
 * groups come back in the fixed display order, grouping works on a PR that has
 * NEVER been reviewed, a real review's `start_line`s land on the right file,
 * and the two edge cases of the route itself — 422 before the handler for a
 * non-uuid id, 404 for a PR in another workspace.
 *
 * No LLM mock is injected on purpose: this endpoint makes no model call at
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
import { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping integration tests.');
}

/** One file of each role, so every group is exercised by the fixture. */
const FILES = [
  { path: 'server/src/modules/reviews/service.ts', additions: 40, deletions: 6 },
  { path: 'server/test/reviews.it.test.ts', additions: 25, deletions: 0 },
  { path: 'server/src/modules/smart-diff/index.ts', additions: 3, deletions: 0 },
  { path: 'README.md', additions: 8, deletions: 2 },
  { path: 'pnpm-lock.yaml', additions: 120, deletions: 14 },
];
const TOTAL_LINES = FILES.reduce((n, f) => n + f.additions + f.deletions, 0);

d('L04 smart-diff endpoint (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let repoSeq = 0;

  async function setupPr(ownerWorkspaceId: string) {
    const name = `smart-diff-${repoSeq++}`;
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
    return pr!;
  }

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        secrets: new MockSecretsProvider(),
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('groups an UNREVIEWED PR into five ordered groups with no finding lines', async () => {
    const pr = await setupPr(workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);

    // The response is the contract, not merely shaped like it.
    const diff = SmartDiff.parse(res.json());

    expect(diff.groups.map((g) => g.role)).toEqual([
      'core',
      'tests',
      'wiring',
      'docs',
      'boilerplate',
    ]);
    expect(diff.groups.map((g) => g.files.map((f) => f.path))).toEqual([
      ['server/src/modules/reviews/service.ts'],
      ['server/test/reviews.it.test.ts'],
      ['server/src/modules/smart-diff/index.ts'],
      ['README.md'],
      ['pnpm-lock.yaml'],
    ]);
    // Grouping works before the first review has ever run.
    expect(diff.groups.flatMap((g) => g.files).flatMap((f) => f.finding_lines)).toEqual([]);
    expect(diff.split_suggestion).toEqual({
      too_big: false,
      total_lines: TOTAL_LINES,
      proposed_splits: [],
    });
  });

  it("surfaces the latest review's start_lines on the file that was cited", async () => {
    const pr = await setupPr(workspaceId);
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: 'comment',
        summary: 'fixture review',
        score: 70,
        model: 'test/model',
      })
      .returning();
    await pg.handle.db.insert(t.findings).values(
      [31, 12, 12].map((startLine, i) => ({
        reviewId: review!.id,
        file: 'server/src/modules/reviews/service.ts',
        startLine,
        endLine: startLine,
        severity: 'WARNING',
        category: 'bug',
        title: `fixture finding ${i}`,
        rationale: 'fixture',
        confidence: 0.9,
      })),
    );

    const diff = SmartDiff.parse(
      (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` })).json(),
    );

    const core = diff.groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.finding_lines).toEqual([12, 31]);
    // Nothing leaks onto the files the review did not cite.
    expect(
      diff.groups.filter((g) => g.role !== 'core').flatMap((g) => g.files.flatMap((f) => f.finding_lines)),
    ).toEqual([]);
  });

  it('422s a non-uuid id before the handler, and 404s a PR in another workspace', async () => {
    const bad = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(bad.statusCode).toBe(422);

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const foreign = await setupPr(otherWs!.id);
    const res = await app.inject({ method: 'GET', url: `/pulls/${foreign.id}/smart-diff` });
    expect(res.statusCode).toBe(404);
  });
});
