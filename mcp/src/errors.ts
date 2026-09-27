import { MAX_CANDIDATES_IN_ERROR } from './constants.js';
import type { ApiFailure } from './api.js';

/**
 * Every failure this server can produce, as text that names the NEXT CALL to
 * make. A bare status code leaves the agent stuck; "call list_agents" does not.
 *
 * Pure: data in, result out. No fetch, no env, no clock — which is what makes
 * these testable without mocks.
 */

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  /** The SDK's result type is open-ended; this keeps ToolResult assignable to it. */
  [key: string]: unknown;
}

export function text(body: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text: body }], isError };
}

/** A list of candidates must never itself blow the response budget. */
function candidates(items: (string | number)[]): string {
  if (items.length === 0) return 'none';
  const shown = items.slice(0, MAX_CANDIDATES_IN_ERROR).join(', ');
  const rest = items.length - MAX_CANDIDATES_IN_ERROR;
  return rest > 0 ? `${shown}, … and ${rest} more` : shown;
}

export function agentNotFound(name: string, available: string[]): ToolResult {
  return text(
    `Agent "${name}" not found. Configured agents: ${candidates(available)}. ` +
      `Call list_agents for the full list, then retry with an exact name.`,
    true,
  );
}

export function repoNotFound(slug: string, available: string[]): ToolResult {
  return text(
    `Repository "${slug}" is not imported into DevDigest. Imported: ${candidates(available)}. ` +
      `Add it in the DevDigest studio first — this server cannot import repositories.`,
    true,
  );
}

export function pullNotFound(repo: string, number: number, available: number[]): ToolResult {
  return text(
    `PR #${number} not found in ${repo}. Known PRs: ${candidates(available.map((n) => `#${n}`))}. ` +
      `If the PR is newer than the last sync, open the repo in the DevDigest studio to re-sync it.`,
    true,
  );
}

/** A PR row can come back without an id; that is a resolution failure, not a crash. */
export function pullNotPersisted(repo: string, number: number): ToolResult {
  return text(
    `PR #${number} in ${repo} is listed but has not been persisted yet, so it has no id to review. ` +
      `Open it once in the DevDigest studio, then retry.`,
    true,
  );
}

export function apiUnreachable(url: string): ToolResult {
  return text(
    `Cannot reach the DevDigest API at ${url}. Start the stack with ./scripts/dev.sh ` +
      `(or cd server && pnpm dev), then retry this call. ` +
      `Set DEVDIGEST_API_URL if the API runs elsewhere.`,
    true,
  );
}

export function apiTimeout(op: string): ToolResult {
  return text(`The DevDigest API did not respond in time (${op}). Retry once; if it keeps timing out, check the API logs.`, true);
}

export function rateLimited(): ToolResult {
  return text(
    `Rate limited: the review endpoint allows 10 runs per minute. ` +
      `Wait ~60 seconds, then retry — do not loop.`,
    true,
  );
}

export function upstream(status: number, message: string): ToolResult {
  return text(`The DevDigest API returned ${status}: ${message}`, true);
}

/**
 * The review timed out on OUR side — it keeps running on the server, because
 * aborting the HTTP request does not cancel the run.
 *
 * Deliberately NOT isError: isError tells the model that retrying might work,
 * and here a retry starts a SECOND billed LLM pass and walks into the 10/min
 * limit. The work is already in flight; the agent just has to come back for it.
 */
export function reviewStillRunning(repo: string, pr: number, seconds: number): ToolResult {
  return text(
    `The review is still running on the server after ${seconds}s — this call stopped waiting, ` +
      `it did NOT cancel the run. Wait ~60 seconds, then call ` +
      `get_findings(repo: "${repo}", pr: ${pr}) to collect the result. ` +
      `Do NOT call run_agent_on_pr again: that starts a second billed run and hits the 10/min limit.`,
  );
}

/** Map a transport failure onto the right piece of advice. */
export function fromFailure(failure: ApiFailure): ToolResult {
  switch (failure.kind) {
    case 'unreachable':
      return apiUnreachable(failure.url);
    case 'timeout':
      return apiTimeout(failure.op);
    case 'http':
      return failure.status === 429
        ? rateLimited()
        : upstream(failure.status, failure.message);
  }
}
