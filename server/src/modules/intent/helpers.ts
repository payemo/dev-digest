import type { RiskArea } from '@devdigest/shared';
import {
  CONFIDENCE_BANDS,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  CONFIDENCE_WEIGHTS,
  MAX_BODY_CHARS,
  MAX_COMMIT_MESSAGES,
  MAX_ISSUE_BODY_CHARS,
  MAX_PATHS,
  MAX_SPEC_CHARS,
  MIN_BRANCH_TOKENS,
  MIN_DOCUMENTATION_CHARS,
  MIN_MEANINGFUL_COMMITS,
  MIN_SENTENCE_WORDS,
  SPEC_PATH_PREFIXES,
} from './constants.js';

/**
 * Pure helpers for intent derivation. No container, no I/O, no DB — every
 * function here is a transform over its arguments and is unit-testable with no
 * mocks. The service does the reading; this file does the deciding.
 */

// ---- Tier 2: linked issue -------------------------------------------------

/** A closing reference found in a PR body. `owner`/`repo` set ⇒ cross-repo. */
export interface LinkedIssueRef {
  owner: string | null;
  repo: string | null;
  number: number;
}

/**
 * GitHub's NINE closing keywords, same-repo (`Fixes #12`) and cross-repo
 * (`Closes owner/repo#7`). Deliberately NOT a bare `#123`: "see #12 for
 * context" and a Markdown heading are not statements of intent, and a wrong
 * issue body poisons the derived intent far worse than a missing one (which
 * merely lowers the computed confidence).
 *
 * Accepted trade-off: GitHub only *acts* on closing keywords when the PR
 * targets the default branch, and the only API reporting true closing links is
 * GraphQL `closingIssuesReferences`. We keep REST + regex and accept false
 * NEGATIVES over the false POSITIVES the previous bare-`#n` pattern produced.
 *
 * No nested quantifiers — this regex is ReDoS-safe on an attacker-supplied
 * body.
 */
const CLOSING_KEYWORD_REF =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b\s*:?\s*(?:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+))?#(\d+)\b/gi;

export function extractLinkedIssueRefs(body: string | null | undefined): LinkedIssueRef[] {
  if (!body) return [];
  const out: LinkedIssueRef[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(CLOSING_KEYWORD_REF)) {
    const number = Number(m[3]);
    if (!Number.isSafeInteger(number) || number <= 0) continue;
    const owner = m[1] ?? null;
    const repo = m[2] ?? null;
    const key = `${owner ?? ''}/${repo ?? ''}#${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number });
  }
  return out;
}

/**
 * Jira/Linear-style ticket keys. DETECTED, never fetched — there is no Jira
 * adapter and adding one is out of scope. A detected key is recorded as
 * `ticket_ref_unreadable` in `sources` and contributes ZERO confidence, so the
 * user can see why an apparently well-documented PR still scored low.
 */
const TICKET_KEY = /\b[A-Z][A-Z0-9_]*-\d+\b/g;

export function extractTicketKeys(body: string | null | undefined): string[] {
  if (!body) return [];
  return [...new Set(body.match(TICKET_KEY) ?? [])];
}

// ---- Tier 1: referenced plan/spec files -----------------------------------

/**
 * Is this path safe to hand to `GitClient.readFile`?
 *
 * `SimpleGitClient.readFile` does `join(clonePathFor(repo), path)` with no
 * traversal guard, so a path out of a PR body (attacker-controlled) could
 * otherwise read any file the API process can read. This is the guard, at the
 * call site:
 *
 *   - no absolute path (POSIX `/…` or a Windows drive/UNC),
 *   - no URL,
 *   - no backslashes (a `..\\` segment must not sneak past a `/` split),
 *   - no NUL byte,
 *   - no `..` segment anywhere, before OR after the prefix check,
 *   - must end in `.md`,
 *   - must start with an ALLOWLISTED prefix (`docs/plans/`, `docs/specs/`,
 *     `specs/`) — an allowlist, so an unanticipated shape is rejected rather
 *     than read.
 */
export function isSafeSpecPath(path: string): boolean {
  if (!path) return false;
  if (path.includes('\0') || path.includes('\\')) return false;
  if (path.includes('://')) return false;
  if (path.startsWith('/') || path.startsWith('~')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;

  const normalized = normalizeSpecPath(path);
  if (!normalized) return false;
  const segments = normalized.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.' || seg === '')) return false;
  if (!/\.md$/i.test(normalized)) return false;
  return SPEC_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Strip a leading `./` and any query/fragment a Markdown link carried. */
function normalizeSpecPath(path: string): string {
  return path
    .replace(/^\.\//, '')
    .replace(/[?#].*$/, '')
    .trim();
}

/** Markdown inline links: `[label](path)`. */
const MARKDOWN_LINK = /\[[^\]\n]*\]\(([^()\s]+)\)/g;
/** Bare, whitespace-delimited tokens (a path mentioned in prose or a list). */
const BARE_TOKEN = /[^\s`()<>[\]"']+/g;

/**
 * Plan/spec paths referenced by the PR body — Markdown links and bare tokens
 * alike, filtered through `isSafeSpecPath`. Returned normalized and deduped,
 * in the order they appear (the body's own ordering is the author's ranking).
 */
export function extractSpecPaths(body: string | null | undefined): string[] {
  if (!body) return [];
  const candidates: string[] = [];
  for (const m of body.matchAll(MARKDOWN_LINK)) if (m[1]) candidates.push(m[1]);
  for (const m of body.matchAll(BARE_TOKEN)) if (m[0]) candidates.push(m[0]);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (!isSafeSpecPath(raw)) continue;
    const normalized = normalizeSpecPath(raw);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

// ---- Tier 3: is the PR body real documentation? ---------------------------

/**
 * Does this body actually document the change, or is it the PR template with
 * the instructions still in it?
 *
 * Strips HTML comments (the template's own guidance), checkbox lines, and
 * heading-only lines, then requires enough prose left over AND at least one
 * sentence-like run. An unfilled template therefore reads as "no body
 * evidence", which is what drops the computed confidence into the low band.
 */
export function hasRealDocumentation(body: string | null | undefined): boolean {
  if (!body) return false;
  const stripped = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^[-*+]?\s*\[[ xX]\]/.test(t)) return false; // checkbox line
      if (/^#{1,6}\s/.test(t)) return false; // heading-only line
      return true;
    })
    .join('\n');

  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (collapsed.length < MIN_DOCUMENTATION_CHARS) return false;

  return stripped
    .split(/[.!?\n]+/)
    .some((run) => run.trim().split(/\s+/).filter(Boolean).length >= MIN_SENTENCE_WORDS);
}

// ---- Indirect signals -----------------------------------------------------

/** Merge commits and bare `wip` / `fixup!` noise say nothing about intent. */
export function meaningfulCommitMessages(messages: string[]): string[] {
  return messages
    .map((m) => m.split('\n')[0]?.trim() ?? '')
    .filter((subject) => {
      if (!subject) return false;
      if (/^merge\b/i.test(subject)) return false;
      if (/^(fixup!|squash!|amend!)/i.test(subject)) return false;
      if (/^(wip|tmp|temp|test|stuff|misc|changes?)\b[\s.:!-]*$/i.test(subject)) return false;
      return true;
    })
    .slice(0, MAX_COMMIT_MESSAGES);
}

/** Does a branch name carry any meaning, e.g. `feat/intent-layer` → 3 tokens? */
export function branchIsDescriptive(branch: string | null | undefined): boolean {
  if (!branch) return false;
  const tokens = branch.split(/[^A-Za-z0-9]+/).filter((t) => t.length > 1);
  return tokens.length >= MIN_BRANCH_TOKENS;
}

// ---- D3: confidence -------------------------------------------------------

/** The kind of an evidence marker: `spec:docs/x.md` → `spec`, `body` → `body`. */
function markerKind(marker: string): string {
  return marker.split(':')[0] ?? marker;
}

/**
 * Sum the weights of the evidence markers actually recorded, then clamp.
 * Each KIND counts once however many markers of it there are: two spec files
 * are not twice the evidence one is, and letting them stack would make
 * confidence a function of link count instead of documentation quality.
 */
export function deriveConfidence(sources: string[]): number {
  const kinds = new Set(sources.map(markerKind));
  let score = 0;
  for (const kind of kinds) score += CONFIDENCE_WEIGHTS[kind] ?? 0;
  return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, Number(score.toFixed(4))));
}

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_BANDS.high) return 'high';
  if (confidence >= CONFIDENCE_BANDS.medium) return 'medium';
  return 'low';
}

// ---- D4: risk areas are model-proposed and CODE-verified ------------------

export interface RiskVerification {
  kept: RiskArea[];
  dropped: number;
}

/**
 * Keep only risks whose `evidence_path` is one of the changed paths we sent
 * the model. Same SAMPLE → PROPOSE → VERIFY shape the conventions extractor
 * uses: the citation is checked in code, never trusted. A risk with no
 * citation, or one naming a file this PR does not touch, is dropped — and the
 * count is returned so the drop is logged rather than silently swallowed.
 */
export function verifyRiskAreas(
  proposed: { label: string; evidence_path?: string | null }[],
  changedPaths: string[],
): RiskVerification {
  const allowed = new Set(changedPaths);
  const kept: RiskArea[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const risk of proposed) {
    const path = risk.evidence_path?.trim();
    const label = risk.label?.trim();
    if (!label || !path || !allowed.has(path)) {
      dropped += 1;
      continue;
    }
    const key = `${label}@${path}`;
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    kept.push({ label, evidence_path: path });
  }
  return { kept, dropped };
}

// ---- The untrusted user-prompt body ---------------------------------------

/** Everything the derivation model is allowed to see, already resolved. */
export interface IntentSignals {
  title: string;
  branch: string;
  base: string;
  /** The raw PR body (passed even when it fails `hasRealDocumentation`). */
  body: string | null;
  issue: { number: number; title: string; body: string | null } | null;
  specs: { path: string; content: string }[];
  commits: string[];
  paths: string[];
  additions: number;
  deletions: number;
  filesCount: number;
  ticketKeys: string[];
}

/**
 * Render the signals in D1's PRECEDENCE order — tier 1 (what a human wrote to
 * explain this change) first, tier 7 (what a machine derived from the change)
 * last — so the largest truncation budget and the model's attention both land
 * on stated motivation. Every section is capped; the whole string is wrapped
 * as `<untrusted>` by the caller.
 */
export function renderIntentSources(signals: IntentSignals): string {
  const out: string[] = [];

  for (const spec of signals.specs) {
    out.push(`--- REFERENCED SPEC: ${spec.path} ---`);
    out.push(spec.content.slice(0, MAX_SPEC_CHARS));
    out.push('');
  }

  if (signals.issue) {
    out.push(`--- LINKED ISSUE #${signals.issue.number}: ${signals.issue.title} ---`);
    out.push((signals.issue.body ?? '').slice(0, MAX_ISSUE_BODY_CHARS));
    out.push('');
  }

  if (signals.body?.trim()) {
    out.push('--- PR DESCRIPTION ---');
    out.push(signals.body.slice(0, MAX_BODY_CHARS));
    out.push('');
  }

  out.push('--- PR FACTS ---');
  out.push(`Title: ${signals.title}`);
  out.push(`Branch: ${signals.branch} → ${signals.base}`);
  if (signals.ticketKeys.length > 0) {
    // Named so the model does not invent a body for a ticket nobody can read.
    out.push(`Ticket keys mentioned (NOT fetched): ${signals.ticketKeys.join(', ')}`);
  }
  out.push(
    `Size: ${signals.filesCount} file(s), +${signals.additions}/-${signals.deletions} line(s)`,
  );
  out.push('');

  if (signals.commits.length > 0) {
    out.push('--- COMMIT MESSAGES ---');
    out.push(...signals.commits.map((c) => `- ${c}`));
    out.push('');
  }

  out.push(`--- CHANGED FILES (the ONLY paths you may cite as risk evidence) ---`);
  out.push(...signals.paths.slice(0, MAX_PATHS).map((p) => `- ${p}`));

  return out.join('\n');
}
