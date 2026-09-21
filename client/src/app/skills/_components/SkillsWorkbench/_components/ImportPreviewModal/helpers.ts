import { unzipSync } from "fflate";
import { ACCEPTED_ENTRY_EXT, MAX_BODY_CHARS, MAX_ENTRIES } from "./constants";

/** A parsed skill body, before anything is sent anywhere. */
export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

/** Why an entry inside an archive was NOT imported. Shown in the preview so
 *  "the .sh was excluded" is visible, not implicit. */
export type DropReason = "extension" | "unsafe-path" | "too-many-entries" | "empty";

export interface ImportEntry {
  /** Path as it appeared in the archive, or the dropped file's name. */
  path: string;
  kept: boolean;
  reason?: DropReason;
  parsed?: ParsedSkill;
}

/**
 * Parse one markdown file into a skill.
 *
 * Frontmatter (`---\nname: …\ndescription: …\n---`) wins when present.
 * Otherwise: name falls back to the first `# ` heading, then the filename
 * stem; description falls back to the first non-empty paragraph after the
 * heading (or the whole body, for a heading-less file).
 */
export function parseMarkdownSkill(text: string, filename: string): ParsedSkill {
  const stem = filename.replace(/\.(md|markdown)$/i, "").split("/").pop() ?? filename;

  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let name: string | undefined;
  let description: string | undefined;
  let rest = text;

  if (fm) {
    rest = fm[2] ?? "";
    for (const line of (fm[1] ?? "").split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const [, key, value] = m;
      const v = (value ?? "").trim().replace(/^["']|["']$/g, "");
      if (key === "name") name = v;
      if (key === "description") description = v;
    }
  }

  const headingMatch = rest.match(/^#\s+(.+)$/m);
  if (!name) name = headingMatch?.[1]?.trim() ?? stem;

  if (!description) {
    const afterHeading = headingMatch ? rest.slice((headingMatch.index ?? 0) + headingMatch[0].length) : rest;
    const firstPara = afterHeading
      .split(/\r?\n\r?\n/)
      .map((p) => p.trim())
      .find((p) => p.length > 0);
    description = firstPara?.replace(/\r?\n/g, " ").slice(0, 300) ?? "";
  }

  const body = rest.trim().slice(0, MAX_BODY_CHARS);
  return { name, description, body: body || text.trim().slice(0, MAX_BODY_CHARS) };
}

function isAcceptedExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return ACCEPTED_ENTRY_EXT.some((ext) => lower.endsWith(ext));
}

/** Defense in depth: nothing is written to disk, but an absolute or `..` path
 *  inside an archive is rejected outright rather than trusted. */
function isSafePath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (path.split(/[/\\]/).includes("..")) return false;
  return true;
}

const decoder = new TextDecoder("utf-8");

/**
 * Parse a .zip's markdown entries into skills.
 *
 * Only `.md`/`.markdown` entries are ever decoded — every other entry (a
 * script, a binary, a nested folder) is recorded as dropped and its bytes are
 * never touched beyond the zip index. `unzipSync` is synchronous; the caller
 * is responsible for size-capping the File BEFORE calling this.
 */
export function parseArchive(bytes: Uint8Array): ImportEntry[] {
  const files = unzipSync(bytes);
  const paths = Object.keys(files).filter((p) => !p.endsWith("/"));
  const entries: ImportEntry[] = [];

  for (const [i, path] of paths.entries()) {
    if (i >= MAX_ENTRIES) {
      entries.push({ path, kept: false, reason: "too-many-entries" });
      continue;
    }
    if (!isSafePath(path)) {
      entries.push({ path, kept: false, reason: "unsafe-path" });
      continue;
    }
    if (!isAcceptedExtension(path)) {
      entries.push({ path, kept: false, reason: "extension" });
      continue;
    }
    const text = decoder.decode(files[path]);
    if (!text.trim()) {
      entries.push({ path, kept: false, reason: "empty" });
      continue;
    }
    entries.push({ path, kept: true, parsed: parseMarkdownSkill(text, path) });
  }
  return entries;
}
