import { spawn } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import type {
  CodeIndex,
  RepoRef,
  CodeMatch,
  CodeSymbol,
  CodeReference,
  GitClient,
} from '@devdigest/shared';
import { extractSymbols, extractReferences } from './extract.js';

/**
 * CodeIndex — ripgrep search + an ENHANCED regex symbol/reference
 * extractor (A3, L04). The symbol/reference logic lives in `./extract.ts`
 * (unit-tested in isolation); see that file's header for why we strengthened
 * the regex extractor rather than wiring `web-tree-sitter` under the
 * parallel-phase no-install constraint.
 *
 * grep(): uses the `@vscode/ripgrep` binary when resolvable; otherwise falls
 * back to a pure-Node recursive scan so it works with zero native deps (tests).
 */

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);

let rgPathCache: string | null | undefined;
async function resolveRg(): Promise<string | null> {
  if (rgPathCache !== undefined) return rgPathCache;
  try {
    // Optional native dep; resolved at runtime. Falls back to pure-Node grep if absent.
    const mod = (await import(/* @vite-ignore */ '@vscode/ripgrep' as string)) as {
      rgPath?: string;
    };
    rgPathCache = mod.rgPath ?? null;
  } catch {
    rgPathCache = null;
  }
  return rgPathCache;
}

export class RipgrepCodeIndex implements CodeIndex {
  constructor(private git: Pick<GitClient, 'clonePathFor'>) {}

  private root(repo: RepoRef): string {
    return this.git.clonePathFor(repo);
  }

  async grep(repo: RepoRef, pattern: string): Promise<CodeMatch[]> {
    const root = this.root(repo);
    const rg = await resolveRg();
    if (rg) return this.grepWithRg(rg, root, pattern);
    return this.grepWithNode(root, pattern);
  }

  private grepWithRg(rg: string, root: string, pattern: string): Promise<CodeMatch[]> {
    return new Promise((resolve, reject) => {
      const matches: CodeMatch[] = [];
      // `--` stops ripgrep from parsing `pattern` as a flag — without it, a
      // pattern starting with `-` (e.g. `--pre=<cmd>`) runs as a ripgrep
      // preprocessor option, which is RCE. `grep()` has no callers today
      // (public `CodeIndex` API, one route away from being reachable), so
      // this is hardening ahead of that, not a fix for a live path.
      const proc = spawn(rg, [
        '--line-number',
        '--no-heading',
        '--color=never',
        '--',
        pattern,
        root,
      ]);
      let buf = '';
      proc.stdout.on('data', (d) => {
        buf += d.toString();
      });
      proc.on('error', reject);
      proc.on('close', () => {
        for (const line of buf.split('\n')) {
          // <path>:<line>:<text>
          const m = line.match(/^(.*?):(\d+):(.*)$/);
          if (m) {
            matches.push({
              path: relative(root, m[1]!),
              line: Number(m[2]),
              text: m[3]!,
            });
          }
        }
        resolve(matches);
      });
    });
  }

  private async grepWithNode(root: string, pattern: string): Promise<CodeMatch[]> {
    // Same "no callers today, hardening ahead of that" note as grepWithRg's
    // `--` fix: `pattern` reaches `new RegExp` unescaped, so an overlong or
    // pathological pattern (catastrophic backtracking) is a ReDoS surface
    // once this path is wired to a route. The length cap bounds the obvious
    // case; the try/catch covers a pattern that isn't valid regex syntax.
    const MAX_PATTERN_LENGTH = 500;
    if (pattern.length > MAX_PATTERN_LENGTH) return [];
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      return [];
    }
    const matches: CodeMatch[] = [];
    for (const file of await this.walk(root)) {
      const content = await readFile(file, 'utf8').catch(() => '');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          matches.push({ path: relative(root, file), line: i + 1, text: lines[i]! });
        }
      }
    }
    return matches;
  }

  /** Enhanced regex symbol extractor (functions, classes + methods, arrows, types). */
  async symbols(repo: RepoRef): Promise<CodeSymbol[]> {
    const root = this.root(repo);
    const out: CodeSymbol[] = [];
    for (const file of await this.walk(root)) {
      if (!CODE_EXT.has(extname(file))) continue;
      const content = await readFile(file, 'utf8').catch(() => '');
      const rel = relative(root, file);
      for (const s of extractSymbols(content)) {
        out.push({ path: rel, name: s.name, kind: s.kind, line: s.line });
      }
    }
    return out;
  }

  /** Enhanced reference finder: call sites / `new` / member-calls / JSX usage. */
  async references(repo: RepoRef, symbol: string): Promise<CodeReference[]> {
    const root = this.root(repo);
    const out: CodeReference[] = [];
    for (const file of await this.walk(root)) {
      if (!CODE_EXT.has(extname(file))) continue;
      const content = await readFile(file, 'utf8').catch(() => '');
      const rel = relative(root, file);
      for (const r of extractReferences(content, symbol)) {
        out.push({ fromPath: rel, toSymbol: symbol, line: r.line });
      }
    }
    return out;
  }

  private async walk(dir: string, acc: string[] = []): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        await this.walk(join(dir, e.name), acc);
      } else if (e.isFile()) {
        const full = join(dir, e.name);
        const s = await stat(full).catch(() => null);
        if (s && s.size < 2_000_000) acc.push(full);
      }
    }
    return acc;
  }
}
