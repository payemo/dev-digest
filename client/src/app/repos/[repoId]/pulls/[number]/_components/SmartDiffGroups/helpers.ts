/* Pure derivations for SmartDiffGroups. No react import — that is the test
   for "this belongs in helpers.ts". */
import type { PrFile, SmartDiffGroup, SmartDiffRole } from "@devdigest/shared";
import type { DiffFindingAnchor } from "@/components/diff-viewer";

export interface JoinedGroup {
  role: SmartDiffRole;
  files: PrFile[];
}

/**
 * The `/smart-diff` response is an ORDERING INDEX — it carries no patch text,
 * because the client already holds the patches on `pr.files`. Join the two by
 * path, in response order, so each group renders real diffs.
 *
 * Defensive rule: a file present in `pr.files` but absent from the response is
 * appended to the END of the `core` group, in GitHub order. Both sides read the
 * same `pr_files` rows so this should never fire; it exists so a race after a
 * PR refresh cannot make a file silently vanish from the diff.
 */
export function joinGroups(groups: SmartDiffGroup[], files: PrFile[]): JoinedGroup[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const claimed = new Set<string>();

  const joined = groups.map((g) => ({
    role: g.role,
    files: g.files.reduce<PrFile[]>((acc, f) => {
      const file = byPath.get(f.path);
      if (file) {
        claimed.add(f.path);
        acc.push(file);
      }
      return acc;
    }, []),
  }));

  const orphans = files.filter((f) => !claimed.has(f.path));
  if (orphans.length > 0) {
    const core = joined.find((g) => g.role === "core");
    if (core) core.files = [...core.files, ...orphans];
    else joined.push({ role: "core", files: orphans });
  }
  return joined;
}

/** How many FILES in this group carry at least one finding (not how many findings). */
export function filesWithFindings(files: PrFile[], anchors: DiffFindingAnchor[]): number {
  if (anchors.length === 0) return 0;
  const cited = new Set(anchors.map((a) => a.path));
  return files.reduce((n, f) => n + (cited.has(f.path) ? 1 : 0), 0);
}

/** Repo-wide totals for the section's summary sub-row. */
export function diffTotals(files: PrFile[]): {
  files: number;
  additions: number;
  deletions: number;
} {
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + (f.additions ?? 0), 0),
    deletions: files.reduce((n, f) => n + (f.deletions ?? 0), 0),
  };
}
