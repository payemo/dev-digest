import { z } from 'zod';

/**
 * Project Context — repository documents attached to agents and skills.
 *
 * One document = one Markdown file, either DISCOVERED under the repository's
 * `.devdigest/{specs,docs,insights}/` root (`origin: 'repo'`) or AUTHORED in the
 * studio (`origin: 'user'`). A document's full text is snapshotted server-side,
 * so a run injects what was stored, never what is on disk at run time.
 *
 * Attachments are per (owner, repository): an agent or a skill attaches an
 * ORDERED subset of one repository's documents. A run of that agent in that
 * repository injects the merged effective set (the agent's own attachments plus
 * the ones its enabled skills contribute) into the engine's already-untrusted
 * `## Project context` prompt section.
 *
 * Wire casing is snake_case throughout, matching the SQL columns and every
 * other contract in this folder. Nothing here imports anything but zod.
 */

// ---------------------------------------------------------------------------
// Document identity
// ---------------------------------------------------------------------------

/**
 * The classifying immediate subdirectory of the convention root. A document's
 * category IS its directory — there is no uncategorized document, which is why
 * Markdown sitting directly under `.devdigest/` is not discovered at all.
 */
export const ContextDocumentCategory = z.enum(['specs', 'docs', 'insights']);
export type ContextDocumentCategory = z.infer<typeof ContextDocumentCategory>;

/**
 * Where the document came from. The same path may exist under BOTH origins —
 * a discovered file and a studio-authored document at `specs/x.md` are two
 * separate documents, separately attachable. Reconciliation after a re-scan
 * only ever touches `repo` rows.
 */
export const ContextDocumentOrigin = z.enum(['repo', 'user']);
export type ContextDocumentOrigin = z.infer<typeof ContextDocumentOrigin>;

/**
 * Whether the document is still backed by something. A `repo` document whose
 * file vanished from the clone becomes `missing` — it is never deleted, so its
 * attachments (and the fact that it once existed) survive.
 */
export const ContextDocumentAvailability = z.enum(['present', 'missing']);
export type ContextDocumentAvailability = z.infer<typeof ContextDocumentAvailability>;

/**
 * Document summary — everything the Project Context list and the attachment
 * pickers render. Deliberately carries NO content: the body is fetched one
 * document at a time (`ContextDocumentContent`) so a list response stays small.
 */
export const ContextDocument = z.object({
  id: z.string().uuid(),
  /** Repo-relative posix path, e.g. `.devdigest/specs/public-api.md`. */
  path: z.string(),
  /** File name only, e.g. `public-api.md`. */
  name: z.string(),
  /** Path between the category directory and the name; `''` at the category root. */
  folder: z.string(),
  category: ContextDocumentCategory,
  origin: ContextDocumentOrigin,
  availability: ContextDocumentAvailability,
  size_bytes: z.number().int().nonnegative(),
  /** Stored token count, produced by the one shared counting scheme. */
  token_count: z.number().int().nonnegative(),
  /** sha256 of the stored snapshot — changes iff the content changed. */
  fingerprint: z.string(),
  updated_at: z.string(),
  /** How many ENABLED agents reach this document, directly or via a skill. */
  used_by_agents: z.number().int().nonnegative(),
});
export type ContextDocument = z.infer<typeof ContextDocument>;

/** One document with its stored snapshot, for the read-only preview. */
export const ContextDocumentContent = ContextDocument.extend({
  content: z.string(),
});
export type ContextDocumentContent = z.infer<typeof ContextDocumentContent>;

// ---------------------------------------------------------------------------
// Per-repository sync state
// ---------------------------------------------------------------------------

/**
 * `failed`/`bounded` are what the last scan DID (stored); `fresh`/`stale` are
 * derived from how long ago it happened, so no background job has to age a row.
 */
export const ContextSetHealth = z.enum(['fresh', 'stale', 'failed', 'bounded']);
export type ContextSetHealth = z.infer<typeof ContextSetHealth>;

export const ContextSetStatus = z.object({
  document_count: z.number().int().nonnegative(),
  last_synced_at: z.string().nullable(),
  health: ContextSetHealth,
  /** Why it is `failed`/`bounded` — e.g. `no_clone`, `bounded:42`. */
  reason: z.string().nullish(),
});
export type ContextSetStatus = z.infer<typeof ContextSetStatus>;

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * How an agent reaches a document. `inherited` = only through one of its
 * enabled skills; `both` = attached directly AND contributed by a skill, in
 * which case it is injected once, at its direct position.
 */
export const ContextProvenance = z.enum(['direct', 'inherited', 'both']);
export type ContextProvenance = z.infer<typeof ContextProvenance>;

export const ContextAttachment = z.object({
  document: ContextDocument,
  provenance: ContextProvenance,
});
export type ContextAttachment = z.infer<typeof ContextAttachment>;

export const ContextOwnerKind = z.enum(['agent', 'skill']);
export type ContextOwnerKind = z.infer<typeof ContextOwnerKind>;

/**
 * The effective, ordered set for one (owner, repository) pair. `over_budget` is
 * a DISPLAY signal only — crossing `budget_threshold` warns and gates nothing.
 */
export const ContextAttachmentSet = z.object({
  repo_id: z.string().uuid(),
  owner_kind: ContextOwnerKind,
  owner_id: z.string().uuid(),
  documents: z.array(ContextAttachment),
  total_tokens: z.number().int().nonnegative(),
  budget_threshold: z.number().int().positive(),
  over_budget: z.boolean(),
});
export type ContextAttachmentSet = z.infer<typeof ContextAttachmentSet>;

/**
 * Attachment write = the WHOLE ordered list, never a delta. Order is the array
 * index, so a reorder and an attach are the same request and two concurrent
 * edits cannot interleave into a half-applied set.
 */
export const ContextAttachmentSetUpdate = z.object({
  document_ids: z.array(z.string().uuid()),
});
export type ContextAttachmentSetUpdate = z.infer<typeof ContextAttachmentSetUpdate>;

// ---------------------------------------------------------------------------
// Intake (create-in-place and upload share one JSON body)
// ---------------------------------------------------------------------------

/**
 * A studio-authored document. `folder` may name a folder that does not exist
 * yet — a folder comes into existence by holding a document, so there is no
 * separate "create folder" call and no empty folder to persist.
 */
export const ContextDocumentIntake = z.object({
  category: ContextDocumentCategory,
  folder: z.string(),
  name: z.string().min(1),
  body: z.string(),
});
export type ContextDocumentIntake = z.infer<typeof ContextDocumentIntake>;

// ---------------------------------------------------------------------------
// The one global threshold
// ---------------------------------------------------------------------------

/**
 * Token total above which the UI warns that an attachment set is large.
 * ONE global number, not per agent or per model: it exists so the user can see
 * the cost of what they attached before a run, and it never refuses a write or
 * a run. Lives here so the server's computed `over_budget` and the client's
 * warning read the same constant.
 */
export const CONTEXT_TOKEN_BUDGET = 8000;
