import { describe, it, expect } from 'vitest';
import { parseArgs } from './index.js';

/**
 * CLI argument parsing — the generated workflow runs
 * `node .devdigest/runner.mjs review --agent <slug>`. Breakage covered: the
 * slug being lost (so a repo with several agents fails the exactly-one rule),
 * or the env fallback overriding an explicit flag.
 */
describe('parseArgs', () => {
  it.each([
    [['review', '--agent', 'sec'], 'sec'],
    [['review', '--agent=sec'], 'sec'],
    [['--agent', 'sec'], 'sec'],
    [['review'], undefined],
    [[], undefined],
  ] as const)('%j → %s', (argv, slug) => {
    expect(parseArgs(argv)).toEqual({ agentSlug: slug });
  });

  it('falls back to DEVDIGEST_AGENT, but an explicit flag wins', () => {
    expect(parseArgs(['review'], { DEVDIGEST_AGENT: 'from-env' })).toEqual({ agentSlug: 'from-env' });
    expect(parseArgs(['review', '--agent', 'flag'], { DEVDIGEST_AGENT: 'from-env' })).toEqual({ agentSlug: 'flag' });
    expect(parseArgs(['review', '--agent='], { DEVDIGEST_AGENT: 'from-env' })).toEqual({ agentSlug: 'from-env' });
  });
});
