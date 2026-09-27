import { z } from 'zod';
import * as api from '../api.js';
import { DEFAULT_FINDINGS_LIMIT } from '../constants.js';
import { fromFailure, text } from '../errors.js';
import {
  formatFindings,
  formatVerdict,
  paginate,
  toResult,
  truncationFooter,
} from '../format.js';
import { normalizeRepoSlug, resolveRepoAndPull } from '../resolve.js';
import { defineTool, prArg, repoArg, responseFormatArg } from './types.js';

export default defineTool({
  name: 'get_findings',
  title: 'Get review findings for a pull request',
  description:
    'Read the result of a review that has ALREADY run on a pull request: verdict, score, summary, and each finding with its file and line. Use it after run_agent_on_pr, or to check whether a PR was reviewed at all. Reports the most recent review unless "agent" names one. Does not start a review. Read-only.',
  shape: {
    repo: repoArg,
    pr: prArg,
    agent: z
      .string()
      .optional()
      .describe('Report this agent\'s review instead of the most recent one. Name from list_agents.'),
    response_format: responseFormatArg,
    limit: z.number().int().min(1).max(100).optional().describe('Max findings to return (default 20).'),
    offset: z.number().int().min(0).optional().describe('Index to start from, for paging.'),
  },
  readOnly: true,
  handler: async ({ repo, pr, agent, response_format, limit, offset }) => {
    const resolved = await resolveRepoAndPull(repo, pr);
    if (!resolved.ok) return resolved.result;

    const res = await api.reviewsForPull(resolved.prId);
    if (!res.ok) return fromFailure(res.failure);

    const wanted = agent?.trim().toLowerCase();
    const candidates = wanted
      ? res.data.filter((r) => (r.agent_name ?? '').toLowerCase() === wanted)
      : res.data;

    // The endpoint returns newest-first; sort defensively rather than trust it.
    const [latest] = [...candidates].sort((a, b) => b.created_at.localeCompare(a.created_at));

    // No review yet is a normal state, not a failure — so it is not an error,
    // and it names the call that would produce one.
    if (!latest) {
      const scope = agent ? ` by agent "${agent}"` : '';
      return text(
        `No review has been run on ${repo}#${pr}${scope} yet. ` +
          `Run one with run_agent_on_pr(repo: "${repo}", pr: ${pr}, agent: "<name from list_agents>").`,
      );
    }

    const page = paginate(latest.findings, limit ?? DEFAULT_FINDINGS_LIMIT, offset ?? 0);
    const note = truncationFooter(page, 'get_findings', `repo: "${repo}", pr: ${pr}, `);

    return toResult({
      // Echo the normalised slug, not whatever was pasted in.
      pull_request: `${normalizeRepoSlug(repo)}#${pr}`,
      ...formatVerdict(latest),
      total_findings: page.total,
      findings: formatFindings(page.page, response_format ?? 'concise'),
      ...(note ? { note } : {}),
    });
  },
});
