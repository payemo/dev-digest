import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentRunRow, FindingRow, MultiAgentRunRow, PullRow, RepoRow } from '../../db/rows.js';

export type ReviewRow = typeof t.reviews.$inferSelect;
export type { AgentRunRow, FindingRow, MultiAgentRunRow };

/** One recent run's inputs to an agent's time/cost estimate. */
export type EstimateRow = {
  durationMs: number | null;
  costUsd: number | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
};

/** A child run of a parent, with its agent's current name. */
export type ChildRow = { run: AgentRunRow; agentName: string | null };

/** Everything needed to render one parent run, loaded in a fixed number of queries. */
export type ParentBundle = {
  parent: MultiAgentRunRow;
  pull: Pick<PullRow, 'id' | 'number' | 'title' | 'repoId'>;
  children: ChildRow[];
  reviews: ReviewRow[];
  findings: FindingRow[];
};

/**
 * Multi-agent read side. Reads `multi_agent_runs`, `agent_runs`, `reviews` and
 * `findings` directly (never through another module's repository). Every query
 * is scoped by `workspace_id`, directly or via the parent/review that carries it.
 */
export class MultiAgentRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped PR lookup. */
  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /** Workspace-scoped repo lookup. */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * An agent's most recent runs that are comparable for an estimate: successful
   * (`done`), local (never CI), and on the agent's CURRENT model — so a model
   * switch or pre-feature history never skews the average.
   */
  async estimateRows(
    workspaceId: string,
    agent: { id: string; model: string },
    limit: number,
  ): Promise<EstimateRow[]> {
    return this.db
      .select({
        durationMs: t.agentRuns.durationMs,
        costUsd: t.agentRuns.costUsd,
        model: t.agentRuns.model,
        tokensIn: t.agentRuns.tokensIn,
        tokensOut: t.agentRuns.tokensOut,
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.agentId, agent.id),
          eq(t.agentRuns.status, 'done'),
          eq(t.agentRuns.source, 'local'),
          eq(t.agentRuns.model, agent.model),
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt))
      .limit(limit);
  }

  /** Newest review summary per agent on this PR (`kind = 'review'`). */
  async latestSummaries(
    workspaceId: string,
    prId: string,
    agentIds: string[],
  ): Promise<Map<string, string>> {
    if (agentIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([t.reviews.agentId], {
        agentId: t.reviews.agentId,
        summary: t.reviews.summary,
      })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.reviews.prId, prId),
          eq(t.reviews.kind, 'review'),
          inArray(t.reviews.agentId, agentIds),
        ),
      )
      .orderBy(t.reviews.agentId, desc(t.reviews.createdAt));
    const out = new Map<string, string>();
    for (const r of rows) if (r.agentId && r.summary != null) out.set(r.agentId, r.summary);
    return out;
  }

  /** The newest parent run for a PR, if any. */
  async latestForPull(workspaceId: string, prId: string): Promise<MultiAgentRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.workspaceId, workspaceId), eq(t.multiAgentRuns.prId, prId)))
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(1);
    return row;
  }

  /** The newest parent run across a repo's PRs, with that PR's number. */
  async latestForRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<{ run: MultiAgentRunRow; prNumber: number } | undefined> {
    const [row] = await this.db
      .select({ run: t.multiAgentRuns, prNumber: t.pullRequests.number })
      .from(t.multiAgentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(
        and(
          eq(t.multiAgentRuns.workspaceId, workspaceId),
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
        ),
      )
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(1);
    return row;
  }

  /**
   * One parent with its PR, children (+ agent names), the children's reviews
   * and those reviews' findings — four queries total, never one per child.
   */
  async loadParent(workspaceId: string, multiAgentRunId: string): Promise<ParentBundle | undefined> {
    const [head] = await this.db
      .select({
        parent: t.multiAgentRuns,
        pull: {
          id: t.pullRequests.id,
          number: t.pullRequests.number,
          title: t.pullRequests.title,
          repoId: t.pullRequests.repoId,
        },
      })
      .from(t.multiAgentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(
        and(eq(t.multiAgentRuns.id, multiAgentRunId), eq(t.multiAgentRuns.workspaceId, workspaceId)),
      );
    if (!head) return undefined;

    const children = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(
        and(
          eq(t.agentRuns.multiAgentRunId, multiAgentRunId),
          eq(t.agentRuns.workspaceId, workspaceId),
        ),
      )
      // Children of one parent share ran_at (one transaction): order by agent
      // name so columns keep a stable, readable order across reloads.
      .orderBy(t.agents.name, t.agentRuns.id);

    const runIds = children.map((c) => c.run.id);
    const reviews =
      runIds.length === 0
        ? []
        : await this.db
            .select()
            .from(t.reviews)
            .where(and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.runId, runIds)));

    const reviewIds = reviews.map((r) => r.id);
    const findings =
      reviewIds.length === 0
        ? []
        : await this.db
            .select()
            .from(t.findings)
            .where(inArray(t.findings.reviewId, reviewIds))
            .orderBy(t.findings.file, t.findings.startLine);

    return {
      parent: head.parent,
      pull: head.pull,
      children: children.map((c) => ({ run: c.run, agentName: c.agentName ?? null })),
      reviews,
      findings,
    };
  }
}
