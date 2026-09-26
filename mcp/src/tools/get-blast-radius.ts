import { text } from '../errors.js';
import { defineTool, prArg, repoArg } from './types.js';

/**
 * A stub, on purpose — Blast Radius is the other half of this lesson and is
 * built on repo-intel's symbol graph.
 *
 * It returns a NORMAL result, not an error. `isError: true` tells the model
 * that retrying might work; for a tool that does not exist yet, retrying can
 * only waste turns. It also makes no HTTP call at all, so it cannot fail and
 * costs no round trip.
 */
export default defineTool({
  name: 'get_blast_radius',
  title: 'Get the blast radius of a pull request',
  description:
    'Report the blast radius of a pull request: which files, symbols and tests its changes can reach. NOT IMPLEMENTED in this build — it returns an explanation rather than data, so prefer get_findings for review results.',
  shape: { repo: repoArg, pr: prArg },
  readOnly: true,
  handler: async ({ repo, pr }) =>
    text(
      `Blast radius is not implemented yet, so there is no data for ${repo}#${pr}.\n\n` +
        `When built, it will return for each changed symbol: the direct and transitive ` +
        `callers up to a chosen depth, the test files covering them, and a risk score — ` +
        `derived from repo-intel's symbol and import graph, which requires the repository ` +
        `to be Indexed in DevDigest.\n\n` +
        `Do not retry; report this to the user.`,
    ),
});
