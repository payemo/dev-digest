import { z } from 'zod';
import * as api from '../api.js';
import { DEFAULT_BLAST_SYMBOL_LIMIT } from '../constants.js';
import { fromFailure, text } from '../errors.js';
import { formatBlastRadius, paginate, toResult, truncationFooter } from '../format.js';
import { normalizeRepoSlug, resolveRepoAndPull } from '../resolve.js';
import { defineTool, prArg, repoArg } from './types.js';

/**
 * Reads DevDigest's code index — no model call, no re-parsing — so it is cheap
 * enough to call before judging any change.
 *
 * "Repository not indexed" is a NORMAL result, not an error: `isError: true`
 * tells the model that retrying might work, and no number of retries can index
 * a repository. The result names the action that would — open the repo in the
 * studio and run Re-analyze — and leaves `isError` false.
 */
export default defineTool({
  name: 'get_blast_radius',
  title: 'Get the blast radius of a pull request',
  description:
    "Find what else in the repository a pull request's changes can reach: for each symbol its changed files declare, which other files call it (with file:line) and which HTTP endpoints or scheduled jobs depend on those callers. Call it before judging the risk of a change, or to decide what to test beyond the diff. Reads DevDigest's code index, so there is no model call and no cost; it says so plainly when the repository has not been indexed yet. Read-only.",
  shape: {
    repo: repoArg,
    pr: prArg,
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max changed symbols to return (default 10).'),
    offset: z.number().int().min(0).optional().describe('Index to start from, for paging.'),
  },
  readOnly: true,
  handler: async ({ repo, pr, limit, offset }) => {
    const resolved = await resolveRepoAndPull(repo, pr);
    if (!resolved.ok) return resolved.result;

    const res = await api.blastRadius(resolved.prId);
    if (!res.ok) return fromFailure(res.failure);

    const { changed_symbols, downstream, summary, degraded, reason } = res.data;

    // Degraded AND empty means the index could not answer at all. Naming the
    // next action beats returning an empty object that reads as "no impact".
    if (degraded === true && downstream.length === 0) {
      return text(
        `No blast radius available for ${normalizeRepoSlug(repo)}#${pr}: the repository's code ` +
          `index is not usable${reason ? ` (${reason})` : ''}, so callers cannot be resolved.\n\n` +
          `Open the repo in the DevDigest studio and run Re-analyze, then retry this call. ` +
          `Retrying now will return the same answer.`,
      );
    }

    const page = paginate(downstream, limit ?? DEFAULT_BLAST_SYMBOL_LIMIT, offset ?? 0);
    const note = truncationFooter(page, 'get_blast_radius', `repo: "${repo}", pr: ${pr}, `);
    const declaredIn = (symbol: string) =>
      changed_symbols.find((s) => s.name === symbol)?.file ?? null;

    return toResult({
      // Echo the normalised slug, not whatever was pasted in.
      pull_request: `${normalizeRepoSlug(repo)}#${pr}`,
      summary,
      changed_symbols: changed_symbols.length,
      total_symbols_with_impact: page.total,
      total_callers: downstream.reduce((n, entry) => n + entry.callers.length, 0),
      downstream: formatBlastRadius(page.page, declaredIn),
      ...(note ? { note } : {}),
      // Data exists but is incomplete — worth saying, not worth erroring over.
      ...(degraded === true
        ? {
            index_note: `The code index is incomplete${
              reason ? ` (${reason})` : ''
            }; some callers may be missing. Re-analyze the repo in the DevDigest studio for a full answer.`,
          }
        : {}),
    });
  },
});
