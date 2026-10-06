import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AddLabelBody, FindingLabel } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { FindingLabelService } from './service.js';

export default async function findingLabelRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new FindingLabelService(app.container);

  app.get('/findings/:id/labels', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post(
    '/findings/:id/labels',
    { schema: { params: IdParams, body: AddLabelBody, response: { 201: FindingLabel } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const label = await service.add(workspaceId, req.params.id, req.body);
      return reply.code(201).send(label);
    },
  );

  app.delete(
    '/labels/:id',
    { schema: { params: IdParams, response: { 204: z.null() } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.remove(workspaceId, req.params.id);
      return reply.code(204).send(null);
    },
  );
}
