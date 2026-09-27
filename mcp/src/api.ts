import type { Repo, PrMeta, ApiErrorBody } from '@devdigest/shared';
import type { Agent, ConventionCandidate } from '@devdigest/shared';
import type { ReviewRecord, ReviewRunResponse } from '@devdigest/shared';
import { DEFAULT_API_URL, HTTP_TIMEOUT_MS, REVIEW_TIMEOUT_MS } from './constants.js';

/**
 * The ONLY file in this package that calls fetch.
 *
 * Contracts are imported TYPE-ONLY: `tsc` does not rewrite the
 * `@devdigest/shared` alias into output, and this is a long-lived runtime
 * process, so a value import would be a live module-resolution failure.
 * Type imports are fully erased.
 */

/** Read once at module load — the server URL cannot change mid-process. */
const BASE_URL = (process.env['DEVDIGEST_API_URL'] ?? DEFAULT_API_URL).replace(/\/+$/, '');

export function baseUrl(): string {
  return BASE_URL;
}

/**
 * Three failure classes, because each maps to a different piece of advice for
 * the agent (see errors.ts). A raw fetch rejection never escapes this file.
 */
export type ApiFailure =
  | { kind: 'unreachable'; url: string }
  | { kind: 'timeout'; op: string }
  | { kind: 'http'; status: number; message: string };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

/** A timeout surfaces as a DOMException named TimeoutError/AbortError. */
function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function readErrorMessage(res: Response): Promise<string> {
  // The API returns a structured envelope, but not every route declares a
  // response schema, so parse defensively and fall back to the status text.
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    const message = body?.error?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    /* non-JSON body — fall through */
  }
  return res.statusText || `HTTP ${res.status}`;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = HTTP_TIMEOUT_MS,
  op: string = path,
): Promise<ApiResult<T>> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  // No auth header, deliberately: the local API runs LocalNoAuthProvider and
  // resolves tenancy itself. Do not invent a credential here.
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (isTimeout(err)) return { ok: false, failure: { kind: 'timeout', op } };
    return { ok: false, failure: { kind: 'unreachable', url: BASE_URL } };
  }

  if (!res.ok) {
    return {
      ok: false,
      failure: { kind: 'http', status: res.status, message: await readErrorMessage(res) },
    };
  }

  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, failure: { kind: 'http', status: res.status, message: 'Malformed JSON' } };
  }
}

export function listRepos(): Promise<ApiResult<Repo[]>> {
  return request<Repo[]>('/repos');
}

export function listPulls(repoId: string): Promise<ApiResult<PrMeta[]>> {
  return request<PrMeta[]>(`/repos/${encodeURIComponent(repoId)}/pulls`);
}

export function listAgents(): Promise<ApiResult<Agent[]>> {
  return request<Agent[]>('/agents');
}

export function listConventions(repoId: string): Promise<ApiResult<ConventionCandidate[]>> {
  return request<ConventionCandidate[]>(`/repos/${encodeURIComponent(repoId)}/conventions`);
}

export function reviewsForPull(prId: string): Promise<ApiResult<ReviewRecord[]>> {
  return request<ReviewRecord[]>(`/pulls/${encodeURIComponent(prId)}/reviews`);
}

/**
 * Run ONE agent on a PR and wait for it — the route is synchronous and returns
 * the persisted reviews once the run completes.
 *
 * The body key is `agentId`, CAMELCASE, unlike the snake_case wire everywhere
 * else in this API. Both RunRequest fields are optional and the body schema is
 * itself optional, so a snake_case `agent_id` does NOT get rejected: it parses
 * to an empty request, runs zero agents, and comes back 200 with an empty
 * `reviews` array. There is no error to catch — which is why the caller treats
 * empty `reviews` as a failure rather than as "no findings".
 */
export function runReview(prId: string, agentId: string): Promise<ApiResult<ReviewRunResponse>> {
  return request<ReviewRunResponse>(
    `/pulls/${encodeURIComponent(prId)}/review`,
    { method: 'POST', body: JSON.stringify({ agentId }) },
    REVIEW_TIMEOUT_MS,
    'review',
  );
}
