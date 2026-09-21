/** Hard limits enforced BEFORE any parsing — never after. */

/** Reject a file/archive larger than this before touching it. unzipSync is
 *  synchronous; a large zip bomb would otherwise freeze the tab. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB

/** Reject an archive with more entries than this. */
export const MAX_ENTRIES = 50;

/** Truncate an absurdly long body rather than reject the whole import. */
export const MAX_BODY_CHARS = 200_000;

/** Only these extensions are ever parsed as a skill. Everything else — an
 *  executable, a script, an image — is dropped before the preview is built
 *  and never reaches a request body. */
export const ACCEPTED_ENTRY_EXT = [".md", ".markdown"];
