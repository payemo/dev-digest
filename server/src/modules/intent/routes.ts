import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrIntentRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * Intent module (L03).
 *   GET  /pulls/:id/intent → the persisted record, or `null`
 *   POST /pulls/:id/intent → derive now (one paid model call), 409 while one
 *                            is already in flight for that PR
 *
 * Deliberately NOT part of `PrDetail`: that DTO is served from
 * `pulls/routes.ts` (the module we may not add queries to) and is refetched on
 * every PR page focus — coupling a paid derivation to that cadence would be
 * wrong. `GET` returns `null` rather than 404 for a PR with no row yet, so the
 * client stays on one code path with no error branch.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new IntentService(app.container);

  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentRecord.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id);
    },
  );

  app.post(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: PrIntentRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.derive(workspaceId, req.params.id);
    },
  );
}
