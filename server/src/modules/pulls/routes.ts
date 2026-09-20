import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PrMeta, PrDetail, PrReviewComment } from '@devdigest/shared';
import { PrMeta as PrMetaSchema, PrDetail as PrDetailSchema, PrReviewComment as PrReviewCommentSchema, PrCommentInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PullsService } from './service.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list PRs for a repo (open + recently merged/closed,
 *                          synced from GitHub, persisted). `status` is GitHub's
 *                          merge state (open/merged/closed).
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new PullsService(container);

  app.get(
    '/repos/:id/pulls',
    { schema: { params: IdParams, response: { 200: z.array(PrMetaSchema) } } },
    async (req): Promise<PrMeta[]> => {
      const { workspaceId } = await getContext(container, req);
      return service.listForRepo(workspaceId, req.params.id, app.log);
    },
  );

  app.get(
    '/pulls/:id',
    { schema: { params: IdParams, response: { 200: PrDetailSchema } } },
    async (req): Promise<PrDetail> => {
      const { workspaceId } = await getContext(container, req);
      return service.getDetail(workspaceId, req.params.id, app.log);
    },
  );

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.
  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams, response: { 200: z.array(PrReviewCommentSchema) } } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(container, req);
      return service.listComments(workspaceId, req.params.id, app.log);
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput, response: { 200: PrReviewCommentSchema } } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      return service.postComment(workspaceId, req.params.id, req.body);
    },
  );
}
