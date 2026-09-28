import type { Agent, PrMeta, Repo } from '@devdigest/shared';
import * as api from './api.js';
import type { ApiResult } from './api.js';
import {
  AGENT_CACHE_TTL_MS,
  PULL_CACHE_TTL_MS,
  REPO_CACHE_TTL_MS,
} from './constants.js';
import {
  agentNotFound,
  fromFailure,
  pullNotFound,
  pullNotPersisted,
  repoNotFound,
  type ToolResult,
} from './errors.js';

/**
 * Semantic identifiers in, uuids out. A uuid never crosses the tool boundary:
 * it is unguessable without an extra round trip, and it costs tokens to carry.
 */

export type Resolved = { ok: true; id: string } | { ok: false; result: ToolResult };

interface CacheEntry {
  at: number;
  value: unknown[];
}

const cache = new Map<string, CacheEntry>();

/** Tests drive time and the API; they need a clean slate between cases. */
export function resetCache(): void {
  cache.clear();
}

/**
 * Fetch a list, optionally from cache.
 *
 * The cache exists so three consecutive tool calls in one turn are cheap. It
 * must never pin a worldview: callers re-run this with `force` after a miss,
 * so a repo or PR imported ten seconds ago is not reported missing — and the
 * "call list_agents" advice we hand back does not return the same stale list.
 */
async function list<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<ApiResult<T[]>>,
  force: boolean,
): Promise<ApiResult<T[]>> {
  if (!force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return { ok: true, data: hit.value as T[] };
  }
  const res = await fetcher();
  if (res.ok) cache.set(key, { at: Date.now(), value: res.data });
  return res;
}

/**
 * Run `match` against the cached list; on a miss, fetch once more with the
 * cache bypassed before giving up. `onMiss` builds the error from the final,
 * freshest list — never from a stale one.
 */
async function findOrRefetch<T, R>(
  key: string,
  ttl: number,
  fetcher: () => Promise<ApiResult<T[]>>,
  match: (items: T[]) => R | undefined,
  onMiss: (items: T[]) => ToolResult,
): Promise<{ ok: true; value: R } | { ok: false; result: ToolResult }> {
  let items: T[] = [];
  for (const force of [false, true]) {
    const res = await list(key, ttl, fetcher, force);
    if (!res.ok) return { ok: false, result: fromFailure(res.failure) };
    items = res.data;
    const hit = match(items);
    if (hit !== undefined) return { ok: true, value: hit };
  }
  return { ok: false, result: onMiss(items) };
}

/** An agent will paste a URL sooner or later. Accept it. */
export function normalizeRepoSlug(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export async function resolveRepo(slug: string): Promise<Resolved> {
  const wanted = normalizeRepoSlug(slug);
  const found = await findOrRefetch<Repo, string>(
    'repos',
    REPO_CACHE_TTL_MS,
    api.listRepos,
    (repos) => repos.find((r) => r.full_name.toLowerCase() === wanted)?.id,
    (repos) => repoNotFound(slug, repos.map((r) => r.full_name)),
  );
  return found.ok ? { ok: true, id: found.value } : found;
}

/**
 * Accepts either a name (as `list_agents` reports it) or a raw agent id — the
 * id is the unambiguous form, needed when two agents share a name.
 */
export async function resolveAgent(nameOrId: string): Promise<Resolved> {
  const wanted = nameOrId.trim().toLowerCase();
  const found = await findOrRefetch<Agent, string>(
    'agents',
    AGENT_CACHE_TTL_MS,
    api.listAgents,
    (agents) => {
      const byId = agents.find((a) => a.id.toLowerCase() === wanted);
      if (byId) return byId.id;
      const matches = agents.filter((a) => a.name.toLowerCase() === wanted);
      // Two agents can share a name across versions; the live one wins.
      return (matches.find((a) => a.enabled) ?? matches[0])?.id;
    },
    (agents) => agentNotFound(nameOrId, agents.map((a) => a.name)),
  );
  return found.ok ? { ok: true, id: found.value } : found;
}

/**
 * PR number → pr uuid.
 *
 * The list response embeds every agent's latest findings PER PR, so a repo
 * with 30 reviewed PRs carries hundreds of findings here. Project to
 * {id, number} immediately: that array must not leave this function.
 */
export async function resolvePull(
  repoId: string,
  repoSlug: string,
  number: number,
): Promise<Resolved> {
  const found = await findOrRefetch<PrMeta, { id: string | null; number: number }>(
    `pulls:${repoId}`,
    PULL_CACHE_TTL_MS,
    () => api.listPulls(repoId),
    (pulls) => {
      const hit = pulls.find((p) => p.number === number);
      return hit ? { id: hit.id ?? null, number: hit.number } : undefined;
    },
    (pulls) => pullNotFound(repoSlug, number, pulls.map((p) => p.number)),
  );
  if (!found.ok) return found;
  // The contract marks a listed PR's id as optional — treat a missing one as a
  // named resolution failure rather than letting `undefined` reach a URL.
  if (found.value.id === null) {
    return { ok: false, result: pullNotPersisted(repoSlug, number) };
  }
  return { ok: true, id: found.value.id };
}

/** The pair every PR-scoped tool needs. */
export async function resolveRepoAndPull(
  repoSlug: string,
  number: number,
): Promise<{ ok: true; repoId: string; prId: string } | { ok: false; result: ToolResult }> {
  const repo = await resolveRepo(repoSlug);
  if (!repo.ok) return repo;
  const pull = await resolvePull(repo.id, repoSlug, number);
  if (!pull.ok) return pull;
  return { ok: true, repoId: repo.id, prId: pull.id };
}
