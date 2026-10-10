import PQueue from 'p-queue';
import type { EvalSkillSnapshotEntry, Finding, Provider, ReviewStrategy } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { withTimeout } from '../../platform/resilience.js';
import { effectiveRunCost, type Estimator } from '../../platform/run-cost.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { EvalAgentRunRow, EvalCaseRow } from '../../db/rows.js';
import { taskLine } from '../reviews/helpers.js';
import { EVAL_CASE_CONCURRENCY, EVAL_CASE_TIMEOUT_MS } from './constants.js';
import { caseSpec, injectableBodies } from './helpers.js';
import type { EvalRepository, InsertCaseResult } from './repository.js';
import { aggregateRun, scoreCase, type ErroredCase, type ScoredCase } from './scoring.js';

/** Minimal structured logger (pino-compatible: (obj, msg)). */
export type EvalLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/** The configuration a run (or a single-case run) executes with — resolved before execution. */
export interface PinnedConfig {
  agentId: string;
  version: number;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  skillSnapshot: EvalSkillSnapshotEntry[];
}

export interface CaseOutcome {
  /** The `eval_runs` row values for this execution. */
  values: InsertCaseResult;
  /** What the aggregate sees: the scored case, or an errored marker. */
  scored: ScoredCase | ErroredCase;
  costUsd: number | null;
}

/**
 * Executes eval cases through the real review engine + grounding gate.
 *
 * Each case sees ONLY its frozen diff, its frozen PR meta (task line +
 * description) and the pinned prompt/model/strategy/skill blocks — no clone,
 * no repository index, no attached documents, no derived PR summary, no memory.
 * Frozen file entries are reference-only and never sent. Nothing about a case's
 * input or diff is ever logged: log lines carry ids, the case name and status.
 *
 * Runs fire-and-forget from the service (the same accepted pattern reviews use)
 * rather than through the shared JobRunner, whose whole-job timeout and retries
 * would kill a long run or re-pay every case; instead each case has its own
 * timeout and the cases run with bounded concurrency.
 */
export class EvalRunner {
  constructor(
    private container: Container,
    private repo: EvalRepository,
  ) {}

  private get estimate(): Estimator {
    return (m, i, o) => this.container.priceBook.estimate(m, i, o);
  }

  /** Run one case; any failure becomes an errored outcome with a reason. */
  async executeCase(pinned: PinnedConfig, caseRow: EvalCaseRow): Promise<CaseOutcome> {
    const spec = caseSpec(caseRow);
    const started = Date.now();
    const base = {
      caseId: caseRow.id,
      agentId: pinned.agentId,
      agentVersion: pinned.version,
      caseName: caseRow.name,
      caseKind: spec.kind,
      expectedN: spec.kind === 'must_find' ? spec.expected.length : 0,
    };
    try {
      const diff = parseUnifiedDiff(caseRow.inputDiff ?? '');
      const llm = await this.container.llm(pinned.provider);
      const skills = injectableBodies(pinned.skillSnapshot);
      const description = spec.meta.description?.trim() ? spec.meta.description : undefined;
      const outcome = await withTimeout(
        reviewPullRequest({
          systemPrompt: pinned.systemPrompt,
          model: pinned.model,
          strategy: pinned.strategy,
          diff,
          llm,
          ...(skills.length > 0 ? { skills } : {}),
          ...(description ? { prDescription: description } : {}),
          task: taskLine({
            number: spec.meta.number ?? 0,
            title: spec.meta.title,
            author: spec.meta.author ?? 'unknown',
          }),
        }),
        EVAL_CASE_TIMEOUT_MS,
      );
      const grounded: Finding[] = outcome.review.findings;
      const emitted = grounded.length + outcome.dropped.length;
      const scored = scoreCase({
        kind: spec.kind,
        expected: spec.expected,
        forbidden: spec.forbidden,
        grounded,
        emitted,
      });
      const costUsd = effectiveRunCost(
        {
          costUsd: outcome.costUsd,
          model: pinned.model,
          tokensIn: outcome.tokensIn,
          tokensOut: outcome.tokensOut,
        },
        this.estimate,
      );
      return {
        scored,
        costUsd,
        values: {
          ...base,
          status: scored.status,
          reason: null,
          emitted,
          grounded: grounded.length,
          gotM: scored.gotM,
          matched: scored.matched,
          actualOutput: grounded,
          pass: scored.status === 'passed',
          durationMs: Date.now() - started,
          costUsd,
        },
      };
    } catch (err) {
      return {
        scored: { status: 'errored' },
        costUsd: null,
        values: {
          ...base,
          status: 'errored',
          reason: (err as Error)?.message || 'Case execution failed',
          emitted: 0,
          grounded: 0,
          gotM: 0,
          matched: [],
          actualOutput: [],
          pass: false,
          durationMs: Date.now() - started,
          costUsd: null,
        },
      };
    }
  }

  /**
   * Execute a whole run in the background. Each case records its result (and
   * advances progress) as it finishes; the run then completes with the
   * aggregate metrics. Any crash marks the run failed — it is never left
   * `running` while this process lives.
   */
  async execute(
    run: EvalAgentRunRow,
    pinned: PinnedConfig,
    cases: EvalCaseRow[],
    log: EvalLogger,
  ): Promise<void> {
    const started = Date.now();
    try {
      const queue = new PQueue({ concurrency: EVAL_CASE_CONCURRENCY });
      const outcomes: CaseOutcome[] = [];
      let writeError: unknown;
      for (const c of cases) {
        void queue
          .add(async () => {
            const outcome = await this.executeCase(pinned, c);
            await this.repo.recordCaseResult(run.id, outcome.values);
            outcomes.push(outcome);
            log.info(
              { evalRunId: run.id, caseId: c.id, caseName: c.name, status: outcome.values.status },
              'eval: case finished',
            );
          })
          .catch((err: unknown) => {
            writeError ??= err;
          });
      }
      await queue.onIdle();
      if (writeError) throw writeError;
      if (outcomes.length !== cases.length) {
        throw new Error(`Only ${outcomes.length} of ${cases.length} cases recorded`);
      }

      const agg = aggregateRun(outcomes.map((o) => o.scored));
      const scoredCosts = outcomes.filter((o) => o.scored.status !== 'errored').map((o) => o.costUsd);
      const costUsd =
        scoredCosts.length === 0 || scoredCosts.some((c) => c == null)
          ? null
          : Math.round(scoredCosts.reduce<number>((s, c) => s + (c ?? 0), 0) * 1e6) / 1e6;
      await this.repo.completeRun(run.id, {
        recall: agg.recall,
        precision: agg.precision,
        citationAccuracy: agg.citation_accuracy,
        costUsd,
        durationMs: Date.now() - started,
      });
      log.info(
        { evalRunId: run.id, agentId: run.agentId, passed: agg.passed, errored: agg.errored },
        'eval: run completed',
      );
    } catch (err) {
      const message = (err as Error)?.message || 'Eval run crashed';
      log.error({ evalRunId: run.id, err: message }, 'eval: run failed');
      await this.repo.failRun(run.id, message);
    }
  }
}
