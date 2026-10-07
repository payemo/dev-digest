import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Digest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { DIGEST_JOB_KIND } from './constants.js';
import { DigestService } from './service.js';

const BuildBody = z.object({ from: z.coerce.date(), to: z.coerce.date() });
const JobAccepted = z.object({ job_id: z.string() });

export default async function digestRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new DigestService(app.container);

  app.get('/digest/latest', { schema: { response: { 200: Digest } } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.latest(workspaceId);
  });

  app.post(
    '/digest/build',
    { schema: { body: BuildBody, response: { 202: JobAccepted } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const job = await app.container.jobs.enqueue(workspaceId, DIGEST_JOB_KIND, {
        workspaceId,
        from: req.body.from.toISOString(),
        to: req.body.to.toISOString(),
      });
      return reply.code(202).send({ job_id: job.id });
    },
  );
}
