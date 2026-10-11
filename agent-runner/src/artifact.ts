import type { Finding } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import { RunnerError } from './errors.js';

/**
 * Runner version embedded in every artifact. The studio also reads this
 * literal out of the built bundle to label installations, so keep it a plain
 * string assignment.
 */
export const RUNNER_VERSION = '2';

/** Findings carried in the artifact are capped like the contract (`max(500)`). */
const MAX_ARTIFACT_FINDINGS = 500;

/** v2 trace fields. All optional so v1 callers keep producing a valid artifact. */
export interface ArtifactTrace {
  agentSlug?: string | null;
  manifestVersion?: number | null;
  manifestSha256?: string | null;
  provider?: string | null;
  model?: string | null;
  nodeVersion?: string | null;
  dependencies?: Record<string, string> | null;
  repo?: string | null;
  headSha?: string | null;
  baseSha?: string | null;
  githubRunId?: number | null;
  githubRunAttempt?: number | null;
  /** The deterministic gate's review event (never the model's verdict). */
  verdict?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | null;
  blockers?: number | null;
  gateTriggered?: boolean | null;
  postAs?: 'github_review' | 'pr_comment' | 'none' | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
}

export interface BuildResultArtifactInput {
  findings: Finding[];
  costUsd: number | null;
  durationMs: number;
  agent: string;
  prNumber: number;
  trace?: ArtifactTrace;
}

function severityCounts(findings: Finding[]): { critical: number; warning: number; suggestion: number } {
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.critical++;
    else if (f.severity === 'WARNING') counts.warning++;
    else counts.suggestion++;
  }
  return counts;
}

/**
 * Build + validate the `devdigest-result.json` artifact (AC-26). Validated
 * against the SAME `CiResultArtifact` Zod contract the studio's ingest path
 * (T6) will `safeParse` on the way back in, so a malformed artifact fails
 * loudly here rather than silently on ingest.
 */
export function buildResultArtifact(input: BuildResultArtifactInput): CiResultArtifact {
  const counts = severityCounts(input.findings);
  const candidate = {
    findings_count: input.findings.length,
    critical: counts.critical,
    warning: counts.warning,
    suggestion: counts.suggestion,
    cost_usd: input.costUsd,
    duration_ms: input.durationMs,
    agent: input.agent,
    version: RUNNER_VERSION,
    pr_number: input.prNumber,
    ...(input.trace ? v2Fields(input.findings, input.trace) : {}),
  };
  const result = CiResultArtifact.safeParse(candidate);
  if (!result.success) {
    // Should be unreachable — every field above is shaped to the schema. If
    // this ever fires it's a genuine internal bug, not a user/config error.
    throw new RunnerError(
      `Internal error: built result artifact failed CiResultArtifact validation: ${result.error.message}`,
    );
  }
  return result.data;
}

/** The `devdigest-ci-result/v2` fields the studio ingests into the run trace. */
function v2Fields(findings: Finding[], t: ArtifactTrace) {
  return {
    format: 'devdigest-ci-result/v2' as const,
    agent_slug: t.agentSlug ?? null,
    manifest_version: t.manifestVersion ?? null,
    manifest_sha256: t.manifestSha256 ?? null,
    provider: t.provider ?? null,
    model: t.model ?? null,
    runner_version: RUNNER_VERSION,
    node_version: t.nodeVersion ?? null,
    dependencies: t.dependencies ?? null,
    repo: t.repo ?? null,
    head_sha: t.headSha ?? null,
    base_sha: t.baseSha ?? null,
    github_run_id: t.githubRunId ?? null,
    github_run_attempt: t.githubRunAttempt ?? null,
    verdict: t.verdict ?? null,
    blockers: t.blockers ?? null,
    gate_triggered: t.gateTriggered ?? null,
    post_as: t.postAs ?? null,
    tokens_in: t.tokensIn ?? null,
    tokens_out: t.tokensOut ?? null,
    findings: findings.slice(0, MAX_ARTIFACT_FINDINGS),
  };
}
