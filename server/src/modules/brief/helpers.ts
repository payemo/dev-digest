/**
 * PR Brief (L05) — pure transforms. Arguments in, values out: nothing here
 * reads a database, the network, the clock or the composition root. The caller
 * passes every fact (including "now") in.
 *
 * Grounding lives here: the model's answer is a set of CLAIMS about files and
 * lines, and `postValidate` keeps only the ones that point at something real in
 * this PR — its changed files, or a file in its blast map.
 */
import {
  BlastRadius,
  type BlastRadiusResponse,
  type BriefInputs,
  type BriefValidation,
  type Intent,
  type PrBriefModelOutput,
  type PrBriefRecord,
  type PrBriefStored,
  type PrIntentRecord,
  type ReviewFocusItem,
  type Risk,
} from '@devdigest/shared';
import { MAX_FOCUS, MAX_RISKS, SUMMARY_MAX_CHARS } from './constants.js';

/** An inclusive new-side line range. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * Known line anchors per allowed path. The KEY SET is FR-7's allow-list; an
 * empty range list means "a real file, but no known line" (e.g. a changed
 * symbol's declaring file, or a changed file with no patch).
 */
export type AnchorIndex = Map<string, LineRange[]>;

/** The same new-side hunk-header shape the diff parser matches. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The changed new-side line ranges of one file, read from its hunk HEADERS
 * only — numbers, never the body lines between them (FR-9, A-6). A zero-length
 * hunk (a pure deletion) anchors at its start line; a missing length means 1.
 */
export function changedRanges(patch: string | null): LineRange[] {
  if (!patch) return [];
  const ranges: LineRange[] = [];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('@@')) continue;
    const m = line.match(HUNK_HEADER);
    if (!m) continue;
    const start = Number(m[3]);
    const len = m[4] === undefined ? 1 : Number(m[4]);
    if (len === 0) {
      const at = Math.max(1, start);
      ranges.push({ start: at, end: at });
    } else {
      const from = Math.max(1, start);
      ranges.push({ start: from, end: Math.max(from, start + len - 1) });
    }
  }
  return ranges;
}

/** Sort and merge overlapping/adjacent ranges. */
function normalizeRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: LineRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * FR-7's allow-list plus the known lines of each allowed path: every changed
 * file (with its changed ranges), every blast caller file (with its caller
 * lines), and every changed symbol's declaring file.
 */
export function buildAnchorIndex(
  files: { path: string; ranges: LineRange[] }[],
  blast: BlastRadius | null,
): AnchorIndex {
  const acc = new Map<string, LineRange[]>();
  const add = (path: string, ranges: LineRange[]) => {
    const list = acc.get(path) ?? [];
    list.push(...ranges);
    acc.set(path, list);
  };
  for (const f of files) add(f.path, f.ranges);
  if (blast) {
    for (const sym of blast.changed_symbols) add(sym.file, []);
    for (const d of blast.downstream) {
      for (const c of d.callers) {
        add(c.file, c.line >= 1 ? [{ start: c.line, end: c.line }] : []);
      }
    }
  }
  const index: AnchorIndex = new Map();
  for (const [path, ranges] of acc) index.set(path, normalizeRanges(ranges));
  return index;
}

/** Split `path`, `path:N` or `path:N-M` into its path and optional suffix. */
export function parseFileRef(ref: string): { path: string; suffix: string | null } {
  const trimmed = ref.trim();
  const m = trimmed.match(/^(.*?):(\d+(?:-\d+)?)$/);
  if (m && m[1]) return { path: m[1], suffix: m[2]! };
  return { path: trimmed, suffix: null };
}

/** The anchor nearest to `line` in `ranges` (non-empty), ties to the lower line. */
function nearestAnchor(line: number, ranges: LineRange[]): number {
  let best = ranges[0]!.start;
  let bestDist = Infinity;
  for (const r of ranges) {
    if (line >= r.start && line <= r.end) return line;
    const candidate = line < r.start ? r.start : r.end;
    const dist = Math.abs(line - candidate);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

export interface PostValidateCaps {
  maxRisks: number;
  maxFocus: number;
}

/**
 * FR-8, in order: (a) strip refs outside the allow-list and drop risks left
 * with none; (b) drop focus items on an unknown file; (c) snap each focus line
 * to the nearest known line of its file; (d) collapse duplicates keyed on
 * physical identity only (file+line; kind + path set); (e) cap, keeping the
 * model's order.
 */
export function postValidate(
  output: Pick<PrBriefModelOutput, 'risks' | 'review_focus'>,
  anchors: AnchorIndex,
  caps: PostValidateCaps = { maxRisks: MAX_RISKS, maxFocus: MAX_FOCUS },
): { risks: Risk[]; review_focus: ReviewFocusItem[]; validation: BriefValidation } {
  const validation: BriefValidation = {
    risks_dropped: 0,
    refs_stripped: 0,
    focus_dropped: 0,
    focus_snapped: 0,
    duplicates_collapsed: 0,
  };

  // (a)
  const grounded: Risk[] = [];
  for (const risk of output.risks) {
    const refs = risk.file_refs
      .map((r) => r.trim())
      .filter((r) => anchors.has(parseFileRef(r).path));
    validation.refs_stripped += risk.file_refs.length - refs.length;
    if (refs.length === 0) {
      validation.risks_dropped += 1;
      continue;
    }
    grounded.push({ ...risk, file_refs: refs });
  }

  // (b) + (c)
  const focus: ReviewFocusItem[] = [];
  for (const item of output.review_focus) {
    const file = item.file.trim();
    const ranges = anchors.get(file);
    if (!ranges) {
      validation.focus_dropped += 1;
      continue;
    }
    const line = ranges.length > 0 ? nearestAnchor(item.line, ranges) : Math.max(1, item.line);
    if (line !== item.line) validation.focus_snapped += 1;
    focus.push({ ...item, file, line });
  }

  // (d)
  const riskKeys = new Set<string>();
  const uniqueRisks: Risk[] = [];
  for (const risk of grounded) {
    const paths = [...new Set(risk.file_refs.map((r) => parseFileRef(r).path))].sort();
    const key = `${risk.kind}\u0000${paths.join('\u0000')}`;
    if (riskKeys.has(key)) {
      validation.duplicates_collapsed += 1;
      continue;
    }
    riskKeys.add(key);
    uniqueRisks.push(risk);
  }
  const focusKeys = new Set<string>();
  const uniqueFocus: ReviewFocusItem[] = [];
  for (const item of focus) {
    const key = `${item.file}:${item.line}`;
    if (focusKeys.has(key)) {
      validation.duplicates_collapsed += 1;
      continue;
    }
    focusKeys.add(key);
    uniqueFocus.push(item);
  }

  // (e)
  return {
    risks: uniqueRisks.slice(0, caps.maxRisks),
    review_focus: uniqueFocus.slice(0, caps.maxFocus),
    validation,
  };
}

/** Trim, then cut to `SUMMARY_MAX_CHARS` on a word boundary with an ellipsis. */
export function clampSummary(text: string, max = SUMMARY_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const hard = trimmed.slice(0, max - 1);
  const lastSpace = hard.lastIndexOf(' ');
  const cut = lastSpace > max / 2 ? hard.slice(0, lastSpace) : hard;
  return `${cut.trimEnd()}…`;
}

/** D3 — the intent status: absent, from an older head, or current. */
export function intentStatus(intent: PrIntentRecord | null): BriefInputs['intent'] {
  if (!intent) return 'missing';
  return intent.is_stale ? 'stale' : 'present';
}

/**
 * D3 — the blast status. A failed read, or a degraded read with no changed
 * symbols at all, is `missing`; a degraded read that still found something is
 * `partial`.
 */
export function blastStatus(blast: BlastRadiusResponse | null): BriefInputs['blast'] {
  if (!blast) return 'missing';
  if (blast.degraded) return blast.changed_symbols.length === 0 ? 'missing' : 'partial';
  return 'present';
}

/** D3 — every input's status, all five keys. */
export function inputStatuses(args: {
  intent: PrIntentRecord | null;
  blast: BlastRadiusResponse | null;
  description: string | null;
  linkedIssue: { title: string; body: string | null } | null;
  specsCount: number;
}): BriefInputs {
  return {
    intent: intentStatus(args.intent),
    blast: blastStatus(args.blast),
    description: args.description?.trim() ? 'present' : 'missing',
    linked_issue: args.linkedIssue ? 'present' : 'missing',
    project_context: args.specsCount > 0 ? 'present' : 'missing',
  };
}

/** The intent snapshot stored on the brief (A-3), or `null` when missing. */
export function intentSnapshot(intent: PrIntentRecord | null): Intent | null {
  if (!intent) return null;
  return { intent: intent.intent, in_scope: intent.in_scope, out_of_scope: intent.out_of_scope };
}

/**
 * The blast snapshot stored on the brief (A-3): the response minus the live
 * endpoint's `degraded`/`reason` (zod strips unknown keys), or `null` when
 * the blast input is missing.
 */
export function blastSnapshot(blast: BlastRadiusResponse | null): BlastRadius | null {
  if (blastStatus(blast) === 'missing' || !blast) return null;
  return BlastRadius.parse(blast);
}

/** Everything `toStored` composes into the persisted document. */
export interface StoredParts {
  prId: string;
  headSha: string;
  generatedAt: string;
  summary: string;
  intent: Intent | null;
  blast: BlastRadius | null;
  risks: Risk[];
  reviewFocus: ReviewFocusItem[];
  provider: string;
  model: string | null;
  attempts: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  inputTokensMeasured: number;
  truncatedSections: string[];
  inputs: BriefInputs;
  validation: BriefValidation;
}

/** The exact `pr_brief.json` document. */
export function toStored(p: StoredParts): PrBriefStored {
  return {
    summary: p.summary,
    intent: p.intent,
    blast: p.blast,
    risks: { risks: p.risks },
    review_focus: p.reviewFocus,
    history: { history: [] },
    pr_id: p.prId,
    head_sha: p.headSha,
    generated_at: p.generatedAt,
    provider: p.provider,
    model: p.model,
    attempts: p.attempts,
    tokens_in: p.tokensIn,
    tokens_out: p.tokensOut,
    cost_usd: p.costUsd,
    input_tokens_measured: p.inputTokensMeasured,
    truncated_sections: p.truncatedSections,
    inputs: p.inputs,
    validation: p.validation,
  };
}

/** Stored document → wire record. `is_stale` is derived on read, never stored. */
export function toRecord(stored: PrBriefStored, currentHeadSha: string): PrBriefRecord {
  return { ...stored, is_stale: stored.head_sha !== currentHeadSha };
}
