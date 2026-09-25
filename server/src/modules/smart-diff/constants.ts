/**
 * Smart Diff (L04) — the two orders this feature depends on, kept apart on
 * purpose because they are NOT the same list:
 *
 *   ROLE_ORDER     the DISPLAY order — what the response's groups look like.
 *   ROLE_PATTERNS  the MATCHING order — first match wins, `core` is the
 *                  fallthrough and therefore absent from the array.
 *
 * Patterns are plain regexes: no glob library is installed and adding one
 * would touch a lockfile for a 40-line matcher. Paths are matched
 * repo-relative with `/` separators (the caller normalizes).
 */
import type { SmartDiffRole } from '@devdigest/shared';

/** Display order. Mirrors the `SmartDiffRole` enum's own value order. */
export const ROLE_ORDER: readonly SmartDiffRole[] = [
  'core',
  'tests',
  'wiring',
  'docs',
  'boilerplate',
] as const;

/**
 * DO NOT REORDER. The array order IS the classification rule (first match
 * wins), and three deliberate outcomes depend on it:
 *
 *   1. `client/src/__tests__/__snapshots__/x.snap` → `boilerplate`
 *      (the snapshot rule outranks `__tests__`),
 *   2. `.claude/skills/security/SKILL.md`          → `wiring`
 *      (`.claude/**` outranks `**\/*.md`),
 *   3. `e2e/README.md`                             → `tests`
 *      (`e2e/**` outranks `**\/*.md` — accepted; hoisting `docs` above `tests`
 *      would drag every in-package test README out of the test bucket and put
 *      `.claude/**` markdown into `docs`, breaking case 2).
 *
 * `server/test/smart-diff-classify.test.ts` asserts all three.
 */
export const ROLE_PATTERNS: readonly { role: SmartDiffRole; patterns: readonly RegExp[] }[] = [
  {
    role: 'boilerplate',
    patterns: [
      /** `*.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` — at any depth. */
      /(^|\/)[^/]+\.lock$/,
      /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/,
      /** `dist/**`, `build/**` — at any depth. */
      /(^|\/)(dist|build)\//,
      /** `**\/__snapshots__/**`, `*.snap`. */
      /(^|\/)__snapshots__\//,
      /\.snap$/,
      /** `*.generated.*`. */
      /(^|\/)[^/]*\.generated\.[^/]+$/,
      /** `*.min.js`. */
      /\.min\.js$/,
    ],
  },
  {
    role: 'tests',
    patterns: [
      /** `**\/*.test.ts(x)`, `**\/*.it.test.ts`, `**\/*.spec.ts(x)`. */
      /\.(test|spec)\.[cm]?[jt]sx?$/,
      /** `**\/test/**`, `**\/tests/**`, `**\/__tests__/**`. */
      /(^|\/)(tests?|__tests__)\//,
      /** `e2e/**` — the e2e package, from the repo root. */
      /^e2e\//,
    ],
  },
  {
    role: 'wiring',
    patterns: [
      /** `index.ts`/`index.js` barrels (any extension flavour). */
      /(^|\/)index\.[cm]?[jt]sx?$/,
      /** `*.config.*`. */
      /(^|\/)[^/]*\.config\.[^/]+$/,
      /** `tsconfig*.json`. */
      /(^|\/)tsconfig[^/]*\.json$/,
      /** `.eslintrc*`. */
      /(^|\/)\.eslintrc[^/]*$/,
      /** `.env*`. */
      /(^|\/)\.env[^/]*$/,
      /** `docker-compose*.yml` / `.yaml`. */
      /(^|\/)docker-compose[^/]*\.ya?ml$/,
      /** `.github/**`, `.claude/**` — from the repo root. */
      /^\.github\//,
      /^\.claude\//,
    ],
  },
  {
    role: 'docs',
    patterns: [
      /** `**\/*.md` (and `.mdx`). */
      /\.mdx?$/,
      /** `docs/**` — from the repo root. */
      /^docs\//,
      /** `README*`, `CHANGELOG*`, `LICENSE*` — at any depth, extension or not. */
      /(^|\/)(README|CHANGELOG|LICENSE)[^/]*$/,
    ],
  },
  // `core` is the fallthrough and has no patterns — see classifyFile.
] as const;
