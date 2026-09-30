/**
 * Pure URL helpers for the PR detail route's Files-changed deep link
 * (`?tab=diff&file=<path>&line=<n>`). No `react` import. The target file and
 * line are only ever used as comparison values by the diff view — never as
 * markup or as a URL.
 */

export const DIFF_TARGET_PARAMS = { file: "file", line: "line" } as const;

export interface DiffTargetParams {
  file: string;
  line: number | null;
}

/** The deep-link target in `search`, or null. A non-positive-integer line reads as null. */
export function readDiffTarget(search: URLSearchParams): DiffTargetParams | null {
  const file = search.get(DIFF_TARGET_PARAMS.file);
  if (!file) return null;
  const raw = search.get(DIFF_TARGET_PARAMS.line);
  const n = raw != null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return { file, line: Number.isInteger(n) && n > 0 ? n : null };
}

/** A copy of `search` pointing at the Files changed tab, file and (optional) line. */
export function withDiffTarget(
  search: URLSearchParams,
  file: string,
  line: number | null,
): URLSearchParams {
  const sp = new URLSearchParams(search.toString());
  sp.set("tab", "diff");
  sp.set(DIFF_TARGET_PARAMS.file, file);
  if (line != null && Number.isInteger(line) && line > 0) sp.set(DIFF_TARGET_PARAMS.line, String(line));
  else sp.delete(DIFF_TARGET_PARAMS.line);
  return sp;
}

/** A copy of `search` with any deep-link target removed. */
export function withoutDiffTarget(search: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(search.toString());
  sp.delete(DIFF_TARGET_PARAMS.file);
  sp.delete(DIFF_TARGET_PARAMS.line);
  return sp;
}
