import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ReviewExport } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EXPORT_FORMATS } from './constants.js';
import { ReviewExportService } from './service.js';

const ExportQuery = z.object({ format: z.enum(EXPORT_FORMATS).default('json') });

export default async function reviewExportRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ReviewExportService(app.container);

  app.get(
    '/reviews/:id/export',
    { schema: { params: IdParams, querystring: ExportQuery, response: { 200: ReviewExport } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.export(workspaceId, req.params.id, req.query.format);
    },
  );
}
