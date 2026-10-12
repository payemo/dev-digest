/**
 * CiIngestService — pulling GitHub Actions runs back into the studio (spec 05,
 * security model I1–I10, V1–V2). Hermetic: GitHub is `MockGitHubClient`, the
 * repository is an in-memory fake at the service seam (the real SQL of
 * `ingestRun` is exercised in `ci.it.test.ts`).
 *
 * Kinds of breakage covered: a forged/foreign/fork run reaching the DB, an
 * oversized or malformed artifact being parsed, the artifact's self-reported
 * verdict/count/base being trusted, a changed exported file not flagging the
 * run, a re-sync double-counting, a hard-failed CI run vanishing, one broken
 * repo aborting the sync of the others, and concurrent syncs racing.
 */
import { describe, it, expect } from 'vitest';
import type {
  CiResultArtifact,
  Finding,
  GitHubClient,
  RepoRef,
  WorkflowArtifactInfo,
  WorkflowRunInfo,
} from '@devdigest/shared';
import { MockGitHubClient, type MockGitHubOptions } from '../src/adapters/mocks.js';
import { CiIngestService } from '../src/modules/ci/ingest.js';
import { CI_FAILED_NO_ARTIFACT_ERROR } from '../src/modules/ci/constants.js';
import { gitBlobSha } from '../src/modules/ci/helpers.js';
import type {
  CiInstallationRow,
  CiRepository,
  IngestRunValues,
} from '../src/modules/ci/repository.js';
import type { Container } from '../src/platform/container.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const WF = '.github/workflows/devdigest-review-sec.yml';
const MANIFEST_PATH = '.devdigest/agents/sec.yaml';
const SKILL_PATH = '.devdigest/skills/owasp.md';
const EXPECTED_BLOBS = { [MANIFEST_PATH]: gitBlobSha('manifest'), [SKILL_PATH]: gitBlobSha('skill') };

/** src/app.ts line 2 is added; .devdigest/agents/sec.yaml line 1 is added too. */
const DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const key = 'sk_live_123';
 export default a;
diff --git a/.devdigest/agents/sec.yaml b/.devdigest/agents/sec.yaml
--- a/.devdigest/agents/sec.yaml
+++ b/.devdigest/agents/sec.yaml
@@ -0,0 +1,1 @@
+name: sec
`;

function finding(o: Partial<Finding>): Finding {
  return {
    id: 'f',
    severity: 'CRITICAL',
    category: 'security',
    title: 't',
    file: 'src/app.ts',
    start_line: 2,
    end_line: 2,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
    ...o,
  };
}

const GROUNDED = finding({ id: 'real' });
const OFF_DIFF = finding({ id: 'hallucinated', severity: 'WARNING', start_line: 99, end_line: 99 });
const IN_OWN_CONFIG = finding({ id: 'own-config', file: '.devdigest/agents/sec.yaml', start_line: 1, end_line: 1 });

function run(o: Partial<WorkflowRunInfo> = {}): WorkflowRunInfo {
  const id = o.id ?? 101;
  return {
    id,
    run_attempt: 1,
    html_url: `https://github.com/acme/api/actions/runs/${id}`,
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_sha: HEAD,
    path: WF,
    repository_full_name: 'acme/api',
    head_repository_full_name: 'acme/api',
    pull_numbers: [7],
    created_at: '2026-10-01T10:00:00Z',
    run_started_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:01:30Z',
    ...o,
  };
}

function artifact(o: Partial<CiResultArtifact> = {}): CiResultArtifact {
  return {
    format: 'devdigest-ci-result/v2',
    findings_count: 3,
    cost_usd: 0.0042,
    duration_ms: 61_000,
    agent: 'Security Reviewer',
    agent_slug: 'sec',
    manifest_version: 3,
    manifest_sha256: 'msha',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    runner_version: '2',
    dependencies: { 'agent-runner': '2' },
    head_sha: HEAD,
    // Forged: a base that would make every finding "grounded" if trusted.
    base_sha: 'f'.repeat(40),
    github_run_id: 101,
    // Forged: the gate must be recomputed server-side.
    verdict: 'APPROVE',
    blockers: 0,
    tokens_in: 1000,
    tokens_out: 200,
    findings: [GROUNDED, OFF_DIFF, IN_OWN_CONFIG],
    ...o,
  };
}

function inst(o: Partial<CiInstallationRow> = {}): CiInstallationRow {
  return {
    id: 'inst-1',
    agentId: 'agent-1',
    repo: 'acme/api',
    targetType: 'gha',
    installedAt: new Date('2026-09-30T00:00:00Z'),
    repoId: null,
    agentSlug: 'sec',
    postAs: 'github_review',
    triggers: ['opened', 'synchronize'],
    workflowPath: WF,
    workflowYaml: 'x',
    workflowVersion: 1,
    manifestVersion: 3,
    manifestSha256: 'msha',
    runnerVersion: '2',
    runnerSha256: 'rsha',
    expectedBlobs: EXPECTED_BLOBS,
    branch: 'devdigest/ci',
    prUrl: null,
    updatedAt: new Date(),
    lastSyncedAt: null,
    ...o,
  };
}

/** In-memory stand-in for CiRepository: just the methods the ingest calls. */
class FakeCiRepo {
  ingested: IngestRunValues[] = [];
  synced: string[] = [];
  listCalls = 0;
  constructor(
    public installs: CiInstallationRow[],
    private gate?: Promise<void>,
  ) {}
  async listInstallations(_ws: string, f: { installationId?: string }) {
    this.listCalls++;
    if (this.gate) await this.gate;
    return this.installs.filter((i) => !f.installationId || i.id === f.installationId);
  }
  async markSynced(id: string) {
    this.synced.push(id);
  }
  async existingGithubRunIds(ids: number[]) {
    const have = new Set(this.ingested.map((v) => v.ciRun.githubRunId));
    return new Set(ids.filter((id) => have.has(id)));
  }
  async findPullId(_ws: string, _repo: string, n: number) {
    return n === 7 ? 'pr-uuid-7' : null;
  }
  async ingestRun(v: IngestRunValues): Promise<'inserted' | 'duplicate'> {
    if (this.ingested.some((x) => x.ciRun.githubRunId === v.ciRun.githubRunId)) return 'duplicate';
    this.ingested.push(v);
    return 'inserted';
  }
}

const container = {
  agentsRepo: {
    getById: async (_ws: string, id: string) =>
      id === 'agent-1' ? { id, name: 'Security Reviewer', ciFailOn: 'critical' } : undefined,
  },
} as unknown as Container;

let wsCounter = 0;
function setup(gh: GitHubClient, repo = new FakeCiRepo([inst()])) {
  const svc = new CiIngestService(container, repo as unknown as CiRepository, async () => gh);
  // Distinct workspace per test: the single-flight map is module-global.
  const ws = `ws-${++wsCounter}`;
  return { svc, repo, ws, sync: () => svc.sync(ws) };
}

const ART: WorkflowArtifactInfo = { id: 900, name: 'devdigest-result', size_in_bytes: 2048, expired: false };

/** A GitHub where run 101 is a valid run with a valid artifact. */
function happyGh(o: MockGitHubOptions = {}) {
  return new MockGitHubClient({
    workflowRuns: [run()],
    runArtifacts: { 101: [ART] },
    artifactFiles: { 900: JSON.stringify(artifact()) },
    blobShas: { [HEAD]: { ...EXPECTED_BLOBS } },
    pullBaseShas: { 7: BASE },
    compareDiffs: { [`${BASE}...${HEAD}`]: DIFF },
    ...o,
  });
}

describe('CiIngestService — accepted runs', () => {
  it('stores a run with findings re-grounded against the GitHub base, and verdict/blockers from the agent gate', async () => {
    const { repo, sync } = setup(happyGh());
    const res = await sync();

    expect(res).toEqual({ ingested: 1, failed_runs: 0, skipped: 0, rejected: [], errors: [] });
    expect(repo.ingested).toHaveLength(1);
    const v = repo.ingested[0]!;
    // Only the finding on a real added line survives: the off-diff one and the
    // one citing DevDigest's own exported config are dropped.
    expect(v.findingsCount).toBe(1);
    expect(v.blockers).toBe(1);
    expect(v.grounding).toBe('1/3 passed');
    expect(v.ciRun.verdict).toBe('REQUEST_CHANGES'); // artifact said APPROVE
    expect(v.ciRun.reportedFindingsCount).toBe(3);
    expect(v.ciRun.findingsCount).toBe(1);
    expect(v.ciRun.status).toBe('succeeded');
    expect(v.ciRun.verification).toBe('verified');
    expect(v.trace.config.base_sha).toBe(BASE); // never the artifact's base_sha
    expect(v.trace.config.commit_sha).toBe(HEAD);
    expect(v.trace.config.source).toBe('ci');
    expect(v).toMatchObject({ status: 'done', prId: 'pr-uuid-7', agentId: 'agent-1', costUsd: 0.0042, error: null });
    expect(v.ciRun).toMatchObject({ githubRunId: 101, repo: 'acme/api', headSha: HEAD, jobUrl: run().html_url });
  });

  it('stores a zero-survivor run as no_findings / APPROVE', async () => {
    const { repo, sync } = setup(
      happyGh({ artifactFiles: { 900: JSON.stringify(artifact({ findings_count: 1, findings: [OFF_DIFF] })) } }),
    );
    await sync();
    expect(repo.ingested[0]!.ciRun).toMatchObject({ status: 'no_findings', verdict: 'APPROVE', findingsCount: 0 });
  });

  it('marks the run unverified (but still stores it) when one exported file differs at the run commit', async () => {
    const { repo, sync } = setup(
      happyGh({ blobShas: { [HEAD]: { [MANIFEST_PATH]: EXPECTED_BLOBS[MANIFEST_PATH]!, [SKILL_PATH]: gitBlobSha('edited') } } }),
    );
    const res = await sync();
    expect(res.ingested).toBe(1);
    expect(repo.ingested[0]!.ciRun.verification).toBe('unverified');
    expect(repo.ingested[0]!.trace.config.verification).toBe('unverified');
  });

  it.each([
    ['the artifact carries no findings list', { artifactFiles: { 900: JSON.stringify(artifact({ findings: null })) } }],
    ['the run has no pull request', { workflowRuns: [run({ pull_numbers: [] })] }],
    ['GitHub has no base commit for the PR', { pullBaseShas: {} }],
    ['the PR diff is unavailable or too large', { compareDiffs: {} }],
  ] as const)('leaves count/blockers/verdict empty when re-grounding is impossible: %s', async (_label, o) => {
    const { repo, sync } = setup(happyGh(o as MockGitHubOptions));
    const res = await sync();
    expect(res.ingested).toBe(1);
    const v = repo.ingested[0]!;
    expect(v.findingsCount).toBeNull();
    expect(v.blockers).toBeNull();
    expect(v.grounding).toBe('not rechecked');
    expect(v.ciRun).toMatchObject({ verdict: null, findingsCount: null, reportedFindingsCount: 3, status: 'succeeded' });
  });

  it('stores a failed CI run that uploaded no artifact as a failed run', async () => {
    const { repo, sync } = setup(happyGh({ workflowRuns: [run({ conclusion: 'failure' })], runArtifacts: {} }));
    const res = await sync();
    expect(res).toMatchObject({ ingested: 1, failed_runs: 1, rejected: [] });
    const v = repo.ingested[0]!;
    expect(v).toMatchObject({ status: 'failed', error: CI_FAILED_NO_ARTIFACT_ERROR, findingsCount: null, costUsd: null });
    expect(v.ciRun).toMatchObject({ status: 'failed', verdict: null, verification: 'verified', durationMs: 90_000 });
  });
});

describe('CiIngestService — rejected runs never reach the DB', () => {
  const cases: Array<[string, MockGitHubOptions]> = [
    ['repo_mismatch', { workflowRuns: [run({ repository_full_name: 'evil/api' })] }],
    ['fork_run', { workflowRuns: [run({ head_repository_full_name: 'forker/api' })] }],
    ['wrong_event', { workflowRuns: [run({ event: 'workflow_dispatch' })] }],
    ['wrong_workflow', { workflowRuns: [run({ path: '.github/workflows/evil.yml' })] }],
    ['artifact_missing', { runArtifacts: {} }],
    ['artifact_missing', { runArtifacts: { 101: [{ ...ART, name: 'something-else' }] } }],
    ['artifact_missing', { artifactFiles: { 900: null } }],
    ['artifact_too_large', { runArtifacts: { 101: [{ ...ART, size_in_bytes: 256 * 1024 + 1 }] } }],
    ['artifact_too_large', { artifactFiles: { 900: 'too_large' } }],
    ['artifact_invalid', { artifactFiles: { 900: '{not json' } }],
    ['artifact_invalid', { artifactFiles: { 900: JSON.stringify({ findings_count: 'many' }) } }],
    ['artifact_invalid', { runArtifacts: { 101: [ART, { ...ART, id: 901 }] } }],
    ['artifact_mismatch', { artifactFiles: { 900: JSON.stringify(artifact({ head_sha: 'c'.repeat(40) })) } }],
    ['artifact_mismatch', { artifactFiles: { 900: JSON.stringify(artifact({ github_run_id: 555 })) } }],
    ['artifact_mismatch', { artifactFiles: { 900: JSON.stringify(artifact({ agent_slug: 'other-agent' })) } }],
  ];

  it.each(cases)('%s', async (reason, o) => {
    const { repo, sync } = setup(happyGh(o));
    const res = await sync();
    expect(res.rejected).toEqual([{ installation_id: 'inst-1', github_run_id: 101, reason }]);
    expect(res.ingested).toBe(0);
    expect(repo.ingested).toHaveLength(0);
  });

  it('skips a run that has not completed (picked up by a later sync)', async () => {
    const { repo, sync } = setup(happyGh({ workflowRuns: [run({ status: 'in_progress', conclusion: null })] }));
    const res = await sync();
    expect(res).toMatchObject({ skipped: 1, ingested: 0, rejected: [] });
    expect(repo.ingested).toHaveLength(0);
  });
});

describe('CiIngestService — idempotence, isolation, single-flight', () => {
  it('ingests a github_run_id once across repeated syncs', async () => {
    const gh = happyGh();
    const repo = new FakeCiRepo([inst()]);
    const a = setup(gh, repo);
    expect((await a.sync()).ingested).toBe(1);
    const second = await a.sync();
    expect(second.ingested).toBe(0);
    expect(repo.ingested).toHaveLength(1);
  });

  it('counts a run the DB reports as duplicate (concurrent insert) as skipped, not ingested', async () => {
    const repo = new FakeCiRepo([inst()]);
    repo.existingGithubRunIds = async () => new Set(); // race: not yet visible
    repo.ingested.push({ ciRun: { githubRunId: 101 } } as IngestRunValues);
    const { sync } = setup(happyGh(), repo);
    expect(await sync()).toMatchObject({ ingested: 0, skipped: 1 });
  });

  it('one installation failing (e.g. missing Actions scope) does not abort the others', async () => {
    class PartlyBroken extends MockGitHubClient {
      override async listWorkflowRuns(repo: RepoRef, path: string, opts: { perPage: number }) {
        if (repo.owner === 'broken') throw new Error('GitHub refused to list workflow runs (HTTP 404). "Actions: read"');
        return super.listWorkflowRuns(repo, path, opts);
      }
    }
    const gh = new PartlyBroken({
      workflowRuns: [run()],
      runArtifacts: { 101: [ART] },
      artifactFiles: { 900: JSON.stringify(artifact()) },
      blobShas: { [HEAD]: { ...EXPECTED_BLOBS } },
      pullBaseShas: { 7: BASE },
      compareDiffs: { [`${BASE}...${HEAD}`]: DIFF },
    });
    const repo = new FakeCiRepo([inst({ id: 'inst-broken', repo: 'broken/repo' }), inst()]);
    const res = await setup(gh, repo).sync();
    expect(res.errors).toEqual([
      { installation_id: 'inst-broken', message: expect.stringContaining('Actions: read') },
    ]);
    expect(res.ingested).toBe(1);
    expect(repo.synced.sort()).toEqual(['inst-1', 'inst-broken']);
  });

  it('a concurrent sync of the same workspace joins the one in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const repo = new FakeCiRepo([inst()], gate);
    const { svc, ws } = setup(happyGh(), repo);
    const p1 = svc.sync(ws);
    const p2 = svc.sync(ws);
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r2).toBe(r1);
    expect(repo.listCalls).toBe(1);
    expect(repo.ingested).toHaveLength(1);
    // Once settled, a new sync runs again.
    await svc.sync(ws);
    expect(repo.listCalls).toBe(2);
  });
});
