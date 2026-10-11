import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient, type MockLLMOptions } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type {
  MultiAgentCandidate,
  MultiAgentRunRef,
  MultiAgentRunView,
  Review,
} from '@devdigest/shared';

/**
 * Multi-agent review end to end: `POST /pulls/:id/review {agentIds|all}`
 * creates one parent + N children that run concurrently, and the read routes
 * (`/pulls/:id/multi-agent/{candidates,latest}`, `/repos/:id/multi-agent/latest`)
 * serve estimates, the latest parent view and the repo landing ref.
 *
 * EVERY provider is mocked (openai, anthropic, openrouter): the seeded agents
 * and the review_intent default use openrouter, which would otherwise go live.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

function review(summary: string): Review {
  return {
    verdict: 'request_changes',
    summary,
    score: 42,
    findings: [
      {
        id: 'f-valid',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'A live Stripe key is committed in source. Rotate it.',
        suggestion: 'Move the key to an environment variable.',
        confidence: 0.95,
        kind: 'finding',
      },
    ],
  };
}

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `multi-agent-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 700 + repoSeq,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('multi-agent review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let workspaceId: string;
  let foreignWs: string;
  /** Four openai agents (A–D), one anthropic agent (E), one disabled (F). */
  const ids: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'foreign', string> = {} as never;

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    await seed(db);
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [other] = await db.insert(t.workspaces).values({ name: 'foreign-ws' }).returning();
    foreignWs = other!.id;

    const mk = async (
      name: string,
      provider: 'openai' | 'anthropic',
      enabled = true,
      ws = workspaceId,
    ) => {
      const [row] = await db
        .insert(t.agents)
        .values({
          workspaceId: ws,
          name,
          provider,
          model: 'gpt-4.1',
          systemPrompt: `You are ${name}.`,
          description: `${name} description`,
          enabled,
        })
        .returning();
      return row!.id;
    };
    ids.A = await mk('MA Agent A', 'openai');
    ids.B = await mk('MA Agent B', 'openai');
    ids.C = await mk('MA Agent C', 'openai');
    ids.D = await mk('MA Agent D', 'openai');
    ids.E = await mk('MA Agent E', 'anthropic');
    ids.F = await mk('MA Agent F', 'openai', false);
    ids.foreign = await mk('MA Foreign', 'openai', true, foreignWs);
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(opts: { openai?: MockLLMOptions; anthropic?: MockLLMOptions } = {}) {
    const base: MockLLMOptions = { structured: review('Default summary.') };
    return buildApp({
      config: config(),
      db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          openai: new MockLLMProvider('openai', opts.openai ?? base),
          anthropic: new MockLLMProvider('anthropic', opts.anthropic ?? base),
          openrouter: new MockLLMProvider('openai', base),
        },
      },
    });
  }

  const parentsFor = (prId: string) =>
    db.select().from(t.multiAgentRuns).where(eq(t.multiAgentRuns.prId, prId));

  it('(a) agentIds creates one parent with exactly the ticked children (AC-16, AC-17)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(db, workspaceId);
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [ids.A, ids.B, ids.C, ids.D] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.multi_agent_run_id).toBeTruthy();
    expect(body.runs).toHaveLength(4);

    const parents = await parentsFor(pr.id);
    expect(parents).toHaveLength(1);
    expect(parents[0]!.id).toBe(body.multi_agent_run_id);

    const runs = await waitForPrRuns(db, pr.id, { expected: 4 });
    expect(runs).toHaveLength(4);
    expect(runs.every((r) => r.multiAgentRunId === body.multi_agent_run_id)).toBe(true);
    expect(new Set(runs.map((r) => r.agentId))).toEqual(new Set([ids.A, ids.B, ids.C, ids.D]));
    await app.close();
  });

  it('(b) children run concurrently — all 4 model calls are in flight at once (AC-19)', async () => {
    let calls = 0;
    let reachedAll = false;
    let timedOut = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Fallback so a sequential executor fails the assertion instead of hanging:
    // the 4th call only counts as overlap if it arrived BEFORE the fallback.
    const fallback = setTimeout(() => {
      timedOut = true;
      release();
    }, 8_000);
    const app = await appWith({
      openai: {
        respond: async () => {
          calls += 1;
          if (calls >= 4 && !timedOut) {
            reachedAll = true;
            release();
          }
          await gate;
          return review('Concurrent summary.');
        },
      },
    });
    const { pr } = await setupRepoAndPr(db, workspaceId);
    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [ids.A, ids.B, ids.C, ids.D] },
    });
    const runs = await waitForPrRuns(db, pr.id, { expected: 4, timeoutMs: 15_000 });
    clearTimeout(fallback);
    expect(reachedAll).toBe(true);
    expect(runs.filter((r) => r.status === 'done')).toHaveLength(4);
    await app.close();
  }, 30_000);

  it('(c) one failing provider is isolated: parent is partial with a no_result take (AC-20, AC-35, AC-47)', async () => {
    const app = await appWith({
      anthropic: {
        respond: () => {
          throw new Error('provider exploded');
        },
      },
    });
    const { pr } = await setupRepoAndPr(db, workspaceId);
    await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [ids.A, ids.B, ids.C, ids.E] },
    });
    const runs = await waitForPrRuns(db, pr.id, { expected: 4 });
    expect(runs.filter((r) => r.status === 'done')).toHaveLength(3);
    expect(runs.find((r) => r.agentId === ids.E)!.status).toBe('failed');

    const view = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent/latest` })
    ).json() as MultiAgentRunView;
    expect(view.status).toBe('partial');
    expect(view.agent_count).toBe(4);
    expect(view.columns).toHaveLength(4);
    const failedCol = view.columns.find((c) => c.agent_id === ids.E)!;
    expect(failedCol.status).toBe('failed');
    expect(failedCol.findings).toEqual([]);
    expect(view.groups).toHaveLength(1);
    expect(view.disagreements).toHaveLength(1);
    const kinds = view.disagreements[0]!.takes.map((tk) => tk.kind).sort();
    expect(kinds).toEqual(['flagged', 'flagged', 'flagged', 'no_result']);
    // Mocked done runs report $0.001 each; the failed run has no known cost.
    expect(view.total_cost_usd).toBeCloseTo(0.003, 6);
    expect(view.failed_cost_usd).toBeNull();
    await app.close();
  });

  it('(d) a disabled or foreign agent id is a 422 and creates no parent (AC-62, NFR-7)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(db, workspaceId);
    const disabled = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [ids.A, ids.F] },
    });
    expect(disabled.statusCode).toBe(422);
    const foreign = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentIds: [ids.foreign] },
    });
    expect(foreign.statusCode).toBe(422);
    expect(await parentsFor(pr.id)).toHaveLength(0);
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(runs).toHaveLength(0);
    await app.close();
  });

  it('(e) all:true creates one parent with every enabled agent (AC-61, AC-69)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(db, workspaceId);
    const enabled = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    expect(body.multi_agent_run_id).toBeTruthy();
    expect(body.runs).toHaveLength(enabled.length);
    expect(await parentsFor(pr.id)).toHaveLength(1);
    await waitForPrRuns(db, pr.id, { expected: enabled.length });
    await app.close();
  });

  it('(f) legacy {agentId} returns multi_agent_run_id null and creates no parent', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(db, workspaceId);
    const body = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: ids.A },
      })
    ).json();
    expect(body.multi_agent_run_id).toBeNull();
    expect(await parentsFor(pr.id)).toHaveLength(0);
    const runs = await waitForPrRuns(db, pr.id, { expected: 1 });
    expect(runs[0]!.multiAgentRunId).toBeNull();
    await app.close();
  });

  it('(g) latest follows the newest parent per PR and per repo (AC-63, AC-64, AC-66)', async () => {
    const app = await appWith();
    const { repo, pr } = await setupRepoAndPr(db, workspaceId);
    const { repo: emptyRepo } = await setupRepoAndPr(db, workspaceId);

    const none = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent/latest` });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toBeNull();

    const first = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentIds: [ids.A] },
      })
    ).json();
    await waitForPrRuns(db, pr.id, { expected: 1 });
    const second = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentIds: [ids.B, ids.C] },
      })
    ).json();
    await waitForPrRuns(db, pr.id, { expected: 3 });
    expect(second.multi_agent_run_id).not.toBe(first.multi_agent_run_id);

    const view = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent/latest` })
    ).json() as MultiAgentRunView;
    expect(view.id).toBe(second.multi_agent_run_id);
    expect(view.pr_number).toBe(pr.number);
    expect(view.repo_id).toBe(repo.id);
    expect(view.columns).toHaveLength(2);
    expect(view.status).toBe('done');

    const ref = (
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/multi-agent/latest` })
    ).json() as MultiAgentRunRef;
    expect(ref).toMatchObject({ id: second.multi_agent_run_id, pr_id: pr.id, pr_number: pr.number });

    const empty = await app.inject({ method: 'GET', url: `/repos/${emptyRepo.id}/multi-agent/latest` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toBeNull();
    await app.close();
  });

  it('(h) estimates average only the 10 newest local done runs on the current model (AC-14, AC-53, AC-54, AC-68)', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(db, workspaceId);
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'MA Estimator',
        provider: 'openai',
        model: 'est-model',
        systemPrompt: 'x',
      })
      .returning();
    const [ciOnly] = await db
      .insert(t.agents)
      .values({ workspaceId, name: 'MA CI Only', provider: 'openai', model: 'est-model', systemPrompt: 'x' })
      .returning();

    const base = Date.parse('2026-01-01T00:00:00Z');
    const at = (min: number) => new Date(base + min * 60_000);
    // 14 matching runs: durations 1000..14000 ms, increasing with time.
    for (let i = 0; i < 14; i++) {
      await db.insert(t.agentRuns).values({
        workspaceId,
        agentId: agent!.id,
        model: 'est-model',
        status: 'done',
        source: 'local',
        durationMs: (i + 1) * 1000,
        costUsd: 0.01,
        ranAt: at(i),
      });
    }
    // Newer, non-matching rows that must be ignored.
    const noise = { workspaceId, agentId: agent!.id, durationMs: 999_000, costUsd: 9, ranAt: at(100) };
    await db.insert(t.agentRuns).values([
      { ...noise, model: 'est-model', status: 'done', source: 'ci' },
      { ...noise, model: 'est-model', status: 'failed', source: 'local' },
      { ...noise, model: 'est-model', status: 'running', source: 'local' },
      { ...noise, model: 'old-model', status: 'done', source: 'local' },
    ]);
    await db.insert(t.agentRuns).values({
      workspaceId,
      agentId: ciOnly!.id,
      model: 'est-model',
      status: 'done',
      source: 'ci',
      durationMs: 5000,
      costUsd: 0.01,
    });

    const candidates = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent/candidates` })
    ).json() as MultiAgentCandidate[];
    const est = candidates.find((c) => c.agent_id === agent!.id)!;
    // Newest 10 of the 14: durations 5000..14000 → mean 9500.
    expect(est.estimate).toEqual({ avg_duration_ms: 9500, avg_cost_usd: 0.01, sample_size: 10 });
    expect(candidates.find((c) => c.agent_id === ciOnly!.id)!.estimate.sample_size).toBe(0);
    expect(candidates.some((c) => c.agent_id === ids.F)).toBe(false);
    expect(candidates.some((c) => c.agent_id === ids.foreign)).toBe(false);
    await app.close();
  });

  it('(i) latest_summary is the newest review summary of that agent on this PR (AC-52)', async () => {
    const { pr } = await setupRepoAndPr(db, workspaceId);
    const first = await appWith({ openai: { structured: review('Older summary.') } });
    await first.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentIds: [ids.A] } });
    await waitForPrRuns(db, pr.id, { expected: 1 });
    await first.close();
    const second = await appWith({ openai: { structured: review('Newest summary.') } });
    await second.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentIds: [ids.A] } });
    await waitForPrRuns(db, pr.id, { expected: 2 });

    const candidates = (
      await second.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent/candidates` })
    ).json() as MultiAgentCandidate[];
    expect(candidates.find((c) => c.agent_id === ids.A)!.latest_summary).toBe('Newest summary.');
    expect(candidates.find((c) => c.agent_id === ids.E)!.latest_summary).toBeNull();
    await second.close();
  });

  it('(j) foreign-workspace PR / repo ids are 404 on every read', async () => {
    const app = await appWith();
    const { repo, pr } = await setupRepoAndPr(db, foreignWs);
    for (const url of [
      `/pulls/${pr.id}/multi-agent/candidates`,
      `/pulls/${pr.id}/multi-agent/latest`,
      `/repos/${repo.id}/multi-agent/latest`,
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
    }
    await app.close();
  });
});
