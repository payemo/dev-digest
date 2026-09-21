import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[pulls-findings] Docker not available — skipping integration tests.');
}

/**
 * PR-list FINDINGS column: for each agent that ran on the PR, only its
 * LATEST run's findings count, then those per-agent latest counts are
 * summed across every agent — a re-run of the same agent no longer stacks
 * its stale findings on top of its newer ones. See
 * server/specs/pr-cost-and-findings.md.
 *
 * `MockGitHubClient` always upserts a fixed PR #482, ignoring the requested
 * repo — mirrors `run-cost.it.test.ts` / `reviews.it.test.ts` in using PR
 * number 482 so that upsert only touches title/status/head_sha on our own
 * row (same id, same reviews/findings), never inserts a second PR.
 */
d('PR-list FINDINGS (per-agent latest run, summed)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prId: string;
  let securityAgentId: string;
  let generalAgentId: string;
  let testQualityAgentId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    const [security] = await pg.handle.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    securityAgentId = security!.id;

    const [general] = await pg.handle.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));
    generalAgentId = general!.id;

    const [testQuality] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Test Quality Reviewer',
        provider: 'openrouter',
        model: 'test/model',
        systemPrompt: 'You review test quality.',
      })
      .returning();
    testQualityAgentId = testQuality!.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'findings-fixture', fullName: 'acme/findings-fixture' })
      .returning();
    repoId = repo!.id;

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        status: 'needs_review',
      })
      .returning();
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
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        secrets: new MockSecretsProvider(),
      },
    });
  }

  async function insertReviewWithFindings(opts: {
    agentId: string;
    createdAt: Date;
    severities: ('CRITICAL' | 'WARNING' | 'SUGGESTION')[];
  }) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: opts.agentId,
        runId: null,
        kind: 'review',
        verdict: 'comment',
        summary: 'fixture review',
        score: 70,
        model: 'test/model',
        createdAt: opts.createdAt,
      })
      .returning();
    if (opts.severities.length > 0) {
      await pg.handle.db.insert(t.findings).values(
        opts.severities.map((severity, i) => ({
          reviewId: review!.id,
          file: 'src/config.ts',
          startLine: 1,
          endLine: 1,
          severity,
          category: 'bug' as const,
          title: `fixture finding ${i}`,
          rationale: 'fixture',
          confidence: 0.9,
        })),
      );
    }
    return review!;
  }

  it("sums each agent's latest run only, never an agent's stale earlier runs", async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const hour = 60 * 60 * 1000;

    // Security Reviewer: ran once, earliest of all, 2 CRITICAL findings.
    // Must survive later, less-severe runs from OTHER agents (the original
    // PR #482 regression this endpoint's "findings" field guards against).
    await insertReviewWithFindings({
      agentId: securityAgentId,
      createdAt: new Date(t0.getTime()),
      severities: ['CRITICAL', 'CRITICAL'],
    });

    // General Reviewer: ran 3 times. Only the 3rd (latest) run's 4 findings
    // should count — runs 1 and 2's 5 and 2 findings must NOT be added in.
    const generalRun1 = await insertReviewWithFindings({
      agentId: generalAgentId,
      createdAt: new Date(t0.getTime() + hour),
      severities: ['WARNING', 'WARNING', 'SUGGESTION', 'SUGGESTION', 'SUGGESTION'],
    });
    const generalRun2 = await insertReviewWithFindings({
      agentId: generalAgentId,
      createdAt: new Date(t0.getTime() + 2 * hour),
      severities: ['WARNING', 'SUGGESTION'],
    });
    const generalRun3 = await insertReviewWithFindings({
      agentId: generalAgentId,
      createdAt: new Date(t0.getTime() + 3 * hour),
      severities: ['WARNING', 'WARNING', 'SUGGESTION', 'SUGGESTION'],
    });

    // Test Quality Reviewer: ran once, 3 findings.
    await insertReviewWithFindings({
      agentId: testQualityAgentId,
      createdAt: new Date(t0.getTime() + 4 * hour),
      severities: ['SUGGESTION', 'SUGGESTION', 'WARNING'],
    });

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(res.statusCode).toBe(200);
    const list = res.json() as PrMeta[];
    const pr = list.find((p) => p.id === prId);
    expect(pr).toBeDefined();

    // 2 (Security, only run) + 4 (General, LATEST run only) + 3 (Test Quality, only run) = 9.
    // NOT 2 + 5 + 2 + 4 + 3 = 16, which is what summing every review would give.
    expect(pr!.findings).toHaveLength(9);

    const critical = pr!.findings!.filter((f) => f.severity === 'CRITICAL');
    expect(critical).toHaveLength(2); // Security's earlier CRITICALs are not dropped

    // Every General-Reviewer finding in the response belongs to run 3
    // (the latest) — none of run 1's or run 2's stale findings leak through.
    const responseFindingIds = new Set(pr!.findings!.map((f) => f.id));
    const [run1Findings, run2Findings, run3Findings] = await Promise.all(
      [generalRun1, generalRun2, generalRun3].map((review) =>
        pg.handle.db.select({ id: t.findings.id }).from(t.findings).where(eq(t.findings.reviewId, review.id)),
      ),
    );
    for (const f of [...run1Findings!, ...run2Findings!]) {
      expect(responseFindingIds.has(f.id)).toBe(false);
    }
    for (const f of run3Findings!) {
      expect(responseFindingIds.has(f.id)).toBe(true);
    }

    await app.close();
  });
});
