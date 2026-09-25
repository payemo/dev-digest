/**
 * Smart Diff (L04) — pure transforms. No I/O, no composition root, no ORM: a
 * string in, a role out. That purity is the point — the same `classifyFile`
 * is meant to be importable from the review prompt path later, with no HTTP
 * and no DB in sight.
 *
 * The camelCase → snake_case rename to the wire contract happens HERE, on the
 * way out, so a persistence row never reaches an HTTP response. The input is
 * structurally typed on purpose: there is no row type to name for `pr_files`,
 * and reaching for the storage schema to name one would drag the storage
 * format into a pure layer.
 */
import type { SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { ROLE_ORDER, ROLE_PATTERNS } from './constants.js';

/** The shape `groupFilesByRole` needs from a changed file. Caller-shaped. */
export interface ClassifiableFile {
  path: string;
  additions: number | null;
  deletions: number | null;
  /** The finding `start_line`s cited on this file; `[]` when unreviewed. */
  findingLines: number[];
}

/** Repo-relative, `/`-separated, no leading `./`. */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * The role a changed file plays. Walks `ROLE_PATTERNS` in order — first match
 * wins — and falls through to `core`. See the `DO NOT REORDER` note on
 * `ROLE_PATTERNS` for the three cases the order decides.
 */
export function classifyFile(path: string): SmartDiffRole {
  const p = normalize(path);
  for (const { role, patterns } of ROLE_PATTERNS) {
    if (patterns.some((re) => re.test(p))) return role;
  }
  return 'core';
}

/**
 * Bucket changed files by role and emit ALL FIVE groups in `ROLE_ORDER`,
 * including empty ones, so the response shape is stable for every consumer.
 * Input order is preserved inside each group (i.e. GitHub's file order).
 *
 * `pseudocode_summary` is always `null`: the "what this does" line needs a
 * model call and is deliberately out of scope for this endpoint.
 */
export function groupFilesByRole(files: ClassifiableFile[]): SmartDiffGroup[] {
  const buckets = new Map<SmartDiffRole, SmartDiffGroup['files']>(
    ROLE_ORDER.map((role) => [role, []]),
  );
  for (const file of files) {
    buckets.get(classifyFile(file.path))!.push({
      path: file.path,
      pseudocode_summary: null,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      finding_lines: file.findingLines,
    });
  }
  return ROLE_ORDER.map((role) => ({ role, files: buckets.get(role)! }));
}

/** `additions + deletions` across every changed file; null counts read as 0. */
export function totalChangedLines(files: Pick<ClassifiableFile, 'additions' | 'deletions'>[]): number {
  return files.reduce((sum, f) => sum + (f.additions ?? 0) + (f.deletions ?? 0), 0);
}
