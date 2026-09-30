import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PrBriefRecord } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

/**
 * PR Brief module (L05).
 *   GET  /pulls/:id/brief → the persisted brief record, or `null`
 *   POST /pulls/:id/brief → generate now (one paid model call), 409 while one
 *                           is already in flight for that PR
 *
 * `GET` returns `null` rather than 404 for "no brief yet", so the client stays
 * on one code path; it never calls the model or GitHub, and flags the record
 * `is_stale` when the PR's head has moved since generation. Both verbs resolve
 * the PR inside the caller's workspace and 404 otherwise.
 *
 * The service is route-local (no Container getter): nothing else consumes it,
 * which also keeps exactly one in-flight guard per process.
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new BriefService(app.container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBriefRecord.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.get(workspaceId, req.params.id, req.log);
    },
  );

  app.post(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: PrBriefRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.generate(workspaceId, req.params.id, req.log);
    },
  );
}
