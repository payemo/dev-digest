import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { getRunTrace, cancelRunIfRunning } from '../src/modules/reviews/repository/run.repo.js';

/**
 * Workspace-scoping for `getRunTrace` / `cancelRunIfRunning` — Wave 2 of the
 * post-audit hardening pass. Before this, both queried `agent_runs`/`run_traces`
 * by `runId` alone, so a caller in workspace B who knew (or enumerated) a
 * workspace-A runId could read that run's full trace — system prompt, whole
 * PR diff, raw model output — or cancel someone else's in-flight run.
 *
 * Exercised directly at the repository layer (not through HTTP) because that's
 * where the fix actually lives; `getContext` always resolving the same single
 * workspace in this MVP (LocalNoAuthProvider) makes an HTTP-level test unable
 * to construct two distinct tenants without also faking auth, which would
 * just be re-testing this same repository call one layer up.
 */
const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

async function makeWorkspace(db: PgFixture['handle']['db'], name: string) {
  const [row] = await db.insert(t.workspaces).values({ name }).returning();
  return row!.id;
}

async function makeAgentRun(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  status: 'running' | 'done' = 'running',
) {
  const [row] = await db
    .insert(t.agentRuns)
    .values({ workspaceId, agentId: null, prId: null, status })
    .returning();
  return row!.id;
}

d('run.repo tenancy (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
  }, 120_000);

  afterAll(async () => {
    await pg.stop();
  });

  describe('getRunTrace', () => {
    it('returns undefined for a run that belongs to a different workspace', async () => {
      const wsA = await makeWorkspace(db, 'ws-a');
      const wsB = await makeWorkspace(db, 'ws-b');
      const runId = await makeAgentRun(db, wsA, 'done');
      const trace = {
        config: { agent: 'Security Reviewer', version: '1', provider: 'openrouter', model: 'gpt-4.1', pr: 1, source: 'local' },
        stats: { duration_ms: 100, tokens_in: 10, tokens_out: 5, findings: 0, grounding: '0/0 passed' },
        prompt_assembly: { system: 's', user: 'u' },
        tool_calls: [],
        raw_output: '',
        memory_pulled: [],
        specs_read: [],
        log: [],
      };
      await db.insert(t.runTraces).values({ runId, trace });

      await expect(getRunTrace(db, wsB, runId)).resolves.toBeUndefined();
      await expect(getRunTrace(db, wsA, runId)).resolves.toEqual(trace);
    });
  });

  describe('cancelRunIfRunning', () => {
    it('does not cancel a running run that belongs to a different workspace', async () => {
      const wsA = await makeWorkspace(db, 'ws-a');
      const wsB = await makeWorkspace(db, 'ws-b');
      const runId = await makeAgentRun(db, wsA, 'running');

      await expect(cancelRunIfRunning(db, wsB, runId)).resolves.toBe(false);

      const [row] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      expect(row!.status).toBe('running');
    });

    it('cancels a running run in the caller\'s own workspace', async () => {
      const wsA = await makeWorkspace(db, 'ws-a');
      const runId = await makeAgentRun(db, wsA, 'running');

      await expect(cancelRunIfRunning(db, wsA, runId)).resolves.toBe(true);

      const [row] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      expect(row!.status).toBe('cancelled');
    });
  });
});
