import type { PrNote } from '@devdigest/shared';
import type { PrNoteRow } from './repository.js';
import { NOTE_MAX_CHARS } from './constants.js';

export function toNote(row: PrNoteRow): PrNote {
  return {
    id: row.id,
    pull_id: row.pullId,
    author_login: row.authorLogin,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

export function clampBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > NOTE_MAX_CHARS ? trimmed.slice(0, NOTE_MAX_CHARS) : trimmed;
}
