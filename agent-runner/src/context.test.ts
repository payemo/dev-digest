import { describe, it, expect } from 'vitest';
import type { readFileSync } from 'node:fs';
import { resolvePrContext } from './context.js';
import { RunnerError } from './errors.js';

/**
 * CI context — the commit + run identifiers the studio's ingest matches the
 * artifact against (I9). Breakage covered: a head sha / run id silently going
 * missing or becoming NaN (every run would be rejected as a mismatch).
 */

const readEvent = (payload: unknown) =>
  ((p: string) => {
    if (p !== '/event.json') throw new Error('ENOENT');
    return JSON.stringify(payload);
  }) as unknown as typeof readFileSync;

const EVENT = {
  pull_request: {
    number: 42,
    title: 'T',
    body: 'B',
    head: { sha: 'h'.repeat(40), repo: { fork: false } },
    base: { sha: 'b'.repeat(40) },
  },
};

describe('resolvePrContext', () => {
  it('reads head/base sha from the event and run id/attempt from the Actions env', () => {
    const ctx = resolvePrContext(
      { GITHUB_REPOSITORY: 'acme/api', GITHUB_EVENT_PATH: '/event.json', GITHUB_RUN_ID: '9876543210', GITHUB_RUN_ATTEMPT: '2' },
      readEvent(EVENT),
    );
    expect(ctx).toMatchObject({
      owner: 'acme',
      repo: 'api',
      prNumber: 42,
      headSha: 'h'.repeat(40),
      baseSha: 'b'.repeat(40),
      runId: 9876543210,
      runAttempt: 2,
      isFork: false,
    });
  });

  it('leaves identifiers null (never NaN) outside Actions or with a bare payload', () => {
    const ctx = resolvePrContext(
      { GITHUB_REPOSITORY: 'acme/api', PR_NUMBER: '7', GITHUB_RUN_ID: 'abc', GITHUB_RUN_ATTEMPT: '0' },
      readEvent({}),
    );
    expect(ctx).toMatchObject({ prNumber: 7, headSha: null, baseSha: null, runId: null, runAttempt: null });
  });

  it('fails clearly without a repository or a PR number', () => {
    expect(() => resolvePrContext({ PR_NUMBER: '1' }, readEvent({}))).toThrow(RunnerError);
    expect(() => resolvePrContext({ GITHUB_REPOSITORY: 'acme/api', PR_NUMBER: '-3' }, readEvent({}))).toThrow(/PR_NUMBER/);
  });
});
