/**
 * Export to CI routes — the guards that run BEFORE any handler, so they are
 * checked hermetically via `app.inject()` with no database (postgres-js
 * connects lazily and none of these requests reach a query).
 *
 * Kinds of breakage covered: a cross-site page making the studio commit to
 * GitHub with its token (CSRF), a malformed body reaching the service, and the
 * GitHub-writing routes losing their per-route rate limit.
 * Workspace scoping (404 for another workspace's agent) needs a DB and lives in
 * `ci.it.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import {
  MockAuthProvider,
  MockGitHubClient,
  MockLLMProvider,
  MockRunnerBundleSource,
} from '../src/adapters/mocks.js';
import { CI_EXPORT_RATE_LIMIT_MAX } from '../src/modules/ci/constants.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
const AGENT = '00000000-0000-4000-8000-000000000001';
const FOREIGN = 'https://evil.example';

let app: FastifyInstance;
let gh: MockGitHubClient;

beforeAll(async () => {
  gh = new MockGitHubClient();
  const llm = new MockLLMProvider('openai');
  app = await buildApp({
    config,
    overrides: {
      auth: new MockAuthProvider(),
      github: gh,
      llm: { openai: llm, anthropic: llm, openrouter: llm },
      runnerBundle: new MockRunnerBundleSource(),
    },
  });
});
afterAll(async () => {
  await app?.close();
});

describe('CI routes — same-origin guard', () => {
  it.each([
    ['POST', `/agents/${AGENT}/export-ci`, { repo: 'acme/api' }],
    ['POST', `/agents/${AGENT}/ci/update`, undefined],
    ['POST', '/ci/sync', {}],
  ] as const)('%s %s from a foreign Origin is 403 and touches nothing', async (method, url, payload) => {
    const res = await app.inject({
      method,
      url,
      headers: { origin: FOREIGN },
      ...(payload ? { payload } : {}),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden_origin');
    expect(gh.committed).toHaveLength(0);
    expect(gh.openedPrs).toHaveLength(0);
  });
});

describe('CI routes — body validation (422 before the handler)', () => {
  it.each([
    ['export with no triggers', `/agents/${AGENT}/export-ci`, { repo: 'acme/api', triggers: [] }],
    ['export with an unknown trigger', `/agents/${AGENT}/export-ci`, { repo: 'acme/api', triggers: ['push'] }],
    ['export with an unknown action', `/agents/${AGENT}/export-ci`, { repo: 'acme/api', action: 'push_to_main' }],
    ['export with an oversized workflow', `/agents/${AGENT}/export-ci`, { repo: 'acme/api', workflow_yaml: 'x'.repeat(20_001) }],
    ['export with an empty repo', `/agents/${AGENT}/export-ci`, { repo: '' }],
    ['preview with an unknown target', `/agents/${AGENT}/ci/preview`, { repo: 'acme/api', target: 'travis' }],
    ['sync with a non-uuid installation id', '/ci/sync', { installation_id: '1 OR 1=1' }],
  ])('%s', async (_label, url, payload) => {
    const res = await app.inject({ method: 'POST', url, payload });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('rejects a non-uuid agent id and a bad runs query', async () => {
    expect((await app.inject({ method: 'GET', url: '/agents/not-a-uuid/ci' })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/ci/runs?days=365' })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/ci/runs?status=hacked' })).statusCode).toBe(422);
  });
});

describe('CI routes — rate limit', () => {
  it(`export-ci allows ${CI_EXPORT_RATE_LIMIT_MAX} requests per window, then 429`, async () => {
    // The rate-limit plugin is not registered under NODE_ENV=test, so build a
    // fresh app as in development (also: no earlier request counts here).
    const fresh = await buildApp({
      config: { ...config, nodeEnv: 'development', logLevel: 'silent' },
      overrides: { auth: new MockAuthProvider(), github: new MockGitHubClient() },
    });
    try {
      const codes: number[] = [];
      for (let i = 0; i <= CI_EXPORT_RATE_LIMIT_MAX; i++) {
        // Invalid body → 422 without touching the DB; still counted by the limiter.
        const res = await fresh.inject({
          method: 'POST',
          url: `/agents/${AGENT}/export-ci`,
          payload: { repo: 'acme/api', triggers: [] },
        });
        codes.push(res.statusCode);
      }
      // The global limit is 120/min; only the route's own limit yields 429 here.
      expect(codes.slice(0, -1)).toEqual(Array(CI_EXPORT_RATE_LIMIT_MAX).fill(422));
      expect(codes.at(-1)).toBe(429);
    } finally {
      await fresh.close();
    }
  });
});
