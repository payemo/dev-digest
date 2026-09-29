import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ContextAttachmentSetUpdate, ContextDocumentIntake } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { ProjectContextService } from './service.js';

/**
 * Project Context module.
 *   GET    /repos/:repoId/context/documents                        → the repo's documents
 *   GET    /repos/:repoId/context/documents/:docId                 → one document + its body
 *   POST   /repos/:repoId/context/documents                        → create (typed or uploaded)
 *   DELETE /repos/:repoId/context/documents/:docId                 → 204, user-authored only
 *   GET    /repos/:repoId/context/status                           → sync health
 *   POST   /repos/:repoId/context/refresh                          → rescan the clone
 *   GET/PUT /repos/:repoId/context/agents/:agentId/attachments     → an agent's ordered set
 *   GET/PUT /repos/:repoId/context/skills/:skillId/attachments     → a skill's ordered set
 *
 * The attachment routes live under the repo prefix rather than
 * `/agents/:id/...` so every route in this module resolves its repository the
 * same way — and so nothing collides with the agents module's own tree.
 *
 * Intake is a plain JSON body carrying the Markdown text: the browser reads the
 * chosen file and posts its contents, which needs no multipart plugin and no
 * new dependency.
 */

const RepoParams = z.object({ repoId: z.string().uuid() });
const DocParams = RepoParams.extend({ docId: z.string().uuid() });
const AgentParams = RepoParams.extend({ agentId: z.string().uuid() });
const SkillParams = RepoParams.extend({ skillId: z.string().uuid() });

export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ProjectContextService(app.container);

  /** Resolve the repo in the caller's workspace first, so an unknown or
   *  unowned repoId is a clean 404 rather than an empty list. */
  const requireRepo = async (workspaceId: string, repoId: string) => {
    const repo = await app.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');
  };

  app.get('/repos/:repoId/context/documents', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    await requireRepo(workspaceId, req.params.repoId);
    return service.listDocuments(workspaceId, req.params.repoId);
  });

  app.get(
    '/repos/:repoId/context/documents/:docId',
    { schema: { params: DocParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await requireRepo(workspaceId, req.params.repoId);
      return service.getDocument(workspaceId, req.params.repoId, req.params.docId);
    },
  );

  app.post(
    '/repos/:repoId/context/documents',
    { schema: { params: RepoParams, body: ContextDocumentIntake } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const doc = await service.createDocument(workspaceId, req.params.repoId, req.body);
      reply.status(201);
      return doc;
    },
  );

  app.delete(
    '/repos/:repoId/context/documents/:docId',
    { schema: { params: DocParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.deleteDocument(workspaceId, req.params.repoId, req.params.docId);
      reply.status(204);
    },
  );

  app.get('/repos/:repoId/context/status', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.status(workspaceId, req.params.repoId);
  });

  app.post('/repos/:repoId/context/refresh', { schema: { params: RepoParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.sync(workspaceId, req.params.repoId);
  });

  app.get(
    '/repos/:repoId/context/agents/:agentId/attachments',
    { schema: { params: AgentParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.attachments('agent', req.params.agentId, req.params.repoId, workspaceId);
    },
  );

  app.put(
    '/repos/:repoId/context/agents/:agentId/attachments',
    { schema: { params: AgentParams, body: ContextAttachmentSetUpdate } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAttachments(
        'agent',
        req.params.agentId,
        req.params.repoId,
        workspaceId,
        req.body.document_ids,
      );
    },
  );

  app.get(
    '/repos/:repoId/context/skills/:skillId/attachments',
    { schema: { params: SkillParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.attachments('skill', req.params.skillId, req.params.repoId, workspaceId);
    },
  );

  app.put(
    '/repos/:repoId/context/skills/:skillId/attachments',
    { schema: { params: SkillParams, body: ContextAttachmentSetUpdate } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.setAttachments(
        'skill',
        req.params.skillId,
        req.params.repoId,
        workspaceId,
        req.body.document_ids,
      );
    },
  );
}
