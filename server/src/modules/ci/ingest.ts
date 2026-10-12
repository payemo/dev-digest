import {
  ArtifactTooLargeError,
  CiResultArtifact,
  type CiFailOn,
  type CiRejectReason,
  type CiSyncResult,
  type CiVerdict,
  type Finding,
  type GitHubClient,
  type RepoRef,
  type WorkflowRunInfo,
} from '@devdigest/shared';
import { countBlockers, gateTriggered, groundFindings, groundingSummary } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { parseUnifiedDiff } from '../../adapters/index.js';
import {
  CI_ARTIFACT_MAX_JSON_BYTES,
  CI_ARTIFACT_MAX_ZIP_BYTES,
  CI_ARTIFACT_NAME,
  CI_FAILED_NO_ARTIFACT_ERROR,
  CI_REGROUND_MAX_DIFF_BYTES,
  CI_RESULT_FILE,
  CI_SYNC_RUNS_PER_INSTALLATION,
} from './constants.js';
import {
  artifactMatchesRun,
  buildCiRunTrace,
  CI_IGNORED_DIFF_PREFIXES,
  ciRunStatus,
  ciVerdict,
  precheckRun,
  verifyBlobs,
} from './helpers.js';
import type { CiInstallationRow, CiRepository } from './repository.js';

/** Single-flight per workspace: a concurrent sync awaits the one in flight. */
const inFlight = new Map<string, Promise<CiSyncResult>>();

type RunOutcome =
  | { kind: 'ingested'; failed: boolean }
  | { kind: 'skipped' }
  | { kind: 'rejected'; reason: CiRejectReason };

function toRepoRef(fullName: string): RepoRef {
  const [owner = '', name = ''] = fullName.split('/');
  return { owner, name };
}

/**
 * Pulls completed GitHub Actions runs of each installation's workflow back into
 * the studio via their `devdigest-result` artifact.
 *
 * Trust model: the GitHub API vouches for the run (repo, workflow file, event,
 * commit) but NOT for the artifact's content — anyone with write access can
 * change the workflow on a branch. So every run passes the checks below or is
 * rejected (I1–I10), and accepted content is still verified (V1: exported
 * blobs unchanged at the run's commit), re-grounded against the real diff
 * (V2), and its verdict/blockers recomputed here from the agent's current gate.
 * The artifact's own verdict is never used.
 */
export class CiIngestService {
  constructor(
    private container: Container,
    private repo: CiRepository,
    private github: () => Promise<GitHubClient>,
  ) {}

  sync(ws: string, opts: { installationId?: string } = {}): Promise<CiSyncResult> {
    const running = inFlight.get(ws);
    if (running) return running;
    const p = this.doSync(ws, opts).finally(() => inFlight.delete(ws));
    inFlight.set(ws, p);
    return p;
  }

  private async doSync(ws: string, opts: { installationId?: string }): Promise<CiSyncResult> {
    const result: CiSyncResult = { ingested: 0, failed_runs: 0, skipped: 0, rejected: [], errors: [] };
    // I1: runs are only ever listed from the installation's own repo + workflow.
    const installs = await this.repo.listInstallations(ws, {
      target: 'gha',
      installationId: opts.installationId,
    });
    if (installs.length === 0) return result;
    const gh = await this.github();

    for (const inst of installs) {
      try {
        await this.syncInstallation(ws, gh, inst, result);
      } catch (err) {
        // One bad repo (missing scope, deleted repo) never aborts the others.
        result.errors.push({ installation_id: inst.id, message: (err as Error).message });
      } finally {
        await this.repo.markSynced(inst.id, new Date());
      }
    }
    return result;
  }

  private async syncInstallation(
    ws: string,
    gh: GitHubClient,
    inst: CiInstallationRow,
    result: CiSyncResult,
  ): Promise<void> {
    if (!inst.workflowPath) return;
    const agent = await this.container.agentsRepo.getById(ws, inst.agentId);
    if (!agent) return;

    const ref = toRepoRef(inst.repo);
    const runs = await gh.listWorkflowRuns(ref, inst.workflowPath, {
      perPage: CI_SYNC_RUNS_PER_INSTALLATION,
    });
    const known = await this.repo.existingGithubRunIds(runs.map((r) => r.id));

    for (const run of runs) {
      if (known.has(run.id)) continue;
      const outcome = await this.ingestOne(ws, gh, ref, inst, agent.name, agent.ciFailOn, run);
      if (outcome.kind === 'ingested') {
        result.ingested++;
        if (outcome.failed) result.failed_runs++;
      } else if (outcome.kind === 'skipped') {
        result.skipped++;
      } else {
        result.rejected.push({
          installation_id: inst.id,
          github_run_id: run.id,
          reason: outcome.reason,
        });
      }
    }
  }

  private async ingestOne(
    ws: string,
    gh: GitHubClient,
    ref: RepoRef,
    inst: CiInstallationRow,
    agentName: string,
    failOn: CiFailOn,
    run: WorkflowRunInfo,
  ): Promise<RunOutcome> {
    // I2–I6.
    const pre = precheckRun(run, inst);
    if (pre.kind === 'reject') return { kind: 'rejected', reason: pre.reason };
    if (pre.kind === 'skip') return { kind: 'skipped' };

    // I7: exactly one non-expired, size-bounded result artifact.
    const artifacts = (await gh.listRunArtifacts(ref, run.id)).filter(
      (a) => a.name === CI_ARTIFACT_NAME,
    );
    const live = artifacts.filter((a) => !a.expired);
    // upload-artifact@v4 forbids duplicate names; more than one means the
    // workflow was altered to upload extra results — refuse rather than pick.
    if (artifacts.length > 1) return { kind: 'rejected', reason: 'artifact_invalid' };
    const log: string[] = [];
    const prNumber = run.pull_numbers[0] ?? null;
    const prId = prNumber != null ? await this.repo.findPullId(ws, inst.repo, prNumber) : null;
    const ranAt = new Date(run.run_started_at ?? run.created_at);
    const durationFromRun = Math.max(0, Date.parse(run.updated_at) - ranAt.getTime()) || null;

    // V1 — computed for every stored run (failed ones too), but only once the
    // run is known to be stored, so rejected runs cost no extra API calls.
    const verify = async () => {
      const v = verifyBlobs(
        inst.expectedBlobs,
        await gh.getBlobShas(ref, run.head_sha, Object.keys(inst.expectedBlobs ?? {})),
      );
      log.push(
        v === 'verified'
          ? 'verification: exported files unchanged at the run commit'
          : 'verification: exported files differ from the installed version at the run commit',
      );
      return v;
    };

    if (live.length === 0) {
      // The runner's hard-fail path uploads no artifact.
      if (run.conclusion !== 'failure') return { kind: 'rejected', reason: 'artifact_missing' };
      const verification = await verify();
      log.push('runner failed in CI before producing a result');
      const inserted = await this.repo.ingestRun({
        workspaceId: ws,
        agentId: inst.agentId,
        prId,
        provider: null,
        model: null,
        status: 'failed',
        ranAt,
        durationMs: durationFromRun,
        tokensIn: null,
        tokensOut: null,
        costUsd: null,
        findingsCount: null,
        grounding: null,
        blockers: null,
        error: CI_FAILED_NO_ARTIFACT_ERROR,
        trace: buildCiRunTrace({
          agentName,
          manifestVersion: inst.manifestVersion,
          provider: null,
          model: 'unknown',
          prNumber,
          headSha: run.head_sha,
          baseSha: null,
          manifestSha256: null,
          runnerVersion: null,
          dependencies: null,
          jobUrl: run.html_url,
          verification,
          durationMs: durationFromRun ?? 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: null,
          findings: 0,
          grounding: 'not available',
          log,
        }),
        ciRun: {
          ciInstallationId: inst.id,
          prNumber,
          status: ciRunStatus('failed', null),
          githubRunId: run.id,
          githubRunAttempt: run.run_attempt,
          repo: inst.repo,
          headSha: run.head_sha,
          jobUrl: run.html_url,
          verdict: null,
          verification,
          durationMs: durationFromRun,
          reportedFindingsCount: null,
          findingsCount: null,
          costUsd: null,
        },
      });
      return inserted === 'inserted' ? { kind: 'ingested', failed: true } : { kind: 'skipped' };
    }

    const art = live[0]!;
    if (art.size_in_bytes > CI_ARTIFACT_MAX_ZIP_BYTES) {
      return { kind: 'rejected', reason: 'artifact_too_large' };
    }
    let text: string | null;
    try {
      text = await gh.downloadArtifactFile(ref, art.id, CI_RESULT_FILE, {
        maxZipBytes: CI_ARTIFACT_MAX_ZIP_BYTES,
        maxFileBytes: CI_ARTIFACT_MAX_JSON_BYTES,
      });
    } catch (err) {
      if (err instanceof ArtifactTooLargeError) return { kind: 'rejected', reason: 'artifact_too_large' };
      throw err;
    }
    if (text == null) return { kind: 'rejected', reason: 'artifact_missing' };

    // I8: untrusted JSON → schema.
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { kind: 'rejected', reason: 'artifact_invalid' };
    }
    const parsed = CiResultArtifact.safeParse(raw);
    if (!parsed.success) return { kind: 'rejected', reason: 'artifact_invalid' };
    const artifact = parsed.data;

    // I9: the artifact describes this run of this agent.
    if (!artifactMatchesRun(artifact, run, inst)) return { kind: 'rejected', reason: 'artifact_mismatch' };

    const verification = await verify();

    // V2: re-ground the (untrusted) findings against the real PR diff. Every
    // input to this step comes from GitHub — the base is the PR's `base.sha`,
    // never the artifact's `base_sha` — so a forged artifact cannot skip it.
    // When it cannot run, count/blockers/verdict are stored as null
    // (unverified), never as the artifact's self-reported values.
    const regrounded = await this.reground(gh, ref, prNumber, run.head_sha, artifact.findings, log);
    const grounding = regrounded?.grounding ?? 'not rechecked';

    // Verdict + blockers from the deterministic gate, never from the artifact.
    let findingsCount: number | null = null;
    let blockers: number | null = null;
    let verdict: CiVerdict | null = null;
    if (regrounded) {
      findingsCount = regrounded.findings.length;
      blockers = countBlockers(regrounded.findings, failOn);
      verdict = ciVerdict(findingsCount, gateTriggered(regrounded.findings, failOn));
      log.push(`gate: ci_fail_on=${failOn} → ${blockers} blocker(s), ${verdict}`);
    } else {
      log.push('gate: not evaluated — findings unverified, count/blockers/verdict left empty');
    }
    const durationMs = artifact.duration_ms ?? durationFromRun;
    const model = artifact.model ?? 'unknown';

    const inserted = await this.repo.ingestRun({
      workspaceId: ws,
      agentId: inst.agentId,
      prId,
      provider: artifact.provider ?? null,
      model: artifact.model ?? null,
      status: 'done',
      ranAt,
      durationMs,
      tokensIn: artifact.tokens_in ?? null,
      tokensOut: artifact.tokens_out ?? null,
      costUsd: artifact.cost_usd,
      findingsCount,
      grounding,
      blockers,
      error: null,
      trace: buildCiRunTrace({
        agentName: artifact.agent,
        manifestVersion: artifact.manifest_version ?? inst.manifestVersion,
        provider: artifact.provider ?? null,
        model,
        prNumber,
        headSha: run.head_sha,
        baseSha: regrounded?.baseSha ?? null,
        manifestSha256: artifact.manifest_sha256 ?? null,
        runnerVersion: artifact.runner_version ?? artifact.version ?? null,
        dependencies: artifact.dependencies ?? null,
        jobUrl: run.html_url,
        verification,
        durationMs: durationMs ?? 0,
        tokensIn: artifact.tokens_in ?? 0,
        tokensOut: artifact.tokens_out ?? 0,
        costUsd: artifact.cost_usd,
        findings: findingsCount ?? 0,
        grounding,
        log: [...log, `CI reported ${artifact.findings_count} finding(s)`],
      }),
      ciRun: {
        ciInstallationId: inst.id,
        prNumber,
        status: ciRunStatus('done', findingsCount),
        githubRunId: run.id,
        githubRunAttempt: run.run_attempt,
        repo: inst.repo,
        headSha: run.head_sha,
        jobUrl: run.html_url,
        verdict,
        verification,
        durationMs,
        reportedFindingsCount: artifact.findings_count,
        findingsCount,
        costUsd: artifact.cost_usd,
      },
    });
    return inserted === 'inserted' ? { kind: 'ingested', failed: false } : { kind: 'skipped' };
  }

  /**
   * V2. Returns the surviving findings, or null when re-grounding is
   * impossible (no PR, no findings list, base or diff unavailable / too large).
   */
  private async reground(
    gh: GitHubClient,
    ref: RepoRef,
    prNumber: number | null,
    headSha: string,
    reported: Finding[] | undefined | null,
    log: string[],
  ): Promise<{ findings: Finding[]; grounding: string; baseSha: string } | null> {
    if (reported == null) {
      log.push('grounding: artifact carries no findings list — not rechecked, findings unverified');
      return null;
    }
    if (prNumber == null) {
      log.push('grounding: run has no pull request — not rechecked, findings unverified');
      return null;
    }
    const baseSha = await gh.getPullBaseSha(ref, prNumber);
    if (!baseSha) {
      log.push('grounding: PR base commit unavailable — not rechecked, findings unverified');
      return null;
    }
    const diffText = await gh.getCompareDiff(ref, baseSha, headSha, CI_REGROUND_MAX_DIFF_BYTES);
    if (diffText == null) {
      log.push('grounding: PR diff unavailable or too large — not rechecked, findings unverified');
      return null;
    }
    const diff = parseUnifiedDiff(diffText);
    diff.files = diff.files.filter(
      (f) => !CI_IGNORED_DIFF_PREFIXES.some((p) => f.path.startsWith(p)),
    );
    const g = groundFindings(reported, diff);
    const grounding = groundingSummary(g);
    log.push(`grounding: re-checked against ${baseSha.slice(0, 7)}...${headSha.slice(0, 7)} — ${grounding}`);
    return { findings: g.kept, grounding, baseSha };
  }
}
