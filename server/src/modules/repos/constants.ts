/**
 * F1 — repos module constants (extracted from routes.ts; no behaviour change).
 */

/** JobRunner kind for the asynchronous `git clone` job. */
export const CLONE_JOB_KIND = 'clone';

/** Clone depth — shallow clone (latest commit only) keeps imports fast. */
export const CLONE_DEPTH = 1;

/** Secret name (via the Secrets adapter) holding the GitHub PAT for private clones. */
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';

/**
 * Parse `owner`/`repo` from a GitHub URL. Anchored at both ends so a URL
 * cannot carry extra scheme/host/path around a `github.com/owner/repo`
 * substring — e.g. `ext::sh -c id github.com/a/b` (git `ext::` transport
 * shells out) or `http://169.254.169.254/…/github.com/a/b` (SSRF) both fail
 * to match, instead of silently extracting `a/b` and being handed to `git
 * clone` verbatim. Supports the two forms we actually accept:
 * `https://github.com/owner/repo(.git)` and `git@github.com:owner/repo.git`.
 */
export const GITHUB_HTTPS_URL_REGEX = /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/;
export const GITHUB_SSH_URL_REGEX = /^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/;

/** Username embedded into an authenticated https github.com clone URL. */
export const GIT_TOKEN_USERNAME = 'x-access-token';

/** Host for which a token is embedded into an https clone URL. */
export const GITHUB_HTTPS_HOST = 'github.com';
