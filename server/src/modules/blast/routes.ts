import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadiusResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * Blast Radius module (L04).
 *   GET /pulls/:id/blast → for every symbol this PR's changed files declare:
 *                          who calls it, and which HTTP endpoints / scheduled
 *                          jobs depend on those callers.
 *
 * This is the per-lesson `blast` module the registry in `modules/index.ts`
 * already anticipates, and deliberately NOT another handler on
 * `pulls/routes.ts`: the module registry is how a lesson feature is added
 * without touching any other module, and `pulls/routes.ts` is on the
 * dependency-cruiser debt list.
 *
 * It makes NO model call and reads NO new table — the symbol graph, resolved
 * references, file ranks and file facts are all written by the repo-intel
 * indexer at clone time. So it works on a PR that has never been reviewed, and
 * on an unindexed repo it returns a degraded-but-valid response rather than an
 * error.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Built once at plugin load, like every other module: forcing the lazy
  // `repoIntel` getter here is safe because the container is constructed before
  // the feature modules are registered, so a test's override is already in place.
  const service = new BlastService(app.container.reviewRepo, app.container.repoIntel);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadiusResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.forPull(workspaceId, req.params.id);
    },
  );
}
