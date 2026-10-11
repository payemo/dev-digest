import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CiAgentOverview,
  CiExport,
  CiExportInput,
  CiPreview,
  CiPreviewInput,
  CiRun,
  CiRunnerResponse,
  CiRunsQuery,
  CiSyncResult,
  CiUpdateResponse,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
// The eval module's same-origin guard is a pure helper; shared, not duplicated.
import { isForeignOrigin } from '../eval/helpers.js';
import {
  CI_EXPORT_RATE_LIMIT_MAX,
  CI_RATE_LIMIT_WINDOW,
  CI_SYNC_RATE_LIMIT_MAX,
} from './constants.js';
import { CiService } from './service.js';
import { CiIngestService } from './ingest.js';

const SyncBody = z.object({ installation_id: z.string().uuid().optional() });

/**
 * Export to CI + CI Runs. Every route resolves the workspace first; an agent
 * or installation outside it is a 404. The client never supplies a run id,
 * a repository to sync, or any file path/content except the edited workflow.
 *   POST /agents/:id/ci/preview  → generated bundle (runner contents omitted)
 *   POST /agents/:id/export-ci   → commit to devdigest/ci + PR, or return files (201)
 *   POST /agents/:id/ci/update   → regenerate + recommit every PR installation
 *   GET  /agents/:id/ci          → the agent's CI tab
 *   GET  /agents/:id/ci/runner   → runner bundle for the client-side zip (409 if not built)
 *   GET  /ci/runs                → CI Runs page
 *   POST /ci/sync                → pull finished GitHub Actions runs back in
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);
  const ingest = new CiIngestService(app.container, service.repo, () => service.githubClient());
  const { webOrigin } = app.container.config;

  // These routes write to GitHub with the studio's token: refuse a browser
  // request from any origin but the studio's. No Origin header passes.
  const studioOriginOnly = async (req: FastifyRequest) => {
    if (isForeignOrigin(req.headers.origin, webOrigin)) {
      throw new AppError('forbidden_origin', 'Cross-origin request refused', 403);
    }
  };

  app.post(
    '/agents/:id/ci/preview',
    { schema: { params: IdParams, body: CiPreviewInput, response: { 200: CiPreview } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput, response: { 201: CiExport } },
      onRequest: studioOriginOnly,
      config: { rateLimit: { max: CI_EXPORT_RATE_LIMIT_MAX, timeWindow: CI_RATE_LIMIT_WINDOW } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.export(workspaceId, req.params.id, req.body);
      reply.status(201);
      return result;
    },
  );

  app.post(
    '/agents/:id/ci/update',
    {
      schema: { params: IdParams, response: { 200: CiUpdateResponse } },
      onRequest: studioOriginOnly,
      config: { rateLimit: { max: CI_EXPORT_RATE_LIMIT_MAX, timeWindow: CI_RATE_LIMIT_WINDOW } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateConfig(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/ci',
    { schema: { params: IdParams, response: { 200: CiAgentOverview } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.overview(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/ci/runner',
    { schema: { params: IdParams, response: { 200: CiRunnerResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runner(workspaceId, req.params.id);
    },
  );

  app.get(
    '/ci/runs',
    { schema: { querystring: CiRunsQuery, response: { 200: z.array(CiRun) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listRuns(workspaceId, req.query);
    },
  );

  app.post(
    '/ci/sync',
    {
      schema: { body: SyncBody.nullish(), response: { 200: CiSyncResult } },
      onRequest: studioOriginOnly,
      config: { rateLimit: { max: CI_SYNC_RATE_LIMIT_MAX, timeWindow: CI_RATE_LIMIT_WINDOW } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return ingest.sync(workspaceId, { installationId: req.body?.installation_id });
    },
  );
}
