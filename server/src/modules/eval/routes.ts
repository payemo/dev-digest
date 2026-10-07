import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalAgentDetail,
  EvalAgentRun,
  EvalAgentRunDetail,
  EvalCaseFromFindingInput,
  EvalCaseInput,
  EvalCaseRecord,
  EvalCaseResult,
  EvalCaseSeed,
  EvalCompare,
  EvalPromoteInput,
  EvalPromoteResult,
  EvalRunAllResult,
  EvalStartResult,
  EvalWorkspaceDashboard,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import {
  EVAL_CASE_RUN_RATE_LIMIT_MAX,
  EVAL_DEFAULT_WINDOW_DAYS,
  EVAL_RATE_LIMIT_WINDOW,
  EVAL_RUN_RATE_LIMIT_MAX,
} from './constants.js';
import { isForeignOrigin } from './helpers.js';
import { EvalService } from './service.js';

/** `?days=` — the time window of history/detail reads. */
const WindowQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(EVAL_DEFAULT_WINDOW_DAYS),
});

/** `GET /eval/compare?a=&b=` — two run ids. */
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

const Ok = z.object({ ok: z.literal(true) });

/**
 * Eval pipeline module (L06). Every route resolves the workspace first; any
 * case, run, finding or agent outside it is a 404.
 *   GET    /findings/:id/eval-case     → seeded draft (or the existing case)
 *   POST   /findings/:id/eval-case     → save the seeded case (201 new, 200 existing)
 *   GET    /agents/:id/eval/cases      → the agent's cases + last results
 *   POST   /agents/:id/eval/cases      → hand-made case (201; 409 on duplicate name)
 *   PUT    /eval/cases/:id             → edit a case
 *   DELETE /eval/cases/:id             → delete a case (history is kept)
 *   POST   /eval/cases/:id/run         → single-case run (not part of history)
 *   POST   /agents/:id/eval/runs       → start a full run (202) or re-attach (200)
 *   GET    /agents/:id/eval/runs       → full runs in the window, newest first
 *   GET    /eval/runs/:id              → one run + its per-case results (progress)
 *   GET    /agents/:id/eval/detail     → per-agent page: tiles, trend, alert, in-flight
 *   GET    /eval/dashboard             → every agent with cases + recent runs
 *   POST   /eval/runs/all              → start (or re-attach) a run per agent with cases
 *   GET    /eval/compare?a=&b=         → compare two runs of one agent
 *   POST   /agents/:id/eval/promote    → promote the run's agent version
 */
export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new EvalService(app.container);
  const { webOrigin } = app.container.config;

  // CORS stops another site reading a response, not sending the request: the
  // routes that spend model credits refuse any Origin but the studio's. No
  // Origin header (curl, server-to-server, tests) passes.
  const studioOriginOnly = async (req: FastifyRequest) => {
    if (isForeignOrigin(req.headers.origin, webOrigin)) {
      throw new AppError('forbidden_origin', 'Cross-origin request refused', 403);
    }
  };

  app.get(
    '/findings/:id/eval-case',
    { schema: { params: IdParams, response: { 200: EvalCaseSeed } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.seedFromFinding(workspaceId, req.params.id);
    },
  );

  app.post(
    '/findings/:id/eval-case',
    {
      schema: {
        params: IdParams,
        // A body-less POST arrives as null: "save with no edits" is the common case.
        body: EvalCaseFromFindingInput.nullish(),
        response: { 200: EvalCaseRecord, 201: EvalCaseRecord },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const { record, created } = await service.createFromFinding(
        workspaceId,
        req.params.id,
        req.body ?? {},
      );
      reply.status(created ? 201 : 200);
      return record;
    },
  );

  app.get(
    '/agents/:id/eval/cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCaseRecord) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  app.post(
    '/agents/:id/eval/cases',
    { schema: { params: IdParams, body: EvalCaseInput, response: { 201: EvalCaseRecord } } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const record = await service.createCase(workspaceId, req.params.id, req.body);
      reply.status(201);
      return record;
    },
  );

  app.put(
    '/eval/cases/:id',
    { schema: { params: IdParams, body: EvalCaseInput, response: { 200: EvalCaseRecord } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete(
    '/eval/cases/:id',
    { schema: { params: IdParams, response: { 200: Ok } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      await service.deleteCase(workspaceId, req.params.id);
      return { ok: true as const };
    },
  );

  // Tight per-route limit: each call is a synchronous paid model call.
  app.post(
    '/eval/cases/:id/run',
    {
      schema: { params: IdParams, response: { 200: EvalCaseResult } },
      onRequest: studioOriginOnly,
      config: { rateLimit: { max: EVAL_CASE_RUN_RATE_LIMIT_MAX, timeWindow: EVAL_RATE_LIMIT_WINDOW } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runCase(workspaceId, req.params.id);
    },
  );

  // Tight per-route limit: a full run fans out to one model call per case.
  app.post(
    '/agents/:id/eval/runs',
    {
      schema: { params: IdParams, response: { 200: EvalStartResult, 202: EvalStartResult } },
      onRequest: studioOriginOnly,
      config: { rateLimit: { max: EVAL_RUN_RATE_LIMIT_MAX, timeWindow: EVAL_RATE_LIMIT_WINDOW } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.startRun(workspaceId, req.params.id, req.log);
      reply.status(result.attached ? 200 : 202);
      return result;
    },
  );

  app.get(
    '/agents/:id/eval/runs',
    {
      schema: { params: IdParams, querystring: WindowQuery, response: { 200: z.array(EvalAgentRun) } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listRuns(workspaceId, req.params.id, req.query.days);
    },
  );

  app.get(
    '/eval/runs/:id',
    { schema: { params: IdParams, response: { 200: EvalAgentRunDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );

  app.get(
    '/agents/:id/eval/detail',
    { schema: { params: IdParams, querystring: WindowQuery, response: { 200: EvalAgentDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.agentDetail(workspaceId, req.params.id, req.query.days);
    },
  );

  app.get(
    '/eval/dashboard',
    { schema: { response: { 200: EvalWorkspaceDashboard } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.dashboard(workspaceId);
    },
  );

  // Tight per-route limit: fans out to a full run for every agent with cases.
  app.post(
    '/eval/runs/all',
    {
      schema: { response: { 200: EvalRunAllResult } },
      onRequest: studioOriginOnly,
      config: { rateLimit: { max: EVAL_RUN_RATE_LIMIT_MAX, timeWindow: EVAL_RATE_LIMIT_WINDOW } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.runAll(workspaceId, req.log);
    },
  );

  app.get(
    '/eval/compare',
    { schema: { querystring: CompareQuery, response: { 200: EvalCompare } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.compare(workspaceId, req.query.a, req.query.b);
    },
  );

  app.post(
    '/agents/:id/eval/promote',
    { schema: { params: IdParams, body: EvalPromoteInput, response: { 200: EvalPromoteResult } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.promote(workspaceId, req.params.id, req.body.run_id);
    },
  );
}
