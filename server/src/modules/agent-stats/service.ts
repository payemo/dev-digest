import type { AgentPerformance, AgentStats, StatsWindowQuery } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Estimator } from '../../platform/run-cost.js';
import { AgentStatsRepository } from './repository.js';
import {
  attachComparison,
  buildPerformance,
  buildSnapshot,
  previousWindow,
  type Window,
  type WindowSnapshot,
} from './helpers.js';

/**
 * Agent stats read side: one agent's Stats tab and the workspace-wide Agent
 * Performance dashboard. Both go through `compute`, for the requested window
 * and for the equal-length window before it, so a dashboard row and a Stats
 * tab response are identical for the same window.
 *
 * Reads stored runs and findings only — no model is ever called. The one
 * possible outbound effect is `PriceBook`'s lazy price-list refresh while
 * pricing runs that stored no cost (no inference; the PR list does the same).
 */
export class AgentStatsService {
  private repo: AgentStatsRepository;

  constructor(private container: Container) {
    this.repo = new AgentStatsRepository(container.db);
  }

  private get estimate(): Estimator {
    return (m, i, o) => this.container.priceBook.estimate(m, i, o);
  }

  private async compute(
    workspaceId: string,
    window: Window,
    agentId?: string,
  ): Promise<WindowSnapshot> {
    const { from, to } = window;
    const [agents, runs, statuses, decisions] = await Promise.all([
      this.repo.listAgents(workspaceId, agentId),
      this.repo.doneRuns(workspaceId, from, to, agentId),
      this.repo.runStatusCounts(workspaceId, from, to, agentId),
      this.repo.decisionCounts(workspaceId, from, to, agentId),
    ]);
    return buildSnapshot({ window, agents, runs, statuses, decisions, estimate: this.estimate });
  }

  /** One agent's stats for the window, with its previous-window comparison. */
  async agentStats(workspaceId: string, agentId: string, query: StatsWindowQuery): Promise<AgentStats> {
    const window = toWindow(query);
    const prevWindow = previousWindow(window);
    const [current, previous] = await Promise.all([
      this.compute(workspaceId, window, agentId),
      this.compute(workspaceId, prevWindow, agentId),
    ]);
    const [row] = current.agents;
    if (!row) throw new NotFoundError('Agent not found');
    return attachComparison(row, previous.agents[0], prevWindow);
  }

  /** Every agent's stats for the window, plus totals, breakdowns and deltas. */
  async performance(workspaceId: string, query: StatsWindowQuery): Promise<AgentPerformance> {
    const window = toWindow(query);
    const [current, previous] = await Promise.all([
      this.compute(workspaceId, window),
      this.compute(workspaceId, previousWindow(window)),
    ]);
    return buildPerformance(current, previous);
  }
}

function toWindow(query: StatsWindowQuery): Window {
  return { from: new Date(query.from), to: new Date(query.to) };
}
