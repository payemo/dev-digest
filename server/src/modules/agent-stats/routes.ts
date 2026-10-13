import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentPerformance, AgentStats, StatsWindowQuery } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AgentStatsService } from './service.js';

/**
 * Agent stats. Read-only and workspace-scoped; both routes take the same
 * explicit `[from, to)` window so their numbers agree for the same agent.
 *   GET /agents/:id/stats?from&to   → one agent's AgentStats (404 outside the workspace)
 *   GET /agent-performance?from&to  → every agent's AgentStats + totals and breakdowns
 */
export default async function agentStatsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new AgentStatsService(app.container);

  app.get(
    '/agents/:id/stats',
    { schema: { params: IdParams, querystring: StatsWindowQuery, response: { 200: AgentStats } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agentStats(workspaceId, req.params.id, req.query);
    },
  );

  app.get(
    '/agent-performance',
    { schema: { querystring: StatsWindowQuery, response: { 200: AgentPerformance } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.performance(workspaceId, req.query);
    },
  );
}
