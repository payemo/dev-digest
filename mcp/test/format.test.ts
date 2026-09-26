import { describe, expect, it } from 'vitest';
import { MAX_RATIONALE_CHARS, MAX_RESPONSE_CHARS } from '../src/constants.js';
import {
  agentNotFound,
  apiUnreachable,
  rateLimited,
  reviewStillRunning,
} from '../src/errors.js';
import {
  capResponse,
  formatAgents,
  formatConventions,
  formatFindings,
  formatVerdict,
  paginate,
  truncationFooter,
} from '../src/format.js';
import { agent, convention, finding, review } from './fixtures.js';

describe('projections keep expensive fields out of a model context', () => {
  it('never returns an agent system prompt, in any format', () => {
    const serialized = JSON.stringify(formatAgents([agent()]));
    expect(serialized).not.toContain('SUPERSECRETPROMPT');
    expect(Object.keys(formatAgents([agent()])[0]!).sort()).toEqual([
      'description',
      'enabled',
      'model',
      'name',
    ]);
  });

  it('returns exactly four fields for a concise finding', () => {
    const [f] = formatFindings([finding()], 'concise');
    expect(Object.keys(f!).sort()).toEqual(['file', 'line', 'severity', 'title']);
  });

  it('never returns trifecta evidence, in either format', () => {
    for (const mode of ['concise', 'detailed'] as const) {
      const serialized = JSON.stringify(formatFindings([finding()], mode));
      expect(serialized).not.toContain('trifecta_components');
      expect(serialized).not.toContain('evidence');
    }
  });

  it('truncates an unbounded rationale in detailed mode', () => {
    const [f] = formatFindings([finding()], 'detailed');
    const rationale = (f as { rationale: string }).rationale;
    expect(rationale.length).toBeLessThanOrEqual(MAX_RATIONALE_CHARS);
    expect(rationale.endsWith('…')).toBe(true);
  });

  it('truncates an unbounded review summary', () => {
    expect(formatVerdict(review()).summary!.length).toBeLessThan(900);
  });

  it('never returns a raw convention snippet', () => {
    for (const mode of ['concise', 'detailed'] as const) {
      expect(JSON.stringify(formatConventions([convention()], mode))).not.toContain('RAWSNIPPET');
    }
  });
});

describe('pagination', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it('reports the next offset while items remain', () => {
    const page = paginate(items, 20, 0);
    expect(page.page).toHaveLength(20);
    expect(page.total).toBe(50);
    expect(page.nextOffset).toBe(20);
  });

  it('stops at the end without a footer', () => {
    const page = paginate(items, 20, 40);
    expect(page.page).toHaveLength(10);
    expect(page.nextOffset).toBeNull();
    expect(truncationFooter(page, 'get_findings', '')).toBeUndefined();
  });

  it('returns an empty page past the end', () => {
    const page = paginate(items, 20, 999);
    expect(page.page).toEqual([]);
    expect(page.nextOffset).toBeNull();
  });

  it('names the exact next call in the footer', () => {
    const footer = truncationFooter(paginate(items, 20, 0), 'get_findings', 'repo: "a/b", pr: 1, ');
    expect(footer).toContain('30 more');
    expect(footer).toContain('get_findings');
    expect(footer).toContain('offset=20');
  });
});

describe('response ceiling', () => {
  it('caps a pathological payload and says so', () => {
    const capped = capResponse('line\n'.repeat(50_000));
    expect(capped.length).toBeLessThan(MAX_RESPONSE_CHARS + 200);
    expect(capped).toContain('truncated');
  });

  it('leaves a small payload untouched', () => {
    expect(capResponse('short')).toBe('short');
  });
});

describe('errors name the next call', () => {
  it('points an unknown agent at list_agents', () => {
    const result = agentNotFound('Secrity', ['Security Reviewer', 'Perf Reviewer']);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('list_agents');
    expect(result.content[0]!.text).toContain('Security Reviewer');
  });

  it('caps a long candidate list so the error cannot blow the budget', () => {
    const many = Array.from({ length: 50 }, (_, i) => `agent-${i}`);
    const text = agentNotFound('x', many).content[0]!.text;
    expect(text).toContain('and 30 more');
    expect(text).not.toContain('agent-49');
  });

  it('tells the user how to start the API', () => {
    expect(apiUnreachable('http://127.0.0.1:3001').content[0]!.text).toContain('./scripts/dev.sh');
  });

  it('tells the agent not to loop on a rate limit', () => {
    expect(rateLimited().content[0]!.text).toContain('do not loop');
  });

  it('treats a review timeout as a non-error that forbids a re-run', () => {
    const result = reviewStillRunning('acme/payments-api', 42, 120);
    // Not an error: the run is still in flight, and isError invites a retry
    // that would start a second billed pass.
    expect(result.isError).toBe(false);
    expect(result.content[0]!.text).toContain('get_findings');
    expect(result.content[0]!.text).toContain('Do NOT call run_agent_on_pr again');
  });
});
