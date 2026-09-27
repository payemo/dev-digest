import { z } from 'zod';
import * as api from '../api.js';
import { DEFAULT_FINDINGS_LIMIT, REVIEW_TIMEOUT_MS } from '../constants.js';
import { fromFailure, reviewStillRunning, text } from '../errors.js';
import {
  formatFindings,
  formatVerdict,
  paginate,
  toResult,
  truncationFooter,
} from '../format.js';
import { normalizeRepoSlug, resolveAgent, resolveRepoAndPull } from '../resolve.js';
import { defineTool, prArg, repoArg } from './types.js';

/**
 * The one tool here that writes — and the one that costs money.
 *
 * It is an outcome, not an operation: one call creates the run, waits for it,
 * and returns the finished findings. The review endpoint is synchronous, so
 * there is no poll loop; polling would mean extra billed agent turns for
 * information the first response already carries.
 */
export default defineTool({
  name: 'run_agent_on_pr',
  title: 'Run a reviewer agent on a pull request',
  description:
    'Run a DevDigest reviewer agent on a pull request and wait for the finished review (up to ~2 minutes), returning the verdict, score and findings. This is the only tool here that starts a model run, and one call is one billed review — do not call it to re-read a result, use get_findings for that. "agent" is a name from list_agents.',
  shape: {
    repo: repoArg,
    pr: prArg,
    agent: z
      .string()
      .describe('Name of the reviewer agent to run, exactly as list_agents reports it.'),
  },
  readOnly: false,
  handler: async ({ repo, pr, agent }) => {
    // Resolve everything BEFORE the POST: a typo in the agent name must not
    // cost a billed run.
    const target = await resolveRepoAndPull(repo, pr);
    if (!target.ok) return target.result;

    const reviewer = await resolveAgent(agent);
    if (!reviewer.ok) return reviewer.result;

    const res = await api.runReview(target.prId, reviewer.id);

    if (!res.ok) {
      // Our request gave up; the run did not. Aborting the HTTP call does not
      // cancel it, so this is not an error and must not invite a retry.
      if (res.failure.kind === 'timeout') {
        return reviewStillRunning(repo, pr, Math.round(REVIEW_TIMEOUT_MS / 1000));
      }
      return fromFailure(res.failure);
    }

    const [review] = res.data.reviews;

    // A review row exists only for a successful run, so an empty array means
    // the run produced nothing — the observable symptom of a failed run, and
    // of a malformed request body that silently targeted zero agents.
    if (!review) {
      return text(
        `The review of ${repo}#${pr} by "${agent}" completed without producing a review record. ` +
          `The run most likely failed — open the PR in the DevDigest studio to see the run's error.`,
        true,
      );
    }

    const page = paginate(review.findings, DEFAULT_FINDINGS_LIMIT, 0);
    const note = truncationFooter(page, 'get_findings', `repo: "${repo}", pr: ${pr}, `);

    return toResult({
      // Echo the normalised slug, not whatever was pasted in.
      pull_request: `${normalizeRepoSlug(repo)}#${pr}`,
      ...formatVerdict(review),
      total_findings: page.total,
      findings: formatFindings(page.page, 'concise'),
      ...(note ? { note } : {}),
    });
  },
});
