import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * GET /agents/:id/stats and GET /agent-performance over hand-inserted rows
 * (no seed totals, no review run). Covers: Stats-tab ↔ dashboard-row parity
 * (AC1/AC11), previous-period parity (AC8), sums (AC2/AC10), most-active
 * (AC3), zero-run agent vs empty workspace (AC4), workspace scoping,
 * validation 422 / 404, and zero LLM calls on the read path (R8/AC6).
 *
 * Window W = [2026-03-01, 2026-03-04) UTC → previous window P = [2026-02-26, 2026-03-01).
 */
const FROM = '2026-03-01T00:00:00.000Z';
const TO = '2026-03-04T00:00:00.000Z';
const PREV_FROM = '2026-02-26T00:00:00.000Z';
const q = (from: string, to: string) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

type Db = PgFixture['handle']['db'];

d('agent stats endpoints (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: Db;
  let wsA: string;
  let wsB: string;
  let wsEmpty: string;
  const ids = {} as Record<'alpha' | 'beta' | 'idle' | 'foreign', string>;
  const llms = {
    openai: new MockLLMProvider('openai'),
    anthropic: new MockLLMProvider('anthropic'),
    openrouter: new MockLLMProvider('openai'),
  };
  const apps: FastifyInstance[] = [];

  async function appFor(workspaceId: string) {
    const app = await buildApp({
      config: config(),
      db,
      overrides: {
        auth: new MockAuthProvider(undefined, { id: workspaceId, name: 'ws' }),
        // No OpenRouter key → PriceBook never fetches a live price list.
        secrets: new MockSecretsProvider({}),
        llm: llms,
      },
    });
    apps.push(app);
    return app;
  }

  async function agent(workspaceId: string, name: string, enabled = true) {
    const [row] = await db
      .insert(t.agents)
      .values({ workspaceId, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'p', enabled })
      .returning();
    return row!.id;
  }

  async function pr(workspaceId: string) {
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `r-${workspaceId.slice(0, 8)}`, fullName: `acme/r-${workspaceId.slice(0, 8)}` })
      .returning();
    const [row] = await db
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
    return row!.id;
  }

  async function runRow(v: typeof t.agentRuns.$inferInsert) {
    const [row] = await db.insert(t.agentRuns).values(v).returning();
    return row!.id;
  }

  /** One review on the run with the given decision mix. */
  async function reviewWith(
    workspaceId: string,
    prId: string,
    agentId: string | null,
    runId: string,
    mix: { accepted: number; dismissed: number; pending: number },
  ) {
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId, runId, kind: 'review' })
      .returning();
    const base = {
      reviewId: review!.id,
      file: 'f.ts',
      startLine: 1,
      endLine: 1,
      severity: 'WARNING',
      category: 'bug',
      title: 'x',
      rationale: 'x',
      confidence: 0.9,
    };
    const now = new Date();
    const rows = [
      ...Array.from({ length: mix.accepted }, () => ({ ...base, acceptedAt: now })),
      ...Array.from({ length: mix.dismissed }, () => ({ ...base, dismissedAt: now })),
      ...Array.from({ length: mix.pending }, () => ({ ...base })),
    ];
    if (rows.length) await db.insert(t.findings).values(rows);
  }

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    const [a, b, e] = await db
      .insert(t.workspaces)
      .values([{ name: 'stats-a' }, { name: 'stats-b' }, { name: 'stats-empty' }])
      .returning();
    wsA = a!.id;
    wsB = b!.id;
    wsEmpty = e!.id;

    ids.alpha = await agent(wsA, 'Alpha');
    ids.beta = await agent(wsA, 'Beta');
    ids.idle = await agent(wsA, 'Idle', false);
    ids.foreign = await agent(wsB, 'Foreign');
    await agent(wsEmpty, 'Lonely');
    const prA = await pr(wsA);
    const prB = await pr(wsB);

    // --- Alpha, current window ---
    const alphaLocal = await runRow({
      workspaceId: wsA, agentId: ids.alpha, prId: prA, status: 'done', source: 'local',
      model: 'm-a', costUsd: 0.1, durationMs: 1000, ranAt: new Date('2026-03-01T10:00:00Z'),
    });
    await reviewWith(wsA, prA, ids.alpha, alphaLocal, { accepted: 8, dismissed: 2, pending: 1 });
    // CI run: counts toward runs/cost, contributes no decisions
    await runRow({
      workspaceId: wsA, agentId: ids.alpha, prId: null, status: 'done', source: 'ci',
      model: 'm-a', costUsd: 0.2, durationMs: 3000, ranAt: new Date('2026-03-03T08:00:00Z'),
    });
    // Failed run: only failed_runs + last_run_at
    await runRow({
      workspaceId: wsA, agentId: ids.alpha, prId: prA, status: 'failed',
      model: 'm-a', costUsd: 7, durationMs: 99_999, ranAt: new Date('2026-03-03T20:00:00Z'),
    });

    // --- Alpha, previous window (60%, 10 decisions) ---
    const alphaPrev = await runRow({
      workspaceId: wsA, agentId: ids.alpha, prId: prA, status: 'done',
      model: 'm-a', costUsd: 0.05, durationMs: 500, ranAt: new Date('2026-02-27T10:00:00Z'),
    });
    await reviewWith(wsA, prA, ids.alpha, alphaPrev, { accepted: 6, dismissed: 4, pending: 0 });

    // --- Out of both windows (incl. exactly at the exclusive `to`) ---
    await runRow({ workspaceId: wsA, agentId: ids.alpha, status: 'done', model: 'm-a', costUsd: 9, ranAt: new Date('2026-02-20T00:00:00Z') });
    await runRow({ workspaceId: wsA, agentId: ids.alpha, status: 'done', model: 'm-a', costUsd: 9, ranAt: new Date(TO) });

    // --- Beta: one unpriced done run, low sample ---
    const betaRun = await runRow({
      workspaceId: wsA, agentId: ids.beta, prId: prA, status: 'done',
      model: 'unpriced-model-xyz', costUsd: null, tokensIn: 100, tokensOut: 50, durationMs: null,
      ranAt: new Date('2026-03-02T00:00:00Z'),
    });
    await reviewWith(wsA, prA, ids.beta, betaRun, { accepted: 1, dismissed: 1, pending: 0 });

    // --- Deleted agent's run ---
    await runRow({
      workspaceId: wsA, agentId: null, status: 'done', model: null, costUsd: 0.07,
      ranAt: new Date('2026-03-02T12:00:00Z'),
    });

    // --- Another workspace, same window: must never leak into wsA ---
    const foreignRun = await runRow({
      workspaceId: wsB, agentId: ids.foreign, prId: prB, status: 'done',
      model: 'm-a', costUsd: 5, ranAt: new Date('2026-03-02T00:00:00Z'),
    });
    await reviewWith(wsB, prB, ids.foreign, foreignRun, { accepted: 20, dismissed: 0, pending: 0 });
  }, 120_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
    await pg?.stop();
  });

  it('a Stats-tab response deep-equals its dashboard row for every agent (AC1/AC11)', async () => {
    const app = await appFor(wsA);
    const perfRes = await app.inject({ method: 'GET', url: `/agent-performance?${q(FROM, TO)}` });
    expect(perfRes.statusCode).toBe(200);
    const perf = perfRes.json();

    expect(perf.agents.map((a: { agent_name: string }) => a.agent_name).sort()).toEqual(['Alpha', 'Beta', 'Idle']);
    for (const row of perf.agents) {
      const res = await app.inject({ method: 'GET', url: `/agents/${row.agent_id}/stats?${q(FROM, TO)}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(row);
    }
  });

  it('aggregates only done in-window runs of this workspace, with sums that add up (AC2, AC3, AC10)', async () => {
    const app = await appFor(wsA);
    const perf = (await app.inject({ method: 'GET', url: `/agent-performance?${q(FROM, TO)}` })).json();

    expect(perf.window).toEqual({ from: FROM, to: TO });
    expect(perf.previous_window).toEqual({ from: PREV_FROM, to: FROM });
    expect(perf.cost_basis).toBe('estimate');
    expect(perf.min_decisions_for_ranking).toBe(10);

    // 2 Alpha + 1 Beta + 1 deleted; failed, out-of-window, at-`to` and foreign runs excluded
    expect(perf.totals).toEqual({
      runs: 4,
      failed_runs: 1,
      unpriced_runs: 1,
      deleted_agent_runs: 1,
      total_cost_usd: 0.37,
      accepted: 9,
      dismissed: 3,
      decisions: 12,
      accept_rate: 0.75,
    });

    const sum = (xs: Array<{ cost_usd: number }>) => xs.reduce((s, x) => s + x.cost_usd, 0);
    expect(Math.abs(sum(perf.cost_by_agent) - 0.37)).toBeLessThan(1e-6);
    expect(Math.abs(sum(perf.cost_by_model) - 0.37)).toBeLessThan(1e-6);
    expect(perf.cost_by_agent).toContainEqual({ key: 'deleted', label: 'Deleted agent', cost_usd: 0.07, runs: 1 });
    expect(perf.cost_by_model).toContainEqual({ key: 'unknown', label: 'Unknown model', cost_usd: 0.07, runs: 1 });

    expect(perf.runs_trend).toEqual([
      { label: '2026-03-01', value: 1 },
      { label: '2026-03-02', value: 2 },
      { label: '2026-03-03', value: 1 },
    ]);

    expect(perf.most_active).toEqual({
      agent_id: ids.alpha,
      agent_name: 'Alpha',
      runs: 2,
      accept_rate: 0.8,
      decisions: 10,
    });

    const alpha = perf.agents.find((a: { agent_id: string }) => a.agent_id === ids.alpha);
    expect(alpha).toMatchObject({
      runs: 2,
      failed_runs: 1,
      total_cost_usd: 0.3,
      avg_cost_usd: 0.15,
      avg_latency_ms: 2000,
      findings_total: 11,
      accepted: 8,
      dismissed: 2,
      pending: 1,
      decisions: 10,
      accept_rate: 0.8,
      low_sample: false,
      last_run_at: '2026-03-03T20:00:00.000Z',
      previous: { runs: 1, decisions: 10, accept_rate: 0.6, low_sample: false, total_cost_usd: 0.05 },
      accept_trend: 'up',
      accept_rate_delta_pp: 20,
    });

    const beta = perf.agents.find((a: { agent_id: string }) => a.agent_id === ids.beta);
    expect(beta).toMatchObject({
      runs: 1,
      unpriced_runs: 1,
      avg_cost_usd: null,
      avg_latency_ms: null,
      decisions: 2,
      accept_rate: 0.5,
      low_sample: true,
      accept_trend: null,
      accept_rate_delta_pp: null,
    });
  });

  it('previous_totals equal a direct call on previous_window, and the delta is their difference (AC8)', async () => {
    const app = await appFor(wsA);
    const perf = (await app.inject({ method: 'GET', url: `/agent-performance?${q(FROM, TO)}` })).json();
    const direct = (
      await app.inject({
        method: 'GET',
        url: `/agent-performance?${q(perf.previous_window.from, perf.previous_window.to)}`,
      })
    ).json();

    expect(perf.previous_totals).toEqual({
      runs: direct.totals.runs,
      total_cost_usd: direct.totals.total_cost_usd,
      decisions: direct.totals.decisions,
      accept_rate: direct.totals.accept_rate,
    });
    expect(perf.previous_totals).toEqual({ runs: 1, total_cost_usd: 0.05, decisions: 10, accept_rate: 0.6 });
    expect(perf.cost_delta_usd).toBe(0.32);

    // A per-agent previous figure equals that agent's row in the direct call
    const alphaNow = perf.agents.find((a: { agent_id: string }) => a.agent_id === ids.alpha);
    const alphaThen = direct.agents.find((a: { agent_id: string }) => a.agent_id === ids.alpha);
    expect(alphaNow.previous).toEqual({
      runs: alphaThen.runs,
      decisions: alphaThen.decisions,
      accept_rate: alphaThen.accept_rate,
      low_sample: alphaThen.low_sample,
      total_cost_usd: alphaThen.total_cost_usd,
    });
  });

  it('distinguishes an agent with no runs from an empty workspace (AC4)', async () => {
    const app = await appFor(wsA);
    const idle = (await app.inject({ method: 'GET', url: `/agents/${ids.idle}/stats?${q(FROM, TO)}` })).json();
    expect(idle).toMatchObject({
      agent_name: 'Idle',
      enabled: false,
      runs: 0,
      accept_rate: null,
      total_cost_usd: null,
      last_run_at: null,
      accept_trend: null,
    });

    const emptyApp = await appFor(wsEmpty);
    const empty = (await emptyApp.inject({ method: 'GET', url: `/agent-performance?${q(FROM, TO)}` })).json();
    expect(empty.totals.runs).toBe(0);
    expect(empty.totals.failed_runs).toBe(0);
    expect(empty.totals.total_cost_usd).toBeNull();
    expect(empty.totals.accept_rate).toBeNull();
    expect(empty.cost_delta_usd).toBeNull();
    expect(empty.most_active).toBeNull();
    expect(empty.cost_by_agent).toEqual([]);
    expect(empty.cost_by_model).toEqual([]);
    expect(empty.agents).toHaveLength(1);
    expect(empty.runs_trend.every((p: { value: number }) => p.value === 0)).toBe(true);
  });

  it('scopes to the caller workspace: foreign runs never count and a foreign agent is 404', async () => {
    const appA = await appFor(wsA);
    const foreign = await appA.inject({ method: 'GET', url: `/agents/${ids.foreign}/stats?${q(FROM, TO)}` });
    expect(foreign.statusCode).toBe(404);
    const unknown = await appA.inject({
      method: 'GET',
      url: `/agents/00000000-0000-4000-8000-000000000000/stats?${q(FROM, TO)}`,
    });
    expect(unknown.statusCode).toBe(404);

    // ...and from its own workspace the foreign agent sees only its own run
    const appB = await appFor(wsB);
    const perfB = (await appB.inject({ method: 'GET', url: `/agent-performance?${q(FROM, TO)}` })).json();
    expect(perfB.totals.runs).toBe(1);
    expect(perfB.totals.total_cost_usd).toBe(5);
    expect(perfB.agents.map((a: { agent_name: string }) => a.agent_name)).toEqual(['Foreign']);
  });

  it('rejects from >= to and a span over 366 days with 422 on both routes', async () => {
    const app = await appFor(wsA);
    const bad = [
      q(TO, FROM),
      q(FROM, FROM),
      q('2025-01-01T00:00:00.000Z', '2026-01-03T00:00:00.000Z'), // 367 days
      'from=yesterday&to=today',
    ];
    for (const query of bad) {
      expect((await app.inject({ method: 'GET', url: `/agent-performance?${query}` })).statusCode).toBe(422);
      expect((await app.inject({ method: 'GET', url: `/agents/${ids.alpha}/stats?${query}` })).statusCode).toBe(422);
    }
    // exactly 366 days is allowed
    const edge = await app.inject({
      method: 'GET',
      url: `/agent-performance?${q('2025-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')}`,
    });
    expect(edge.statusCode).toBe(200);
  });

  it('never calls a model on the read path (R8/AC6)', async () => {
    const app = await appFor(wsA);
    await app.inject({ method: 'GET', url: `/agent-performance?${q(FROM, TO)}` });
    await app.inject({ method: 'GET', url: `/agents/${ids.alpha}/stats?${q(FROM, TO)}` });
    // Every earlier test in this file shares these mocks too.
    expect(llms.openai.calls).toEqual([]);
    expect(llms.anthropic.calls).toEqual([]);
    expect(llms.openrouter.calls).toEqual([]);
  });
});
