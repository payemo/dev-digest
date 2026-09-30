import type { ContextAttachment, ContextDocument } from "@/lib/types";
import { CATEGORY_ORDER } from "./constants";

/** Swap the element at `index` with its neighbour, returning a new array. An
 *  out-of-range move is a no-op. */
export function moveId(ids: string[], index: number, direction: "up" | "down"): string[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/**
 * The ids this owner may WRITE — its own attachments, in their order.
 *
 * An inherited-only document is deliberately excluded: it reaches the agent
 * through a skill, so putting it in the agent's own list on the next write
 * would quietly convert an inherited attachment into a direct one.
 */
export function writableIds(attachments: ContextAttachment[]): string[] {
  return attachments
    .filter((a) => a.provenance === "direct" || a.provenance === "both")
    .map((a) => a.document.id);
}

/** Case-insensitive substring match over name and folder. */
export function filterDocuments(documents: ContextDocument[], query: string): ContextDocument[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return documents;
  return documents.filter(
    (d) => d.name.toLowerCase().includes(q) || d.folder.toLowerCase().includes(q),
  );
}

/** Category order first, then path — the fallback order for anything with no
 *  attachment position of its own. */
export function sortDocuments(documents: ContextDocument[]): ContextDocument[] {
  return [...documents].sort((a, b) => {
    const byCategory = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    return byCategory !== 0 ? byCategory : a.path.localeCompare(b.path);
  });
}

/**
 * The row order the list actually renders in: attached documents first, in
 * their own custom order (`orderedIds`), then everything else in category+path
 * order. The hint text promises "a document earlier in this list appears
 * earlier in the assembled block" — so the on-screen position must BE the
 * order, not a separate figure a drag gesture updates invisibly.
 */
export function orderForDisplay(
  documents: ContextDocument[],
  orderedIds: string[],
): ContextDocument[] {
  const rank = new Map(orderedIds.map((id, i) => [id, i]));
  const attached = documents
    .filter((d) => rank.has(d.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = sortDocuments(documents.filter((d) => !rank.has(d.id)));
  return [...attached, ...rest];
}

/**
 * Move `dragId` next to `overId` — before it, or after when `before` is
 * false — returning a new array. A no-op if either id is missing from `ids`
 * (e.g. `overId` belongs to an unattached row, which has no position to drop
 * onto) or if they're the same id.
 */
export function reorderIds(
  ids: string[],
  dragId: string,
  overId: string,
  before: boolean,
): string[] {
  if (dragId === overId || !ids.includes(dragId) || !ids.includes(overId)) return ids;
  const without = ids.filter((id) => id !== dragId);
  const at = without.indexOf(overId);
  without.splice(before ? at : at + 1, 0, dragId);
  return without;
}

/**
 * Total tokens of the attached set, summed from each document's STORED count.
 * Nothing is counted here — the number a row shows and the number the footer
 * shows are the same server-produced figure.
 */
export function totalTokens(attachments: ContextAttachment[]): number {
  return attachments.reduce((sum, a) => sum + a.document.token_count, 0);
}
