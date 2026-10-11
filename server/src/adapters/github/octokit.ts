import { Octokit } from 'octokit';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  WorkflowRunInfo,
  WorkflowArtifactInfo,
  ArtifactLimits,
} from '@devdigest/shared';
import { ArtifactTooLargeError } from '@devdigest/shared';
import { unzipSync } from 'fflate';
import { ExternalServiceError } from '../../platform/errors.js';
import { withRetry, withTimeout } from '../../platform/resilience.js';
// A pure, dependency-free extractor. Importing it here points OUTER (adapter)
// → INNER (application helper), which is the allowed direction, and keeps the
// closing-keyword rule in ONE place: a second copy of a security-relevant
// regex is a copy that silently drifts.
import { extractLinkedIssueRefs } from '../../modules/intent/helpers.js';

const TIMEOUT = 30_000;
const API_BASE = 'https://api.github.com';

/**
 * Map a 403/404 from an Actions/contents call to a message naming the token
 * scope that is most likely missing. Never includes the token itself.
 */
function scopeError(err: unknown, scope: string, what: string): unknown {
  const status = (err as { status?: number } | null)?.status;
  if (status === 403 || status === 404) {
    return new ExternalServiceError(
      `GitHub refused to ${what} (HTTP ${status}). The GitHub token likely lacks the "${scope}" permission for this repository.`,
    );
  }
  return err;
}

/** Read a fetch body up to `max` bytes; throws once the stream passes it. */
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) {
    throw new ArtifactTooLargeError(`artifact zip is ${declared} bytes (cap ${max})`);
  }
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ArtifactTooLargeError(`artifact zip exceeds ${max} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;
  /** Kept only for the artifact download, which needs a size-capped raw fetch. */
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
    this.octokit = new Octokit({ auth: token });
  }

  async listPullRequests(repo: RepoRef): Promise<PrMeta[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          // Fetch open + recently merged/closed (most-recently-updated first) so
          // the list shows which PRs are merged vs still open — not just open.
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 50,
          });
          return res.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: 0,
            deletions: 0,
            files_count: 0, // not present on the list payload; populated by getPullRequest
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
          }));
        })(),
        TIMEOUT,
      ),
    );
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const { data: commits } = await this.octokit.rest.pulls.listCommits({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /**
   * The issue this PR CLOSES, from the PR body.
   *
   * Requires one of GitHub's nine closing keywords — `Fixes #12`,
   * `Closes owner/repo#7` — and no longer matches a bare `#123`. A bare `#n`
   * in prose ("see #12 for context", a Markdown heading) is a mention, not a
   * statement that this PR resolves it, and the old pattern turned every one
   * of them into "the linked issue".
   *
   * TRADE-OFF, accepted deliberately: GitHub itself only *acts* on closing
   * keywords when the PR targets the default branch, and the only API that
   * reports true closing links is GraphQL `closingIssuesReferences` — REST has
   * no equivalent, and adding GraphQL would mean a second auth path and a
   * second failure mode in an adapter whose value here is that it degrades to
   * "no token, no issue" offline. So we accept FALSE NEGATIVES (a closing link
   * expressed in a way this pattern misses) over the FALSE POSITIVES the bare
   * `#n` pattern produced: a wrong issue misinforms every consumer, a missing
   * one only leaves a field empty.
   */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const [ref] = extractLinkedIssueRefs(body);
    if (!ref) return undefined;
    const target: RepoRef = ref.owner && ref.repo ? { owner: ref.owner, name: ref.repo } : repo;
    try {
      return await this.getIssue(target, ref.number);
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            comments: review.comments?.map((c) => ({
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: payload.files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: 'blob',
              content: f.contents,
            })),
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }

  async getRepoDefaultBranch(repo: RepoRef): Promise<string> {
    try {
      const res = await withRetry(() =>
        withTimeout(this.octokit.rest.repos.get({ owner: repo.owner, repo: repo.name }), TIMEOUT),
      );
      return res.data.default_branch;
    } catch (err) {
      throw scopeError(err, 'Contents: read', 'read the repository');
    }
  }

  async listWorkflowRuns(
    repo: RepoRef,
    workflowPath: string,
    opts: { perPage: number },
  ): Promise<WorkflowRunInfo[]> {
    // The workflows API addresses a workflow by its file basename.
    const file = workflowPath.split('/').pop() ?? workflowPath;
    try {
      const res = await withRetry(() =>
        withTimeout(
          this.octokit.rest.actions.listWorkflowRuns({
            owner: repo.owner,
            repo: repo.name,
            workflow_id: file,
            event: 'pull_request',
            per_page: opts.perPage,
          }),
          TIMEOUT,
        ),
      );
      return res.data.workflow_runs.map((r) => ({
        id: r.id,
        run_attempt: r.run_attempt ?? 1,
        html_url: r.html_url,
        event: r.event,
        status: r.status ?? null,
        conclusion: r.conclusion ?? null,
        head_sha: r.head_sha,
        path: r.path,
        repository_full_name: r.repository.full_name,
        head_repository_full_name: r.head_repository?.full_name ?? null,
        pull_numbers: (r.pull_requests ?? []).map((p) => p.number),
        created_at: r.created_at,
        run_started_at: r.run_started_at ?? null,
        updated_at: r.updated_at,
      }));
    } catch (err) {
      // A 404 here means one of two things:
      //  1. the workflow file is not on the default branch yet (the PR-first
      //     flow) — genuinely "no runs", so return [];
      //  2. the token lacks "Actions: read" or cannot see the repo — GitHub
      //     hides that behind a 404 too, and it must surface as a scope error.
      // Tell them apart by checking whether the file exists on the default branch.
      const status = (err as { status?: number } | null)?.status;
      if (status === 404 && (await this.workflowFileAbsent(repo, workflowPath))) return [];
      throw scopeError(err, 'Actions: read', 'list workflow runs');
    }
  }

  /**
   * True only when the repo is reachable and `path` is confirmed absent on its
   * default branch. An unreachable repo resolves false (the caller's original
   * 404 is then reported as a scope error); a Contents permission failure is
   * thrown as its own scope error.
   */
  private async workflowFileAbsent(repo: RepoRef, path: string): Promise<boolean> {
    let ref: string;
    try {
      const res = await withRetry(() =>
        withTimeout(this.octokit.rest.repos.get({ owner: repo.owner, repo: repo.name }), TIMEOUT),
      );
      ref = res.data.default_branch;
    } catch (err) {
      if ((err as { status?: number } | null)?.status === 404) return false;
      throw scopeError(err, 'Contents: read', 'read the repository');
    }
    try {
      await withRetry(() =>
        withTimeout(
          this.octokit.rest.repos.getContent({ owner: repo.owner, repo: repo.name, path, ref }),
          TIMEOUT,
        ),
      );
      return false;
    } catch (err) {
      if ((err as { status?: number } | null)?.status === 404) return true;
      throw scopeError(err, 'Contents: read', 'read repository contents');
    }
  }

  async listRunArtifacts(repo: RepoRef, runId: number): Promise<WorkflowArtifactInfo[]> {
    try {
      const res = await withRetry(() =>
        withTimeout(
          this.octokit.rest.actions.listWorkflowRunArtifacts({
            owner: repo.owner,
            repo: repo.name,
            run_id: runId,
            per_page: 100,
          }),
          TIMEOUT,
        ),
      );
      return res.data.artifacts.map((a) => ({
        id: a.id,
        name: a.name,
        size_in_bytes: a.size_in_bytes,
        expired: a.expired,
      }));
    } catch (err) {
      throw scopeError(err, 'Actions: read', 'list run artifacts');
    }
  }

  async downloadArtifactFile(
    repo: RepoRef,
    artifactId: number,
    fileName: string,
    limits: ArtifactLimits,
  ): Promise<string | null> {
    const url = `${API_BASE}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(
      repo.name,
    )}/actions/artifacts/${artifactId}/zip`;
    // Raw fetch (not Octokit) so the body can be size-capped while streaming.
    // GitHub answers with a redirect to blob storage; fetch drops the
    // Authorization header on that cross-origin hop.
    const res = await withTimeout(
      fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'follow',
      }),
      TIMEOUT,
    );
    if (!res.ok) {
      throw scopeError({ status: res.status }, 'Actions: read', 'download the run artifact') as Error;
    }
    const zip = await readCapped(res, limits.maxZipBytes);

    let entryTooLarge = false;
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(zip, {
        // Inflate exactly one entry, and only when its declared size is in bounds.
        filter: (f) => {
          if (f.name !== fileName) return false;
          if (f.originalSize > limits.maxFileBytes) {
            entryTooLarge = true;
            return false;
          }
          return true;
        },
      });
    } catch (err) {
      throw new ExternalServiceError(`artifact zip could not be read: ${(err as Error).message}`);
    }
    if (entryTooLarge) {
      throw new ArtifactTooLargeError(`${fileName} exceeds ${limits.maxFileBytes} bytes`);
    }
    const entry = files[fileName];
    if (!entry) return null;
    // The declared size can lie; re-check what was actually inflated.
    if (entry.byteLength > limits.maxFileBytes) {
      throw new ArtifactTooLargeError(`${fileName} exceeds ${limits.maxFileBytes} bytes`);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(entry);
  }

  async getBlobShas(
    repo: RepoRef,
    ref: string,
    paths: string[],
  ): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (const path of paths) {
      try {
        const res = await withRetry(() =>
          withTimeout(
            this.octokit.rest.repos.getContent({ owner: repo.owner, repo: repo.name, path, ref }),
            TIMEOUT,
          ),
        );
        const data = res.data as { type?: string; sha?: string } | unknown[];
        out[path] = !Array.isArray(data) && data.type === 'file' && data.sha ? data.sha : null;
      } catch (err) {
        if ((err as { status?: number } | null)?.status === 404) {
          out[path] = null;
          continue;
        }
        throw scopeError(err, 'Contents: read', 'read repository contents');
      }
    }
    return out;
  }

  async getPullBaseSha(repo: RepoRef, n: number): Promise<string | null> {
    try {
      const { data: pr } = await withRetry(() =>
        withTimeout(
          this.octokit.rest.pulls.get({ owner: repo.owner, repo: repo.name, pull_number: n }),
          TIMEOUT,
        ),
      );
      return pr.base?.sha ?? null;
    } catch {
      // Unavailable base degrades to "not rechecked" — never fails the ingest.
      return null;
    }
  }

  async getCompareDiff(
    repo: RepoRef,
    base: string,
    head: string,
    maxBytes: number,
  ): Promise<string | null> {
    try {
      const res = await withRetry(() =>
        withTimeout(
          this.octokit.rest.repos.compareCommitsWithBasehead({
            owner: repo.owner,
            repo: repo.name,
            basehead: `${base}...${head}`,
            mediaType: { format: 'diff' },
          }),
          TIMEOUT,
        ),
      );
      const text = res.data as unknown;
      if (typeof text !== 'string') return null;
      if (Buffer.byteLength(text, 'utf8') > maxBytes) return null;
      return text;
    } catch {
      // Unavailable diff degrades to "not rechecked" — never fails the ingest.
      return null;
    }
  }
}
