import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PrNote } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { toNote } from './helpers.js';
import { PrNoteService } from './service.js';

const AddNoteBody = z.object({ body: z.string().min(1) });

export default async function prNoteRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new PrNoteService(app.container);

  app.get(
    '/pulls/:id/notes',
    { schema: { params: IdParams, response: { 200: z.array(PrNote) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const rows = await app.container.db
        .select()
        .from(t.prNotes)
        .where(and(eq(t.prNotes.workspaceId, workspaceId), eq(t.prNotes.pullId, req.params.id)))
        .orderBy(desc(t.prNotes.createdAt));
      return rows.map(toNote);
    },
  );

  app.post(
    '/pulls/:id/notes',
    { schema: { params: IdParams, body: AddNoteBody, response: { 201: PrNote } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const note = await service.add(workspaceId, req.params.id, req.body.body);
      return reply.code(201).send(note);
    },
  );
}
