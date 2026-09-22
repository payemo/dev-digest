import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ConventionSkillCreate, ConventionUpdate } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * Conventions Extractor module.
 *   GET    /repos/:id/conventions              → candidates for the repo (survives reload)
 *   POST   /repos/:id/conventions/extract       → run a scan (one model call)
 *   GET    /repos/:id/conventions/skill-draft   → draft skill from APPROVED candidates (writes nothing)
 *   POST   /repos/:id/conventions/skill         → create/replace the `repo-conventions` skill
 *   PATCH  /conventions/:id                     → accept / reject / edit
 *   DELETE /conventions/:id                     → drop a candidate
 *
 * Repo-scoped routes 404 through `reposRepo` before touching the conventions
 * table, the same tenancy pattern `repo-intel/routes.ts` uses — `conventions`
 * DOES carry `workspace_id` directly, but resolving the repo first also turns
 * an unknown repoId into a clean 404 instead of an empty list.
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const repo = await app.container.reposRepo.getById(workspaceId, req.params.id);
    if (!repo) throw new NotFoundError('Repository not found');
    return service.list(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get(
    '/repos/:id/conventions/skill-draft',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillDraft(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: ConventionSkillCreate } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.createSkill(workspaceId, req.params.id, req.body);
      // 201 for a fresh skill, 200 for an explicit replace (req.body.replace_skill_id set).
      reply.status(req.body.replace_skill_id ? 200 : 201);
      return skill;
    },
  );

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: ConventionUpdate } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const row = await service.update(workspaceId, req.params.id, req.body);
      if (!row) throw new NotFoundError('Convention not found');
      return row;
    },
  );

  app.delete('/conventions/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Convention not found');
    return { ok: true };
  });
}
