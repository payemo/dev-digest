/**
 * Export to CI end to end over real Postgres (spec 05, plan S16 "server
 * integration"). Every provider is mocked: LLMs for all three provider ids
 * (server/INSIGHTS.md — an unmocked provider turns this lane live and billed),
 * GitHub via MockGitHubClient (whose options object is mutated between steps to
 * script Actions runs), the runner bundle via MockRunnerBundleSource.
 *
 * This is the only place the real SQL of CiRepository runs: the atomic
 * agent_runs + run_traces + ci_runs write, its rollback on a duplicate
 * github_run_id, the (agent, repo) upsert, workspace scoping on every read,
 * and memory export scoping.
 *
 * The tests are ordered and share state (one seeded DB, one app).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { CiResultArtifact, WorkflowRunInfo } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockRunnerBundleSource,
  MockSecretsProvider,
  type MockGitHubOptions,
} from '../src/adapters/mocks.js';
import { CiRepository } from '../src/modules/ci/repository.js';
import { buildCiRunTrace, gitBlobSha } from '../src/modules/ci/helpers.js';

const hasDocker = await dockerAvailable();
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci.it] Docker not available — skipping integration tests.');
}
const d = hasDocker ? describe : describe.skip;

const REPO = 'acme/payments-api';
const PR = 482;
const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,2 +1,3 @@
 export const a = 1;
+export const stripeKey = 'sk_live_xxx';
 export default a;
`;

d('Export to CI (spec 05) — real Postgres, hermetic providers', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  let ghOpts: MockGitHubOptions;
  let gh: MockGitHubClient;
  let repo: CiRepository;
  const llm = new MockLLMProvider('openai');
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
  const overrides = () => ({
    llm: { openai: llm, anthropic: llm, openrouter: llm },
    git: new MockGitClient(),
  });

  let ws: string;
  let otherWs: string;
  let secId: string; // Security Reviewer (openrouter)
  let perfId: string; // Performance Reviewer (openrouter)
  let anthropicId: string;
  let otherWsAgentId: string;
  let repoId: string;
  let editedWorkflow: string;

  const post = (url: string, payload?: unknown) =>
    app.inject({ method: 'POST', url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const get = (url: string) => app.inject({ method: 'GET', url });

  async function installationRow(agentId: string) {
    const [row] = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, REPO)));
    return row;
  }

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [w] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    ws = w!.id;
    const agentId = async (name: string) =>
      (await db.select().from(t.agents).where(and(eq(t.agents.workspaceId, ws), eq(t.agents.name, name))))[0]!.id;
    secId = await agentId('Security Reviewer');
    perfId = await agentId('Performance Reviewer');
    const [r] = await db.select().from(t.repos).where(and(eq(t.repos.workspaceId, ws), eq(t.repos.fullName, REPO)));
    repoId = r!.id;

    const [anth] = await db
      .insert(t.agents)
      .values({ workspaceId: ws, name: 'Claude Reviewer', provider: 'anthropic', model: 'claude-x', systemPrompt: 'p' })
      .returning();
    anthropicId = anth!.id;

    const [w2] = await db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();
    otherWs = w2!.id;
    const [a2] = await db
      .insert(t.agents)
      .values({ workspaceId: otherWs, name: 'Foreign Agent', provider: 'openrouter', model: 'm', systemPrompt: 'p' })
      .returning();
    otherWsAgentId = a2!.id;
    const [otherRepo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name: 'unrelated', fullName: 'acme/unrelated' } as typeof t.repos.$inferInsert)
      .returning();

    // Memory export scoping fixtures.
    await db.insert(t.memory).values([
      { workspaceId: ws, scope: 'global', kind: 'convention', content: 'MEM-GLOBAL', confidence: 0.8, sources: [] },
      { workspaceId: ws, repoId, scope: 'repo', kind: 'fact', content: 'MEM-THIS-REPO', confidence: 0.7, sources: [] },
      { workspaceId: ws, repoId: otherRepo!.id, scope: 'repo', kind: 'fact', content: 'MEM-OTHER-REPO', sources: [] },
      { workspaceId: otherWs, scope: 'global', kind: 'fact', content: 'MEM-OTHER-WORKSPACE', sources: [] },
    ]);

    ghOpts = {};
    gh = new MockGitHubClient(ghOpts);
    repo = new CiRepository(db);
    app = await buildApp({
      config,
      db,
      overrides: { ...overrides(), github: gh, runnerBundle: new MockRunnerBundleSource() },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  // -------------------------------------------------------------------------
  // preview
  // -------------------------------------------------------------------------

  it('preview: generates manifest, skills, memory, workflow and the runner (size only), unblocked for OpenRouter', async () => {
    const res = await post(`/agents/${secId}/ci/preview`, { repo: REPO });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blocking).toEqual([]);
    expect(body.branch).toBe('devdigest/ci');
    expect(body.secret_names).toEqual(['OPENROUTER_API_KEY']);

    const byRole = (role: string) => body.files.filter((f: { role: string }) => f.role === role);
    const [manifest] = byRole('manifest');
    expect(manifest.path).toBe('.devdigest/agents/security-reviewer.yaml');
    expect(body.workflow_path).toBe('.github/workflows/devdigest-review-security-reviewer.yml');
    expect(byRole('workflow')[0].path).toBe(body.workflow_path);
    expect(byRole('workflow')[0].editable).toBe(true);
    expect(byRole('workflow')[0].contents).toContain('node .devdigest/runner.mjs review --agent security-reviewer');
    // One skill file per skill slug the manifest references.
    const slugs = manifest.contents.match(/^skills:\n((?: {2}- .+\n)*)/m)?.[1]?.trim().split('\n').map((l: string) => l.replace(/^ *- /, '')) ?? [];
    expect(byRole('skill').map((f: { path: string }) => f.path).sort()).toEqual(
      slugs.map((s: string) => `.devdigest/skills/${s}.md`).sort(),
    );
    const [runner] = byRole('runner');
    expect(runner.path).toBe('.devdigest/runner.mjs');
    expect(runner.contents).toBe('');
    expect(runner.size_bytes).toBeGreaterThan(0);
    // Memory: global + this repo's, never another repo's or another workspace's.
    const [memory] = byRole('memory');
    expect(memory.path).toBe('.devdigest/memory.jsonl');
    expect(memory.contents).toContain('MEM-GLOBAL');
    expect(memory.contents).toContain('MEM-THIS-REPO');
    expect(memory.contents).not.toContain('MEM-OTHER-REPO');
    expect(memory.contents).not.toContain('MEM-OTHER-WORKSPACE');
    // Nothing reached GitHub.
    expect(gh.committed).toHaveLength(0);
  });

  it('preview: reports every blocking reason', async () => {
    const codes = async (agent: string, payload: object) =>
      ((await post(`/agents/${agent}/ci/preview`, payload)).json().blocking as { code: string }[]).map((b) => b.code);
    expect(await codes(secId, { repo: 'acme/not-imported' })).toEqual(['repo_not_imported']);
    expect(await codes(anthropicId, { repo: REPO })).toEqual(['provider_unsupported']);
    expect(await codes(secId, { repo: REPO, target: 'circle' })).toEqual(['target_unsupported']);

    const noRunner = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { ...overrides(), github: new MockGitHubClient(), runnerBundle: new MockRunnerBundleSource(null) },
    });
    try {
      const res = await noRunner.inject({ method: 'POST', url: `/agents/${secId}/ci/preview`, payload: { repo: REPO } });
      expect(res.json().blocking.map((b: { code: string }) => b.code)).toEqual(['runner_bundle_missing']);
      expect(res.json().files.some((f: { role: string }) => f.role === 'runner')).toBe(false);
    } finally {
      await noRunner.close();
    }
  });

  // -------------------------------------------------------------------------
  // export
  // -------------------------------------------------------------------------

  it('export open_pr: commits only to devdigest/ci off the default branch, opens a PR, persists the installation', async () => {
    const res = await post(`/agents/${secId}/export-ci`, { repo: REPO, action: 'open_pr' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.pr_url).toBe('https://github.com/mock/mock/pull/1');

    expect(gh.committed).toHaveLength(1);
    const commit = gh.committed[0]!;
    expect(commit.branch).toBe('devdigest/ci');
    expect(commit.base).toBe('main');
    expect(commit.files.find((f) => f.path === '.devdigest/runner.mjs')!.contents).toContain('mock agent-runner bundle');
    expect(gh.openedPrs).toEqual([expect.objectContaining({ head: 'devdigest/ci', base: 'main' })]);
    // The runner is committed in full but never echoed back for open_pr.
    expect(body.files.find((f: { role: string }) => f.role === 'runner').contents).toBe('');

    const row = (await installationRow(secId))!;
    expect(row).toMatchObject({ branch: 'devdigest/ci', prUrl: body.pr_url, agentSlug: 'security-reviewer', repoId, targetType: 'gha' });
    // V1 baseline = the blobs of exactly what was committed.
    expect(row.expectedBlobs).toEqual(Object.fromEntries(commit.files.map((f) => [f.path, gitBlobSha(f.contents)])));

    const overview = (await get(`/agents/${secId}/ci`)).json();
    expect(overview.active_repos).toBe(1);
    expect(overview.installations).toEqual([
      expect.objectContaining({ repo: REPO, branch: 'devdigest/ci', outdated: false, last_run: null }),
    ]);
  });

  it('export again: reuses the open PR and updates the same installation row', async () => {
    const res = await post(`/agents/${secId}/export-ci`, { repo: REPO, triggers: ['opened', 'reopened'], post_as: 'none' });
    expect(res.statusCode).toBe(201);
    expect(gh.committed).toHaveLength(2);
    expect(gh.openedPrs).toHaveLength(1);
    const rows = await pg.handle.db.select().from(t.ciInstallations).where(eq(t.ciInstallations.agentId, secId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ triggers: ['opened', 'reopened'], postAs: 'none' });
  });

  it('export refuses devdigest/ci as the base, and an edited workflow that no longer runs the agent', async () => {
    const before = gh.committed.length;
    const base = await post(`/agents/${secId}/export-ci`, { repo: REPO, base: 'devdigest/ci' });
    expect(base.statusCode).toBe(422);

    const preview = (await post(`/agents/${secId}/ci/preview`, { repo: REPO })).json();
    const wf = preview.files.find((f: { role: string }) => f.role === 'workflow').contents as string;
    const broken = await post(`/agents/${secId}/export-ci`, {
      repo: REPO,
      workflow_yaml: wf.replace('review --agent security-reviewer', 'review --agent someone-else'),
    });
    expect(broken.statusCode).toBe(422);
    expect(broken.json().error.details.errors[0]).toMatch(/must still run/);
    expect(gh.committed).toHaveLength(before);
  });

  it('export commits a valid edited workflow verbatim', async () => {
    const preview = (await post(`/agents/${secId}/ci/preview`, { repo: REPO })).json();
    const wf = preview.files.find((f: { role: string }) => f.role === 'workflow').contents as string;
    editedWorkflow = wf.replace('timeout-minutes: 15', 'timeout-minutes: 25 # edited');
    const res = await post(`/agents/${secId}/export-ci`, { repo: REPO, workflow_yaml: editedWorkflow });
    expect(res.statusCode).toBe(201);
    const committed = gh.committed.at(-1)!.files.find((f) => f.path === preview.workflow_path)!;
    expect(committed.contents).toBe(editedWorkflow);
    expect((await installationRow(secId))!.workflowYaml).toBe(editedWorkflow);
  });

  it('export files: returns every file including the runner contents, without calling GitHub', async () => {
    const before = gh.committed.length;
    const res = await post(`/agents/${perfId}/export-ci`, { repo: REPO, action: 'files' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.pr_url).toBeNull();
    expect(body.files.find((f: { role: string }) => f.role === 'runner').contents).toContain('mock agent-runner bundle');
    expect(gh.committed).toHaveLength(before);
    expect((await installationRow(perfId))).toMatchObject({ branch: null, agentSlug: 'performance-reviewer' });
  });

  it('export is 409 with the blocking reasons for an unsupported agent, and commits nothing', async () => {
    const before = gh.committed.length;
    const res = await post(`/agents/${anthropicId}/export-ci`, { repo: REPO });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.blocking.map((b: { code: string }) => b.code)).toEqual(['provider_unsupported']);
    expect(gh.committed).toHaveLength(before);
  });

  it('export open_pr is 412 when no GitHub token is configured', async () => {
    const noToken = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { ...overrides(), secrets: new MockSecretsProvider({}), runnerBundle: new MockRunnerBundleSource() },
    });
    try {
      const res = await noToken.inject({ method: 'POST', url: `/agents/${secId}/export-ci`, payload: { repo: REPO } });
      expect(res.statusCode).toBe(412);
      expect(res.json().error.code).toBe('github_not_connected');
    } finally {
      await noToken.close();
    }
  });

  // -------------------------------------------------------------------------
  // outdated + update
  // -------------------------------------------------------------------------

  it('a changed agent marks installations outdated; Update CI config recommits only PR installations, keeping the edited workflow', async () => {
    await pg.handle.db
      .update(t.agents)
      .set({ version: 99, systemPrompt: 'changed prompt' })
      .where(eq(t.agents.id, secId));
    const stale = (await get(`/agents/${secId}/ci`)).json();
    expect(stale.installations[0].outdated).toBe(true);

    await pg.handle.db.update(t.agents).set({ version: 42 }).where(eq(t.agents.id, perfId));
    const perfBefore = (await installationRow(perfId))!;

    const before = gh.committed.length;
    const res = await post(`/agents/${secId}/ci/update`);
    expect(res.statusCode).toBe(200);
    expect(res.json().installations).toHaveLength(1);
    expect(gh.committed).toHaveLength(before + 1);
    const commit = gh.committed.at(-1)!;
    expect(commit.branch).toBe('devdigest/ci');
    expect(commit.files.find((f) => f.path.startsWith('.github/workflows/'))!.contents).toBe(editedWorkflow);
    expect(commit.files.find((f) => f.path.endsWith('security-reviewer.yaml'))!.contents).toContain('changed prompt');
    expect((await get(`/agents/${secId}/ci`)).json().installations[0].outdated).toBe(false);

    // The zip-installed agent has no PR installation: update is a no-op.
    const perfRes = await post(`/agents/${perfId}/ci/update`);
    expect(perfRes.json().installations).toEqual([]);
    expect(gh.committed).toHaveLength(before + 1);
    expect((await installationRow(perfId))!.updatedAt).toEqual(perfBefore.updatedAt);
  });

  // -------------------------------------------------------------------------
  // sync / ingest
  // -------------------------------------------------------------------------

  it('sync twice: exactly one agent_runs(source=ci) + run_traces + ci_runs per GitHub run; a failed run is stored as failed', async () => {
    const inst = (await installationRow(secId))!;
    const now = Date.now();
    const runOf = (id: number, o: Partial<WorkflowRunInfo> = {}): WorkflowRunInfo => ({
      id,
      run_attempt: 1,
      html_url: `https://github.com/${REPO}/actions/runs/${id}`,
      event: 'pull_request',
      status: 'completed',
      conclusion: 'success',
      head_sha: HEAD,
      path: inst.workflowPath!,
      repository_full_name: REPO,
      head_repository_full_name: REPO,
      pull_numbers: [PR],
      created_at: new Date(now - 3_600_000).toISOString(),
      run_started_at: new Date(now - 3_600_000).toISOString(),
      updated_at: new Date(now - 3_540_000).toISOString(),
      ...o,
    });
    const artifact: CiResultArtifact = {
      format: 'devdigest-ci-result/v2',
      findings_count: 2,
      cost_usd: 0.003,
      duration_ms: 42_000,
      agent: 'Security Reviewer',
      agent_slug: inst.agentSlug,
      manifest_version: 42,
      manifest_sha256: 'msha',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      runner_version: '2',
      dependencies: { 'agent-runner': '2', 'reviewer-core': '0.0.0' },
      head_sha: HEAD,
      github_run_id: 7001,
      verdict: 'APPROVE',
      findings: [
        { id: 'a', severity: 'CRITICAL', category: 'security', title: 'key', file: 'src/config.ts', start_line: 2, end_line: 2, rationale: 'r', confidence: 0.9, kind: 'finding' },
        { id: 'b', severity: 'WARNING', category: 'bug', title: 'ghost', file: 'src/config.ts', start_line: 90, end_line: 90, rationale: 'r', confidence: 0.4, kind: 'finding' },
      ],
    };
    Object.assign(ghOpts, {
      workflowRuns: [
        runOf(7001),
        runOf(7002, {
          conclusion: 'failure',
          created_at: new Date(now - 3 * 86_400_000).toISOString(),
          run_started_at: new Date(now - 3 * 86_400_000).toISOString(),
          updated_at: new Date(now - 3 * 86_400_000 + 60_000).toISOString(),
        }),
      ],
      runArtifacts: { 7001: [{ id: 51, name: 'devdigest-result', size_in_bytes: 900, expired: false }] },
      artifactFiles: { 51: JSON.stringify(artifact) },
      blobShas: { [HEAD]: inst.expectedBlobs! },
      pullBaseShas: { [PR]: BASE },
      compareDiffs: { [`${BASE}...${HEAD}`]: DIFF },
    } satisfies MockGitHubOptions);

    const first = await post('/ci/sync', {});
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ingested: 2, failed_runs: 1, rejected: [], errors: [] });
    const second = await post('/ci/sync', {});
    expect(second.json()).toMatchObject({ ingested: 0, failed_runs: 0 });

    const ciRuns = await pg.handle.db.select().from(t.ciRuns);
    expect(ciRuns).toHaveLength(2);
    const ciAgentRuns = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.source, 'ci'));
    expect(ciAgentRuns).toHaveLength(2);

    const ok = ciRuns.find((r) => r.githubRunId === 7001)!;
    expect(ok).toMatchObject({ status: 'succeeded', verdict: 'REQUEST_CHANGES', findingsCount: 1, reportedFindingsCount: 2, verification: 'verified', ciInstallationId: inst.id });
    const [ar] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, ok.agentRunId!));
    const [pull] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, ws), eq(t.pullRequests.number, PR)));
    expect(ar).toMatchObject({ source: 'ci', status: 'done', agentId: secId, workspaceId: ws, prId: pull!.id, blockers: 1, findingsCount: 1 });
    const traces = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, ar!.id));
    expect(traces).toHaveLength(1);
    expect((traces[0]!.trace as { config: Record<string, unknown> }).config).toMatchObject({
      source: 'ci',
      commit_sha: HEAD,
      base_sha: BASE,
      version: '42',
      model: 'deepseek/deepseek-v4-flash',
      dependencies: { 'agent-runner': '2', 'reviewer-core': '0.0.0' },
    });

    const failed = ciRuns.find((r) => r.githubRunId === 7002)!;
    expect(failed).toMatchObject({ status: 'failed', verdict: null, findingsCount: null });

    const overview = (await get(`/agents/${secId}/ci`)).json();
    expect(overview.installations[0].last_run).toMatchObject({ status: 'succeeded', verification: 'verified' });
    expect(overview.recent_runs).toHaveLength(2);
  });

  it('GET /ci/runs filters by window, agent, repo and status', async () => {
    const ids = async (qs: string) => {
      const res = await get(`/ci/runs${qs}`);
      expect(res.statusCode).toBe(200);
      return (res.json() as { github_url: string }[]).map((r) => r.github_url.split('/').pop()).sort();
    };
    expect(await ids('')).toEqual(['7001', '7002']);
    expect(await ids('?days=1')).toEqual(['7001']);
    expect(await ids('?status=failed')).toEqual(['7002']);
    expect(await ids(`?agent_id=${secId}`)).toEqual(['7001', '7002']);
    expect(await ids(`?agent_id=${perfId}`)).toEqual([]);
    expect(await ids('?repo=acme/unrelated')).toEqual([]);
    const [row] = (await get('/ci/runs?status=succeeded')).json();
    expect(row).toMatchObject({ repo: REPO, repo_id: repoId, agent: 'Security Reviewer', manifest_version: 42, grounding: '1/2 passed' });
  });

  // -------------------------------------------------------------------------
  // repository: atomicity + scoping
  // -------------------------------------------------------------------------

  it('ingestRun rolls back the agent_runs row when github_run_id is a duplicate', async () => {
    const inst = (await installationRow(secId))!;
    const countCi = async () => (await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.source, 'ci'))).length;
    const before = await countCi();
    const result = await repo.ingestRun({
      workspaceId: ws,
      agentId: secId,
      prId: null,
      provider: null,
      model: null,
      status: 'failed',
      ranAt: new Date(),
      durationMs: null,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      findingsCount: null,
      grounding: null,
      blockers: null,
      error: 'x',
      trace: buildCiRunTrace({
        agentName: 'a', manifestVersion: null, provider: null, model: 'unknown', prNumber: null, headSha: HEAD,
        baseSha: null, manifestSha256: null, runnerVersion: null, dependencies: null, jobUrl: 'u',
        verification: 'unverified', durationMs: 0, tokensIn: 0, tokensOut: 0, costUsd: null, findings: 0,
        grounding: 'n/a', log: [],
      }),
      ciRun: {
        ciInstallationId: inst.id, prNumber: null, status: 'failed', githubRunId: 7001, githubRunAttempt: 1,
        repo: REPO, headSha: HEAD, jobUrl: 'u', verdict: null, verification: 'unverified', durationMs: null,
        reportedFindingsCount: null, findingsCount: null, costUsd: null,
      },
    });
    expect(result).toBe('duplicate');
    expect(await countCi()).toBe(before);
    expect(await pg.handle.db.select().from(t.ciRuns)).toHaveLength(2);
  });

  it('workspace scoping: another workspace sees none of it, and its agents are 404 here', async () => {
    const inst = (await installationRow(secId))!;
    expect(await repo.listRuns(otherWs, { days: 90 })).toEqual([]);
    expect(await repo.listInstallations(otherWs, { target: 'gha' })).toEqual([]);
    expect(await repo.getInstallation(otherWs, inst.id)).toBeUndefined();
    expect(await repo.getInstallation(ws, inst.id)).toMatchObject({ id: inst.id });
    expect(await repo.listInstallationsForAgent(otherWs, secId)).toEqual([]);
    expect(await repo.listInstallationsForRepo(otherWs, REPO)).toEqual([]);
    await expect(
      repo.upsertInstallation(otherWs, {
        agentId: secId, repo: REPO, targetType: 'gha', repoId: null, agentSlug: 'x', postAs: 'none', triggers: ['opened'],
        workflowPath: 'p', workflowYaml: 'y', workflowVersion: 1, manifestVersion: 1, manifestSha256: 'm',
        runnerVersion: 'r', runnerSha256: 'r', expectedBlobs: {}, branch: null, prUrl: null,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await installationRow(secId))!.agentSlug).toBe('security-reviewer');

    const mem = (await repo.listMemoryForExport(otherWs, null)).map((m) => m.content);
    expect(mem).toEqual(['MEM-OTHER-WORKSPACE']);
    const mine = (await repo.listMemoryForExport(ws, repoId)).map((m) => m.content);
    expect(mine).toEqual(expect.arrayContaining(['MEM-GLOBAL', 'MEM-THIS-REPO']));
    expect(mine).not.toContain('MEM-OTHER-REPO');
    expect(mine).not.toContain('MEM-OTHER-WORKSPACE');

    const before = gh.committed.length;
    expect((await get(`/agents/${otherWsAgentId}/ci`)).statusCode).toBe(404);
    expect((await post(`/agents/${otherWsAgentId}/ci/preview`, { repo: REPO })).statusCode).toBe(404);
    expect((await post(`/agents/${otherWsAgentId}/export-ci`, { repo: REPO })).statusCode).toBe(404);
    expect((await post(`/agents/${otherWsAgentId}/ci/update`)).statusCode).toBe(404);
    expect((await get(`/agents/${otherWsAgentId}/ci/runner`)).statusCode).toBe(404);
    expect((await get(`/ci/runs?agent_id=${otherWsAgentId}`)).json()).toEqual([]);
    expect(gh.committed).toHaveLength(before);
  });

  it('GET /agents/:id/ci/runner returns the bundle for the zip download', async () => {
    const res = await get(`/agents/${secId}/ci/runner`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ path: '.devdigest/runner.mjs', version: '2', sha256: 'mock-runner-sha256' });
  });
});
