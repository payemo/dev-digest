import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SmartDiff } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * Smart Diff module (L04).
 *   GET /pulls/:id/smart-diff → the PR's changed files grouped by role
 *                               (core → tests → wiring → docs → boilerplate)
 *
 * Deliberately its OWN module rather than another endpoint on
 * `pulls/routes.ts`: the module registry is how a lesson feature is added
 * without touching any other module, and `pulls/routes.ts` is on the
 * dependency-cruiser debt list ("do not add a new query to them").
 *
 * The response is an ORDERING INDEX, not a second copy of the diff — it
 * carries no patch text, because the client already holds the patches from
 * `GET /pulls/:id` and joins the two by path. Grouping involves no model call
 * and reads no new table, so it works on a PR that has never been reviewed.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SmartDiffService(app.container.reviewRepo);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiff } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.forPull(workspaceId, req.params.id);
    },
  );
}
