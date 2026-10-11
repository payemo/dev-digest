import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MultiAgentCandidate, MultiAgentRunRef, MultiAgentRunView } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiAgentService } from './service.js';

/**
 * Multi-Agent Review module (read side; runs start on `POST /pulls/:id/review`).
 *   GET /pulls/:id/multi-agent/candidates → enabled agents + estimates + latest summary
 *   GET /pulls/:id/multi-agent/latest     → the PR's latest parent run view, or null
 *   GET /repos/:id/multi-agent/latest     → ref to the repo's latest parent run, or null
 * A PR or repo outside the workspace is a 404.
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentService(container);

  app.get(
    '/pulls/:id/multi-agent/candidates',
    { schema: { params: IdParams, response: { 200: z.array(MultiAgentCandidate) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.candidates(workspaceId, req.params.id);
    },
  );

  app.get(
    '/pulls/:id/multi-agent/latest',
    { schema: { params: IdParams, response: { 200: MultiAgentRunView.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.viewLatestForPull(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/multi-agent/latest',
    { schema: { params: IdParams, response: { 200: MultiAgentRunRef.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.latestRefForRepo(workspaceId, req.params.id);
    },
  );
}
