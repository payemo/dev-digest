import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeRepoSlug,
  resetCache,
  resolveAgent,
  resolvePull,
  resolveRepo,
} from '../src/resolve.js';
import { agent, pull, repo } from './fixtures.js';
import { calls, json, mockFetch } from './http.js';

beforeEach(() => resetCache());
afterEach(() => vi.unstubAllGlobals());

describe('repo slugs', () => {
  it('accepts what an agent would actually paste', () => {
    expect(normalizeRepoSlug('https://github.com/Acme/Payments-API.git')).toBe(
      'acme/payments-api',
    );
    expect(normalizeRepoSlug('  acme/payments-api/  ')).toBe('acme/payments-api');
  });

  it('resolves a repo whose case differs', async () => {
    mockFetch({ 'GET /repos': [repo()] });
    await expect(resolveRepo('ACME/Payments-API')).resolves.toEqual({ ok: true, id: 'repo-1' });
  });

  it('resolves a pasted GitHub URL', async () => {
    mockFetch({ 'GET /repos': [repo()] });
    await expect(resolveRepo('https://github.com/acme/payments-api')).resolves.toEqual({
      ok: true,
      id: 'repo-1',
    });
  });

  it('lists what IS imported when a repo is not', async () => {
    mockFetch({ 'GET /repos': [repo()] });
    const result = await resolveRepo('acme/other');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.content[0]!.text).toContain('acme/payments-api');
    expect(result.result.content[0]!.text).toContain('studio');
  });
});

describe('agents', () => {
  it('points an unknown name at list_agents with the real names', async () => {
    mockFetch({ 'GET /agents': [agent()] });
    const result = await resolveAgent('Securty Reviewer');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.content[0]!.text).toContain('list_agents');
    expect(result.result.content[0]!.text).toContain('Security Reviewer');
  });

  it('prefers the enabled agent when two share a name', async () => {
    mockFetch({
      'GET /agents': [
        agent({ id: 'old', enabled: false }),
        agent({ id: 'live', enabled: true }),
      ],
    });
    await expect(resolveAgent('security reviewer')).resolves.toEqual({ ok: true, id: 'live' });
  });
});

describe('pull requests', () => {
  it('finds a PR that appeared after the list was cached', async () => {
    // A stale cache must not be able to report a just-imported PR as missing —
    // the advice we would hand back ("re-sync it") would then be wrong.
    let pulls = [pull({ number: 42 })];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(pulls)),
    );

    await resolvePull('repo-1', 'acme/payments-api', 42);
    pulls = [pull({ number: 42 }), pull({ id: 'pr-2', number: 43 })];

    await expect(resolvePull('repo-1', 'acme/payments-api', 43)).resolves.toEqual({
      ok: true,
      id: 'pr-2',
    });
  });

  it('reports a listed-but-unpersisted PR instead of crashing on a missing id', async () => {
    mockFetch({ 'GET /repos/repo-1/pulls': [pull({ id: null, number: 7 })] });
    const result = await resolvePull('repo-1', 'acme/payments-api', 7);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.content[0]!.text).toContain('has not been persisted');
  });

  it('lists known PR numbers when one is missing', async () => {
    mockFetch({ 'GET /repos/repo-1/pulls': [pull({ number: 40 }), pull({ number: 41 })] });
    const result = await resolvePull('repo-1', 'acme/payments-api', 99);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.content[0]!.text).toContain('#40');
  });
});

describe('the cache', () => {
  it('serves repeat lookups without a second request', async () => {
    mockFetch({ 'GET /repos': [repo()] });
    await resolveRepo('acme/payments-api');
    await resolveRepo('acme/payments-api');
    expect(calls.filter((c) => c.url === '/repos')).toHaveLength(1);
  });
});
