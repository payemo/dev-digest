import { createHash } from 'node:crypto';
import type {
  ContextDocument,
  ContextDocumentCategory,
  ContextDocumentIntake,
  ContextProvenance,
  ContextSetHealth,
} from '@devdigest/shared';
import type { ContextDocumentRow } from '../../db/rows.js';
import {
  CONTEXT_CATEGORIES,
  CONTEXT_ROOT,
  EXCLUDED_SCAN_DIRS,
  MARKDOWN_EXT,
  MAX_DOC_BYTES,
  STALE_AFTER_MS,
} from './constants.js';

/**
 * project-context — the pure half. Every function here is a transform over its
 * arguments: no wiring, no queries, no I/O. `createHash` is compute, not I/O.
 *
 * Testable with plain object arguments and no mocks at all, which is the point:
 * the interesting rules of this feature (what counts as a document, what a user
 * may name one, how two attachment sources merge) are decided here rather than
 * anywhere a database has to be running.
 */

const CATEGORY_SET: ReadonlySet<string> = new Set<string>(CONTEXT_CATEGORIES);
const MARKDOWN_SET: ReadonlySet<string> = new Set<string>(MARKDOWN_EXT);

export interface DocumentClassification {
  category: ContextDocumentCategory;
  folder: string;
  name: string;
}

/**
 * Classify a repo-relative path, or return `null` when it is not a document.
 *
 * A Markdown file is a document when some directory above it is named
 * `specs`, `docs` or `insights`, at any depth — so documentation that already
 * sits next to the code (`server/docs/x.md`, `client/specs/y.md`) is found as
 * well as `.devdigest/{specs,docs,insights}/**`. The OUTERMOST such directory
 * is the category. A repo-root `README.md` has no category directory and
 * returns `null`, as does anything under a hidden directory other than the
 * root (`.git`, `.github`, `src/.devdigest`) or an excluded one
 * (`node_modules`, `dist`, …).
 *
 * `folder` is the path between the repo and the file with the root and the
 * category segment removed, so `server/docs/api/x.md` is folder `server/api`
 * and `.devdigest/docs/api/x.md` is folder `api`.
 */
export function classifyDocument(relPath: string): DocumentClassification | null {
  const segments = relPath.split('/').filter((seg) => seg.length > 0);
  if (segments.length < 2) return null;

  const name = segments[segments.length - 1]!;
  if (!MARKDOWN_SET.has(extLower(name))) return null;

  const dirs = segments.slice(0, -1);
  // Only the convention root may be hidden, and only as the first segment.
  const hidden = dirs.findIndex((seg, i) => seg.startsWith('.') && !(i === 0 && seg === CONTEXT_ROOT));
  if (hidden !== -1) return null;
  if (dirs.some((seg) => EXCLUDED_SCAN_DIRS.has(seg))) return null;

  const at = dirs.findIndex((seg) => CATEGORY_SET.has(seg));
  if (at === -1) return null;

  const folder = dirs
    .filter((seg, i) => i !== at && !(i === 0 && seg === CONTEXT_ROOT))
    .join('/');
  return { category: dirs[at] as ContextDocumentCategory, folder, name };
}

export interface SafePathResult {
  ok: true;
  path: string;
  folder: string;
  name: string;
}
export interface SafePathRejection {
  ok: false;
  reason: string;
}

/**
 * Build the stored path for a studio-authored document, or explain why the
 * requested one is not addressable.
 *
 * A document cannot address a location outside its own repository's document
 * area, so anything that could escape `<root>/<category>/` is rejected rather
 * than normalized into something adjacent: absolute paths, a drive letter, a
 * NUL byte, backslash separators, and any `..` that survives normalization.
 * The check is "does the normalized result still start with the category
 * prefix?", not a denylist of spellings.
 */
export function safeUserPath(input: {
  category: string;
  folder: string;
  name: string;
}): SafePathResult | SafePathRejection {
  const { category } = input;
  if (!CATEGORY_SET.has(category)) {
    return { ok: false, reason: `Unknown category "${category}".` };
  }

  const raw = `${input.folder ?? ''}/${input.name ?? ''}`;
  if (raw.includes('\0')) {
    return { ok: false, reason: 'A document path cannot contain a null byte.' };
  }
  if (raw.includes('\\')) {
    return { ok: false, reason: 'Use "/" to separate folders in a document path.' };
  }
  if (/^[a-zA-Z]:/.test(input.folder ?? '')) {
    return { ok: false, reason: 'A document path must be relative to its category folder.' };
  }

  const name = (input.name ?? '').trim();
  if (name.length === 0) return { ok: false, reason: 'A document needs a file name.' };
  if (name.includes('/')) {
    return { ok: false, reason: 'Put folders in the folder field, not in the file name.' };
  }
  if (!MARKDOWN_SET.has(extLower(name))) {
    return {
      ok: false,
      reason: `Only Markdown documents are supported (${MARKDOWN_EXT.join(', ')}).`,
    };
  }

  const folder = normalizeRelative(input.folder ?? '');
  if (folder === null) {
    return { ok: false, reason: 'A document folder cannot point outside its category.' };
  }

  const prefix = `${CONTEXT_ROOT}/${category}/`;
  const path = `${prefix}${folder.length > 0 ? `${folder}/` : ''}${name}`;
  // Belt and braces: whatever the pieces were, the assembled path must still
  // sit under the category prefix.
  if (!path.startsWith(prefix) || path.includes('/../') || path.endsWith('/..')) {
    return { ok: false, reason: 'A document folder cannot point outside its category.' };
  }
  return { ok: true, path, folder, name };
}

/**
 * Collapse `.` segments and reject anything with a `..` that would climb out.
 * Returns `null` for a rejection so the caller can phrase the reason.
 */
function normalizeRelative(folder: string): string | null {
  const out: string[] = [];
  for (const seg of folder.split('/')) {
    if (seg.length === 0 || seg === '.') continue;
    // A `..` is rejected outright rather than popped: "the folder above" is
    // never a thing a user needs to express when naming a new document, so
    // accepting it would only ever be an escape attempt.
    if (seg === '..') return null;
    out.push(seg);
  }
  return out.join('/');
}

export interface IntakeRejection {
  ok: false;
  reason: string;
}
export interface IntakeAccepted {
  ok: true;
  path: string;
  folder: string;
  name: string;
  sizeBytes: number;
}

/**
 * Validate an intake body: Markdown-only, non-empty, within the per-document
 * size bound. Returns an explanatory reason rather than a bare boolean, so the
 * page can say what to fix instead of "invalid".
 */
export function validateIntake(body: ContextDocumentIntake): IntakeAccepted | IntakeRejection {
  const resolved = safeUserPath(body);
  if (!resolved.ok) return resolved;

  const text = body.body ?? '';
  if (text.trim().length === 0) {
    return { ok: false, reason: 'A document cannot be empty.' };
  }
  const sizeBytes = Buffer.byteLength(text, 'utf8');
  if (sizeBytes > MAX_DOC_BYTES) {
    return {
      ok: false,
      reason: `A document must be at most ${MAX_DOC_BYTES} bytes; this one is ${sizeBytes}.`,
    };
  }
  return { ok: true, path: resolved.path, folder: resolved.folder, name: resolved.name, sizeBytes };
}

/** sha256 hex of a stored snapshot — equal iff the content is equal. */
export function fingerprint(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Render one document into the string handed to the engine's project-context
 * slot: its path on the first line, a blank line, then the body verbatim.
 *
 * The path goes INSIDE the block the engine wraps, never into the wrapper's own
 * `source` label — that label is interpolated into an attribute, so a
 * user-chosen path there would be an injection surface. Inside the body it is
 * just more data the model can use to tell documents apart.
 *
 * No truncation, at any length: the user chose what to attach, and silently
 * dropping half of a specification is worse than a large prompt. The
 * compensating controls are the pre-run token total and the reproducible trace.
 */
export function renderContextDocument(doc: { path: string; content: string }): string {
  return `${doc.path}\n\n${doc.content}`;
}

export interface EffectiveEntry {
  documentId: string;
  provenance: ContextProvenance;
}

/**
 * Merge an agent's own attachments with the ones its enabled skills contribute.
 *
 * Order: the agent's own list in the user's order first, then each skill's list
 * in the agent's skill order. A document reached both ways appears ONCE, at its
 * earliest position, marked `both` — so attaching a document an inherited skill
 * already supplies changes its position but never duplicates its text.
 */
export function mergeEffectiveSet(
  direct: string[],
  inheritedBySkill: string[][],
): EffectiveEntry[] {
  const order: string[] = [];
  const provenance = new Map<string, ContextProvenance>();

  for (const id of direct) {
    if (!provenance.has(id)) {
      order.push(id);
      provenance.set(id, 'direct');
    }
  }
  for (const skillDocs of inheritedBySkill) {
    for (const id of skillDocs) {
      const seen = provenance.get(id);
      if (seen === undefined) {
        order.push(id);
        provenance.set(id, 'inherited');
      } else if (seen === 'direct') {
        provenance.set(id, 'both');
      }
    }
  }
  return order.map((documentId) => ({ documentId, provenance: provenance.get(documentId)! }));
}

/**
 * Derive the health a status readout shows. `failed`/`bounded` are what the
 * last scan recorded; `fresh` vs `stale` is elapsed time, computed here, which
 * is why nothing has to age a stored row. A repository that was never synced
 * reads `stale` — there is nothing current about having no data.
 */
export function deriveHealth(
  state: { outcome: 'ok' | 'failed' | 'bounded'; lastSyncedAt: Date | null } | null,
  now: number,
): ContextSetHealth {
  if (!state) return 'stale';
  if (state.outcome === 'failed') return 'failed';
  if (state.outcome === 'bounded') return 'bounded';
  if (!state.lastSyncedAt) return 'stale';
  return now - state.lastSyncedAt.getTime() > STALE_AFTER_MS ? 'stale' : 'fresh';
}

/** Map a stored row plus its reverse count onto the wire shape (snake_case). */
export function toDocumentDto(
  row: Omit<ContextDocumentRow, 'content'> & { content?: string },
  usedByAgents: number,
): ContextDocument {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    folder: row.folder,
    category: row.category,
    origin: row.origin,
    availability: row.availability,
    size_bytes: row.sizeBytes,
    token_count: row.tokenCount,
    fingerprint: row.fingerprint,
    updated_at: row.updatedAt.toISOString(),
    used_by_agents: usedByAgents,
  };
}

function extLower(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}
