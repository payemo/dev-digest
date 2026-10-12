import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { RunnerBundle, RunnerBundleSource } from '@devdigest/shared';

/** `RUNNER_VERSION = '2'` as emitted by the (non-minified) ncc bundle. */
const VERSION_MARKER = /\bRUNNER_VERSION\s*=\s*['"]([A-Za-z0-9._-]{1,32})['"]/;

/**
 * Reads the locally built agent-runner bundle (`agent-runner/dist/index.js` by
 * default) from a path set in `AppConfig`. Cached by mtime so a rebuild is
 * picked up without restarting the API. Returns null when it was never built —
 * the studio never builds it on demand.
 */
export class LocalRunnerBundleSource implements RunnerBundleSource {
  private cache: { mtimeMs: number; bundle: RunnerBundle } | null = null;

  constructor(private readonly path: string) {}

  async read(): Promise<RunnerBundle | null> {
    let mtimeMs: number;
    try {
      const st = await stat(this.path);
      if (!st.isFile()) return null;
      mtimeMs = st.mtimeMs;
    } catch {
      return null;
    }
    if (this.cache && this.cache.mtimeMs === mtimeMs) return this.cache.bundle;

    const contents = await readFile(this.path, 'utf8');
    const sha256 = createHash('sha256').update(contents, 'utf8').digest('hex');
    const version = VERSION_MARKER.exec(contents)?.[1] ?? sha256.slice(0, 12);
    const bundle = { contents, sha256, version };
    this.cache = { mtimeMs, bundle };
    return bundle;
  }
}
