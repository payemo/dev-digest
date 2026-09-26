import { z } from 'zod';
import * as api from '../api.js';
import { DEFAULT_CONVENTIONS_LIMIT } from '../constants.js';
import { fromFailure } from '../errors.js';
import { formatConventions, paginate, toResult, truncationFooter } from '../format.js';
import { resolveRepo } from '../resolve.js';
import { defineTool, repoArg, responseFormatArg } from './types.js';

/**
 * Reads the persisted convention candidates and returns only the APPROVED
 * ones — the rules a human accepted. Pending and rejected candidates are model
 * noise, not the repository's conventions.
 *
 * The skill-draft endpoint is deliberately not used: it rejects the request
 * when nothing has been approved yet, which turns a perfectly normal state
 * into an error.
 */
export default defineTool({
  name: 'get_conventions',
  title: 'Get repository conventions',
  description:
    'Get the coding conventions DevDigest extracted for a repository: the approved rules its reviewers apply, each with the file and line it was learned from. Use it to match a repo\'s own conventions before writing code. Returns approved rules only and does not run a new extraction. Read-only.',
  shape: {
    repo: repoArg,
    response_format: responseFormatArg,
    limit: z.number().int().min(1).max(100).optional().describe('Max rules to return (default 25).'),
    offset: z.number().int().min(0).optional().describe('Index to start from, for paging.'),
  },
  readOnly: true,
  handler: async ({ repo, response_format, limit, offset }) => {
    const resolved = await resolveRepo(repo);
    if (!resolved.ok) return resolved.result;

    const res = await api.listConventions(resolved.id);
    if (!res.ok) return fromFailure(res.failure);

    const approved = res.data.filter((c) => c.status === 'approved');
    const page = paginate(approved, limit ?? DEFAULT_CONVENTIONS_LIMIT, offset ?? 0);
    const note = truncationFooter(page, 'get_conventions', `repo: "${repo}", `);

    return toResult({
      repo,
      total_approved: page.total,
      conventions: formatConventions(page.page, response_format ?? 'concise'),
      ...(note ? { note } : {}),
    });
  },
});
