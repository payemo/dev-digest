/**
 * Smart Diff (L04) — the pure `path → role` classifier
 * (`modules/smart-diff/helpers.ts`). No DB, no HTTP, no container: it is a
 * function over a string, which is exactly what makes it reusable as a
 * prompt-assembly filter later.
 *
 * The table below IS the specification. Three rows are there because the
 * matching order (`ROLE_PATTERNS`, first match wins) is contested and someone
 * will eventually be tempted to reorder it:
 *   - a snapshot inside `__tests__/` is boilerplate, not tests;
 *   - markdown under `.claude/` is wiring, not docs;
 *   - `e2e/README.md` is tests, not docs (deliberate — see D2 of the plan).
 *
 * The final `it` pins ROLE_ORDER, the *display* order, which deliberately
 * differs from the matching order.
 */
import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/modules/smart-diff/helpers.js';
import { ROLE_ORDER } from '../src/modules/smart-diff/constants.js';
import type { SmartDiffRole } from '@devdigest/shared';

const CASES: [path: string, expected: SmartDiffRole][] = [
  // --- contested: the matching order is what decides these three -----------
  ['client/src/__tests__/__snapshots__/x.snap', 'boilerplate'],
  ['.claude/skills/security/SKILL.md', 'wiring'],
  ['e2e/README.md', 'tests'],

  // --- boilerplate ---------------------------------------------------------
  ['pnpm-lock.yaml', 'boilerplate'],
  ['client/pnpm-lock.yaml', 'boilerplate'],
  ['server/dist/app.js', 'boilerplate'],
  ['client/public/vendor/thing.min.js', 'boilerplate'],
  ['server/src/db/schema.generated.ts', 'boilerplate'],

  // --- tests ---------------------------------------------------------------
  ['server/test/pulls-status.test.ts', 'tests'],
  ['server/test/reviews.it.test.ts', 'tests'],
  ['client/src/lib/format.spec.ts', 'tests'],

  // --- wiring --------------------------------------------------------------
  ['client/src/components/diff-viewer/index.ts', 'wiring'],
  ['client/next.config.ts', 'wiring'],
  ['server/tsconfig.json', 'wiring'],
  ['docker-compose.yml', 'wiring'],
  ['.github/workflows/client.yml', 'wiring'],
  ['server/.env.example', 'wiring'],

  // --- docs ----------------------------------------------------------------
  ['README.md', 'docs'],
  ['docs/plans/lab04-smart-diff.plan.md', 'docs'],
  ['LICENSE', 'docs'],

  // --- core (the fallthrough) ---------------------------------------------
  ['server/src/modules/reviews/service.ts', 'core'],
  ['client/src/app/repos/[repoId]/pulls/[number]/page.tsx', 'core'],
  // A constants file is NOT wiring — only barrels and `*.config.*` are.
  ['server/src/modules/reviews/constants.ts', 'core'],
];

describe('classifyFile', () => {
  it.each(CASES)('%s → %s', (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  it('normalizes a leading "./" and Windows separators before matching', () => {
    expect(classifyFile('./pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('server\\test\\pulls-status.test.ts')).toBe('tests');
  });
});

describe('ROLE_ORDER', () => {
  it('is the display order, which is NOT the matching order', () => {
    expect([...ROLE_ORDER]).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
  });
});
