import { describe, it, expect, vi } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import type { Db } from '../src/db/client.js';

/**
 * Unit coverage for two JobRunner behaviours that don't show up in a diff:
 *
 *  - a failed job's persisted `error` must not carry credentials embedded in
 *    a URL (simple-git's stderr echoes the tokenized clone URL verbatim);
 *  - a job that permanently fails must not become an unhandled promise
 *    rejection — no call site awaits `EnqueuedJob.done` today, and Node's
 *    default is to crash the process on one.
 *
 * A minimal fake `Db` stands in for Drizzle: JobRunner only ever calls
 * `insert(...).values(...).returning(...)` once and `update(...).set(...).
 * where(...)` repeatedly, so the fake only needs that chain shape.
 */

function fakeDb() {
  const updates: Record<string, unknown>[] = [];
  let n = 0;
  const db = {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: `job-${++n}` }],
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          updates.push(patch);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, updates };
}

describe('JobRunner', () => {
  it('redacts embedded credentials from the persisted error message', async () => {
    const { db, updates } = fakeDb();
    const runner = new JobRunner(db, { retries: 0 });
    const secretUrl = 'https://x-access-token:ghp_supersecrettoken@github.com/o/r.git';
    runner.register('clone', async () => {
      throw new Error(`Cloning into '/tmp/x' failed: could not access '${secretUrl}'`);
    });

    const { done } = await runner.enqueue('ws-1', 'clone', {});
    await done.catch(() => {}); // rejection is expected; assert on the DB write below

    const failedUpdate = updates.find((u) => u.status === 'failed');
    expect(failedUpdate).toBeDefined();
    const errorMessage = failedUpdate!.error as string;
    expect(errorMessage).not.toContain('ghp_supersecrettoken');
    expect(errorMessage).toContain('https://***:***@github.com/o/r.git');
  });

  it('does not raise an unhandled rejection when a job permanently fails and nobody awaits .done', async () => {
    const { db } = fakeDb();
    const runner = new JobRunner(db, { retries: 0 });
    runner.register('clone', async () => {
      throw new Error('permanent failure');
    });

    const onUnhandledRejection = vi.fn();
    process.on('unhandledRejection', onUnhandledRejection);
    try {
      await runner.enqueue('ws-1', 'clone', {}); // intentionally not awaiting .done
      await runner.onIdle();
      // Give the rejection a turn to surface as "unhandled" if it were going to.
      await new Promise((r) => setTimeout(r, 0));
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('still delivers the rejection to a caller that does await .done', async () => {
    const { db } = fakeDb();
    const runner = new JobRunner(db, { retries: 0 });
    runner.register('clone', async () => {
      throw new Error('permanent failure');
    });

    const { done } = await runner.enqueue('ws-1', 'clone', {});
    await expect(done).rejects.toThrow('permanent failure');
  });
});
