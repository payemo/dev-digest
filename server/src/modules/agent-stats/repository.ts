import { and, asc, eq, gte, inArray, lt, max, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Agent-stats data-access. Owns no table: it reads (never writes) `agents`,
 * `agent_runs`, `reviews` and `findings` to build per-agent aggregates for the
 * Agent Performance dashboard and the agent editor's Stats tab.
 *
 * Reading those tables directly is deliberate: the aggregate is read-only and
 * spans four tables, and smearing it across three modules' repositories would
 * be worse. What the layering rule forbids — importing another module's
 * `repository.ts` — is not done here or in the service.
 *
 * Every query is workspace-scoped and filters a half-open `[from, to)` window
 * on `agent_runs.ran_at`. `agentId`, when given, narrows to one agent.
 */

export interface StatsAgentRow {
  id: string;
  name: string;
  enabled: boolean;
}

/** A `status = 'done'` run — the only kind that counts toward runs/cost/duration. */
export interface DoneRunRow {
  id: string;
  agentId: string | null;
  model: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  ranAt: Date;
}

/** Per agent (null = deleted agent): failed + cancelled runs, last run of any status. */
export interface RunStatusRow {
  agentId: string | null;
  failed: number;
  lastRunAt: Date | null;
}

/** Per agent (null = deleted agent): findings of its done runs in the window. */
export interface DecisionRow {
  agentId: string | null;
  findings: number;
  accepted: number;
  dismissed: number;
  critical: number;
  warning: number;
  suggestion: number;
}

export class AgentStatsRepository {
  constructor(private db: Db) {}

  /** Every agent of the workspace (enabled or not), A→Z. */
  async listAgents(workspaceId: string, agentId?: string): Promise<StatsAgentRow[]> {
    const where = [eq(t.agents.workspaceId, workspaceId)];
    if (agentId !== undefined) where.push(eq(t.agents.id, agentId));
    return this.db
      .select({ id: t.agents.id, name: t.agents.name, enabled: t.agents.enabled })
      .from(t.agents)
      .where(and(...where))
      .orderBy(asc(t.agents.name));
  }

  async doneRuns(workspaceId: string, from: Date, to: Date, agentId?: string): Promise<DoneRunRow[]> {
    return this.db
      .select({
        id: t.agentRuns.id,
        agentId: t.agentRuns.agentId,
        model: t.agentRuns.model,
        costUsd: t.agentRuns.costUsd,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
        durationMs: t.agentRuns.durationMs,
        ranAt: t.agentRuns.ranAt,
      })
      .from(t.agentRuns)
      .where(and(...runWindow(workspaceId, from, to, agentId), eq(t.agentRuns.status, 'done')));
  }

  async runStatusCounts(
    workspaceId: string,
    from: Date,
    to: Date,
    agentId?: string,
  ): Promise<RunStatusRow[]> {
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        failed: sql<number>`count(*) filter (where ${inArray(t.agentRuns.status, ['failed', 'cancelled'])})::int`,
        lastRunAt: max(t.agentRuns.ranAt),
      })
      .from(t.agentRuns)
      .where(and(...runWindow(workspaceId, from, to, agentId)))
      .groupBy(t.agentRuns.agentId);
    return rows.map((r) => ({ agentId: r.agentId, failed: Number(r.failed), lastRunAt: r.lastRunAt }));
  }

  /**
   * Findings reached through `reviews.run_id` from the agent's done runs in
   * the window. `accepted_at` / `dismissed_at` are mutually exclusive, so
   * `findings − accepted − dismissed` is the pending count. CI runs have no
   * reviews and so contribute nothing here.
   */
  async decisionCounts(
    workspaceId: string,
    from: Date,
    to: Date,
    agentId?: string,
  ): Promise<DecisionRow[]> {
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        findings: sql<number>`count(*)::int`,
        accepted: sql<number>`count(${t.findings.acceptedAt})::int`,
        dismissed: sql<number>`count(${t.findings.dismissedAt})::int`,
        critical: sql<number>`count(*) filter (where ${eq(t.findings.severity, 'CRITICAL')})::int`,
        warning: sql<number>`count(*) filter (where ${eq(t.findings.severity, 'WARNING')})::int`,
        suggestion: sql<number>`count(*) filter (where ${eq(t.findings.severity, 'SUGGESTION')})::int`,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.agentRuns, eq(t.reviews.runId, t.agentRuns.id))
      .where(
        and(
          ...runWindow(workspaceId, from, to, agentId),
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .groupBy(t.agentRuns.agentId);
    return rows.map((r) => ({
      agentId: r.agentId,
      findings: Number(r.findings),
      accepted: Number(r.accepted),
      dismissed: Number(r.dismissed),
      critical: Number(r.critical),
      warning: Number(r.warning),
      suggestion: Number(r.suggestion),
    }));
  }
}

/** Workspace + `[from, to)` on `ran_at` (+ one agent) — shared by every runs query. */
function runWindow(workspaceId: string, from: Date, to: Date, agentId?: string): SQL[] {
  const where = [
    eq(t.agentRuns.workspaceId, workspaceId),
    gte(t.agentRuns.ranAt, from),
    lt(t.agentRuns.ranAt, to),
  ];
  if (agentId !== undefined) where.push(eq(t.agentRuns.agentId, agentId));
  return where;
}
