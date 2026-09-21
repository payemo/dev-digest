import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * GET /skills/:id/stats over hand-inserted rows (no model call needed — the
 * numbers come straight from run_skills / findings, not from a review run).
 * Covers: used-by count, the linked/injected run split (including runs from
 * BEFORE run_skills existed being excluded from the denominator), accept rate,
 * and category totals.
 */
d('GET /skills/:id/stats', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  it('attributes findings only through runs that recorded run_skills, and splits accept/dismiss', async () => {
    const app = await makeApp();
    const db = pg.handle.db;

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'Stats subject',
          description: 'd',
          type: 'rubric',
          body: 'b',
        },
      })
    ).json();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Stats agent ${Math.random().toString(36).slice(2, 8)}`,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'p',
        },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'stats-repo', fullName: 'acme/stats-repo' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();

    // Run A: attributed (has a run_skills row) — 2 findings, one accepted one dismissed.
    const [runA] = await db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agent.id, prId: pr!.id, status: 'done' })
      .returning();
    await db.insert(t.runSkills).values({ runId: runA!.id, skillId: skill.id, order: 0 });
    const [reviewA] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId: agent.id, runId: runA!.id, kind: 'review' })
      .returning();
    await db.insert(t.findings).values([
      {
        reviewId: reviewA!.id,
        file: 'f.ts',
        startLine: 1,
        endLine: 1,
        severity: 'CRITICAL',
        category: 'security',
        title: 'x',
        rationale: 'x',
        confidence: 0.9,
        acceptedAt: new Date(),
      },
      {
        reviewId: reviewA!.id,
        file: 'f.ts',
        startLine: 2,
        endLine: 2,
        severity: 'WARNING',
        category: 'bug',
        title: 'y',
        rationale: 'y',
        confidence: 0.5,
        dismissedAt: new Date(),
      },
    ]);

    // Run B: same agent, but no run_skills row — pre-feature run. Must be
    // excluded from BOTH the numerator and the denominator.
    await db.insert(t.agentRuns).values({ workspaceId, agentId: agent.id, prId: pr!.id, status: 'done' });

    const stats = (
      await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` })
    ).json();

    expect(stats.used_by_agents).toBe(1);
    // Only run A recorded attribution, so it's the only one counted at all —
    // the denominator does NOT include run B.
    expect(stats.linked_agent_runs).toBe(1);
    expect(stats.injected_runs).toBe(1);
    expect(stats.pull_frequency_pct).toBe(100);
    expect(stats.findings).toBe(2);
    expect(stats.accepted).toBe(1);
    expect(stats.dismissed).toBe(1);
    expect(stats.accept_rate).toBe(50);
    expect(stats.by_category.map((c: { category: string }) => c.category).sort()).toEqual([
      'bug',
      'security',
    ]);
  });
});
