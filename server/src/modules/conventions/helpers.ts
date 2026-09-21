import type { ConventionCandidate, ConventionCategory, ConventionSkillDraft } from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import {
  MAX_FILE_CHARS,
  MAX_FILE_LINES,
  MAX_SNIPPET_LINES,
  MIN_SNIPPET_CHARS,
} from './constants.js';

/**
 * Pure helpers for the Conventions Extractor. Everything here is deterministic
 * and unit-tested: the sample rendering the model sees, the evidence gate that
 * decides which of its candidates survive, and the skill markdown assembled
 * from the accepted ones. No IO, no model, no DB.
 */

// ---- sampling ------------------------------------------------------------

export interface SampledFile {
  path: string;
  /** File content as read, already truncated to the per-file caps. */
  text: string;
  lines: string[];
  truncated: boolean;
}

/** Truncate to the per-file caps and split once, so callers reuse the lines. */
export function toSampledFile(path: string, raw: string): SampledFile {
  const byChars = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
  const allLines = byChars.split('\n');
  const lines = allLines.slice(0, MAX_FILE_LINES);
  return {
    path,
    text: lines.join('\n'),
    lines,
    truncated: lines.length < allLines.length || byChars.length < raw.length,
  };
}

/**
 * Render one file for the prompt with 1-based line numbers.
 *
 * The numbers are the whole point: the model is asked to cite `file` + `line` +
 * a verbatim snippet, and a numbered listing is what makes that citation
 * mechanically checkable afterwards. Without them the model guesses line
 * numbers and the evidence gate drops nearly everything.
 */
export function renderSample(file: SampledFile): string {
  const body = file.lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
  const suffix = file.truncated ? '\n… (truncated)' : '';
  return `--- FILE: ${file.path} ---\n${body}${suffix}`;
}

/** Join rendered samples, stopping before `maxChars` so the prompt stays bounded. */
export function renderSamples(files: SampledFile[], maxChars: number): string {
  const out: string[] = [];
  let used = 0;
  for (const f of files) {
    const block = renderSample(f);
    if (used + block.length > maxChars) break;
    out.push(block);
    used += block.length + 2;
  }
  return out.join('\n\n');
}

// ---- the evidence gate ---------------------------------------------------

/** What the model returns, before any verification. */
export interface RawCandidate {
  category: string;
  rule: string;
  rationale?: string | null;
  evidence_path: string;
  evidence_line?: number | null;
  evidence_snippet: string;
  confidence: number;
}

export interface VerifiedCandidate {
  category: ConventionCategory;
  rule: string;
  rationale: string | null;
  evidencePath: string;
  evidenceLine: number;
  /** Taken FROM THE FILE, not from the model — displayed evidence is real code. */
  evidenceSnippet: string;
  confidence: number;
}

export type DropReason =
  | 'empty_rule'
  | 'path_traversal'
  | 'unknown_file'
  | 'invalid_line'
  | 'snippet_too_short'
  | 'comment_only'
  | 'snippet_not_found'
  | 'confidence_out_of_range';

export type VerifyResult =
  | { ok: true; candidate: VerifiedCandidate }
  | { ok: false; reason: DropReason };

const CATEGORIES: readonly ConventionCategory[] = [
  'naming',
  'structure',
  'errors',
  'testing',
  'imports',
  'typing',
  'api',
  'general',
];

/** Whitespace-insensitive, case-insensitive comparison key for a code line. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A line whose FIRST non-whitespace content is a comment opener — `// …`,
 * `# …`, a block-comment line/continuation, or an HTML/SQL comment. A
 * trailing inline comment (`const x = 1; // note`) does not count: that line's
 * primary content is still real code.
 */
function isCommentOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return /^(\/\/|#|\/\*|\*\/?|<!--|-->|--)/.test(trimmed);
}

/** Strip a leading comment marker so a genuine code line's length is judged on its code, not its punctuation. */
function stripCommentMarkers(s: string): string {
  return s
    .trim()
    .replace(/^(\/\/|#|\*\/?|<!--|-->|--)+\s*/, '')
    .replace(/\*\/\s*$/, '')
    .trim();
}

/** Reject an absolute path or any `..` segment — the gate must never let a model walk it off-sample. */
function hasTraversal(path: string): boolean {
  if (!path) return true;
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) return true;
  return path.split(/[\\/]/).some((seg) => seg === '..');
}

/**
 * Verify one candidate against the files we actually sampled.
 *
 * Every check is mechanical, in code — no second model call:
 *  1. the rule text isn't empty;
 *  2. the cited path has no traversal and is one we sampled (a path we never
 *     sent is invented);
 *  3. the claimed line is a sane integer;
 *  4. the snippet is substantial enough to identify a line;
 *  5. the snippet's first meaningful line really occurs in that file;
 *  6. confidence lands in [0, 1].
 *
 * When the model's line number is wrong but the code is there, we CORRECT the
 * line rather than drop the candidate — an off-by-a-few line number is a
 * counting mistake, not a hallucinated rule. The snippet we keep is re-read
 * from the file, so what the UI shows is always the repo's own bytes.
 */
export function verifyCandidate(files: Map<string, SampledFile>, c: RawCandidate): VerifyResult {
  if (!c.rule?.trim()) return { ok: false, reason: 'empty_rule' };

  if (hasTraversal(c.evidence_path ?? '')) return { ok: false, reason: 'path_traversal' };

  const file = resolveFile(files, c.evidence_path);
  if (!file) return { ok: false, reason: 'unknown_file' };

  if (c.evidence_line != null && (!Number.isInteger(c.evidence_line) || c.evidence_line < 1)) {
    return { ok: false, reason: 'invalid_line' };
  }

  const snippetLines = (c.evidence_snippet ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*\d+\t/, '')) // the model sometimes echoes our line-number gutter
    .filter((l) => l.trim().length > 0);
  const head = snippetLines[0];
  if (!head) return { ok: false, reason: 'snippet_too_short' };
  if (isCommentOnlyLine(head)) return { ok: false, reason: 'comment_only' };
  const substance = stripCommentMarkers(head).replace(/\s/g, '');
  if (substance.length < MIN_SNIPPET_CHARS) {
    return { ok: false, reason: 'snippet_too_short' };
  }

  const idx = findLine(file.lines, head, c.evidence_line ?? null);
  if (idx === -1) return { ok: false, reason: 'snippet_not_found' };

  const confidence = c.confidence ?? 0;
  if (confidence < 0 || confidence > 1) return { ok: false, reason: 'confidence_out_of_range' };

  const span = Math.min(Math.max(snippetLines.length, 1), MAX_SNIPPET_LINES);
  const snippet = dedent(file.lines.slice(idx, idx + span)).join('\n').trimEnd();

  return {
    ok: true,
    candidate: {
      category: CATEGORIES.includes(c.category as ConventionCategory)
        ? (c.category as ConventionCategory)
        : 'general',
      rule: c.rule.trim(),
      rationale: c.rationale?.trim() || null,
      evidencePath: file.path,
      evidenceLine: idx + 1,
      evidenceSnippet: snippet,
      confidence,
    },
  };
}

/**
 * Match a cited path to a sampled one. Exact first; then a unique suffix match,
 * because models routinely cite `src/api/users.ts` as `./src/api/users.ts` or
 * `users.ts`. Ambiguous suffixes are NOT resolved — guessing which file was
 * meant would defeat the gate.
 */
function resolveFile(files: Map<string, SampledFile>, cited: string): SampledFile | undefined {
  if (!cited) return undefined;
  const clean = cited.trim().replace(/^\.?\//, '').split(':')[0]!;
  const exact = files.get(clean);
  if (exact) return exact;
  const matches = [...files.values()].filter(
    (f) => f.path === clean || f.path.endsWith(`/${clean}`),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Index of the line whose normalized text contains the snippet head. Prefers
 * the line nearest the model's own claim, so a repeated line (`}`, `import`)
 * resolves to the one it meant.
 */
function findLine(lines: string[], head: string, claimed: number | null): number {
  const needle = norm(head);
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = norm(lines[i]!);
    if (line && (line === needle || line.includes(needle))) hits.push(i);
  }
  if (hits.length === 0) return -1;
  if (claimed == null) return hits[0]!;
  const target = claimed - 1;
  return hits.reduce((best, i) => (Math.abs(i - target) < Math.abs(best - target) ? i : best));
}

/** Strip the common leading indentation so a nested snippet reads cleanly. */
function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^\s*/)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return min > 0 ? lines.map((l) => l.slice(min)) : lines;
}

// ---- dedupe --------------------------------------------------------------

/** Comparison key for "the same rule said twice" (across scans, too). */
export function ruleKey(candidate: {
  category: string;
  rule: string;
  evidencePath?: string | null;
  evidenceLine?: number | null;
}): string {
  // Keyed on EVIDENCE LOCATION + category, not on the rule text: the user can
  // edit the rule's wording without re-scan treating the edited row as a
  // "new" rule (it would no longer match a text-based key) or, worse, letting
  // the model's original wording re-appear alongside the edit. Two different
  // observations can still coexist at the same line as long as they're
  // classified into different categories.
  return [candidate.category, candidate.evidencePath ?? '', candidate.evidenceLine ?? ''].join('|');
}

/**
 * Drop candidates that repeat a rule already in `seen` (previous scans' kept
 * decisions) or each other. First occurrence wins, so the highest-confidence
 * one survives when the caller sorts before calling.
 */
export function dedupeCandidates(
  candidates: VerifiedCandidate[],
  seen: Iterable<string> = [],
): { kept: VerifiedCandidate[]; dropped: number } {
  const keys = new Set(seen);
  const kept: VerifiedCandidate[] = [];
  for (const c of candidates) {
    const key = ruleKey(c);
    if (keys.has(key)) continue;
    keys.add(key);
    kept.push(c);
  }
  return { kept, dropped: candidates.length - kept.length };
}

// ---- DTO + skill assembly ------------------------------------------------

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId,
    category: row.category as ConventionCategory,
    rule: row.rule,
    rationale: row.rationale,
    evidence_path: row.evidencePath,
    evidence_line: row.evidenceLine,
    evidence_snippet: row.evidenceSnippet,
    confidence: row.confidence,
    status: row.status as ConventionCandidate['status'],
    created_at: row.createdAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
  };
}

/** `Always use async/await …` → `always-use-async-await` (skill section anchor). */
export function slugify(text: string, maxWords = 6): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, maxWords)
      .join('-') || 'rule'
  );
}

const CATEGORY_LABELS: Record<ConventionCategory, string> = {
  naming: 'Naming',
  structure: 'Structure',
  errors: 'Error Handling',
  testing: 'Testing',
  imports: 'Imports',
  typing: 'Typing',
  api: 'API Shape',
  general: 'General',
};

/**
 * Assemble APPROVED candidates into a skill draft. The body is markdown the
 * user edits before saving — this is a starting point, not a final artifact.
 * Rejected and pending rows are never included; `rows` is the caller's
 * responsibility to have already filtered to `status === 'approved'`.
 *
 * Every rule carries its `file:line` evidence into the prompt on purpose: it
 * tells the reviewing model the rule is real in THIS repo and gives it a
 * concrete shape to compare a diff against.
 */
export function buildSkillDraft(
  rows: ConventionRow[],
  opts: { name: string; existingSkillId: string | null },
): ConventionSkillDraft {
  const byCategory = new Map<ConventionCategory, ConventionRow[]>();
  for (const r of rows) {
    const cat = r.category as ConventionCategory;
    const list = byCategory.get(cat) ?? [];
    list.push(r);
    byCategory.set(cat, list);
  }

  const sections = CATEGORIES.filter((cat) => byCategory.has(cat)).map((cat) => {
    const items = byCategory
      .get(cat)!
      .map((r) => {
        const at = r.evidencePath
          ? r.evidenceLine
            ? `${r.evidencePath}:${r.evidenceLine}`
            : r.evidencePath
          : null;
        const lines = [`- ${r.rule.trim()}`];
        if (at) lines.push(`  - Evidence: \`${at}\``);
        return lines.join('\n');
      })
      .join('\n');
    return `## ${CATEGORY_LABELS[cat]}\n\n${items}`;
  });

  const body = [
    '# Repository Conventions',
    '',
    'Apply these repository-specific conventions when modifying this project. When reporting a violation, cite the relevant `file:line` evidence.',
    '',
    ...sections,
  ].join('\n');

  const evidenceFiles = [...new Set(rows.map((r) => r.evidencePath).filter((p): p is string => !!p))];

  return {
    name: opts.name,
    description: `${rows.length} house convention${rows.length === 1 ? '' : 's'} extracted from the repository`,
    type: 'convention',
    enabled: true,
    body,
    evidence_files: evidenceFiles,
    convention_ids: rows.map((r) => r.id),
    existing_skill_id: opts.existingSkillId,
  };
}
