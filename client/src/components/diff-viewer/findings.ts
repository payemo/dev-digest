/* Generic findings support for the DiffViewer.

   The viewer is SHARED and must stay generic: it knows where a marker goes,
   what colour it is, and what to call to render the body — and nothing about
   reviews. So this file deliberately does NOT import a PR-review DTO, a
   route-local finding card, or anything under the app router tree. The caller
   supplies anchors (already translated) plus a `render(id)` slot.

   Pure helpers mirror comments.ts, which is this folder's own precedent for
   "nothing is silently dropped". */
import type { ReactNode } from "react";
import type { Severity } from "@devdigest/ui";
import type { Line } from "./helpers";

/** One finding, reduced to what the viewer needs to place a marker. */
export interface DiffFindingAnchor {
  /** Opaque to the viewer — handed back to `render`. */
  id: string;
  path: string;
  /** The finding's start line, on the RIGHT (post-change) side. */
  line: number;
  /** The one shared vocabulary item, from @devdigest/ui's token set. */
  severity: Severity;
  /** Caller-supplied and already translated (e.g. "blocker"). */
  label: string;
}

/** What the viewer needs to show findings inline. */
export interface DiffFindingApi {
  anchors: DiffFindingAnchor[];
  /** Gated by the same boolean as comments — one toggle for both. */
  showFindings: boolean;
  /** Route-local renderer. The viewer never imports the card it draws. */
  render: (id: string) => ReactNode;
  /** Heading for the "line not in this patch" footer block. */
  unanchoredLabel: string;
}

/**
 * The anchors a parsed line hosts. A finding cites the POST-change file, so it
 * matches on `newNo` only — unlike a comment, which can also anchor LEFT.
 */
export function anchorsForLine(
  ln: Line,
  byLine: Map<number, DiffFindingAnchor[]>,
): DiffFindingAnchor[] {
  if (byLine.size === 0) return [];
  if (ln.kind !== "add" && ln.kind !== "ctx") return [];
  if (ln.newNo == null) return [];
  return byLine.get(ln.newNo) ?? [];
}

/**
 * Split anchors into those that land on a line this patch actually renders and
 * those that do not (a truncated patch, a `patch: null` file, a finding citing
 * a deleted line). The remainder is surfaced in a footer block rather than
 * dropped — the direct analogue of `partitionThreads`.
 */
export function partitionAnchors(
  anchors: DiffFindingAnchor[],
  renderedLines: Set<number>,
): { matched: Map<number, DiffFindingAnchor[]>; unanchored: DiffFindingAnchor[] } {
  const matched = new Map<number, DiffFindingAnchor[]>();
  const unanchored: DiffFindingAnchor[] = [];
  for (const a of anchors) {
    if (renderedLines.has(a.line)) {
      const list = matched.get(a.line) ?? [];
      list.push(a);
      matched.set(a.line, list);
    } else {
      unanchored.push(a);
    }
  }
  return { matched, unanchored };
}
