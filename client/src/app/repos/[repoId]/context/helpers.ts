import type { ContextDocument, ContextDocumentCategory } from "@/lib/types";
import { CATEGORY_ORDER, MARKDOWN_EXT, MAX_DOC_BYTES } from "./constants";

export interface CategoryGroup {
  category: ContextDocumentCategory;
  documents: ContextDocument[];
}

/** Group documents by category in `CATEGORY_ORDER`, dropping empty groups. */
export function groupByCategory(documents: ContextDocument[]): CategoryGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    documents: documents
      .filter((d) => d.category === category)
      .sort((a, b) => a.path.localeCompare(b.path)),
  })).filter((g) => g.documents.length > 0);
}

/** Case-insensitive substring match over a document's name and folder. */
export function filterDocuments(documents: ContextDocument[], query: string): ContextDocument[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return documents;
  return documents.filter(
    (d) => d.name.toLowerCase().includes(q) || d.folder.toLowerCase().includes(q),
  );
}

/** Compact elapsed time for the sync footer (e.g. "now", "5m", "3h", "2d"). */
export function elapsedLabel(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Split a `bounded:<dropped>:<kept>` reason into its two numbers. Returns null
 * for any other reason string, so the footer falls back to showing it verbatim
 * rather than inventing a figure.
 */
export function parseBoundedReason(
  reason: string | null | undefined,
): { dropped: number; kept: number } | null {
  if (!reason) return null;
  const match = /^bounded:(\d+):(\d+)$/.exec(reason);
  if (!match) return null;
  return { dropped: Number(match[1]), kept: Number(match[2]) };
}

export type IntakeRejection = "extension" | "empty" | "tooLarge";

/**
 * The client-side pre-check: same rules as the server's, run early so a
 * rejection is explained instead of arriving as a 422. Returns `null` when
 * nothing is obviously wrong — the server still has the final say.
 */
export function precheckIntake(name: string, body: string): IntakeRejection | null {
  const lower = name.trim().toLowerCase();
  if (!MARKDOWN_EXT.some((ext) => lower.endsWith(ext))) return "extension";
  if (body.trim().length === 0) return "empty";
  if (byteLength(body) > MAX_DOC_BYTES) return "tooLarge";
  return null;
}

/** UTF-8 byte length, matching what the server bounds. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
