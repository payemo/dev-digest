import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalAgentRunRow, EvalCaseResultRow, EvalCaseRow } from '../../db/rows.js';
import { EVAL_REAPED_ERROR } from './constants.js';

export type { EvalAgentRunRow, EvalCaseResultRow, EvalCaseRow };

/**
 * Eval data-access (L06): `eval_cases`, `eval_agent_runs` and the per-case
 * results in `eval_runs`. Workspace-scoped throughout, except the in-run
 * writes, which are keyed by a run id the service created in scope.
 *
 * Every result query keys on `eval_agent_runs` or a non-null `eval_runs.agent_id`,
 * so `eval_runs` rows written before the eval pipeline existed (null agent)
 * never surface in any list, history or metric.
 */

export type InsertEvalCase = Omit<typeof t.evalCases.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateEvalCase = Pick<
  typeof t.evalCases.$inferInsert,
  'name' | 'kind' | 'inputDiff' | 'inputFiles' | 'inputMeta' | 'expectedOutput' | 'forbiddenLocation' | 'notes'
>;
export type InsertEvalRun = Omit<
  typeof t.evalAgentRuns.$inferInsert,
  'id' | 'status' | 'startedAt' | 'finishedAt' | 'casesDone' | 'passed' | 'errored'
>;
export type InsertCaseResult = Omit<typeof t.evalRuns.$inferInsert, 'id' | 'ranAt' | 'suiteRunId'>;

export interface RunCompletion {
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  costUsd: number | null;
  durationMs: number;
}

/** Postgres unique violation → the constraint name, else undefined. */
function uniqueViolation(err: unknown): string | undefined {
  const e = err as { code?: string; constraint_name?: string; cause?: unknown };
  if (e?.code === '23505') return e.constraint_name ?? '';
  const c = e?.cause as { code?: string; constraint_name?: string } | undefined;
  if (c?.code === '23505') return c.constraint_name ?? '';
  return undefined;
}

function caseConflict(err: unknown): { conflict: 'name' | 'source' } | undefined {
  const name = uniqueViolation(err);
  if (name === undefined) return undefined;
  return { conflict: name === 'eval_cases_owner_source_finding_uq' ? 'source' : 'name' };
}

const agentCase = (workspaceId: string, agentId: string) =>
  and(
    eq(t.evalCases.workspaceId, workspaceId),
    eq(t.evalCases.ownerKind, 'agent'),
    eq(t.evalCases.ownerId, agentId),
  );

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- cases --------------------------------------------------------------

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(agentCase(workspaceId, agentId))
      .orderBy(asc(t.evalCases.createdAt), asc(t.evalCases.name));
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async caseBySourceFinding(
    workspaceId: string,
    agentId: string,
    findingId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(agentCase(workspaceId, agentId), eq(t.evalCases.sourceFindingId, findingId)));
    return row;
  }

  async caseNamesFor(workspaceId: string, agentId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ name: t.evalCases.name })
      .from(t.evalCases)
      .where(agentCase(workspaceId, agentId));
    return new Set(rows.map((r) => r.name));
  }

  /** Case counts per agent (agents with ≥ 1 case only). */
  async caseCountsByAgent(workspaceId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ agentId: t.evalCases.ownerId, n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerKind, 'agent')))
      .groupBy(t.evalCases.ownerId);
    return new Map(rows.map((r) => [r.agentId, r.n]));
  }

  async insertCase(
    values: InsertEvalCase,
  ): Promise<{ row: EvalCaseRow } | { conflict: 'name' | 'source' }> {
    try {
      const [row] = await this.db.insert(t.evalCases).values(values).returning();
      return { row: row! };
    } catch (err) {
      const c = caseConflict(err);
      if (c) return c;
      throw err;
    }
  }

  async updateCase(
    workspaceId: string,
    id: string,
    values: UpdateEvalCase,
  ): Promise<{ row: EvalCaseRow | undefined } | { conflict: 'name' | 'source' }> {
    try {
      const [row] = await this.db
        .update(t.evalCases)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
        .returning();
      return { row };
    } catch (err) {
      const c = caseConflict(err);
      if (c) return c;
      throw err;
    }
  }

  /** Delete a case. Its historical results keep their copied name/kind (no FK). */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** The latest result per case (`DISTINCT ON (case_id)`), single-case runs included. */
  async lastResultsFor(caseIds: string[]): Promise<Map<string, EvalCaseResultRow>> {
    if (caseIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([t.evalRuns.caseId])
      .from(t.evalRuns)
      .where(and(inArray(t.evalRuns.caseId, caseIds), isNotNull(t.evalRuns.agentId)))
      .orderBy(t.evalRuns.caseId, desc(t.evalRuns.ranAt));
    const out = new Map<string, EvalCaseResultRow>();
    for (const r of rows) if (r.caseId) out.set(r.caseId, r);
    return out;
  }

  // ---- runs ---------------------------------------------------------------

  /**
   * Create a `running` run. The partial unique index allows one running run
   * per agent, so a concurrent second start reports `conflict` instead.
   */
  async insertRunningRun(
    values: InsertEvalRun,
  ): Promise<{ row: EvalAgentRunRow } | { conflict: true }> {
    try {
      const [row] = await this.db
        .insert(t.evalAgentRuns)
        .values({ ...values, status: 'running' })
        .returning();
      return { row: row! };
    } catch (err) {
      if (uniqueViolation(err) !== undefined) return { conflict: true };
      throw err;
    }
  }

  async runningRunFor(workspaceId: string, agentId: string): Promise<EvalAgentRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalAgentRuns)
      .where(
        and(
          eq(t.evalAgentRuns.workspaceId, workspaceId),
          eq(t.evalAgentRuns.agentId, agentId),
          eq(t.evalAgentRuns.status, 'running'),
        ),
      );
    return row;
  }

  /**
   * Record one case result. With a run id, the run's progress counters move in
   * the same transaction, so a progress read never sees a result without its count.
   */
  async recordCaseResult(
    runId: string | null,
    values: InsertCaseResult,
  ): Promise<EvalCaseResultRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.evalRuns)
        .values({ ...values, suiteRunId: runId })
        .returning();
      if (runId) {
        await tx
          .update(t.evalAgentRuns)
          .set({
            casesDone: sql`${t.evalAgentRuns.casesDone} + 1`,
            passed: sql`${t.evalAgentRuns.passed} + ${values.status === 'passed' ? 1 : 0}`,
            errored: sql`${t.evalAgentRuns.errored} + ${values.status === 'errored' ? 1 : 0}`,
          })
          .where(eq(t.evalAgentRuns.id, runId));
      }
      return row!;
    });
  }

  async completeRun(id: string, m: RunCompletion): Promise<void> {
    await this.db
      .update(t.evalAgentRuns)
      .set({
        status: 'completed',
        recall: m.recall,
        precision: m.precision,
        citationAccuracy: m.citationAccuracy,
        costUsd: m.costUsd,
        durationMs: m.durationMs,
        finishedAt: new Date(),
      })
      .where(and(eq(t.evalAgentRuns.id, id), eq(t.evalAgentRuns.status, 'running')));
  }

  async failRun(id: string, error: string): Promise<void> {
    await this.db
      .update(t.evalAgentRuns)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(and(eq(t.evalAgentRuns.id, id), eq(t.evalAgentRuns.status, 'running')));
  }

  async getRun(workspaceId: string, id: string): Promise<EvalAgentRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalAgentRuns)
      .where(and(eq(t.evalAgentRuns.workspaceId, workspaceId), eq(t.evalAgentRuns.id, id)));
    return row;
  }

  async resultsForRun(runId: string): Promise<EvalCaseResultRow[]> {
    return this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.suiteRunId, runId))
      .orderBy(asc(t.evalRuns.ranAt));
  }

  /** An agent's runs started since `since`, newest first. */
  async runsForAgent(
    workspaceId: string,
    agentId: string,
    since: Date,
  ): Promise<EvalAgentRunRow[]> {
    return this.db
      .select()
      .from(t.evalAgentRuns)
      .where(
        and(
          eq(t.evalAgentRuns.workspaceId, workspaceId),
          eq(t.evalAgentRuns.agentId, agentId),
          gte(t.evalAgentRuns.startedAt, since),
        ),
      )
      .orderBy(desc(t.evalAgentRuns.startedAt));
  }

  /** The last `perAgent` completed runs per agent, newest first within each agent. */
  async latestCompletedRuns(
    workspaceId: string,
    agentIds: string[],
    perAgent: number,
  ): Promise<Map<string, EvalAgentRunRow[]>> {
    const out = new Map<string, EvalAgentRunRow[]>();
    if (agentIds.length === 0) return out;
    const ranked = this.db
      .select({
        id: t.evalAgentRuns.id,
        rn: sql<number>`row_number() over (partition by ${t.evalAgentRuns.agentId} order by ${t.evalAgentRuns.startedAt} desc)`.as(
          'rn',
        ),
      })
      .from(t.evalAgentRuns)
      .where(
        and(
          eq(t.evalAgentRuns.workspaceId, workspaceId),
          inArray(t.evalAgentRuns.agentId, agentIds),
          eq(t.evalAgentRuns.status, 'completed'),
        ),
      )
      .as('ranked');
    const rows = await this.db
      .select({ run: t.evalAgentRuns })
      .from(t.evalAgentRuns)
      .innerJoin(ranked, eq(ranked.id, t.evalAgentRuns.id))
      .where(sql`${ranked.rn} <= ${perAgent}`)
      .orderBy(desc(t.evalAgentRuns.startedAt));
    for (const { run } of rows) {
      const list = out.get(run.agentId) ?? [];
      list.push(run);
      out.set(run.agentId, list);
    }
    return out;
  }

  /** Ids of the workspace's agents that have a run in flight. */
  async runningAgentIds(workspaceId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ agentId: t.evalAgentRuns.agentId })
      .from(t.evalAgentRuns)
      .where(
        and(eq(t.evalAgentRuns.workspaceId, workspaceId), eq(t.evalAgentRuns.status, 'running')),
      );
    return new Set(rows.map((r) => r.agentId));
  }

  /** The most recent runs across every agent of the workspace, with the agent's name. */
  async recentRunsAcrossAgents(
    workspaceId: string,
    limit: number,
  ): Promise<{ run: EvalAgentRunRow; agentName: string }[]> {
    return this.db
      .select({ run: t.evalAgentRuns, agentName: t.agents.name })
      .from(t.evalAgentRuns)
      .innerJoin(t.agents, eq(t.agents.id, t.evalAgentRuns.agentId))
      .where(eq(t.evalAgentRuns.workspaceId, workspaceId))
      .orderBy(desc(t.evalAgentRuns.startedAt))
      .limit(limit);
  }

  // ---- boot reaper --------------------------------------------------------

  /** On boot: every `running` run is orphaned (its process died) → failed. */
  async reapRunningRuns(): Promise<number> {
    const rows = await this.db
      .update(t.evalAgentRuns)
      .set({ status: 'failed', error: EVAL_REAPED_ERROR, finishedAt: new Date() })
      .where(eq(t.evalAgentRuns.status, 'running'))
      .returning({ id: t.evalAgentRuns.id });
    return rows.length;
  }
}
