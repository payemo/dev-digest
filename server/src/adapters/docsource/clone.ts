/**
 * docsource adapter — reads a repository's project-context documents off its
 * local clone. The `ProjectDocSource` port's only real implementation, and the
 * only place this feature touches the filesystem.
 *
 * Walks the whole clone for Markdown under a `specs`/`docs`/`insights`
 * directory at any depth, skipping `EXCLUDED_SCAN_DIRS` (`node_modules`, …) and
 * hidden directories other than the `.devdigest` convention root. The code
 * index's own walk is untouched.
 */
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type {
  GitClient,
  ProjectDocFile,
  ProjectDocScan,
  ProjectDocSource,
  RepoRef,
} from '@devdigest/shared';
import {
  CONTEXT_ROOT,
  EXCLUDED_SCAN_DIRS,
  MARKDOWN_EXT,
  MAX_DOCS_PER_REPO,
  MAX_DOC_BYTES,
  MAX_SCAN_ENTRIES,
} from '../../modules/project-context/constants.js';
import { classifyDocument } from '../../modules/project-context/helpers.js';

const MARKDOWN_SET: ReadonlySet<string> = new Set<string>(MARKDOWN_EXT);

export class CloneDocSource implements ProjectDocSource {
  /**
   * Takes the `GitClient` port rather than a directory so the clone location
   * is resolved the one way the rest of the server resolves it
   * (`clonePathFor`), instead of re-deriving a path from config.
   */
  constructor(private git: GitClient) {}

  /**
   * Never throws. A missing or unreadable clone is reported as
   * `available: false`, which the caller reads as "nothing to compare against"
   * and therefore leaves every stored snapshot alone — the opposite of
   * reconciling them all away because the disk was momentarily gone.
   */
  async scan(repo: RepoRef): Promise<ProjectDocScan> {
    const unavailable: ProjectDocScan = {
      files: [],
      head: null,
      available: false,
      bounded: 0,
      skippedTooLarge: 0,
    };

    let clonePath: string;
    try {
      clonePath = this.git.clonePathFor(repo);
    } catch {
      return unavailable;
    }

    // The symlink-free base every candidate must resolve under. Resolved once,
    // so a clone directory that is itself reached through a symlink still works.
    let realBase: string;
    try {
      realBase = await realpath(clonePath);
    } catch {
      return unavailable;
    }

    const candidates: string[] = [];
    let skippedTooLarge = 0;
    const walk: WalkState = { cloneRoot: clonePath, realBase, remaining: MAX_SCAN_ENTRIES };
    await collect(walk, clonePath, candidates);

    // Sorted so "the first N" is reproducible rather than dependent on
    // directory order, which readdir does not guarantee.
    candidates.sort();

    const kept: string[] = [];
    for (const rel of candidates) {
      let size: number;
      try {
        size = (await stat(join(clonePath, rel))).size;
      } catch {
        continue;
      }
      // stat BEFORE read: an oversized document is never pulled into memory.
      if (size > MAX_DOC_BYTES) {
        skippedTooLarge += 1;
        continue;
      }
      kept.push(rel);
    }

    const bounded = Math.max(0, kept.length - MAX_DOCS_PER_REPO);
    const files: ProjectDocFile[] = [];
    for (const rel of kept.slice(0, MAX_DOCS_PER_REPO)) {
      try {
        const content = await readFile(join(clonePath, rel), 'utf8');
        files.push({ path: rel, content, sizeBytes: Buffer.byteLength(content, 'utf8') });
      } catch {
        // Raced away or unreadable between stat and read — treat as absent.
      }
    }

    let head: string | null = null;
    try {
      head = await this.git.currentHead(repo);
    } catch {
      head = null;
    }

    return { files, head, available: true, bounded, skippedTooLarge };
  }
}

/** True only for a real directory — a symlink to one, or anything missing, is false. */
async function isRealDirectory(path: string): Promise<boolean> {
  try {
    const st = await lstat(path);
    return !st.isSymbolicLink() && st.isDirectory();
  } catch {
    return false;
  }
}

/** True when `path` resolves (symlinks followed) to somewhere under `realBase`. */
async function resolvesUnder(realBase: string, path: string): Promise<boolean> {
  try {
    const real = await realpath(path);
    return real.startsWith(realBase + sep);
  } catch {
    return false;
  }
}

/** Shared across the whole recursion, so the entry budget spans all categories. */
interface WalkState {
  cloneRoot: string;
  realBase: string;
  remaining: number;
}

/**
 * Recurse a directory, appending the repo-relative posix paths of Markdown
 * files that `classifyDocument` accepts.
 *
 * Two independent layers keep the walk inside the clone:
 *  1. entries that are symlinks are never followed or collected — same rule the
 *     code-index walk uses;
 *  2. each candidate file's real path must fall under the clone's real path
 *     before it is kept.
 * And the walk visits at most `MAX_SCAN_ENTRIES` entries in total, so a very
 * large tree cannot turn one scan into an unbounded directory walk.
 */
async function collect(walk: WalkState, dir: string, out: string[]): Promise<void> {
  if (walk.remaining <= 0) return;
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // A directory that cannot be read contributes nothing; the rest still scan.
    return;
  }

  for (const entry of entries) {
    if (walk.remaining <= 0) return;
    walk.remaining -= 1;
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_SCAN_DIRS.has(entry.name)) continue;
      // Only the convention root may be hidden, and only at the clone root.
      if (entry.name.startsWith('.') && !(dir === walk.cloneRoot && entry.name === CONTEXT_ROOT)) {
        continue;
      }
      await collect(walk, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!MARKDOWN_SET.has(extname(entry.name).toLowerCase())) continue;
    if (!(await resolvesUnder(walk.realBase, full))) continue;
    // Posix separators so stored paths are platform-agnostic, matching the
    // `pr_files.path` convention.
    const rel = relative(walk.cloneRoot, full).split(sep).join('/');
    if (classifyDocument(rel)) out.push(rel);
  }
}
