/**
 * Export to CI — the pure rules (spec 05, plan S16 "server unit, helpers").
 *
 * Kinds of breakage covered: an exported path escaping the allow-list, slug
 * collisions with another agent or a project-context directory, a git blob id
 * that no longer matches what GitHub reports (V1 would mark every run
 * unverified), the ingest's I2–I6/I9 decisions, the null-count status rule,
 * a manifest the runner could not read back, and a workflow that loses its
 * fork guard / least-privilege permissions / always-upload step or lets an
 * agent name inject YAML.
 */
import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import { AgentManifest, RunTrace, type WorkflowRunInfo } from '@devdigest/shared';
import {
  artifactMatchesRun,
  assertSafeExportPath,
  buildCiRunTrace,
  ciAgentManifestPath,
  ciRunStatus,
  ciSkillPath,
  ciSlug,
  ciVerdict,
  ciWorkflowPath,
  gitBlobSha,
  precheckRun,
  toCiInstallationDto,
  toCiRunDto,
  toMemoryJsonl,
  verifyBlobs,
} from '../src/modules/ci/helpers.js';
import { buildManifestYaml, type ManifestAgent } from '../src/modules/ci/manifest.js';
import { buildWorkflowYaml, validateWorkflowYaml } from '../src/modules/ci/workflow.js';
import { CI_MEMORY_PATH, CI_RUNNER_PATH } from '../src/modules/ci/constants.js';
import { ValidationError } from '../src/platform/errors.js';
import type {
  CiInstallationRow,
  CiRunListRow,
  MemoryRow,
} from '../src/modules/ci/repository.js';

// ---------------------------------------------------------------------------
// slugs + paths
// ---------------------------------------------------------------------------

describe('ciSlug', () => {
  it('kebab-cases the name and suffixes collisions within the same repo', () => {
    const taken = new Set<string>();
    expect(ciSlug('Security Reviewer', taken)).toBe('security-reviewer');
    expect(ciSlug('Security  Reviewer!', taken)).toBe('security-reviewer-2');
    expect(ciSlug('security reviewer', taken)).toBe('security-reviewer-3');
    expect([...taken]).toEqual(['security-reviewer', 'security-reviewer-2', 'security-reviewer-3']);
  });

  it('never takes a reserved project-context directory name', () => {
    for (const reserved of ['specs', 'docs', 'insights']) {
      const slug = ciSlug(reserved.toUpperCase(), new Set());
      expect(slug).toBe(`${reserved}-2`);
    }
  });

  it('falls back to "agent" for a name with no slug characters, and stays a valid flat slug', () => {
    expect(ciSlug('!!! ???', new Set())).toBe('agent');
    const long = ciSlug('x'.repeat(200), new Set());
    expect(long).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
  });
});

describe('assertSafeExportPath', () => {
  it('accepts exactly the paths the export generates', () => {
    for (const p of [
      ciAgentManifestPath('security-reviewer'),
      ciSkillPath('owasp-top-10'),
      ciWorkflowPath('security-reviewer'),
      CI_MEMORY_PATH,
      CI_RUNNER_PATH,
    ]) {
      expect(() => assertSafeExportPath(p), p).not.toThrow();
    }
  });

  it('refuses traversal, absolute paths, project-context dirs and anything else', () => {
    for (const p of [
      '.devdigest/agents/../../etc/passwd.yaml',
      '../.devdigest/runner.mjs',
      '/.devdigest/runner.mjs',
      '/etc/passwd',
      '.devdigest/docs/x.md',
      '.devdigest/specs/x.md',
      '.devdigest/insights/x.md',
      '.devdigest/agents/Upper.yaml',
      '.devdigest/skills/nested/x.md',
      '.github/workflows/deploy.yml',
      'package.json',
    ]) {
      expect(() => assertSafeExportPath(p), p).toThrow(ValidationError);
    }
  });
});

// ---------------------------------------------------------------------------
// hashing + memory
// ---------------------------------------------------------------------------

describe('gitBlobSha', () => {
  it('matches the ids `git hash-object` produces', () => {
    expect(gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('hashes by UTF-8 byte length, not string length', () => {
    // "é" is 1 UTF-16 unit but 2 bytes; `printf 'é\n' | git hash-object --stdin`
    expect(gitBlobSha('é\n')).toBe('c6003325155f475bd7c87731607525dce73be9cf');
  });
});

function memRow(o: Partial<MemoryRow>): MemoryRow {
  return {
    id: 'm',
    workspaceId: 'w',
    repoId: null,
    scope: 'global',
    kind: 'convention',
    content: 'Use zod at the route boundary',
    embedding: null,
    confidence: 0.9,
    sources: [{ pr: 12, context: 'review' }],
    createdAt: new Date(),
    updatedAt: new Date(),
    lastUsedAt: null,
    ...o,
  } as MemoryRow;
}

describe('toMemoryJsonl', () => {
  it('writes one MemoryItem per line, keeping content when stored sources are malformed', () => {
    const text = toMemoryJsonl([
      memRow({ content: 'first' }),
      memRow({ content: 'second', sources: { not: 'an array' } as unknown as MemoryRow['sources'], confidence: null }),
    ]);
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.trimEnd().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { content: 'first', scope: 'global', kind: 'convention', confidence: 0.9, sources: [{ pr: 12, context: 'review' }] },
      { content: 'second', scope: 'global', kind: 'convention', confidence: 0.5, sources: [] },
    ]);
  });

  it('drops a row that cannot be a MemoryItem, caps at 200 lines, and is empty for no rows', () => {
    const bad = memRow({ kind: 'nonsense' as MemoryRow['kind'] });
    expect(toMemoryJsonl([bad])).toBe('');
    expect(toMemoryJsonl([])).toBe('');
    const many = Array.from({ length: 250 }, (_, i) => memRow({ content: `m${i}` }));
    const lines = toMemoryJsonl(many).trimEnd().split('\n');
    expect(lines).toHaveLength(200);
    expect(JSON.parse(lines[199]!).content).toBe('m199');
  });
});

// ---------------------------------------------------------------------------
// ingest decisions
// ---------------------------------------------------------------------------

const WF = '.github/workflows/devdigest-review-sec.yml';
const INST = { repo: 'acme/api', workflowPath: WF, agentSlug: 'sec' };

function run(o: Partial<WorkflowRunInfo> = {}): WorkflowRunInfo {
  return {
    id: 101,
    run_attempt: 1,
    html_url: 'https://github.com/acme/api/actions/runs/101',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_sha: 'h'.repeat(40),
    path: WF,
    repository_full_name: 'acme/api',
    head_repository_full_name: 'acme/api',
    pull_numbers: [7],
    created_at: '2026-10-01T10:00:00Z',
    run_started_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:01:00Z',
    ...o,
  };
}

describe('precheckRun (I2–I6)', () => {
  it('accepts a finished same-repo pull_request run of the installed workflow (repo compared case-insensitively)', () => {
    expect(precheckRun(run({ repository_full_name: 'ACME/Api', head_repository_full_name: 'Acme/API' }), INST)).toEqual({
      kind: 'ok',
    });
  });

  it.each([
    ['repo_mismatch', { repository_full_name: 'evil/api' }],
    ['fork_run', { head_repository_full_name: 'forker/api' }],
    ['fork_run', { head_repository_full_name: null }],
    ['wrong_event', { event: 'pull_request_target' }],
    ['wrong_workflow', { path: '.github/workflows/other.yml' }],
  ] as const)('rejects %s', (reason, o) => {
    expect(precheckRun(run(o), INST)).toEqual({ kind: 'reject', reason });
  });

  it('checks in order: a foreign-repo run is repo_mismatch even when everything else is wrong too', () => {
    expect(
      precheckRun(run({ repository_full_name: 'evil/api', event: 'push', path: 'x.yml', status: 'queued' }), INST),
    ).toEqual({ kind: 'reject', reason: 'repo_mismatch' });
  });

  it('skips (never rejects) a run that has not completed yet', () => {
    expect(precheckRun(run({ status: 'in_progress', conclusion: null }), INST)).toEqual({ kind: 'skip' });
  });
});

describe('artifactMatchesRun (I9)', () => {
  const art = { head_sha: 'h'.repeat(40), github_run_id: 101, agent_slug: 'sec' };
  const asArt = (o: object) => ({ findings_count: 0, cost_usd: null, agent: 'Sec', ...art, ...o });

  it('matches when sha, run id and slug agree; a missing run id is tolerated', () => {
    expect(artifactMatchesRun(asArt({}), run(), INST)).toBe(true);
    expect(artifactMatchesRun(asArt({ github_run_id: null }), run(), INST)).toBe(true);
  });

  it('refuses an artifact from another commit, another run or another agent (or a v1 artifact with no sha)', () => {
    expect(artifactMatchesRun(asArt({ head_sha: 'x'.repeat(40) }), run(), INST)).toBe(false);
    expect(artifactMatchesRun(asArt({ head_sha: null }), run(), INST)).toBe(false);
    expect(artifactMatchesRun(asArt({ github_run_id: 999 }), run(), INST)).toBe(false);
    expect(artifactMatchesRun(asArt({ agent_slug: 'other' }), run(), INST)).toBe(false);
  });
});

describe('verifyBlobs (V1)', () => {
  it('is verified only when every exported path still has the exported blob', () => {
    const expected = { 'a.yaml': 'sha-a', 'b.md': 'sha-b' };
    expect(verifyBlobs(expected, { 'a.yaml': 'sha-a', 'b.md': 'sha-b' })).toBe('verified');
    expect(verifyBlobs(expected, { 'a.yaml': 'sha-a', 'b.md': 'sha-CHANGED' })).toBe('unverified');
    expect(verifyBlobs(expected, { 'a.yaml': 'sha-a', 'b.md': null })).toBe('unverified');
  });

  it('is never verified without a baseline', () => {
    expect(verifyBlobs(null, {})).toBe('unverified');
    expect(verifyBlobs({}, {})).toBe('unverified');
  });
});

describe('ciVerdict / ciRunStatus', () => {
  it('derives the review event from the count and the gate', () => {
    expect(ciVerdict(0, true)).toBe('APPROVE');
    expect(ciVerdict(2, true)).toBe('REQUEST_CHANGES');
    expect(ciVerdict(2, false)).toBe('COMMENT');
  });

  it('never claims "no findings" for a count that could not be re-checked', () => {
    expect(ciRunStatus('done', 0)).toBe('no_findings');
    expect(ciRunStatus('done', 3)).toBe('succeeded');
    expect(ciRunStatus('done', null)).toBe('succeeded');
    expect(ciRunStatus('failed', 0)).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// DTO mappers + trace
// ---------------------------------------------------------------------------

function instRow(o: Partial<CiInstallationRow> = {}): CiInstallationRow {
  return {
    id: 'i1',
    agentId: 'a1',
    repo: 'acme/api',
    targetType: 'gha',
    installedAt: new Date('2026-10-01T00:00:00Z'),
    repoId: 'r1',
    agentSlug: 'sec',
    postAs: 'github_review',
    triggers: ['opened', 'synchronize'],
    workflowPath: WF,
    workflowYaml: 'name: x',
    workflowVersion: 1,
    manifestVersion: 3,
    manifestSha256: 'm',
    runnerVersion: '2',
    runnerSha256: 'r',
    expectedBlobs: {},
    branch: 'devdigest/ci',
    prUrl: 'https://github.com/acme/api/pull/9',
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    lastSyncedAt: null,
    ...o,
  };
}

describe('DTO mappers', () => {
  it('toCiInstallationDto drops unknown stored triggers and a last run with an unknown status', () => {
    const dto = toCiInstallationDto(
      { ...instRow({ triggers: ['opened', 'labeled', 'reopened'] }), lastRun: { status: 'weird', ranAt: null, verification: null } },
      true,
    );
    expect(dto.triggers).toEqual(['opened', 'reopened']);
    expect(dto.last_run).toBeNull();
    expect(dto.outdated).toBe(true);
    expect(dto.installed_at).toBe('2026-10-01T00:00:00.000Z');

    const withRun = toCiInstallationDto({
      ...instRow(),
      lastRun: { status: 'failed', ranAt: new Date('2026-10-03T00:00:00Z'), verification: 'unverified' },
    });
    expect(withRun.last_run).toEqual({ status: 'failed', ran_at: '2026-10-03T00:00:00.000Z', verification: 'unverified' });
  });

  it('toCiRunDto parses the trace manifest version and nulls an unknown verdict', () => {
    const base: CiRunListRow = {
      run: {
        id: 'c1',
        ciInstallationId: 'i1',
        prNumber: 7,
        ranAt: new Date('2026-10-01T10:00:00Z'),
        status: 'succeeded',
        findingsCount: null,
        costUsd: 0.01,
        githubUrl: 'https://github.com/acme/api/actions/runs/101',
        source: 'gha',
        agentRunId: 'ar1',
        githubRunId: 101,
        githubRunAttempt: 1,
        repo: 'acme/api',
        headSha: 'h',
        jobUrl: 'https://github.com/acme/api/actions/runs/101',
        verdict: 'REQUEST_CHANGES',
        verification: 'verified',
        durationMs: 1500,
        reportedFindingsCount: 4,
      },
      agentId: 'a1',
      agentName: 'Sec',
      model: 'm',
      grounding: 'not rechecked',
      manifestVersion: '3',
      repoId: null,
    };
    const dto = toCiRunDto(base);
    expect(dto).toMatchObject({
      manifest_version: 3,
      verdict: 'REQUEST_CHANGES',
      duration_s: 1.5,
      findings_count: null,
      reported_findings_count: 4,
      ran_at: '2026-10-01T10:00:00.000Z',
    });
    const odd = toCiRunDto({ ...base, manifestVersion: null, run: { ...base.run, verdict: 'LGTM', durationMs: null } });
    expect(odd.manifest_version).toBeNull();
    expect(odd.verdict).toBeNull();
    expect(odd.duration_s).toBeNull();
  });

  it('buildCiRunTrace produces a valid RunTrace that records CI provenance and no prompt', () => {
    const trace = buildCiRunTrace({
      agentName: 'Sec',
      manifestVersion: 3,
      provider: 'openrouter',
      model: 'deepseek/x',
      prNumber: 7,
      headSha: 'head',
      baseSha: 'base',
      manifestSha256: 'msha',
      runnerVersion: '2',
      dependencies: { 'reviewer-core': '0.1.0' },
      jobUrl: 'https://github.com/acme/api/actions/runs/101',
      verification: 'unverified',
      durationMs: 1200,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.002,
      findings: 1,
      grounding: '1/2 passed',
      log: ['a', 'b'],
    });
    const parsed = RunTrace.parse(trace);
    expect(parsed.config).toMatchObject({
      source: 'ci',
      version: '3',
      commit_sha: 'head',
      base_sha: 'base',
      manifest_sha256: 'msha',
      ci_job_url: 'https://github.com/acme/api/actions/runs/101',
      verification: 'unverified',
      dependencies: { 'reviewer-core': '0.1.0' },
    });
    expect(parsed.prompt_assembly).toEqual({ system: '', user: '' });
    expect(parsed.log.map((l) => l.msg)).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// manifest
// ---------------------------------------------------------------------------

const AGENT: ManifestAgent = {
  name: 'Security: "Reviewer"',
  version: 4,
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'You review.\n# not a comment\n---\nkey: value\n  indented: yes\n',
  strategy: 'single-pass',
  ciFailOn: 'warning',
};

describe('buildManifestYaml', () => {
  it('round-trips through YAML + AgentManifest exactly as the runner reads it', () => {
    const text = buildManifestYaml(AGENT, ['owasp', 'secrets']);
    expect(text.startsWith('# generated by DevDigest — agent v4\n')).toBe(true);
    const back = AgentManifest.parse(YAML.parse(text));
    expect(back).toEqual({
      name: 'Security: "Reviewer"',
      version: 4,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      system_prompt: AGENT.systemPrompt,
      skills: ['owasp', 'secrets'],
      strategy: 'single-pass',
      ci_fail_on: 'warning',
    });
  });

  it('refuses an agent the runner would reject', () => {
    expect(() => buildManifestYaml({ ...AGENT, model: '' }, [])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// workflow
// ---------------------------------------------------------------------------

type Step = { uses?: string; run?: string; if?: string; name?: string; with?: Record<string, unknown>; env?: Record<string, string> };

function parseWorkflow(text: string) {
  const doc = YAML.parse(text) as {
    name: string;
    on: { pull_request: { types: string[] } };
    permissions: Record<string, string>;
    jobs: Record<string, { if: string; steps: Step[] }>;
  };
  return { doc, steps: doc.jobs.review!.steps };
}

describe('buildWorkflowYaml', () => {
  const text = buildWorkflowYaml({
    agentName: 'Security Reviewer',
    agentSlug: 'sec',
    triggers: ['reopened', 'opened'],
    postAs: 'pr_comment',
  });
  const { doc, steps } = parseWorkflow(text);

  it('runs the bundled runner for this slug on the chosen triggers, in canonical order', () => {
    expect(doc.on).toEqual({ pull_request: { types: ['opened', 'reopened'] } });
    const review = steps.find((s) => s.run)!;
    expect(review.run).toBe('node .devdigest/runner.mjs review --agent sec');
    expect(review.env!.DEVDIGEST_POST_AS).toBe('pr_comment');
    expect(text).not.toContain('devdigest/review-action');
  });

  it('is least-privilege: read-only contents, no persisted credentials, forks skipped, only two secrets', () => {
    expect(doc.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(doc.jobs.review!.if).toBe('github.event.pull_request.head.repo.full_name == github.repository');
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout'))!;
    expect(checkout.with).toEqual({ 'persist-credentials': false });
    const node = steps.find((s) => s.uses?.startsWith('actions/setup-node'))!;
    expect(node.with!['node-version']).toBe('22');
    const secrets = new Set([...text.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]));
    expect([...secrets].sort()).toEqual(['GITHUB_TOKEN', 'OPENROUTER_API_KEY']);
  });

  it('uploads the result artifact even when the review step fails', () => {
    const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'))!;
    expect(upload.if).toBe('always()');
    expect(upload.with).toMatchObject({ name: 'devdigest-result', path: 'devdigest-result.json' });
  });

  it('keeps a hostile agent name inside the name value', () => {
    const evil = 'x"\non:\n  push: {}\npermissions: write-all\n#';
    const { doc: d } = parseWorkflow(
      buildWorkflowYaml({ agentName: evil, agentSlug: 'sec', triggers: ['opened'], postAs: 'none' }),
    );
    expect(d.name).toBe(`DevDigest review — ${evil}`);
    expect(d.on).toEqual({ pull_request: { types: ['opened'] } });
    expect(d.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('refuses a slug that is not a flat file name (it lands in a shell command)', () => {
    for (const slug of ['../x', 'a b', 'sec; rm -rf /', 'Sec', '']) {
      expect(() => buildWorkflowYaml({ agentName: 'n', agentSlug: slug, triggers: ['opened'], postAs: 'none' }), slug).toThrow(
        ValidationError,
      );
    }
  });
});

describe('validateWorkflowYaml', () => {
  const good = buildWorkflowYaml({ agentName: 'S', agentSlug: 'sec', triggers: ['opened'], postAs: 'none' });

  it('accepts the generated workflow and a harmless edit', () => {
    expect(validateWorkflowYaml(good, 'sec')).toEqual({ errors: [], warnings: [] });
    expect(validateWorkflowYaml(good.replace('timeout-minutes: 15', 'timeout-minutes: 30'), 'sec')).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('errors on invalid YAML, a non-mapping document, a lost runner invocation, or an oversized file', () => {
    expect(validateWorkflowYaml('on: [unclosed', 'sec').errors[0]).toMatch(/not valid YAML/);
    expect(validateWorkflowYaml('- a\n- b\n', 'sec').errors).toEqual(['workflow must be a YAML mapping']);
    expect(validateWorkflowYaml('just a string', 'sec').errors).toEqual(['workflow must be a YAML mapping']);
    expect(validateWorkflowYaml(good.replace('review --agent sec', 'echo hi'), 'sec').errors[0]).toMatch(
      /must still run "node \.devdigest\/runner\.mjs review --agent sec"/,
    );
    // The invocation must be for THIS agent's slug.
    expect(validateWorkflowYaml(good, 'other').errors).toHaveLength(1);
    expect(validateWorkflowYaml(`${good}#${'x'.repeat(20_001)}`, 'sec').errors[0]).toMatch(/longer than/);
  });

  it('only warns (never errors) when no "devdigest-result" upload remains anywhere in the file', () => {
    const noUpload = good
      .slice(0, good.indexOf('      - name: Upload DevDigest result'))
      .split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n');
    const v = validateWorkflowYaml(noUpload, 'sec');
    expect(v.errors).toEqual([]);
    expect(v.warnings).toHaveLength(1);
    expect(v.warnings[0]).toMatch(/devdigest-result/);
  });

  // The generated header comment also names "devdigest-result", so the check
  // must look at the parsed upload step, not at the text.
  it('warns when only the upload step is removed and the generated header comment is kept', () => {
    const noUpload = good.slice(0, good.indexOf('      - name: Upload DevDigest result'));
    expect(validateWorkflowYaml(noUpload, 'sec').warnings).toHaveLength(1);
  });
});
