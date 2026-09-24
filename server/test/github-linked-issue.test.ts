/**
 * `OctokitGitHubClient.resolveLinkedIssue` — the tightened closing-keyword rule
 * (L03, plan Step 12).
 *
 * This is a deliberate BEHAVIOUR CHANGE to an endpoint the existing PR UI
 * already consumes: `PrDetail.linked_issue` no longer resolves from a bare
 * `#123` in prose. The adapter had no test at all, which is exactly why nothing
 * broke when the regex changed — so the table below pins the new behaviour, and
 * pins that the cross-repo form targets the OTHER repo rather than this one.
 *
 * The Octokit REST client is replaced with a recording double (the constructor
 * takes only a token, so there is no other seam); no network, no token.
 */
import { describe, it, expect } from 'vitest';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

interface IssueCall {
  owner: string;
  repo: string;
  issue_number: number;
}

function clientWith(body: string | null, opts: { issueFails?: boolean } = {}) {
  const issueCalls: IssueCall[] = [];
  const octokit = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 482,
            title: 'Add rate limiting',
            user: { login: 'marisa.koch' },
            head: { ref: 'feat/rl', sha: 'a1b2c3d4' },
            base: { ref: 'main' },
            additions: 1,
            deletions: 0,
            changed_files: 1,
            state: 'open',
            merged_at: null,
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-01T03:00:00Z',
            body,
          },
        }),
        listFiles: async () => ({ data: [] }),
        listCommits: async () => ({ data: [] }),
      },
      issues: {
        get: async (args: IssueCall) => {
          issueCalls.push(args);
          if (opts.issueFails) throw new Error('404 Not Found');
          return {
            data: {
              number: args.issue_number,
              title: `Issue #${args.issue_number}`,
              body: 'The pool runs dry under load.',
              state: 'open',
            },
          };
        },
      },
    },
  };
  const client = new OctokitGitHubClient('token-never-used');
  (client as unknown as { octokit: unknown }).octokit = octokit;
  return { client, issueCalls };
}

const REPO = { owner: 'acme', name: 'payments-api' };

describe('resolveLinkedIssue — a closing keyword is required', () => {
  const noLink = [
    'see #12 for context',
    '## Release #12',
    'Reverts #12',
    'Depends on #12 landing first',
    'Ports the fix from #12',
  ];
  for (const body of noLink) {
    it(`does NOT resolve an issue for ${JSON.stringify(body)}`, async () => {
      const { client, issueCalls } = clientWith(body);
      const detail = await client.getPullRequest(REPO, 482);
      expect(detail.linked_issue).toBeUndefined();
      // And it never spends a REST call looking one up.
      expect(issueCalls).toEqual([]);
    });
  }

  it('resolves a same-repo closing reference against this repo', async () => {
    const { client, issueCalls } = clientWith('Adds the limiter. Fixes #12.');
    const detail = await client.getPullRequest(REPO, 482);
    expect(detail.linked_issue).toEqual({
      number: 12,
      title: 'Issue #12',
      body: 'The pool runs dry under load.',
      state: 'open',
    });
    expect(issueCalls).toEqual([{ owner: 'acme', repo: 'payments-api', issue_number: 12 }]);
  });

  it('resolves a cross-repo reference against the OTHER repo, not this one', async () => {
    const { client, issueCalls } = clientWith('Closes acme/api#7');
    const detail = await client.getPullRequest(REPO, 482);
    expect(detail.linked_issue?.number).toBe(7);
    expect(issueCalls).toEqual([{ owner: 'acme', repo: 'api', issue_number: 7 }]);
  });

  it('keeps degrading to no issue when the issue read fails', async () => {
    const { client } = clientWith('Fixes #12', { issueFails: true });
    const detail = await client.getPullRequest(REPO, 482);
    expect(detail.linked_issue).toBeUndefined();
    // The PR itself still comes back — a private/deleted issue is not a PR error.
    expect(detail.number).toBe(482);
  });

  it('handles a PR with no body at all', async () => {
    const { client, issueCalls } = clientWith(null);
    const detail = await client.getPullRequest(REPO, 482);
    expect(detail.linked_issue).toBeUndefined();
    expect(issueCalls).toEqual([]);
  });
});
