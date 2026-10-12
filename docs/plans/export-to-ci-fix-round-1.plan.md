# Fix Plan — export-to-ci, round 1

**Source plan:** `docs/plans/export-to-ci.plan.md`
**Execution mode:** single agent
**Origin:** security-reviewer WARNING (confidence 0.8) on the uncommitted diff.

## Steps

### F1 — Re-grounding (V2) must not depend on untrusted artifact fields
- **Files:** `server/src/modules/ci/ingest.ts:269-302` (and, if needed, `server/src/modules/ci/helpers.ts`, the `GitHubClient` port in `server/src/vendor/shared/adapters.ts` + `server/src/adapters/github/octokit.ts` + `server/src/adapters/mocks.ts`; mirror any shared change byte-for-byte into `client/src/vendor/shared`).
- **Change:** address: V2 only runs `if (artifact.base_sha)` and diffs `artifact.base_sha...run.head_sha`, so both the trigger and the base come from the artifact. A forged artifact can (a) omit `base_sha`, (b) set `base_sha` to an early commit so the diff exceeds the 2 MiB cap and `getCompareDiff` returns null, or (c) omit `findings`, so the self-reported `findings_count` is stored (ingest.ts:300). Fix:
  1. Take the base from GitHub, never from the artifact: the PR's `base.sha` via the pulls API for `run.pull_numbers[0]` (or the merge-base). Add a port method only if none exists.
  2. When re-grounding is impossible (no PR number, base unavailable, diff too large / null), do NOT store the reported `findings_count`, `blockers` or `verdict`: store them as null / "unverified" per the spec's verdict model, and keep the run visible.
  3. When `findings` is absent from the artifact, never fall back to the self-reported `findings_count`.
  4. Keep the verdict recomputed in the studio; never read the artifact's `verdict`.
- **Constraint:** plan "Security model" (V2: findings are untrusted, re-checked against the PR diff; blockers and verdict recomputed in the studio) and `specs/05-export-to-ci.md` V1–V3. Onion layering: GitHub only through the `GitHubClient` port; no SQL outside the repository. Contract changes additive/nullish only.
- **Owner:** implementer
- **Done when:** the security-reviewer no longer reports this finding on a re-scan; `cd server && pnpm typecheck` and `pnpm exec vitest run --exclude '**/*.it.test.ts'` pass; `diff -rq server/src/vendor/shared client/src/vendor/shared` is empty.

## Out of scope
The two SUGGESTION findings (artifact decode/format errors aborting the installation-wide sync loop in `octokit.ts:556-583`; `pull-requests: write` emitted when `post_as` is `none` in `workflow.ts:57-59`) are non-blocking and are reported to the user, not fixed here.
