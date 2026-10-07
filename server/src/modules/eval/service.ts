import {
  AgentVersionConfig,
  EvalCaseInput,
  type EvalAgentDetail,
  type EvalAgentRun,
  type EvalAgentRunDetail,
  type EvalCaseFromFindingInput,
  type EvalCaseRecord,
  type EvalCaseResult,
  type EvalCaseSeed,
  type EvalCompare,
  type EvalPromoteResult,
  type EvalRunAllResult,
  type EvalStartResult,
  type EvalWorkspaceDashboard,
  type Provider,
  type ReviewStrategy,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentRow, EvalCaseRow, FindingRow, PullRow } from '../../db/rows.js';
import { toAgentDto } from '../agents/helpers.js';
import {
  EVAL_DEFAULT_WINDOW_DAYS,
  EVAL_RECENT_RUNS_LIMIT,
  EVAL_SPARKLINE_POINTS,
} from './constants.js';
import {
  buildSeedDraft,
  buildSkillSnapshot,
  caseInputFromRecord,
  compareRuns,
  findingDecision,
  metricDeltas,
  precisionDip,
  sameSkillState,
  storedSnapshot,
  toAgentRunDto,
  toCaseRecord,
  toResultDto,
  trendPoints,
  uniqueCaseName,
} from './helpers.js';
import { EvalRepository, type InsertEvalCase } from './repository.js';
import { EvalRunner, type EvalLogger, type PinnedConfig } from './runner.js';

const DAY_MS = 86_400_000;

/** A finding with its review + PR, as the shared review repository resolves it. */
type FindingContext = NonNullable<Awaited<ReturnType<Container['reviewRepo']['findingContext']>>>;

/** How many times a create retries a name that a concurrent create just took. */
const NAME_RETRIES = 5;

/**
 * Eval pipeline use cases (L06): cases (seeded from a finding or hand-made),
 * single-case runs, background agent-wide runs, and the read models behind the
 * Evals tab, the per-agent detail page, the dashboard, Compare and Promote.
 *
 * Agents and reviews are reached only through `container.agentsRepo` /
 * `container.reviewRepo`. Every lookup is workspace-scoped; anything outside
 * the caller's workspace is a 404.
 *
 * Deliberate deviation from "background work goes through the JobRunner": the
 * shared `container.jobs` runner is built with a whole-job timeout and retries
 * (`platform/jobs.ts:51-53`), which would kill an N-case run part-way and, on
 * retry, re-run and re-pay every case. Instead — the precedent reviews already
 * set — the durable `eval_agent_runs` row is created first, the run executes
 * fire-and-forget with a per-case timeout and bounded concurrency, and a boot
 * reaper fails any run a restart interrupted (`reapStaleRuns`).
 */
export class EvalService {
  private repo: EvalRepository;
  private runner: EvalRunner;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
    this.runner = new EvalRunner(container, this.repo);
  }

  // ===========================================================================
  // Cases
  // ===========================================================================

  private async requireAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  /** An agent-owned case in the workspace, or 404. */
  private async requireCase(workspaceId: string, caseId: string): Promise<EvalCaseRow> {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row || row.ownerKind !== 'agent') throw new NotFoundError('Eval case not found');
    return row;
  }

  private async record(row: EvalCaseRow): Promise<EvalCaseRecord> {
    const [record] = await this.records([row]);
    return record!;
  }

  private async records(rows: EvalCaseRow[]): Promise<EvalCaseRecord[]> {
    const last = await this.repo.lastResultsFor(rows.map((r) => r.id));
    const available = await Promise.all(
      rows.map(async (r) =>
        r.sourceFindingId
          ? (await this.container.reviewRepo.getFinding(r.sourceFindingId)) !== undefined
          : false,
      ),
    );
    return rows.map((r, i) => toCaseRecord(r, last.get(r.id) ?? null, available[i]!));
  }

  /** The finding's context, scoped to the workspace and to an agent-produced review. */
  private async findingSource(
    workspaceId: string,
    findingId: string,
  ): Promise<FindingContext & { agent: AgentRow }> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    if (!ctx.review.agentId) {
      throw new ValidationError(
        'This finding was not produced by an agent, so there is no eval set to add it to.',
      );
    }
    const agent = await this.container.agentsRepo.getById(workspaceId, ctx.review.agentId);
    if (!agent) {
      throw new ValidationError('The agent that produced this finding no longer exists.');
    }
    return { ...ctx, agent };
  }

  /** Recompute the frozen draft for a finding from the stored data (never from the client). */
  private async freshDraft(
    workspaceId: string,
    src: { finding: FindingRow; pull: PullRow; agent: AgentRow },
  ) {
    const files = await this.container.reviewRepo.getPrFiles(src.pull.id);
    const patch = files.find((f) => f.path === src.finding.file)?.patch;
    const taken = await this.repo.caseNamesFor(workspaceId, src.agent.id);
    const result = buildSeedDraft({ finding: src.finding, pull: src.pull, patch, taken });
    if ('refused' in result) throw new ValidationError(result.refused);
    return result;
  }

  /** `GET /findings/:id/eval-case` — the seeded draft, or the case already made from it. */
  async seedFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseSeed> {
    const src = await this.findingSource(workspaceId, findingId);
    const existingRow = await this.repo.caseBySourceFinding(workspaceId, src.agent.id, findingId);
    if (existingRow) {
      const existing = await this.record(existingRow);
      return {
        decision: existingRow.sourceDecision ?? findingDecision(src.finding) ?? 'accepted',
        existing,
        draft: caseInputFromRecord(existing),
      };
    }
    const { decision, draft } = await this.freshDraft(workspaceId, src);
    return { decision, existing: null, draft };
  }

  /**
   * `POST /findings/:id/eval-case` — save the seeded case. The input is
   * re-frozen server-side (client-sent input is never accepted); only name,
   * notes and — for `must_find` — the expected output may be overridden.
   * Seeding the same finding twice returns the existing case.
   */
  async createFromFinding(
    workspaceId: string,
    findingId: string,
    overrides: EvalCaseFromFindingInput,
  ): Promise<{ record: EvalCaseRecord; created: boolean }> {
    const src = await this.findingSource(workspaceId, findingId);
    const existing = await this.repo.caseBySourceFinding(workspaceId, src.agent.id, findingId);
    if (existing) return { record: await this.record(existing), created: false };

    const { decision, draft } = await this.freshDraft(workspaceId, src);
    const parsed = EvalCaseInput.safeParse({
      ...draft,
      ...(overrides.name !== undefined ? { name: overrides.name } : {}),
      ...(overrides.notes !== undefined ? { notes: overrides.notes } : {}),
      ...(overrides.expected_output !== undefined && draft.kind === 'must_find'
        ? { expected_output: overrides.expected_output }
        : {}),
    });
    if (!parsed.success) {
      throw new ValidationError('Invalid eval case', parsed.error.flatten());
    }

    let name = parsed.data.name;
    for (let attempt = 0; attempt < NAME_RETRIES; attempt++) {
      const res = await this.repo.insertCase({
        ...this.caseValues(workspaceId, src.agent.id, { ...parsed.data, name }),
        sourceFindingId: findingId,
        sourceDecision: decision,
      });
      if ('row' in res) return { record: await this.record(res.row), created: true };
      if (res.conflict === 'source') {
        const again = await this.repo.caseBySourceFinding(workspaceId, src.agent.id, findingId);
        if (again) return { record: await this.record(again), created: false };
      }
      name = uniqueCaseName(name, await this.repo.caseNamesFor(workspaceId, src.agent.id));
    }
    throw new ConflictError('Could not find a free name for this eval case');
  }

  private caseValues(workspaceId: string, agentId: string, input: EvalCaseInput): InsertEvalCase {
    return {
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      kind: input.kind,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      forbiddenLocation: input.kind === 'must_not_flag' ? (input.forbidden_location ?? null) : null,
      notes: input.notes ?? null,
    };
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRecord[]> {
    await this.requireAgent(workspaceId, agentId);
    return this.records(await this.repo.listCases(workspaceId, agentId));
  }

  async createCase(
    workspaceId: string,
    agentId: string,
    input: EvalCaseInput,
  ): Promise<EvalCaseRecord> {
    await this.requireAgent(workspaceId, agentId);
    const res = await this.repo.insertCase(this.caseValues(workspaceId, agentId, input));
    if (!('row' in res)) throw new ConflictError(`An eval case named "${input.name}" already exists`);
    return this.record(res.row);
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    input: EvalCaseInput,
  ): Promise<EvalCaseRecord> {
    const existing = await this.requireCase(workspaceId, caseId);
    await this.requireAgent(workspaceId, existing.ownerId);
    const { workspaceId: _ws, ownerKind: _k, ownerId: _o, ...values } = this.caseValues(
      workspaceId,
      existing.ownerId,
      input,
    );
    const res = await this.repo.updateCase(workspaceId, caseId, values);
    if (!('row' in res)) throw new ConflictError(`An eval case named "${input.name}" already exists`);
    if (!res.row) throw new NotFoundError('Eval case not found');
    return this.record(res.row);
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<void> {
    await this.requireCase(workspaceId, caseId);
    const ok = await this.repo.deleteCase(workspaceId, caseId);
    if (!ok) throw new NotFoundError('Eval case not found');
  }

  // ===========================================================================
  // Execution
  // ===========================================================================

  /**
   * Resolve what a run executes with: the agent's CURRENT version (its
   * snapshot recorded now if it was never recorded, e.g. a seeded agent) and a
   * snapshot of the linked skills as they are right now.
   */
  private async pin(agent: AgentRow): Promise<PinnedConfig> {
    const agents = this.container.agentsRepo;
    await agents.ensureVersionSnapshot(agent);
    const version = await agents.getVersion(agent.id, agent.version);
    const parsed = version ? AgentVersionConfig.safeParse(version.configJson) : undefined;
    const cfg = parsed?.success ? parsed.data : undefined;
    const links = await agents.linkedSkills(agent.id);
    return {
      agentId: agent.id,
      version: agent.version,
      provider: (cfg?.provider ?? agent.provider) as Provider,
      model: cfg?.model ?? agent.model,
      systemPrompt: cfg?.system_prompt ?? agent.systemPrompt,
      strategy: (cfg?.strategy ?? agent.strategy) as ReviewStrategy,
      skillSnapshot: buildSkillSnapshot(links),
    };
  }

  /**
   * Single-case run against the current version + current skills. Recorded as
   * the case's last result with no parent run, so it never shows in history,
   * trend or dashboard.
   */
  async runCase(workspaceId: string, caseId: string): Promise<EvalCaseResult> {
    const row = await this.requireCase(workspaceId, caseId);
    const agent = await this.requireAgent(workspaceId, row.ownerId);
    const pinned = await this.pin(agent);
    const outcome = await this.runner.executeCase(pinned, row);
    const result = await this.repo.recordCaseResult(null, outcome.values);
    return toResultDto(result);
  }

  /**
   * Start a background run over the agent's whole case set, or re-attach to the
   * one already in flight (at most one per agent — enforced by the database).
   * Returns before any case finishes.
   */
  async startRun(
    workspaceId: string,
    agentId: string,
    log: EvalLogger,
  ): Promise<EvalStartResult> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const inFlight = await this.repo.runningRunFor(workspaceId, agentId);
    if (inFlight) return { run: toAgentRunDto(inFlight), attached: true };

    const cases = await this.repo.listCases(workspaceId, agentId);
    if (cases.length === 0) throw new ValidationError('This agent has no eval cases to run');
    const pinned = await this.pin(agent);

    const res = await this.repo.insertRunningRun({
      workspaceId,
      agentId,
      agentVersion: pinned.version,
      provider: pinned.provider,
      model: pinned.model,
      skillSnapshot: pinned.skillSnapshot,
      caseIds: cases.map((c) => c.id),
      casesTotal: cases.length,
    });
    if (!('row' in res)) {
      const running = await this.repo.runningRunFor(workspaceId, agentId);
      if (!running) throw new ConflictError('An eval run for this agent just started; try again');
      return { run: toAgentRunDto(running), attached: true };
    }

    const run = res.row;
    void this.runner.execute(run, pinned, cases, log).catch((err) => {
      log.error({ evalRunId: run.id, err: (err as Error)?.message }, 'eval: background run crashed');
    });
    log.info({ evalRunId: run.id, agentId, cases: cases.length }, 'eval: run started');
    return { run: toAgentRunDto(run), attached: false };
  }

  /** Start (or re-attach) one run per agent that has at least one case. */
  async runAll(workspaceId: string, log: EvalLogger): Promise<EvalRunAllResult> {
    const counts = await this.repo.caseCountsByAgent(workspaceId);
    const agents = (await this.container.agentsRepo.list(workspaceId)).filter(
      (a) => (counts.get(a.id) ?? 0) > 0,
    );
    const runs: EvalStartResult[] = [];
    for (const a of agents) runs.push(await this.startRun(workspaceId, a.id, log));
    return { runs };
  }

  /** Boot: fail every run a previous process left `running`. */
  async reapStaleRuns(): Promise<number> {
    return this.repo.reapRunningRuns();
  }

  // ===========================================================================
  // Reads (no model call anywhere below)
  // ===========================================================================

  async getRun(workspaceId: string, runId: string): Promise<EvalAgentRunDetail> {
    const run = await this.repo.getRun(workspaceId, runId);
    if (!run) throw new NotFoundError('Eval run not found');
    const results = await this.repo.resultsForRun(run.id);
    return { ...toAgentRunDto(run), results: results.map(toResultDto) };
  }

  async listRuns(
    workspaceId: string,
    agentId: string,
    days = EVAL_DEFAULT_WINDOW_DAYS,
    now = new Date(),
  ): Promise<EvalAgentRun[]> {
    await this.requireAgent(workspaceId, agentId);
    const since = new Date(now.getTime() - days * DAY_MS);
    return (await this.repo.runsForAgent(workspaceId, agentId, since)).map(toAgentRunDto);
  }

  async agentDetail(
    workspaceId: string,
    agentId: string,
    days = EVAL_DEFAULT_WINDOW_DAYS,
    now = new Date(),
  ): Promise<EvalAgentDetail> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const since = new Date(now.getTime() - days * DAY_MS);
    const [names, windowRows, latestMap, running] = await Promise.all([
      this.repo.caseNamesFor(workspaceId, agentId),
      this.repo.runsForAgent(workspaceId, agentId, since),
      this.repo.latestCompletedRuns(workspaceId, [agentId], 2),
      this.repo.runningRunFor(workspaceId, agentId),
    ]);
    const runs = windowRows.map(toAgentRunDto);
    const [latestRow, previousRow] = latestMap.get(agentId) ?? [];
    const latest = latestRow ? toAgentRunDto(latestRow) : null;
    const previous = previousRow ? toAgentRunDto(previousRow) : null;
    const trend = trendPoints(runs);
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      model: agent.model,
      cases_total: names.size,
      runs_in_window: trend.length,
      window_days: days,
      latest,
      delta: metricDeltas(latest, previous),
      trend,
      recent_runs: runs.slice(0, EVAL_RECENT_RUNS_LIMIT),
      in_flight: running ? toAgentRunDto(running) : null,
      alert: precisionDip(latest, previous),
    };
  }

  async dashboard(workspaceId: string): Promise<EvalWorkspaceDashboard> {
    const counts = await this.repo.caseCountsByAgent(workspaceId);
    const agents = (await this.container.agentsRepo.list(workspaceId)).filter(
      (a) => (counts.get(a.id) ?? 0) > 0,
    );
    const [latestMap, running, recent] = await Promise.all([
      this.repo.latestCompletedRuns(
        workspaceId,
        agents.map((a) => a.id),
        EVAL_SPARKLINE_POINTS,
      ),
      this.repo.runningAgentIds(workspaceId),
      this.repo.recentRunsAcrossAgents(workspaceId, EVAL_RECENT_RUNS_LIMIT),
    ]);
    return {
      agents: agents.map((a) => {
        const list = latestMap.get(a.id) ?? [];
        return {
          agent_id: a.id,
          agent_name: a.name,
          model: a.model,
          cases_total: counts.get(a.id) ?? 0,
          latest: list[0] ? toAgentRunDto(list[0]) : null,
          recall_series: [...list]
            .reverse()
            .map((r) => r.recall)
            .filter((v): v is number => v != null),
          in_flight: running.has(a.id),
        };
      }),
      recent_runs: recent.map((r) => ({ ...toAgentRunDto(r.run), agent_name: r.agentName })),
    };
  }

  /** The system prompt recorded for one agent version ('' if never recorded). */
  private async promptOf(agentId: string, version: number): Promise<string> {
    const row = await this.container.agentsRepo.getVersion(agentId, version);
    const parsed = row ? AgentVersionConfig.safeParse(row.configJson) : undefined;
    return parsed?.success ? parsed.data.system_prompt : '';
  }

  /** Compare two runs of the same agent (ordered older → newer). No model call. */
  async compare(workspaceId: string, a: string, b: string): Promise<EvalCompare> {
    const [runA, runB] = await Promise.all([
      this.repo.getRun(workspaceId, a),
      this.repo.getRun(workspaceId, b),
    ]);
    if (!runA || !runB) throw new NotFoundError('Eval run not found');
    if (runA.agentId !== runB.agentId) {
      throw new ValidationError('Only two runs of the same agent can be compared');
    }
    const agent = await this.requireAgent(workspaceId, runA.agentId);
    const [promptA, promptB, links] = await Promise.all([
      this.promptOf(agent.id, runA.agentVersion),
      this.promptOf(agent.id, runB.agentVersion),
      this.container.agentsRepo.linkedSkills(agent.id),
    ]);
    return compareRuns(
      { run: toAgentRunDto(runA), prompt: promptA },
      { run: toAgentRunDto(runB), prompt: promptB },
      buildSkillSnapshot(links),
      agent.version,
    );
  }

  /**
   * Promote the agent version a run was made with: a NEW version copying that
   * version's config becomes active. Skill links are left as they are; the
   * result says whether the run's skill snapshot differs from them.
   */
  async promote(workspaceId: string, agentId: string, runId: string): Promise<EvalPromoteResult> {
    const run = await this.repo.getRun(workspaceId, runId);
    if (!run || run.agentId !== agentId) throw new NotFoundError('Eval run not found');
    const outcome = await this.container.agentsRepo.promoteVersion(
      workspaceId,
      agentId,
      run.agentVersion,
    );
    if (outcome.kind === 'not_found') throw new NotFoundError('Agent version not found');
    if (outcome.kind === 'already_active') {
      throw new ConflictError(`v${run.agentVersion} is already the active version`);
    }
    const links = await this.container.agentsRepo.linkedSkills(agentId);
    return {
      agent: toAgentDto(outcome.row),
      new_version: outcome.row.version,
      source_version: run.agentVersion,
      skill_mismatch: !sameSkillState(storedSnapshot(run), buildSkillSnapshot(links)),
    };
  }
}
