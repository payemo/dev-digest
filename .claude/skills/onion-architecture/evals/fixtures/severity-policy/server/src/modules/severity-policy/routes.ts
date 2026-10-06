import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SeverityPolicy } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SeverityPolicyService } from './service.js';

export default async function severityPolicyRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SeverityPolicyService(app.container);

  app.get(
    '/agents/:id/severity-policy',
    { schema: { params: IdParams, response: { 200: SeverityPolicy } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getPolicy(workspaceId, req.params.id);
    },
  );

  app.put(
    '/agents/:id/severity-policy',
    { schema: { params: IdParams, response: { 200: SeverityPolicy } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setPolicy(req, workspaceId, req.params.id);
    },
  );
}
