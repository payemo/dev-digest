import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { StructuredRequest } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { EvalService } from '../src/modules/eval/service.js';
import { EVAL_CASE_RUN_RATE_LIMIT_MAX, EVAL_REAPED_ERROR } from '../src/modules/eval/constants.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { Container } from '../src/platform/container.js';

/**
 * L06 eval pipeline end to end over real Postgres with hermetic providers
 * (spec 04, plan S18). The mock LLM answers per case from the frozen diff text,
 * and a marker in the agent's system prompt decides HOW well it answers:
 *   (none)               → finds every must_find location, never flags forbidden ones
 *   EVAL-MARKER:LAZY     → misses the rate-limit and N+1 cases (recall drops)
 *   EVAL-MARKER:SPOIL    → also flags every forbidden location (precision drops)
 * A test can hold every model call on a deferred gate to observe a run in flight.
 *
 * The tests in this file are ordered and share state (one seeded DB, one app).
 */

const hasDocker = await dockerAvailable();
const verifyGate = process.env.VERIFY_L06 === '1';

if (!hasDocker && !verifyGate) {
  // eslint-disable-next-line no-console
  console.warn('[eval-pipeline] Docker not available — skipping integration tests.');
}

// `pnpm verify:l06` must never pass vacuously (AC-77): no Docker is a failure there.
if (!hasDocker && verifyGate) {
  describe('eval pipeline (verify:l06)', () => {
    it('needs Docker', () => {
      throw new Error('verify:l06 needs Docker (testcontainers)');
    });
  });
}

const d = hasDocker ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Prompt- and diff-keyed mock model
// ---------------------------------------------------------------------------

interface Loc {
  file: string;
  start: number;
  end: number;
  title: string;
}

/** Diff signature → the location a correct reviewer would cite. */
const MUST_FIND: Array<{ sig: string; loc: Loc; lazySkips?: boolean }> = [
  { sig: 'sk_live_DEMO', loc: { file: 'src/config.ts', start: 12, end: 12, title: 'Hardcoded Stripe key' } },
  { sig: 'callback_url', loc: { file: 'src/api/public/webhooks.ts', start: 60, end: 61, title: 'SSRF' } },
  { sig: 'Too Many Requests', loc: { file: 'src/middleware/ratelimit.ts', start: 50, end: 51, title: 'No Retry-After' }, lazySkips: true },
  { sig: 'orders.userId', loc: { file: 'src/api/users.ts', start: 21, end: 23, title: 'N+1' }, lazySkips: true },
  { sig: 'vault.read', loc: { file: 'src/api/public/hooks.ts', start: 2, end: 4, title: 'Trifecta' } },
];
/** Diff signature → a location only a spoiled prompt flags. */
const FORBIDDEN: Array<{ sig: string; loc: Loc }> = [
  { sig: "from 'lodash'", loc: { file: 'src/api/users.ts', start: 2, end: 2, title: 'Unused import' } },
  { sig: 'addContentTypeParser', loc: { file: 'src/server.ts', start: 7, end: 7, title: 'Raw body parser' } },
  { sig: 'sk_test_DEMO', loc: { file: 'test/fixtures/stripe.ts', start: 2, end: 2, title: 'Test key' } },
];

const asFinding = (l: Loc) => ({
  id: `${l.file}:${l.start}`,
  severity: 'WARNING',
  category: 'security',
  title: l.title,
  file: l.file,
  start_line: l.start,
  end_line: l.end,
  rationale: 'mock',
  confidence: 0.9,
  kind: 'finding',
});

function answer(system: string, user: string) {
  const lazy = system.includes('EVAL-MARKER:LAZY');
  const spoil = system.includes('EVAL-MARKER:SPOIL');
  const findings = [
    ...MUST_FIND.filter((m) => user.includes(m.sig) && !(lazy && m.lazySkips)).map((m) => asFinding(m.loc)),
    ...(spoil ? FORBIDDEN.filter((m) => user.includes(m.sig)).map((m) => asFinding(m.loc)) : []),
  ];
  return {
    verdict: findings.length ? 'request_changes' : 'approve',
    summary: 'mock review',
    score: findings.length ? 50 : 95,
    findings,
  };
}

interface Captured {
  system: string;
  user: string;
}

function textOf(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

// ---------------------------------------------------------------------------

d('eval pipeline (L06) — real Postgres, hermetic providers', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let llm: MockLLMProvider;
  const captured: Captured[] = [];
  const repoIntelCalls: string[] = [];
  let gate: { promise: Promise<void>; release: () => void } | null = null;

  let workspaceId: string;
  let secId: string; // Security Reviewer
  let seededPrompt: string;
  const runIds: Record<string, string> = {};

  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });

  async function waitForRun(id: string) {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const res = await inject('GET', `/eval/runs/${id}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      if (body.status !== 'running') return body;
      if (Date.now() > deadline) throw new Error(`eval run ${id} still running after 30s`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Start a full run for the Security Reviewer and wait for it to finish. */
  async function fullRun(label: string) {
    const from = captured.length;
    const start = await inject('POST', `/agents/${secId}/eval/runs`);
    expect(start.statusCode).toBe(202);
    const id = start.json().run.id as string;
    runIds[label] = id;
    const done = await waitForRun(id);
    expect(done.status).toBe('completed');
    return { run: done, calls: captured.slice(from) };
  }

  async function caseList(agentId = secId) {
    const res = await inject('GET', `/agents/${agentId}/eval/cases`);
    expect(res.statusCode).toBe(200);
    return res.json() as Array<Record<string, any>>;
  }

  async function pr491Findings() {
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 491)));
    const reviews = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, pr!.id));
    const findings = reviews.length
      ? await pg.handle.db
          .select()
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviews.map((r) => r.id)))
      : [];
    return { pr: pr!, reviews, findings };
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    const [sec] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    secId = sec!.id;
    seededPrompt = sec!.systemPrompt;

    llm = new MockLLMProvider('openai', {
      respond: async (req: StructuredRequest<unknown>) => {
        const msgs = req.messages as Array<{ role: string; content: unknown }>;
        const system = msgs.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
        const user = msgs.filter((m) => m.role !== 'system').map((m) => textOf(m.content)).join('\n');
        captured.push({ system, user });
        if (gate) await gate.promise;
        return answer(system, user);
      },
    });
    const repoIntel = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'then') return undefined;
          return () => {
            repoIntelCalls.push(String(prop));
            throw new Error(`repoIntel.${String(prop)} must not be reached by an eval`);
          };
        },
      },
    ) as unknown as RepoIntel;

    app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        // Seeded agents use openrouter: mock EVERY provider so nothing is live.
        llm: { openai: llm, anthropic: llm, openrouter: llm },
        github: new MockGitHubClient(),
        git: new MockGitClient(),
        repoIntel,
      },
    });
  });

  afterAll(async () => {
    gate?.release();
    await app?.close();
    await pg?.stop();
  });

  it('AC-72–74: the seed ships a ≥8-case Security Reviewer set of both kinds, idempotently, plus PR #491', async () => {
    const cases = await caseList();
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(cases.filter((c) => c.kind === 'must_find').length).toBeGreaterThanOrEqual(5);
    expect(cases.filter((c) => c.kind === 'must_not_flag').length).toBeGreaterThanOrEqual(3);

    await seed(pg.handle.db);
    expect((await caseList()).length).toBe(cases.length);

    const { findings } = await pr491Findings();
    expect(findings.filter((f) => f.acceptedAt).length).toBeGreaterThanOrEqual(1);
    expect(findings.filter((f) => f.dismissedAt).length).toBeGreaterThanOrEqual(1);
    const files = await pg.handle.db
      .select()
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, (await pr491Findings()).pr.id));
    for (const f of findings.filter((x) => x.acceptedAt || x.dismissedAt)) {
      expect(files.find((p) => p.path === f.file)?.patch, `patch for ${f.file}`).toBeTruthy();
    }
  });

  it('AC-4–7, AC-9, AC-11/12: seeding from an accepted and a dismissed finding (one case per finding)', async () => {
    const before = (await caseList()).length;
    const { findings } = await pr491Findings();
    const accepted = findings.find((f) => f.acceptedAt)!;
    const dismissed = findings.find((f) => f.dismissedAt)!;

    const seedRes = await inject('GET', `/findings/${accepted.id}/eval-case`);
    expect(seedRes.statusCode).toBe(200);
    const seedBody = seedRes.json();
    expect(seedBody.decision).toBe('accepted');
    expect(seedBody.existing).toBeNull();
    expect(seedBody.draft.kind).toBe('must_find');
    expect(seedBody.draft.name.startsWith('must-find-hardcoded-stripe-secret-key')).toBe(true);
    expect(seedBody.draft.expected_output).toEqual([
      {
        severity: accepted.severity,
        category: accepted.category,
        title: accepted.title,
        file: accepted.file,
        start_line: accepted.startLine,
      },
    ]);

    // Save with no edits: a body-less POST (AC-5).
    const created = await inject('POST', `/findings/${accepted.id}/eval-case`);
    expect(created.statusCode).toBe(201);
    const c = created.json();
    expect(c).toMatchObject({
      kind: 'must_find',
      owner_id: secId,
      source_finding_id: accepted.id,
      source_decision: 'accepted',
      source_available: true,
      name: seedBody.draft.name,
    });

    const again = await inject('POST', `/findings/${accepted.id}/eval-case`, {});
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(c.id);
    const reseed = (await inject('GET', `/findings/${accepted.id}/eval-case`)).json();
    expect(reseed.existing.id).toBe(c.id);

    const neg = await inject('POST', `/findings/${dismissed.id}/eval-case`, {});
    expect(neg.statusCode).toBe(201);
    expect(neg.json()).toMatchObject({
      kind: 'must_not_flag',
      expected_output: [],
      forbidden_location: { file: dismissed.file, start_line: dismissed.startLine, end_line: dismissed.endLine },
      source_decision: 'dismissed',
    });
    expect(neg.json().name.startsWith('no-')).toBe(true);

    expect((await caseList()).length).toBe(before + 2);
  });

  it('AC-3 / AC-19: an undecided finding and a finding with no stored diff are refused with 422, nothing saved', async () => {
    const before = (await caseList()).length;
    const { findings } = await pr491Findings();
    const undecided = findings.find((f) => !f.acceptedAt && !f.dismissedAt)!;
    const r1 = await inject('POST', `/findings/${undecided.id}/eval-case`, {});
    expect(r1.statusCode).toBe(422);
    expect(r1.json().error.code).toBe('validation_error');
    expect((await inject('GET', `/findings/${undecided.id}/eval-case`)).statusCode).toBe(422);

    // A decided finding on PR #482, whose stored files carry no patch.
    const [pr482] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.number, 482)));
    const reviews482 = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, pr482!.id));
    const withAgent = reviews482.find((r) => r.agentId) ?? reviews482[0]!;
    const [f482] = await pg.handle.db.select().from(t.findings).where(eq(t.findings.reviewId, withAgent.id));
    await pg.handle.db.update(t.findings).set({ acceptedAt: new Date() }).where(eq(t.findings.id, f482!.id));
    const r2 = await inject('POST', `/findings/${f482!.id}/eval-case`, {});
    expect(r2.statusCode).toBe(422);
    expect(r2.json().error.message).toMatch(/stored diff|not produced by an agent/);

    expect((await caseList()).length).toBe(before);
  });

  it('AC-17: deleting the source review leaves the frozen case input untouched', async () => {
    const { reviews, findings } = await pr491Findings();
    const accepted = findings.find((f) => f.acceptedAt)!;
    const before = (await caseList()).find((c) => c.source_finding_id === accepted.id)!;
    expect(before.input_diff).toContain('sk_live_DEMO');

    await pg.handle.db.delete(t.reviews).where(inArray(t.reviews.id, reviews.map((r) => r.id)));

    const after = (await caseList()).find((c) => c.id === before.id)!;
    for (const k of ['name', 'kind', 'input_diff', 'input_files', 'input_meta', 'expected_output', 'forbidden_location']) {
      expect(after[k], k).toEqual(before[k]);
    }
    expect(after.source_available).toBe(false);
  });

  it('hand-made cases: kind rules → 422, no-location must_not_flag, duplicate name → 409, zero cases → 422 on run', async () => {
    const agent = await inject('POST', '/agents', {
      name: 'Eval Handmade Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'Review the diff.',
    });
    expect(agent.statusCode).toBe(201);
    const agentId = agent.json().id as string;

    expect((await inject('POST', `/agents/${agentId}/eval/runs`)).statusCode).toBe(422);

    const base = {
      kind: 'must_not_flag',
      input_diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n x\n+y',
      input_meta: { title: 'hand-made' },
      expected_output: [],
    };
    const ok = await inject('POST', `/agents/${agentId}/eval/cases`, { ...base, name: 'no-noise-at-all' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ kind: 'must_not_flag', forbidden_location: null, source_finding_id: null });

    const dup = await inject('POST', `/agents/${agentId}/eval/cases`, { ...base, name: 'no-noise-at-all' });
    expect(dup.statusCode).toBe(409);

    const emptyFind = await inject('POST', `/agents/${agentId}/eval/cases`, {
      ...base,
      name: 'must-find-nothing',
      kind: 'must_find',
    });
    expect(emptyFind.statusCode).toBe(422);
    expect(emptyFind.json().error.code).toBe('validation_error');

    const nonEmptyNeg = await inject('POST', `/agents/${agentId}/eval/cases`, {
      ...base,
      name: 'no-but-expects',
      expected_output: [{ severity: 'WARNING', category: 'bug', title: 't', file: 'a.ts', start_line: 2 }],
    });
    expect(nonEmptyNeg.statusCode).toBe(422);

    const put = await inject('PUT', `/eval/cases/${ok.json().id}`, { ...base, name: 'no-noise-renamed' });
    expect(put.statusCode).toBe(200);
    expect(put.json().name).toBe('no-noise-renamed');
  });

  it('AC-80–82, AC-32/33, AC-70: a background run returns at once, re-attaches, and stays pinned through mid-run edits', async () => {
    // Seeded agents have no version snapshot until something pins one.
    expect((await inject('GET', `/agents/${secId}/versions/1`)).statusCode).toBe(404);
    const casesAtStart = await caseList();

    let release!: () => void;
    gate = { promise: new Promise<void>((r) => (release = r)), release: () => release() };
    const from = captured.length;

    const start = await inject('POST', `/agents/${secId}/eval/runs`);
    expect(start.statusCode).toBe(202);
    const started = start.json();
    expect(started.attached).toBe(false);
    expect(started.run.status).toBe('running');
    expect(started.run.cases_total).toBe(casesAtStart.length);
    expect(started.run.cases_done).toBeLessThan(started.run.cases_total);
    const runId = started.run.id as string;
    runIds.v1 = runId;

    const second = await inject('POST', `/agents/${secId}/eval/runs`);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ attached: true, run: { id: runId } });

    const progress = await inject('GET', `/eval/runs/${runId}`);
    expect(progress.json()).toMatchObject({ id: runId, status: 'running', cases_done: 0 });
    const detailMid = (await inject('GET', `/agents/${secId}/eval/detail`)).json();
    expect(detailMid.in_flight?.id).toBe(runId);

    // Mid-run edits: new prompt (→ v2) and a newly linked skill.
    const put = await inject('PUT', `/agents/${secId}`, {
      system_prompt: `${seededPrompt}\nEVAL-MARKER:LAZY`,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().version).toBe(2);
    const skill = await inject('POST', '/skills', {
      name: 'Eval Skill X',
      description: 'Skill X for eval pinning',
      body: 'SKILL-X-BODY: flag secrets.',
      enabled: true,
    });
    expect(skill.statusCode).toBe(201);
    runIds.skillX = skill.json().id;
    expect(
      (await inject('POST', `/agents/${secId}/skills`, { skill_id: runIds.skillX })).statusCode,
    ).toBe(200);

    gate.release();
    gate = null;
    const done = await waitForRun(runId);
    const calls = captured.slice(from);

    expect(done.status).toBe('completed');
    expect(done.cases_done).toBe(casesAtStart.length);
    expect(done.results).toHaveLength(casesAtStart.length);
    expect(done.agent_version).toBe(1);
    expect(done.skill_snapshot).toEqual([]);
    expect([...done.case_ids].sort()).toEqual(casesAtStart.map((c) => c.id).sort());
    expect(done.finished_at).not.toBeNull();
    expect(done.duration_ms).not.toBeNull();
    // Every case was answered with the pre-edit prompt and no skill block.
    expect(calls).toHaveLength(casesAtStart.length);
    for (const c of calls) {
      expect(c.system).not.toContain('EVAL-MARKER:LAZY');
      expect(c.system + c.user).not.toContain('SKILL-X-BODY');
    }
    // The perfect mock answers every expectation and never flags a forbidden one.
    expect(done).toMatchObject({ recall: 1, precision: 1, citation_accuracy: 1, passed: casesAtStart.length });

    const v1 = await inject('GET', `/agents/${secId}/versions/1`);
    expect(v1.statusCode).toBe(200);
    expect(v1.json().config.system_prompt).toBe(seededPrompt);
  });

  it('AC-75, AC-34, AC-63: a v2 prompt moves recall; an unchanged config gives byte-identical model input', async () => {
    const r2 = await fullRun('v2');
    expect(r2.run.agent_version).toBe(2);
    expect(r2.run.skill_snapshot.map((s: { name: string }) => s.name)).toEqual(['Eval Skill X']);
    expect(r2.run.recall).toBeLessThan(1);
    for (const c of r2.calls) expect(c.user).toContain('SKILL-X-BODY'); // skills go in the user turn

    const cmp = await inject('GET', `/eval/compare?a=${runIds.v2}&b=${runIds.v1}`);
    expect(cmp.statusCode).toBe(200);
    const body = cmp.json();
    expect(body.old.id).toBe(runIds.v1);
    expect(body.new.id).toBe(runIds.v2);
    expect(body.same_prompt).toBe(false);
    expect(body.old_prompt).toBe(seededPrompt); // AC-70: the seeded version's prompt is showable
    expect(body.new_prompt).toContain('EVAL-MARKER:LAZY');
    expect(body.delta.recall).toBeLessThan(0);
    expect(body.skill_diff.added).toEqual(['Eval Skill X']);

    const r3 = await fullRun('v2again');
    const norm = (cs: Captured[]) => cs.map((c) => JSON.stringify(c)).sort();
    expect(norm(r3.calls)).toEqual(norm(r2.calls));
    const same = (await inject('GET', `/eval/compare?a=${runIds.v2}&b=${runIds.v2again}`)).json();
    expect(same.no_config_change).toBe(true);
    expect(same.case_set).toEqual({ same: true, only_old: 0, only_new: 0 });
  });

  it('AC-62 / AC-71: a skill-only change keeps the agent version but records a different snapshot', async () => {
    const skill = await inject('POST', '/skills', {
      name: 'Eval Skill Y',
      description: 'Skill Y',
      body: 'SKILL-Y-BODY',
      enabled: true,
    });
    expect(skill.statusCode).toBe(201);
    await inject('POST', `/agents/${secId}/skills`, { skill_id: skill.json().id });

    const r4 = await fullRun('skillY');
    expect(r4.run.agent_version).toBe(2);
    const cmp = (await inject('GET', `/eval/compare?a=${runIds.v2again}&b=${runIds.skillY}`)).json();
    expect(cmp.same_prompt).toBe(true);
    expect(cmp.no_config_change).toBe(false);
    expect(cmp.skill_diff.added).toEqual(['Eval Skill Y']);
    // Both runs stay distinguishable in history.
    const history = (await inject('GET', `/agents/${secId}/eval/runs`)).json();
    const ids = history.map((r: { id: string }) => r.id);
    expect(ids).toContain(runIds.v2again);
    expect(ids).toContain(runIds.skillY);
  });

  it('AC-76 / AC-57: a spoiled prompt lowers precision strictly and raises the dip alert', async () => {
    const previous = (await inject('GET', `/eval/runs/${runIds.skillY}`)).json();
    const put = await inject('PUT', `/agents/${secId}`, {
      system_prompt: `${seededPrompt}\nEVAL-MARKER:LAZY\nEVAL-MARKER:SPOIL`,
    });
    expect(put.json().version).toBe(3);
    const r5 = await fullRun('spoiled');
    expect(r5.run.precision).toBeLessThan(previous.precision);

    const detail = (await inject('GET', `/agents/${secId}/eval/detail`)).json();
    expect(detail.latest.id).toBe(runIds.spoiled);
    expect(detail.alert).not.toBeNull();
    expect(detail.alert.version).toBe(3);
    expect(detail.alert.points).toBe(Math.round((previous.precision - r5.run.precision) * 100));
    expect(detail.in_flight).toBeNull();
    // AC-31 / AC-55: history newest first; trend oldest → newest over completed runs.
    const history = (await inject('GET', `/agents/${secId}/eval/runs`)).json();
    expect(history.map((r: { id: string }) => r.id)).toEqual([
      runIds.spoiled,
      runIds.skillY,
      runIds.v2again,
      runIds.v2,
      runIds.v1,
    ]);
    expect(detail.trend.map((p: { version: number }) => p.version)).toEqual([1, 2, 2, 2, 3]);
  });

  it('AC-35: a single-case run updates last_result but adds nothing to run history', async () => {
    const historyBefore = (await inject('GET', `/agents/${secId}/eval/runs`)).json().length;
    const target = (await caseList()).find((c) => c.name === 'ssrf-webhook')!;
    const res = await inject('POST', `/eval/cases/${target.id}/run`);
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.suite_run_id).toBeNull();
    expect(result.agent_version).toBe(3);
    expect(result.status).toBe('passed');

    const after = (await caseList()).find((c) => c.id === target.id)!;
    expect(after.last_result.id).toBe(result.id);
    expect((await inject('GET', `/agents/${secId}/eval/runs`)).json()).toHaveLength(historyBefore);
  });

  it('AC-25 / AC-65: deleting a case keeps it in past results and the next run reports the case-set change', async () => {
    const victim = (await caseList()).find((c) => c.name === 'missing-retry-after')!;
    expect((await inject('DELETE', `/eval/cases/${victim.id}`)).json()).toEqual({ ok: true });
    expect((await caseList()).some((c) => c.id === victim.id)).toBe(false);

    const old = (await inject('GET', `/eval/runs/${runIds.v1}`)).json();
    expect(old.results.some((r: { case_name: string }) => r.case_name === 'missing-retry-after')).toBe(true);

    await fullRun('afterDelete');
    const cmp = (await inject('GET', `/eval/compare?a=${runIds.spoiled}&b=${runIds.afterDelete}`)).json();
    expect(cmp.case_set).toEqual({ same: false, only_old: 1, only_new: 0 });
  });

  it('AC-36 / NFR-2: reads (compare, detail, dashboard, history) make no model call', async () => {
    const before = llm.calls.length;
    const dash = await inject('GET', '/eval/dashboard');
    expect(dash.statusCode).toBe(200);
    const sec = dash.json().agents.find((a: { agent_id: string }) => a.agent_id === secId);
    expect(sec.latest.id).toBe(runIds.afterDelete);
    expect(sec.in_flight).toBe(false);
    await inject('GET', `/eval/compare?a=${runIds.v1}&b=${runIds.afterDelete}`);
    await inject('GET', `/agents/${secId}/eval/detail?days=7`);
    await inject('GET', `/agents/${secId}/eval/runs`);
    await inject('GET', `/agents/${secId}/eval/cases`);
    await inject('GET', `/eval/runs/${runIds.v1}`);
    expect(llm.calls.length).toBe(before);
  });

  it('AC-66–69: promote copies an old version into a new active one; active → 409; skill mismatch flagged', async () => {
    const preview = (await inject('GET', `/eval/compare?a=${runIds.v1}&b=${runIds.v2}`)).json();
    expect(preview.promote).toEqual({ version: 2, available: true, skill_mismatch: true });

    const active = await inject('POST', `/agents/${secId}/eval/promote`, { run_id: runIds.afterDelete });
    expect(active.statusCode).toBe(409);

    const v1Before = (await inject('GET', `/eval/runs/${runIds.v1}`)).json();
    const res = await inject('POST', `/agents/${secId}/eval/promote`, { run_id: runIds.v1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ new_version: 4, source_version: 1, skill_mismatch: true });

    const agent = (await inject('GET', `/agents/${secId}`)).json();
    expect(agent.version).toBe(4);
    expect(agent.system_prompt).toBe(seededPrompt);
    // Promote never touches skill links.
    const links = (await inject('GET', `/agents/${secId}/skills`)).json();
    expect(links.length).toBe(2);
    // History is never rewritten.
    expect((await inject('GET', `/eval/runs/${runIds.v1}`)).json()).toEqual(v1Before);
    expect((await inject('GET', `/agents/${secId}/versions/3`)).json().config.system_prompt).toContain(
      'EVAL-MARKER:SPOIL',
    );
  });

  it('AC-84: the boot reaper fails a run left running by a dead process', async () => {
    const [other] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Test Quality Reviewer')));
    const [row] = await pg.handle.db
      .insert(t.evalAgentRuns)
      .values({
        workspaceId,
        agentId: other!.id,
        agentVersion: 1,
        model: 'm',
        skillSnapshot: [],
        caseIds: [],
        status: 'running',
      })
      .returning();
    const reaped = await new EvalService((app as unknown as { container: Container }).container).reapStaleRuns();
    expect(reaped).toBeGreaterThanOrEqual(1);
    const after = (await inject('GET', `/eval/runs/${row!.id}`)).json();
    expect(after).toMatchObject({ status: 'failed', error: EVAL_REAPED_ERROR });
    expect(after.finished_at).not.toBeNull();
  });

  it('NFR-8: another workspace’s agent, case and run are 404 from this workspace', async () => {
    const db = pg.handle.db;
    const [ws2] = await db.insert(t.workspaces).values({ name: 'eval-other' }).returning();
    const [agent2] = await db
      .insert(t.agents)
      .values({ workspaceId: ws2!.id, name: 'Foreign', provider: 'openai', model: 'm', systemPrompt: 'x' })
      .returning();
    const [case2] = await db
      .insert(t.evalCases)
      .values({
        workspaceId: ws2!.id,
        ownerKind: 'agent',
        ownerId: agent2!.id,
        name: 'foreign-case',
        kind: 'must_not_flag',
        inputDiff: 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,1 +1,1 @@\n+x',
        inputMeta: { title: 't' },
        expectedOutput: [],
      })
      .returning();
    const [run2] = await db
      .insert(t.evalAgentRuns)
      .values({
        workspaceId: ws2!.id,
        agentId: agent2!.id,
        agentVersion: 1,
        model: 'm',
        skillSnapshot: [],
        caseIds: [case2!.id],
        status: 'completed',
      })
      .returning();

    const caseBody = {
      name: 'hijack',
      kind: 'must_not_flag',
      input_diff: 'x',
      input_meta: { title: 't' },
      expected_output: [],
    };
    const callsBefore = llm.calls.length;
    const probes: Array<[string, Promise<{ statusCode: number }>]> = [
      ['list cases', inject('GET', `/agents/${agent2!.id}/eval/cases`)],
      ['create case', inject('POST', `/agents/${agent2!.id}/eval/cases`, caseBody)],
      ['update case', inject('PUT', `/eval/cases/${case2!.id}`, caseBody)],
      ['run case', inject('POST', `/eval/cases/${case2!.id}/run`)],
      ['start run', inject('POST', `/agents/${agent2!.id}/eval/runs`)],
      ['get run', inject('GET', `/eval/runs/${run2!.id}`)],
      ['detail', inject('GET', `/agents/${agent2!.id}/eval/detail`)],
      ['compare', inject('GET', `/eval/compare?a=${run2!.id}&b=${runIds.v1}`)],
      ['promote foreign agent', inject('POST', `/agents/${agent2!.id}/eval/promote`, { run_id: run2!.id })],
      ['promote foreign run', inject('POST', `/agents/${secId}/eval/promote`, { run_id: run2!.id })],
    ];
    for (const [label, p] of probes) expect((await p).statusCode, label).toBe(404);
    expect((await inject('DELETE', `/eval/cases/${case2!.id}`)).statusCode).toBe(404);

    const [stillThere] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, case2!.id));
    expect(stillThere?.name).toBe('foreign-case');
    expect(llm.calls.length).toBe(callsBefore);
    const dash = (await inject('GET', '/eval/dashboard')).json();
    expect(dash.agents.some((a: { agent_id: string }) => a.agent_id === agent2!.id)).toBe(false);
  });

  it('CSRF guard: a foreign Origin cannot start runs; the studio origin and no Origin can', async () => {
    const { webOrigin } = (app as unknown as { container: Container }).container.config;
    const countRuns = async () => (await pg.handle.db.select().from(t.evalAgentRuns)).length;
    const runsBefore = await countRuns();
    const callsBefore = llm.calls.length;

    const evil = await app.inject({
      method: 'POST',
      url: '/eval/runs/all',
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error.code).toBe('forbidden_origin');
    for (const url of [`/agents/${secId}/eval/runs`, `/eval/cases/${(await caseList())[0]!.id}/run`]) {
      const res = await app.inject({ method: 'POST', url, headers: { origin: 'https://evil.example' } });
      expect(res.statusCode, url).toBe(403);
    }
    expect(await countRuns()).toBe(runsBefore);
    expect(llm.calls.length).toBe(callsBefore);

    // Hold the model so the no-Origin call deterministically re-attaches.
    let release!: () => void;
    gate = { promise: new Promise<void>((r) => (release = r)), release: () => release() };
    const studio = await app.inject({ method: 'POST', url: '/eval/runs/all', headers: { origin: webOrigin } });
    expect(studio.statusCode).toBe(200);
    const started = studio.json().runs as Array<{ attached: boolean; run: { id: string } }>;
    expect(started.length).toBeGreaterThanOrEqual(1);
    expect(started.every((r) => !r.attached)).toBe(true);

    const bare = await inject('POST', '/eval/runs/all');
    expect(bare.statusCode).toBe(200);
    expect((bare.json().runs as Array<{ attached: boolean }>).every((r) => r.attached)).toBe(true);

    gate.release();
    gate = null;
    for (const r of started) await waitForRun(r.run.id);
  });

  it('rate limit: the (max+1)-th single-case run within the window is 429', async () => {
    // The global rate-limit plugin is not registered under NODE_ENV=test, so
    // the per-route limit is exercised on a second app built as in development.
    const base = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const limited = await buildApp({
      config: { ...base, nodeEnv: 'development', logLevel: 'silent' },
      db: pg.handle.db,
      overrides: { llm: { openai: llm, anthropic: llm, openrouter: llm } },
    });
    try {
      // An unknown case id 404s after the limiter counted it — no model call is spent.
      const url = `/eval/cases/${crypto.randomUUID()}/run`;
      for (let i = 0; i < EVAL_CASE_RUN_RATE_LIMIT_MAX; i++) {
        expect((await limited.inject({ method: 'POST', url })).statusCode, `call ${i + 1}`).toBe(404);
      }
      expect((await limited.inject({ method: 'POST', url })).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('NFR-1: no eval path reached the repository index', () => {
    expect(repoIntelCalls).toEqual([]);
  });
});
