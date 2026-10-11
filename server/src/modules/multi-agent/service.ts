import type { Container } from '../../platform/container.js';
import type { MultiAgentCandidate, MultiAgentRunRef, MultiAgentRunView } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { effectiveRunCost, type Estimator } from '../../platform/run-cost.js';
import { MultiAgentRepository, type FindingRow, type ReviewRow } from './repository.js';
import { ESTIMATE_SAMPLE_SIZE } from './constants.js';
import {
  averageEstimate,
  buildDisagreements,
  childToColumn,
  computeTotals,
  deriveParentStatus,
  failedRunCost,
  groupFindings,
} from './helpers.js';

/**
 * Multi-Agent Review read side: the picker's candidates (with estimates and
 * latest summaries), a PR's latest parent run as one view, and the repo's
 * latest parent for the area landing. Starting a run stays on
 * `POST /pulls/:id/review` (reviews module).
 */
export class MultiAgentService {
  private repo: MultiAgentRepository;
  private agents: Container['agentsRepo'];

  constructor(private container: Container) {
    this.repo = new MultiAgentRepository(container.db);
    this.agents = container.agentsRepo;
  }

  private get estimate(): Estimator {
    return (m, i, o) => this.container.priceBook.estimate(m, i, o);
  }

  /** Enabled agents of the workspace, each with its estimate and latest summary on this PR. */
  async candidates(workspaceId: string, prId: string): Promise<MultiAgentCandidate[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const enabled = await this.agents.listEnabled(workspaceId);
    const [samples, summaries] = await Promise.all([
      Promise.all(
        enabled.map((a) => this.repo.estimateRows(workspaceId, a, ESTIMATE_SAMPLE_SIZE)),
      ),
      this.repo.latestSummaries(
        workspaceId,
        prId,
        enabled.map((a) => a.id),
      ),
    ]);

    return enabled
      .map((a, i) => ({
        agent_id: a.id,
        agent_name: a.name,
        provider: a.provider,
        model: a.model,
        description: a.description,
        latest_summary: summaries.get(a.id) ?? null,
        estimate: averageEstimate(
          samples[i]!.map((r) => ({
            durationMs: r.durationMs,
            cost: effectiveRunCost(r, this.estimate),
          })),
        ),
      }))
      .sort((x, y) => x.agent_name.localeCompare(y.agent_name));
  }

  /** The PR's latest parent run as one view, or null when it has none. */
  async viewLatestForPull(workspaceId: string, prId: string): Promise<MultiAgentRunView | null> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const latest = await this.repo.latestForPull(workspaceId, prId);
    if (!latest) return null;
    const bundle = await this.repo.loadParent(workspaceId, latest.id);
    if (!bundle) return null;

    const reviewByRun = new Map<string, ReviewRow>();
    for (const r of bundle.reviews) if (r.runId) reviewByRun.set(r.runId, r);
    const findingsByReview = new Map<string, FindingRow[]>();
    for (const f of bundle.findings) {
      const list = findingsByReview.get(f.reviewId) ?? [];
      list.push(f);
      findingsByReview.set(f.reviewId, list);
    }

    const failedCosts: (number | null)[] = [];
    const columns = bundle.children.map(({ run, agentName }) => {
      const review = reviewByRun.get(run.id);
      let cost: number | null = null;
      if (run.status === 'done') cost = effectiveRunCost(run, this.estimate);
      else if (run.status === 'failed' || run.status === 'cancelled') {
        cost = failedRunCost(run, this.estimate);
        failedCosts.push(cost);
      }
      return childToColumn(
        run,
        agentName,
        review,
        review ? (findingsByReview.get(review.id) ?? []) : [],
        cost,
      );
    });

    const groups = groupFindings(columns);
    return {
      id: bundle.parent.id,
      pr_id: bundle.pull.id,
      pr_number: bundle.pull.number,
      pr_title: bundle.pull.title,
      repo_id: bundle.pull.repoId,
      ran_at: bundle.parent.ranAt.toISOString(),
      status: deriveParentStatus(columns.map((c) => c.status)),
      ...computeTotals(columns, failedCosts),
      columns,
      groups,
      disagreements: buildDisagreements(columns, groups),
    };
  }

  /** Pointer to the repo's latest parent run, or null when it has none. */
  async latestRefForRepo(workspaceId: string, repoId: string): Promise<MultiAgentRunRef | null> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const latest = await this.repo.latestForRepo(workspaceId, repoId);
    if (!latest) return null;
    return {
      id: latest.run.id,
      pr_id: latest.run.prId,
      pr_number: latest.prNumber,
      ran_at: latest.run.ranAt.toISOString(),
    };
  }
}
