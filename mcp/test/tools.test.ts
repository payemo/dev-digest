import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCache } from '../src/resolve.js';
import getBlastRadius from '../src/tools/get-blast-radius.js';
import getConventions from '../src/tools/get-conventions.js';
import getFindings from '../src/tools/get-findings.js';
import listAgents from '../src/tools/list-agents.js';
import runAgentOnPr from '../src/tools/run-agent-on-pr.js';
import { agent, blast, convention, finding, pull, repo, review } from './fixtures.js';
import { calls, json, mockFetch, timeoutError } from './http.js';

const REPO = 'acme/payments-api';
const resolution = {
  'GET /repos': [repo()],
  'GET /repos/repo-1/pulls': [pull()],
  'GET /agents': [agent()],
};

function body(result: { content: { text: string }[] }): string {
  return result.content[0]!.text;
}

beforeEach(() => resetCache());
afterEach(() => vi.unstubAllGlobals());

describe('list_agents', () => {
  it('returns names and models, never the system prompt', async () => {
    mockFetch({ 'GET /agents': [agent()] });
    const text = body(await listAgents.handler({}));
    expect(text).toContain('Security Reviewer');
    expect(text).toContain('gpt-4o-mini');
    expect(text).not.toContain('SUPERSECRETPROMPT');
  });

  it('explains how to start a stopped API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const result = await listAgents.handler({});
    expect(result.isError).toBe(true);
    expect(body(result)).toContain('./scripts/dev.sh');
  });
});

describe('get_conventions', () => {
  it('returns approved rules only', async () => {
    mockFetch({
      ...resolution,
      'GET /repos/repo-1/conventions': [
        convention({ id: 'a', status: 'approved', rule: 'KEEP THIS' }),
        convention({ id: 'b', status: 'pending', rule: 'DROP PENDING' }),
        convention({ id: 'c', status: 'rejected', rule: 'DROP REJECTED' }),
      ],
    });
    const text = body(await getConventions.handler({ repo: REPO }));
    expect(text).toContain('KEEP THIS');
    expect(text).not.toContain('DROP PENDING');
    expect(text).not.toContain('DROP REJECTED');
  });
});

describe('get_findings', () => {
  it('treats "never reviewed" as a normal state that names the next call', async () => {
    mockFetch({ ...resolution, 'GET /pulls/pr-1/reviews': [] });
    const result = await getFindings.handler({ repo: REPO, pr: 42 });
    expect(result.isError).toBe(false);
    expect(body(result)).toContain('run_agent_on_pr');
  });

  it('reports the most recent review', async () => {
    mockFetch({
      ...resolution,
      'GET /pulls/pr-1/reviews': [
        review({ id: 'old', created_at: '2026-01-01T00:00:00.000Z', score: 10 }),
        review({ id: 'new', created_at: '2026-09-01T00:00:00.000Z', score: 88 }),
      ],
    });
    expect(body(await getFindings.handler({ repo: REPO, pr: 42 }))).toContain('88');
  });

  it('can report a specific agent instead', async () => {
    mockFetch({
      ...resolution,
      'GET /pulls/pr-1/reviews': [
        review({ agent_name: 'Perf Reviewer', score: 70, created_at: '2026-09-02T00:00:00.000Z' }),
        review({ agent_name: 'Security Reviewer', score: 30, created_at: '2026-09-01T00:00:00.000Z' }),
      ],
    });
    const text = body(await getFindings.handler({ repo: REPO, pr: 42, agent: 'Security Reviewer' }));
    expect(text).toContain('30');
    expect(text).not.toContain('Perf Reviewer');
  });
});

describe('run_agent_on_pr', () => {
  const ok = {
    ...resolution,
    'POST /pulls/pr-1/review': { pr_id: 'pr-1', runs: [], reviews: [review()] },
  };

  it('returns the verdict and findings, not the raw API body', async () => {
    mockFetch(ok);
    const text = body(await runAgentOnPr.handler({ repo: REPO, pr: 42, agent: 'Security Reviewer' }));
    expect(text).toContain('request_changes');
    expect(text).toContain('Unvalidated repo id');
    expect(text).not.toContain('run_id');
    expect(text).not.toContain('grounding');
  });

  it('sends the agent id under the camelCase key the route actually reads', async () => {
    // A snake_case key is not rejected — it parses to an empty request, runs
    // zero agents, and returns 200 with no reviews. There is no error to catch,
    // so this assertion is the only thing standing between us and that.
    mockFetch(ok);
    await runAgentOnPr.handler({ repo: REPO, pr: 42, agent: 'Security Reviewer' });
    const post = calls.find((c) => c.method === 'POST');
    expect(post!.body).toEqual({ agentId: 'agent-1' });
  });

  it('does not spend a run when the agent name is wrong', async () => {
    mockFetch(resolution);
    const result = await runAgentOnPr.handler({ repo: REPO, pr: 42, agent: 'Securty' });
    expect(result.isError).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('treats a timeout as work still in flight, not an error to retry', async () => {
    mockFetch({
      ...resolution,
      'POST /pulls/pr-1/review': () => {
        throw timeoutError();
      },
    });
    const result = await runAgentOnPr.handler({ repo: REPO, pr: 42, agent: 'Security Reviewer' });
    expect(result.isError).toBe(false);
    expect(body(result)).toContain('get_findings');
    expect(body(result)).toContain('Do NOT call run_agent_on_pr again');
  });

  it('names the rate limit rather than inviting a loop', async () => {
    mockFetch({
      ...resolution,
      'POST /pulls/pr-1/review': json({ error: { code: 'rate', message: 'slow down' } }, 429),
    });
    const result = await runAgentOnPr.handler({ repo: REPO, pr: 42, agent: 'Security Reviewer' });
    expect(result.isError).toBe(true);
    expect(body(result)).toContain('10 runs per minute');
  });

  it('reports an empty reviews array as a failed run, not as "no findings"', async () => {
    mockFetch({ ...resolution, 'POST /pulls/pr-1/review': { pr_id: 'pr-1', runs: [], reviews: [] } });
    const result = await runAgentOnPr.handler({ repo: REPO, pr: 42, agent: 'Security Reviewer' });
    expect(result.isError).toBe(true);
    expect(body(result)).toContain('without producing a review record');
  });

  it('points at get_findings when it truncates a long finding list', async () => {
    const many = Array.from({ length: 50 }, (_, i) => finding({ id: `f-${i}` }));
    mockFetch({
      ...resolution,
      'POST /pulls/pr-1/review': { pr_id: 'pr-1', runs: [], reviews: [review({ findings: many })] },
    });
    const text = body(await runAgentOnPr.handler({ repo: REPO, pr: 42, agent: 'Security Reviewer' }));
    expect(text).toContain('30 more');
    expect(text).toContain('get_findings');
  });
});

describe('get_blast_radius', () => {
  it('reports callers and the endpoints they serve, from the code index', async () => {
    mockFetch({ ...resolution, 'GET /pulls/pr-1/blast': blast() });
    const result = await getBlastRadius.handler({ repo: REPO, pr: 42 });

    expect(result.isError).toBe(false);
    const text = body(result);
    expect(text).toContain('rateLimit');
    expect(text).toContain('src/api/public/index.ts:23 (listItems)');
    expect(text).toContain('GET /api/public/items');
    // The stub made no network call at all; this one must.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain('GET /pulls/pr-1/blast');
  });

  it('names Re-analyze when the repo is not indexed, and does NOT call it an error', async () => {
    mockFetch({
      ...resolution,
      'GET /pulls/pr-1/blast': blast({
        changed_symbols: [],
        downstream: [],
        degraded: true,
        reason: 'no_data',
      }),
    });
    const result = await getBlastRadius.handler({ repo: REPO, pr: 42 });

    // isError means "retrying might help"; no retry can index a repository.
    expect(result.isError).toBe(false);
    expect(body(result)).toContain('Re-analyze');
    expect(body(result)).toContain('no_data');
  });

  it('flags an incomplete index as a note when there IS data', async () => {
    mockFetch({
      ...resolution,
      'GET /pulls/pr-1/blast': blast({ degraded: true, reason: 'index_partial' }),
    });
    const text = body(await getBlastRadius.handler({ repo: REPO, pr: 42 }));

    expect(text).toContain('index_note');
    expect(text).toContain('rateLimit');
  });

  it('reports an unknown PR without ever asking for its blast radius', async () => {
    mockFetch({ ...resolution });
    const result = await getBlastRadius.handler({ repo: REPO, pr: 999 });

    expect(result.isError).toBe(true);
    expect(body(result)).toContain('#999');
    expect(calls.map((c) => c.url)).not.toContain('/pulls/pr-1/blast');
  });

  it('hands a transport failure to the advice the agent can act on', async () => {
    mockFetch({
      ...resolution,
      'GET /pulls/pr-1/blast': () => {
        throw timeoutError();
      },
    });
    const result = await getBlastRadius.handler({ repo: REPO, pr: 42 });

    expect(result.isError).toBe(true);
    expect(body(result)).toContain('did not respond in time');
  });
});

describe('argument validation', () => {
  it('is the handler itself — the low-level server does not validate for us', async () => {
    // Nothing is stubbed: a bad argument must be rejected before any request.
    await expect(getFindings.handler({ repo: 'acme/payments-api', pr: '42' })).rejects.toThrow();
    await expect(runAgentOnPr.handler({ repo: 'acme/payments-api', pr: 1 })).rejects.toThrow();
  });
});
