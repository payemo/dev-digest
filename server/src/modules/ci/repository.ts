import { and, asc, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { RunTrace, type CiRunsQuery } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { CI_MEMORY_MAX_ITEMS, CI_RUNS_LIST_LIMIT } from './constants.js';

/**
 * CI data access: `ci_installations`, `ci_runs`, and the CI-sourced
 * `agent_runs` + `run_traces` rows an ingest writes. Every read and write is
 * workspace-scoped through `agents.workspace_id` (an installation belongs to an
 * agent, an agent to a workspace).
 */

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;
export type MemoryRow = typeof t.memory.$inferSelect;

/** The newest run of an installation, for the CI tab's "last run" chip. */
export interface CiLastRun {
  status: string | null;
  ranAt: Date | null;
  verification: 'verified' | 'unverified' | null;
}

export interface CiInstallationWithLastRun extends CiInstallationRow {
  lastRun: CiLastRun | null;
}

/** Columns the export flow writes on an installation (insert or update). */
export interface UpsertInstallation {
  agentId: string;
  repo: string;
  targetType: 'gha' | 'circle' | 'jenkins' | 'cli';
  repoId: string | null;
  agentSlug: string;
  postAs: 'github_review' | 'pr_comment' | 'none';
  triggers: string[];
  workflowPath: string;
  workflowYaml: string;
  workflowVersion: number;
  manifestVersion: number;
  manifestSha256: string;
  runnerVersion: string;
  runnerSha256: string;
  expectedBlobs: Record<string, string>;
  branch: string | null;
  prUrl: string | null;
}

/** A `ci_runs` row joined with what the CI Runs page shows next to it. */
export interface CiRunListRow {
  run: CiRunRow;
  agentId: string;
  agentName: string;
  model: string | null;
  grounding: string | null;
  manifestVersion: string | null;
  repoId: string | null;
}

/** Everything one ingested CI run writes, in one transaction. */
export interface IngestRunValues {
  workspaceId: string;
  agentId: string;
  prId: string | null;
  provider: string | null;
  model: string | null;
  status: 'done' | 'failed';
  ranAt: Date;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  findingsCount: number | null;
  grounding: string | null;
  blockers: number | null;
  error: string | null;
  trace: RunTrace;
  ciRun: {
    ciInstallationId: string;
    prNumber: number | null;
    status: string;
    githubRunId: number;
    githubRunAttempt: number | null;
    repo: string;
    headSha: string;
    jobUrl: string;
    verdict: string | null;
    verification: 'verified' | 'unverified';
    durationMs: number | null;
    reportedFindingsCount: number | null;
    findingsCount: number | null;
    costUsd: number | null;
  };
}

/** Thrown inside the ingest transaction to roll back a duplicate run. */
class DuplicateCiRun extends Error {}

export class CiRepository {
  constructor(private db: Db) {}

  /** Installation ids owned by the workspace (inner join through agents). */
  private inWorkspace(workspaceId: string) {
    return eq(t.agents.workspaceId, workspaceId);
  }

  /** Insert or update the (agent, repo) installation. Caller has already
   *  verified the agent belongs to `workspaceId`. */
  async upsertInstallation(
    workspaceId: string,
    values: UpsertInstallation,
  ): Promise<CiInstallationRow> {
    const [agent] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.id, values.agentId), this.inWorkspace(workspaceId)))
      .limit(1);
    if (!agent) throw new NotFoundError('Agent not found');

    const { agentId, repo, ...rest } = values;
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values({ agentId, repo, ...rest })
      .onConflictDoUpdate({
        target: [t.ciInstallations.agentId, t.ciInstallations.repo],
        set: { ...rest, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallationWithLastRun[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.ciInstallations.agentId, agentId), this.inWorkspace(workspaceId)))
      .orderBy(asc(t.ciInstallations.repo));
    const installs = rows.map((r) => r.inst);
    if (installs.length === 0) return [];

    // Newest run per installation (DISTINCT ON keeps the first row per key).
    const last = await this.db
      .selectDistinctOn([t.ciRuns.ciInstallationId], {
        installationId: t.ciRuns.ciInstallationId,
        status: t.ciRuns.status,
        ranAt: t.ciRuns.ranAt,
        verification: t.ciRuns.verification,
      })
      .from(t.ciRuns)
      .where(
        inArray(
          t.ciRuns.ciInstallationId,
          installs.map((i) => i.id),
        ),
      )
      .orderBy(t.ciRuns.ciInstallationId, desc(t.ciRuns.ranAt));
    const byId = new Map(last.map((l) => [l.installationId, l]));
    return installs.map((inst) => {
      const l = byId.get(inst.id);
      return {
        ...inst,
        lastRun: l ? { status: l.status, ranAt: l.ranAt, verification: l.verification } : null,
      };
    });
  }

  /** Installations to sync, optionally narrowed to one id. */
  async listInstallations(
    workspaceId: string,
    filter: { target: 'gha'; installationId?: string },
  ): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(
        and(
          this.inWorkspace(workspaceId),
          eq(t.ciInstallations.targetType, filter.target),
          filter.installationId ? eq(t.ciInstallations.id, filter.installationId) : undefined,
        ),
      )
      .orderBy(asc(t.ciInstallations.installedAt));
    return rows.map((r) => r.inst);
  }

  async getInstallation(workspaceId: string, id: string): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.ciInstallations.id, id), this.inWorkspace(workspaceId)))
      .limit(1);
    return row?.inst;
  }

  /** Installations of one repo (any agent of the workspace) — for slug collisions. */
  async listInstallationsForRepo(workspaceId: string, repo: string): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(this.inWorkspace(workspaceId), eq(t.ciInstallations.repo, repo)));
    return rows.map((r) => r.inst);
  }

  async markSynced(id: string, at: Date): Promise<void> {
    await this.db
      .update(t.ciInstallations)
      .set({ lastSyncedAt: at })
      .where(eq(t.ciInstallations.id, id));
  }

  /** Which of these GitHub run ids are already stored (idempotent re-sync). */
  async existingGithubRunIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: t.ciRuns.githubRunId })
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.githubRunId, ids));
    return new Set(rows.map((r) => r.id).filter((id): id is number => id != null));
  }

  /**
   * Write one CI run: `agent_runs` (source='ci') + `run_traces` + `ci_runs`,
   * atomically. A `ci_runs.github_run_id` conflict rolls the whole thing back,
   * so a concurrent or repeated ingest never leaves an orphan `agent_runs` row.
   */
  async ingestRun(values: IngestRunValues): Promise<'inserted' | 'duplicate'> {
    const trace = RunTrace.parse(values.trace);
    try {
      await this.db.transaction(async (tx) => {
        const [run] = await tx
          .insert(t.agentRuns)
          .values({
            workspaceId: values.workspaceId,
            agentId: values.agentId,
            prId: values.prId,
            provider: values.provider,
            model: values.model,
            status: values.status,
            source: 'ci',
            ranAt: values.ranAt,
            durationMs: values.durationMs,
            tokensIn: values.tokensIn,
            tokensOut: values.tokensOut,
            costUsd: values.costUsd,
            findingsCount: values.findingsCount,
            grounding: values.grounding,
            score: null,
            blockers: values.blockers,
            error: values.error,
          })
          .returning({ id: t.agentRuns.id });
        await tx.insert(t.runTraces).values({ runId: run!.id, trace });
        const c = values.ciRun;
        const inserted = await tx
          .insert(t.ciRuns)
          .values({
            ciInstallationId: c.ciInstallationId,
            prNumber: c.prNumber,
            ranAt: values.ranAt,
            status: c.status,
            findingsCount: c.findingsCount,
            costUsd: c.costUsd,
            githubUrl: c.jobUrl,
            source: 'gha',
            agentRunId: run!.id,
            githubRunId: c.githubRunId,
            githubRunAttempt: c.githubRunAttempt,
            repo: c.repo,
            headSha: c.headSha,
            jobUrl: c.jobUrl,
            verdict: c.verdict,
            verification: c.verification,
            durationMs: c.durationMs,
            reportedFindingsCount: c.reportedFindingsCount,
          })
          .onConflictDoNothing({ target: t.ciRuns.githubRunId })
          .returning({ id: t.ciRuns.id });
        if (inserted.length === 0) throw new DuplicateCiRun();
      });
      return 'inserted';
    } catch (err) {
      if (err instanceof DuplicateCiRun) return 'duplicate';
      throw err;
    }
  }

  /** CI runs for the CI Runs page / the CI tab, newest first. */
  async listRuns(
    workspaceId: string,
    query: CiRunsQuery & { limit?: number },
  ): Promise<CiRunListRow[]> {
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({
        run: t.ciRuns,
        agentId: t.agents.id,
        agentName: t.agents.name,
        model: t.agentRuns.model,
        grounding: t.agentRuns.grounding,
        manifestVersion: sql<string | null>`${t.runTraces.trace} -> 'config' ->> 'version'`,
        repoId: t.repos.id,
      })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .leftJoin(t.agentRuns, eq(t.ciRuns.agentRunId, t.agentRuns.id))
      .leftJoin(t.runTraces, eq(t.runTraces.runId, t.agentRuns.id))
      .leftJoin(
        t.repos,
        and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, t.ciRuns.repo)),
      )
      .where(
        and(
          this.inWorkspace(workspaceId),
          gte(t.ciRuns.ranAt, since),
          query.agent_id ? eq(t.agents.id, query.agent_id) : undefined,
          query.repo ? eq(t.ciRuns.repo, query.repo) : undefined,
          query.status ? eq(t.ciRuns.status, query.status) : undefined,
        ),
      )
      .orderBy(desc(t.ciRuns.ranAt))
      .limit(query.limit ?? CI_RUNS_LIST_LIMIT);
    return rows;
  }

  /** The studio PR id for `owner/name#n`, or null when it is not imported. */
  async findPullId(
    workspaceId: string,
    repoFullName: string,
    prNumber: number,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.repos.workspaceId, workspaceId),
          eq(t.repos.fullName, repoFullName),
          eq(t.pullRequests.number, prNumber),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** Global memory plus the target repo's own memory, oldest first. */
  async listMemoryForExport(workspaceId: string, repoId: string | null): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(t.memory)
      .where(
        and(
          eq(t.memory.workspaceId, workspaceId),
          repoId
            ? or(
                eq(t.memory.scope, 'global'),
                and(eq(t.memory.scope, 'repo'), eq(t.memory.repoId, repoId)),
              )
            : eq(t.memory.scope, 'global'),
        ),
      )
      .orderBy(asc(t.memory.createdAt))
      .limit(CI_MEMORY_MAX_ITEMS);
  }
}
