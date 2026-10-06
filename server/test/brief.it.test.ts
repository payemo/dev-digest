/**
 * PR Brief endpoints (L05, plan Step 10) — DB-backed, against a real Postgres
 * via testcontainers, driven through Fastify's `inject()`.
 *
 * What only the real stack can prove:
 *   - GET is a pure cache read of `pr_brief.json`: no model call, `is_stale`
 *     derived from the PR's current head (FR-6, FR-11);
 *   - POST makes exactly ONE `completeStructured` call, verifies the model's
 *     citations against real `pr_files` and the blast map, and upserts one row;
 *   - a failed generation leaves the previous row byte-identical (FR-15);
 *   - overlapping POSTs yield one 200 and one 409 with one model call (FR-16);
 *   - tenancy: another workspace's PR is 404 on both verbs (NFR-4);
 *   - degraded inputs still generate, labelled (FR-10);
 *   - the `risk_brief` feature-model setting routes the call (FR-13);
 *   - only `specs`-category documents of enabled agents reach the prompt (D6).
 *
 * HERMETICITY: `risk_brief` defaults to `openai`; the mock is injected under
 * `openai` AND `anthropic` (and GitHub is mocked) so no path can reach a real,
 * billed provider (server/INSIGHTS.md). `openrouter` is also covered in case a
 * collaborator (intent) is ever routed through it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { PrBriefRecord, type StructuredRequest, type StructuredResult } from '@devdigest/shared';
import type { BlastResult, RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** New-side ranges 1-4 and 41-43. The body lines must never reach the model. */
const PATCH = [
  '@@ -1,3 +1,4 @@',
  ' import { redis } from "./redis";',
  '+const BUCKET_SECRET_MARKER = process.env.BUCKET_KEY;',
  '-const OLD_LIMIT_MARKER = 10;',
  '@@ -40,2 +41,3 @@',
  '+export function rateLimitBodyMarker(req) { return check(req); }',
].join('\n');

const FILES = [
  { path: 'src/api/rate-limit.ts', additions: 3, deletions: 1, patch: PATCH },
  { path: 'docs/limits.md', additions: 5, deletions: 0, patch: '@@ -0,0 +1,5 @@\n+# Limits doc marker' },
];

/** What the model is stubbed to answer — a mix of grounded and invented claims. */
const OUTPUT = {
  summary: 'Adds per-token rate limiting so one client cannot exhaust the shared Redis pool.',
  risks: [
    {
      kind: 'security',
      title: 'Limiter key read from env',
      explanation: 'A missing key disables limiting.',
      severity: 'high',
      file_refs: ['src/api/rate-limit.ts:2', 'src/invented.ts'],
    },
    {
      kind: 'contract',
      title: 'Public callers now throttled',
      explanation: 'listItems can now return 429.',
      severity: 'medium',
      file_refs: ['src/api/public/items.ts:23'], // blast-only path: valid
    },
    {
      kind: 'performance',
      title: 'Invented worry',
      explanation: 'Nothing real backs this.',
      severity: 'low',
      file_refs: ['src/nowhere.ts'],
    },
  ],
  review_focus: [
    { file: 'src/api/rate-limit.ts', line: 2, reason: 'Where the key is read.' },
    { file: 'src/api/rate-limit.ts', line: 500, reason: 'The exported limiter.' }, // → 43
    { file: 'src/ghost.ts', line: 1, reason: 'Does not exist.' },
  ],
};

const INDEXED: BlastResult = {
  changedSymbols: [{ name: 'rateLimit', file: 'src/api/rate-limit.ts', kind: 'function' }],
  callers: [
    { file: 'src/api/public/items.ts', symbol: 'listItems', viaSymbol: 'rateLimit', line: 23, rank: 90 },
  ],
  impactedEndpoints: ['GET /api/public/items'],
  factsByFile: { 'src/api/public/items.ts': { endpoints: ['GET /api/public/items'], crons: [] } },
  degraded: false,
};
const UNINDEXED: BlastResult = {
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  degraded: true,
  reason: 'no_data',
};

/** Answers `getBlastRadius` with a settable result; every other capability throws. */
class FakeRepoIntel implements RepoIntel {
  constructor(public result: BlastResult) {}
  async getBlastRadius(): Promise<BlastResult> {
    return this.result;
  }
  indexRepo(): never {
    throw new Error('not used by brief');
  }
  refreshIndex(): never {
    throw new Error('not used by brief');
  }
  getIndexState(): never {
    throw new Error('not used by brief');
  }
  getRepoMap(): never {
    throw new Error('not used by brief');
  }
  getFileRank(): never {
    throw new Error('not used by brief');
  }
  getSymbolsInFiles(): never {
    throw new Error('not used by brief');
  }
  getCallerSignatures(): never {
    throw new Error('not used by brief');
  }
  getUnresolvedReferences(): never {
    throw new Error('not used by brief');
  }
  getConventionSamples(): never {
    throw new Error('not used by brief');
  }
  getTopFilesByRank(): never {
    throw new Error('not used by brief');
  }
  getCriticalPaths(): never {
    throw new Error('not used by brief');
  }
}

/**
 * The shared mock LLM, with two test knobs: a swappable `PrBrief` fixture and
 * an optional gate the call awaits (makes the overlap in the 409 test
 * deterministic). Schema validation is still the mock's own.
 */
class ScriptedLLM extends MockLLMProvider {
  fixture: unknown = OUTPUT;
  gate: Promise<void> | null = null;
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    if (this.gate) await this.gate;
    return new MockLLMProvider(this.id, {
      structuredBySchema: { PrBrief: this.fixture },
    }).completeStructured(req);
  }
  briefCalls(): StructuredRequest<unknown>[] {
    return this.calls
      .filter((c) => c.method === 'completeStructured')
      .map((c) => c.req as StructuredRequest<unknown>)
      .filter((r) => r.schemaName === 'PrBrief');
  }
}

d('L05 PR brief endpoints (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let intel: FakeRepoIntel;
  const openai = new ScriptedLLM('openai');
  const anthropic = new ScriptedLLM('anthropic');
  const totalCalls = () => openai.briefCalls().length + anthropic.briefCalls().length;
  let seq = 0;

  async function setupPr(
    owner: string,
    opts: { body?: string | null; files?: typeof FILES; withIntent?: boolean } = {},
  ) {
    const name = `brief-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: owner, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: owner,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4',
        status: 'needs_review',
        body: opts.body === undefined ? 'Protect the Redis pool.\n\nCloses #471.' : opts.body,
      })
      .returning();
    const files = opts.files ?? FILES;
    if (files.length) {
      await pg.handle.db.insert(t.prFiles).values(files.map((f) => ({ prId: pr!.id, ...f })));
    }
    if (opts.withIntent !== false) {
      await pg.handle.db.insert(t.prIntent).values({
        prId: pr!.id,
        intent: 'Stop one API client from exhausting the Redis pool.',
        inScope: ['public endpoints'],
        outOfScope: ['internal endpoints'],
        headSha: 'a1b2c3d4',
      });
    }
    return { repo: repo!, pr: pr! };
  }

  const briefRow = async (prId: string) =>
    (await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId)))[0];

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    intel = new FakeRepoIntel(INDEXED);
    app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: {} }),
        github: new MockGitHubClient(),
        secrets: new MockSecretsProvider(),
        repoIntel: intel,
        llm: { openai, anthropic, openrouter: openai },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('GET is null before generation; POST generates a verified brief that GET then serves with no model call', async () => {
    intel.result = INDEXED;
    const { pr } = await setupPr(workspaceId);

    const before = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toBeNull();

    const callsBefore = totalCalls();
    const posted = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(posted.statusCode).toBe(200);
    const record = PrBriefRecord.parse(posted.json());
    expect(totalCalls()).toBe(callsBefore + 1);
    expect(openai.briefCalls()).toHaveLength(callsBefore + 1); // default risk_brief provider

    expect(record.pr_id).toBe(pr.id);
    expect(record.summary).toBe(OUTPUT.summary);
    expect(record.risks.risks.map((r) => [r.title, r.file_refs])).toEqual([
      ['Limiter key read from env', ['src/api/rate-limit.ts:2']],
      ['Public callers now throttled', ['src/api/public/items.ts:23']],
    ]);
    expect(record.review_focus.map((f) => `${f.file}:${f.line}`)).toEqual([
      'src/api/rate-limit.ts:2',
      'src/api/rate-limit.ts:43',
    ]);
    expect(record.validation).toEqual({
      risks_dropped: 1,
      refs_stripped: 2,
      focus_dropped: 1,
      focus_snapped: 1,
      duplicates_collapsed: 0,
    });
    expect(record.inputs).toEqual({
      intent: 'present',
      blast: 'present',
      description: 'present',
      linked_issue: 'present',
      project_context: 'missing',
    });
    expect(record.intent?.intent).toBe('Stop one API client from exhausting the Redis pool.');
    expect(record.blast?.changed_symbols.map((s) => s.name)).toEqual(['rateLimit']);
    expect(record.blast).not.toHaveProperty('degraded');
    expect(record.history).toEqual({ history: [] });
    expect(record).toMatchObject({
      head_sha: 'a1b2c3d4',
      is_stale: false,
      provider: 'openai',
      model: 'gpt-4.1',
      attempts: 1,
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.001,
    });
    expect(record.input_tokens_measured).toBeGreaterThan(0);
    expect(record.input_tokens_measured).toBeLessThanOrEqual(8_000);

    // What reached the model: changed line numbers and the linked issue, never a patch body.
    const user = openai.briefCalls().at(-1)!.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('src/api/rate-limit.ts [core] +3 -1 lines 1-4,41-43');
    expect(user).toContain('Issue #471');
    for (const marker of ['BUCKET_SECRET_MARKER', 'OLD_LIMIT_MARKER', 'rateLimitBodyMarker', 'Limits doc marker', 'import { redis }']) {
      expect(user).not.toContain(marker);
    }

    // Persisted, and GET serves the identical record with zero further calls.
    expect(await briefRow(pr.id)).toBeDefined();
    const got = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual(posted.json());
    expect(totalCalls()).toBe(callsBefore + 1);
  });

  it('flags is_stale on a moved head with no call, and a regenerate clears it in the same row', async () => {
    intel.result = INDEXED;
    const { pr } = await setupPr(workspaceId);
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    await pg.handle.db.update(t.pullRequests).set({ headSha: 'f9e8d7c6' }).where(eq(t.pullRequests.id, pr.id));

    const callsBefore = totalCalls();
    const stale = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).json();
    expect(stale.is_stale).toBe(true);
    expect(stale.head_sha).toBe('a1b2c3d4');
    expect(totalCalls()).toBe(callsBefore);

    const regen = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(regen.statusCode).toBe(200);
    expect(regen.json()).toMatchObject({ is_stale: false, head_sha: 'f9e8d7c6' });
    expect(totalCalls()).toBe(callsBefore + 1);
    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
  });

  it('a generation whose model output fails the schema errors and leaves the prior brief byte-identical', async () => {
    intel.result = INDEXED;
    const { pr } = await setupPr(workspaceId);
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    const prior = JSON.stringify((await briefRow(pr.id))!.json);

    openai.fixture = { summary: 42, risks: 'nope' };
    try {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
    } finally {
      openai.fixture = OUTPUT;
    }
    expect(JSON.stringify((await briefRow(pr.id))!.json)).toBe(prior);
    const got = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(got.json().summary).toBe(OUTPUT.summary);
  });

  it('two overlapping POSTs yield one 200 and one 409, with exactly one model call', async () => {
    intel.result = INDEXED;
    const { pr } = await setupPr(workspaceId);
    let release!: () => void;
    openai.gate = new Promise<void>((r) => (release = r));
    const callsBefore = totalCalls();
    try {
      const a = app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      const b = app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      // One request is parked on the gate inside its model call…
      await vi.waitFor(() => expect(totalCalls()).toBe(callsBefore + 1));
      // …so the other can only finish by being refused.
      const first = await Promise.race([a, b]);
      expect(first.statusCode).toBe(409);
      release();
      const statuses = (await Promise.all([a, b])).map((r) => r.statusCode).sort();
      expect(statuses).toEqual([200, 409]);
    } finally {
      openai.gate = null;
      release?.();
    }
    expect(totalCalls()).toBe(callsBefore + 1);

    // The guard is released afterwards: a later POST is not refused.
    const again = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(again.statusCode).toBe(200);
  });

  it('422s a PR with no changed files before any model call', async () => {
    const { pr } = await setupPr(workspaceId, { files: [] });
    const callsBefore = totalCalls();
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(422);
    expect(totalCalls()).toBe(callsBefore);
    expect(await briefRow(pr.id)).toBeUndefined();
  });

  it('404s another workspace’s PR on both verbs, and 422s a non-uuid id', async () => {
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'brief-other' }).returning();
    const { pr } = await setupPr(otherWs!.id);
    const callsBefore = totalCalls();
    expect((await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` })).statusCode).toBe(404);
    expect(totalCalls()).toBe(callsBefore);
    expect((await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/brief' })).statusCode).toBe(422);
  });

  it('generates with intent never derived and an unindexed repo, and labels both inputs missing', async () => {
    intel.result = UNINDEXED;
    try {
      const { pr } = await setupPr(workspaceId, { withIntent: false, body: null });
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(res.statusCode).toBe(200);
      const record = PrBriefRecord.parse(res.json());
      expect(record.inputs).toEqual({
        intent: 'missing',
        blast: 'missing',
        description: 'missing',
        linked_issue: 'missing',
        project_context: 'missing',
      });
      expect(record.intent).toBeNull();
      expect(record.blast).toBeNull();
      // With no blast map, the blast-only caller citation no longer grounds.
      expect(record.risks.risks.map((r) => r.title)).toEqual(['Limiter key read from env']);
      const user = openai.briefCalls().at(-1)!.messages.find((m) => m.role === 'user')!.content;
      expect(user).toContain('NOT AVAILABLE: Intent (never derived)');
    } finally {
      intel.result = INDEXED;
    }
  });

  it('routes the single call to the provider the workspace chose for risk_brief', async () => {
    intel.result = INDEXED;
    const { pr } = await setupPr(workspaceId);
    const where = and(
      eq(t.settings.workspaceId, workspaceId),
      isNull(t.settings.userId),
      eq(t.settings.key, 'feature_models'),
    );
    const existing = (await pg.handle.db.select().from(t.settings).where(where))[0];
    await pg.handle.db.delete(t.settings).where(where);
    await pg.handle.db.insert(t.settings).values({
      workspaceId,
      key: 'feature_models',
      value: { risk_brief: { provider: 'anthropic', model: 'claude-x' } },
    });
    const openaiBefore = openai.briefCalls().length;
    const anthropicBefore = anthropic.briefCalls().length;
    try {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ provider: 'anthropic', model: 'claude-x' });
      expect(anthropic.briefCalls()).toHaveLength(anthropicBefore + 1);
      expect(anthropic.briefCalls().at(-1)!.model).toBe('claude-x');
      expect(openai.briefCalls()).toHaveLength(openaiBefore);
    } finally {
      await pg.handle.db.delete(t.settings).where(where);
      if (existing) await pg.handle.db.insert(t.settings).values(existing);
    }
  });

  it('sends a specs document attached to an enabled agent, and not a docs-category one', async () => {
    intel.result = INDEXED;
    const { repo, pr } = await setupPr(workspaceId);
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
    const doc = (path: string, category: 'specs' | 'docs', content: string) => ({
      workspaceId,
      repoId: repo.id,
      path,
      name: path.split('/').at(-1)!,
      folder: '',
      category,
      origin: 'repo' as const,
      content,
      sizeBytes: content.length,
      tokenCount: Math.ceil(content.length / 4),
      fingerprint: `fp-${path}`,
    });
    const docs = await pg.handle.db
      .insert(t.contextDocuments)
      .values([
        doc('.devdigest/specs/public-api.md', 'specs', 'SPEC_BODY_MARKER: every public route is limited.'),
        doc('.devdigest/docs/onboarding.md', 'docs', 'DOCS_BODY_MARKER: how to set up a laptop.'),
      ])
      .returning();
    await pg.handle.db.insert(t.agentContextDocuments).values(
      docs.map((row, order) => ({ agentId: agent!.id, repoId: repo.id, documentId: row.id, order })),
    );

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json().inputs.project_context).toBe('present');
    const user = openai.briefCalls().at(-1)!.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('<untrusted source="spec-0">\npath: .devdigest/specs/public-api.md\n');
    expect(user).toContain('SPEC_BODY_MARKER');
    expect(user).not.toContain('DOCS_BODY_MARKER');
  });
});
