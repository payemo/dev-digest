import { createHash } from 'node:crypto';
import {
  MemoryItem,
  type CiInstallation,
  type CiRejectReason,
  type CiResultArtifact,
  type CiRun,
  type CiRunStatus,
  type CiVerdict,
  type CiVerification,
  type RunLogLine,
  type RunTrace,
  type WorkflowRunInfo,
} from '@devdigest/shared';
import {
  CI_MEMORY_MAX_ITEMS,
  CI_MEMORY_PATH,
  CI_RESERVED_DIRS,
  CI_RUNNER_PATH,
} from './constants.js';
import { ValidationError } from '../../platform/errors.js';
import type {
  CiInstallationRow,
  CiInstallationWithLastRun,
  CiRunListRow,
  MemoryRow,
} from './repository.js';

/*
 * Pure functions for the ci module: export path/slug rules, hashing, memory
 * serialization, DTO mapping and the ingest's per-run decisions. Data in, data
 * out — no I/O and no access to the composition root.
 */

// ---- slugs + exported paths --------------------------------------------------

/** A flat, file-name-safe slug (manifest, skill and workflow names). */
export const CI_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Kebab-case `name` into a slug that is unique within `taken` and never one of
 * the reserved project-context directory names. Adds the result to `taken`.
 */
export function ciSlug(name: string, taken: Set<string>): string {
  let base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
  if (!base) base = 'agent';
  const blocked = (s: string) =>
    taken.has(s) || (CI_RESERVED_DIRS as readonly string[]).includes(s);
  let slug = base;
  for (let n = 2; blocked(slug); n++) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

export function ciAgentManifestPath(slug: string): string {
  return `.devdigest/agents/${slug}.yaml`;
}

export function ciSkillPath(slug: string): string {
  return `.devdigest/skills/${slug}.md`;
}

/** One workflow per agent, so several agents can share a repository. */
export function ciWorkflowPath(agentSlug: string): string {
  return `.github/workflows/devdigest-review-${agentSlug}.yml`;
}

const SAFE_EXPORT_PATHS: RegExp[] = [
  /^\.devdigest\/agents\/[a-z0-9][a-z0-9-]{0,62}\.yaml$/,
  /^\.devdigest\/skills\/[a-z0-9][a-z0-9-]{0,62}\.md$/,
  /^\.github\/workflows\/devdigest-review-[a-z0-9][a-z0-9-]{0,62}\.yml$/,
];

/**
 * The export may only ever write these paths: the agent manifest, skills,
 * memory, the runner bundle and its own workflow. Anything else (traversal,
 * absolute paths, the project-context directories) is refused.
 */
export function assertSafeExportPath(path: string): void {
  const ok =
    !path.startsWith('/') &&
    !path.split('/').includes('..') &&
    (path === CI_MEMORY_PATH ||
      path === CI_RUNNER_PATH ||
      SAFE_EXPORT_PATHS.some((re) => re.test(path)));
  if (!ok) throw new ValidationError(`refusing to export unsafe path: ${path}`);
}

// ---- hashing -------------------------------------------------------------------

/** Git's blob id: sha1("blob <byteLength>\0<content>"). */
export function gitBlobSha(content: string): string {
  const body = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${body.byteLength}\0`, 'utf8'), body]))
    .digest('hex');
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function byteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

// ---- memory.jsonl ----------------------------------------------------------------

/**
 * One `MemoryItem` JSON object per line. Rows whose stored `sources` do not
 * match the contract keep their content with an empty source list; rows that
 * still fail validation are left out rather than exported malformed.
 */
export function toMemoryJsonl(rows: MemoryRow[]): string {
  const lines: string[] = [];
  for (const row of rows.slice(0, CI_MEMORY_MAX_ITEMS)) {
    const base = {
      content: row.content,
      scope: row.scope,
      kind: row.kind,
      confidence: row.confidence ?? 0.5,
    };
    const parsed =
      MemoryItem.safeParse({ ...base, sources: row.sources ?? [] }).data ??
      MemoryItem.safeParse({ ...base, sources: [] }).data;
    if (parsed) lines.push(JSON.stringify(parsed));
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

// ---- DTO mapping ---------------------------------------------------------------

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

const RUN_STATUSES: readonly CiRunStatus[] = ['succeeded', 'failed', 'no_findings', 'running'];

function asRunStatus(s: string | null): CiRunStatus | null {
  return s && (RUN_STATUSES as readonly string[]).includes(s) ? (s as CiRunStatus) : null;
}

export function toCiInstallationDto(
  row: CiInstallationRow | CiInstallationWithLastRun,
  outdated: boolean | null = null,
): CiInstallation {
  const lastRun = 'lastRun' in row ? row.lastRun : null;
  const lastStatus = lastRun ? asRunStatus(lastRun.status) : null;
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    repo_id: row.repoId,
    post_as: row.postAs,
    triggers: row.triggers.filter(
      (t): t is 'opened' | 'synchronize' | 'reopened' =>
        t === 'opened' || t === 'synchronize' || t === 'reopened',
    ),
    workflow_path: row.workflowPath,
    workflow_version: row.workflowVersion,
    manifest_version: row.manifestVersion,
    runner_version: row.runnerVersion,
    branch: row.branch,
    pr_url: row.prUrl,
    updated_at: iso(row.updatedAt),
    outdated,
    last_run:
      lastRun && lastStatus
        ? { status: lastStatus, ran_at: iso(lastRun.ranAt), verification: lastRun.verification }
        : null,
  };
}

const VERDICTS: readonly CiVerdict[] = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];

export function toCiRunDto(r: CiRunListRow): CiRun {
  const run = r.run;
  const manifestVersion = r.manifestVersion != null ? Number.parseInt(r.manifestVersion, 10) : NaN;
  return {
    id: run.id,
    ci_installation_id: run.ciInstallationId,
    pr_number: run.prNumber,
    ran_at: iso(run.ranAt),
    status: run.status,
    findings_count: run.findingsCount,
    cost_usd: run.costUsd,
    github_url: run.githubUrl,
    source: run.source,
    agent: r.agentName,
    duration_s: run.durationMs != null ? run.durationMs / 1000 : null,
    agent_id: r.agentId,
    agent_run_id: run.agentRunId,
    repo: run.repo,
    repo_id: r.repoId,
    verdict: (VERDICTS as readonly string[]).includes(run.verdict ?? '')
      ? (run.verdict as CiVerdict)
      : null,
    duration_ms: run.durationMs,
    job_url: run.jobUrl,
    head_sha: run.headSha,
    model: r.model,
    manifest_version: Number.isFinite(manifestVersion) ? manifestVersion : null,
    verification: run.verification,
    grounding: r.grounding,
    reported_findings_count: run.reportedFindingsCount,
  };
}

// ---- ingest decisions --------------------------------------------------------

export type RunPrecheck =
  | { kind: 'ok' }
  | { kind: 'skip' }
  | { kind: 'reject'; reason: CiRejectReason };

const sameRepo = (a: string | null | undefined, b: string) =>
  a != null && a.toLowerCase() === b.toLowerCase();

/**
 * Security checks I2–I6 on a listed workflow run, in order. A run that is not
 * finished yet is skipped (picked up by a later sync), never rejected.
 */
export function precheckRun(
  run: WorkflowRunInfo,
  inst: Pick<CiInstallationRow, 'repo' | 'workflowPath'>,
): RunPrecheck {
  if (!sameRepo(run.repository_full_name, inst.repo)) return { kind: 'reject', reason: 'repo_mismatch' };
  if (!sameRepo(run.head_repository_full_name, inst.repo)) return { kind: 'reject', reason: 'fork_run' };
  if (run.event !== 'pull_request') return { kind: 'reject', reason: 'wrong_event' };
  if (run.path !== inst.workflowPath) return { kind: 'reject', reason: 'wrong_workflow' };
  if (run.status !== 'completed') return { kind: 'skip' };
  return { kind: 'ok' };
}

/** I9: the artifact must describe exactly this run, of this installation's agent. */
export function artifactMatchesRun(
  artifact: CiResultArtifact,
  run: WorkflowRunInfo,
  inst: Pick<CiInstallationRow, 'agentSlug'>,
): boolean {
  if (artifact.head_sha !== run.head_sha) return false;
  if (artifact.github_run_id != null && artifact.github_run_id !== run.id) return false;
  if (artifact.agent_slug !== inst.agentSlug) return false;
  return true;
}

/** V1: every exported path must still have the blob the studio wrote. */
export function verifyBlobs(
  expected: Record<string, string> | null | undefined,
  actual: Record<string, string | null>,
): CiVerification {
  const entries = Object.entries(expected ?? {});
  if (entries.length === 0) return 'unverified';
  return entries.every(([path, sha]) => actual[path] === sha) ? 'verified' : 'unverified';
}

/** The review event the deterministic gate yields (mirrors `toReviewPayload`). */
export function ciVerdict(findingsCount: number, gate: boolean): CiVerdict {
  if (findingsCount === 0) return 'APPROVE';
  return gate ? 'REQUEST_CHANGES' : 'COMMENT';
}

export function ciRunStatus(status: 'done' | 'failed', findingsCount: number | null): CiRunStatus {
  if (status === 'failed') return 'failed';
  // null = the count could not be re-checked; never claim "no findings" for it.
  return findingsCount === 0 ? 'no_findings' : 'succeeded';
}

/** Prefixes the runner strips from the diff before review; re-grounding does too. */
export const CI_IGNORED_DIFF_PREFIXES = ['.devdigest/', '.github/workflows/'] as const;

export interface CiTraceInput {
  agentName: string;
  manifestVersion: number | null;
  provider: string | null;
  model: string;
  prNumber: number | null;
  headSha: string;
  baseSha: string | null;
  manifestSha256: string | null;
  runnerVersion: string | null;
  dependencies: Record<string, string> | null;
  jobUrl: string;
  verification: CiVerification;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  findings: number;
  grounding: string;
  log: string[];
}

/**
 * The `run_traces` document for a CI run. The prompt was assembled inside CI
 * and is never transmitted, so the prompt/tool/output slots stay empty; the
 * provenance (commit, manifest hash, runner + dependency versions, job link,
 * verification) is what the trace records.
 */
export function buildCiRunTrace(input: CiTraceInput): RunTrace {
  const log: RunLogLine[] = input.log.map((msg) => ({ t: '00.00', kind: 'info', msg }));
  return {
    config: {
      agent: input.agentName,
      version: input.manifestVersion != null ? String(input.manifestVersion) : null,
      provider: input.provider,
      model: input.model,
      pr: input.prNumber,
      source: 'ci',
      commit_sha: input.headSha,
      base_sha: input.baseSha,
      manifest_sha256: input.manifestSha256,
      runner_version: input.runnerVersion,
      dependencies: input.dependencies,
      ci_job_url: input.jobUrl,
      verification: input.verification,
    },
    stats: {
      duration_ms: input.durationMs,
      tokens_in: input.tokensIn,
      tokens_out: input.tokensOut,
      cost_usd: input.costUsd,
      findings: input.findings,
      grounding: input.grounding,
    },
    prompt_assembly: { system: '', user: '' },
    tool_calls: [],
    raw_output: '',
    memory_pulled: [],
    specs_read: [],
    log,
  };
}
