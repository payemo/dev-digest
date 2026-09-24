/**
 * Intent derivation — the pure helpers (L03, plan Step 6).
 *
 * These are the decisions the model is NOT allowed to make: which issue this PR
 * closes, which file the derivation is allowed to read off the clone, whether
 * the PR body is real documentation, and what the confidence number is. Every
 * one of them is a transform over its arguments, so this file is a set of
 * tables with no mocks and no container.
 *
 * Nothing here calls the function under test to compute its own expectation —
 * every expected value is written out.
 */
import { describe, it, expect } from 'vitest';
import {
  branchIsDescriptive,
  confidenceBand,
  deriveConfidence,
  extractLinkedIssueRefs,
  extractSpecPaths,
  extractTicketKeys,
  hasRealDocumentation,
  isSafeSpecPath,
  meaningfulCommitMessages,
  verifyRiskAreas,
} from '../src/modules/intent/helpers.js';

describe('extractLinkedIssueRefs — closing keywords only (D2)', () => {
  it('ignores a bare #n in prose: a mention is not a statement that the PR closes it', () => {
    // The behaviour change this feature shipped. The old adapter regex made
    // every one of these "the linked issue".
    expect(extractLinkedIssueRefs('see #12 for context')).toEqual([]);
    expect(extractLinkedIssueRefs('## Heading #12')).toEqual([]);
    expect(extractLinkedIssueRefs('Reverts #12, supersedes #13')).toEqual([]);
    // A keyword-looking substring inside a word must not match either.
    expect(extractLinkedIssueRefs('prefixes #12')).toEqual([]);
    expect(extractLinkedIssueRefs('unfixed #12')).toEqual([]);
  });

  it('matches all nine of GitHub’s closing keywords, case-insensitively', () => {
    const keywords = [
      'close',
      'closes',
      'closed',
      'fix',
      'fixes',
      'fixed',
      'resolve',
      'resolves',
      'resolved',
    ];
    for (const kw of keywords) {
      expect(extractLinkedIssueRefs(`${kw} #12`)).toEqual([
        { owner: null, repo: null, number: 12 },
      ]);
      expect(extractLinkedIssueRefs(`${kw.toUpperCase()} #12`)).toEqual([
        { owner: null, repo: null, number: 12 },
      ]);
    }
  });

  it('accepts an optional colon and reads a cross-repo owner/repo#n reference', () => {
    expect(extractLinkedIssueRefs('Fixes: #12')).toEqual([{ owner: null, repo: null, number: 12 }]);
    expect(extractLinkedIssueRefs('Closes acme/api#7')).toEqual([
      { owner: 'acme', repo: 'api', number: 7 },
    ]);
  });

  it('keeps body order, dedupes the same reference, and drops #0', () => {
    expect(extractLinkedIssueRefs('Fixes #12 and closes #13; also fixes #12 again')).toEqual([
      { owner: null, repo: null, number: 12 },
      { owner: null, repo: null, number: 13 },
    ]);
    expect(extractLinkedIssueRefs('Fixes #0')).toEqual([]);
    expect(extractLinkedIssueRefs(null)).toEqual([]);
    expect(extractLinkedIssueRefs(undefined)).toEqual([]);
  });
});

describe('extractTicketKeys — detected, never fetched', () => {
  it('finds Jira/Linear-style keys and dedupes them', () => {
    expect(extractTicketKeys('Implements PLAT-4821 and PLAT-4821, blocks ENG_2-17')).toEqual([
      'PLAT-4821',
      'ENG_2-17',
    ]);
    expect(extractTicketKeys('no keys here')).toEqual([]);
  });
});

describe('isSafeSpecPath — the whole traversal guard at this call site', () => {
  // `GitClient.readFile` joins straight onto the clone dir with no guard, and
  // these paths come out of an attacker-controllable PR body.
  const rejected: [string, string][] = [
    ['../../etc/passwd', 'parent traversal, no allowed prefix'],
    ['/etc/passwd', 'absolute POSIX path'],
    ['docs/plans/../../x.md', 'traversal after an allowed prefix'],
    ['docs/plans/../../../../root/.ssh/id_rsa.md', 'deep traversal with an .md tail'],
    ['file:///etc/passwd', 'file URL'],
    ['https://evil.example/docs/plans/x.md', 'remote URL wearing an allowed prefix'],
    ['docs\\plans\\x.md', 'backslash path (a ..\\ segment must not survive a / split)'],
    ['docs/plans\\..\\..\\x.md', 'backslash traversal'],
    ['C:\\docs\\plans\\x.md', 'Windows drive path'],
    ['~/docs/plans/x.md', 'home-relative path'],
    ['docs/plans/x.txt', 'not Markdown'],
    ['docs/plans/x', 'no extension'],
    ['README.md', 'Markdown outside every allowed prefix'],
    ['src/db/schema/reviews.ts', 'source file'],
    ['docs/plans//x.md', 'empty segment'],
    ['docs/plans/./x.md', 'single-dot segment'],
    ['docs/plans/x\0.md', 'NUL byte'],
    ['', 'empty string'],
  ];
  for (const [path, why] of rejected) {
    it(`rejects ${JSON.stringify(path)} — ${why}`, () => {
      expect(isSafeSpecPath(path)).toBe(false);
    });
  }

  const accepted: string[] = [
    'docs/plans/lab03-intent-layer.plan.md',
    './docs/plans/lab03-intent-layer.plan.md',
    'docs/specs/api.md',
    'specs/review-flow.md',
    'docs/plans/nested/deeper/plan.md',
    'docs/plans/plan.MD',
    'docs/plans/plan.md#design-decisions',
    'docs/plans/plan.md?plain=1',
  ];
  for (const path of accepted) {
    it(`accepts ${JSON.stringify(path)}`, () => {
      expect(isSafeSpecPath(path)).toBe(true);
    });
  }
});

describe('extractSpecPaths', () => {
  it('takes Markdown links and bare tokens under an allowed prefix, normalized and deduped', () => {
    const body = [
      'Built from [the plan](docs/plans/lab03.plan.md).',
      'See also ./docs/specs/api.md and docs/plans/lab03.plan.md again.',
      'Not this: ../../etc/passwd, /etc/passwd, README.md, https://x.test/docs/plans/a.md',
    ].join('\n');
    expect(extractSpecPaths(body)).toEqual(['docs/plans/lab03.plan.md', 'docs/specs/api.md']);
  });

  it('returns nothing for an empty body', () => {
    expect(extractSpecPaths(null)).toEqual([]);
    expect(extractSpecPaths('no paths at all')).toEqual([]);
  });
});

describe('hasRealDocumentation — is the body documentation, or the template? (D3)', () => {
  it('is false for an unfilled PR template (comments, checkboxes and headings only)', () => {
    const template = [
      '## Summary',
      '<!-- Describe the change in a sentence or two. Explain the motivation for it,',
      '     not just the mechanics of the diff, and link the issue it closes. -->',
      '',
      '## Checklist',
      '- [ ] Tests added or updated for the behaviour this changes',
      '- [ ] Documentation updated where the behaviour is described',
      '- [x] Self-reviewed the diff before requesting review',
    ].join('\n');
    // The comment body alone is well over 120 characters, so this only passes
    // if HTML comments are actually stripped first.
    expect(template.length).toBeGreaterThan(120);
    expect(hasRealDocumentation(template)).toBe(false);
  });

  it('is true for a filled-in body with real prose', () => {
    const body = [
      '## Summary',
      'Adds rate limiting to the public API endpoints so a single client cannot',
      'exhaust the shared Redis connection pool during a traffic spike. The limit',
      'is per-token and configurable per route.',
      '- [x] Tests added',
    ].join('\n');
    expect(hasRealDocumentation(body)).toBe(true);
  });

  it('is false for long-but-wordless text with no sentence-like run', () => {
    // Over the 120-char floor, but every line is a single word: a label dump is
    // not an explanation.
    const listy = Array.from({ length: 40 }, (_, i) => `token${i}`).join('\n');
    expect(listy.replace(/\s+/g, ' ').length).toBeGreaterThan(120);
    expect(hasRealDocumentation(listy)).toBe(false);
  });

  it('is false for an absent or trivially short body', () => {
    expect(hasRealDocumentation(null)).toBe(false);
    expect(hasRealDocumentation('')).toBe(false);
    expect(hasRealDocumentation('Fixes the thing.')).toBe(false);
  });
});

describe('meaningfulCommitMessages', () => {
  it('keeps subjects only, and drops merge/wip/fixup noise', () => {
    expect(
      meaningfulCommitMessages([
        'Add rate limiter middleware\n\nLonger body that is not a subject.',
        'Merge branch main into feat/rl',
        'wip',
        'fixup! Add rate limiter middleware',
        '   ',
        'Cover the limiter with tests',
      ]),
    ).toEqual(['Add rate limiter middleware', 'Cover the limiter with tests']);
  });
});

describe('branchIsDescriptive', () => {
  it('needs at least two word-ish segments', () => {
    expect(branchIsDescriptive('feat/intent-layer')).toBe(true);
    expect(branchIsDescriptive('patch-1')).toBe(false);
    expect(branchIsDescriptive('wip')).toBe(false);
    expect(branchIsDescriptive(null)).toBe(false);
  });
});

describe('deriveConfidence + confidenceBand — computed in code, never by the model (D3)', () => {
  it('floors at 0.05 for no evidence at all and reads low', () => {
    expect(deriveConfidence([])).toBe(0.05);
    expect(confidenceBand(deriveConfidence([]))).toBe('low');
  });

  it('caps indirect-signal-only evidence at 0.20, which is low by arithmetic', () => {
    // The requirement "build it from indirect signals and mark it lower
    // confidence" is enforced here, not by asking the model: commits + branch +
    // paths is the most a PR with no spec, issue or written body can reach.
    expect(deriveConfidence(['commits', 'branch', 'paths'])).toBe(0.2);
    expect(confidenceBand(0.2)).toBe('low');
  });

  it('reaches high with written documentation behind it and never exceeds 0.95', () => {
    const full = ['spec:docs/plans/x.md', 'issue:482', 'body', 'commits', 'branch', 'paths'];
    // Raw weights sum to 1.00; the clamp is what keeps it under certainty.
    expect(deriveConfidence(full)).toBe(0.95);
    expect(confidenceBand(deriveConfidence(full))).toBe('high');
  });

  it('counts each evidence KIND once, so two spec links are not twice the evidence', () => {
    expect(deriveConfidence(['spec:docs/plans/a.md', 'spec:docs/plans/b.md', 'paths'])).toBe(0.35);
  });

  it('gives ticket_ref_unreadable and unknown markers zero weight', () => {
    // 0.30 on both sides, deliberately away from either clamp boundary so the
    // comparison cannot pass by being clamped.
    expect(deriveConfidence(['body', 'paths'])).toBe(0.3);
    expect(deriveConfidence(['body', 'paths', 'ticket_ref_unreadable'])).toBe(0.3);
    expect(deriveConfidence(['body', 'paths', 'vibes'])).toBe(0.3);
  });

  it('bands on the documented thresholds: high ≥ 0.70, medium ≥ 0.40, else low', () => {
    expect(confidenceBand(0.7)).toBe('high');
    expect(confidenceBand(0.699)).toBe('medium');
    expect(confidenceBand(0.4)).toBe('medium');
    expect(confidenceBand(0.399)).toBe('low');
  });
});

describe('verifyRiskAreas — the citation is checked in code (D4)', () => {
  const changed = ['server/package.json', 'src/config.ts'];

  it('drops a risk citing a path this PR does not change, and counts the drop', () => {
    const { kept, dropped } = verifyRiskAreas(
      [
        { label: 'Secret handling', evidence_path: 'src/config.ts' },
        { label: 'Invented file', evidence_path: 'src/does-not-exist.ts' },
      ],
      changed,
    );
    expect(kept).toEqual([{ label: 'Secret handling', evidence_path: 'src/config.ts' }]);
    expect(dropped).toBe(1);
  });

  it('drops an uncited risk (null / missing / blank evidence_path)', () => {
    const { kept, dropped } = verifyRiskAreas(
      [
        { label: 'Vague worry', evidence_path: null },
        { label: 'Also vague' },
        { label: 'Blank', evidence_path: '   ' },
      ],
      changed,
    );
    expect(kept).toEqual([]);
    expect(dropped).toBe(3);
  });

  it('keeps a dependency-flavoured risk citing the manifest, and dedupes label@path', () => {
    const { kept, dropped } = verifyRiskAreas(
      [
        { label: 'New dependency', evidence_path: 'server/package.json' },
        { label: 'New dependency', evidence_path: 'server/package.json' },
      ],
      changed,
    );
    expect(kept).toEqual([{ label: 'New dependency', evidence_path: 'server/package.json' }]);
    expect(dropped).toBe(1);
  });
});
