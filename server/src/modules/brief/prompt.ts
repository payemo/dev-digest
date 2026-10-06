import type { ChatMessage, BriefInputs, DownstreamImpact, SmartDiffRole } from '@devdigest/shared';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import {
  INPUT_TOKEN_BUDGET,
  MAX_INTENT_CHARS,
  SECTION_CEILINGS,
  SHRINK_ORDER,
  type BriefSection,
} from './constants.js';
import type { LineRange } from './helpers.js';

/**
 * The brief generation input — pure assembly over facts the service already
 * collected. Only precomputed facts reach the model (FR-9): paths, roles,
 * counts, changed line NUMBERS, the blast map, the description, the linked
 * issue and attached spec documents. Never a patch body line, never a clone
 * file, never a review finding.
 *
 * Every author- or repo-controlled string (title, paths, symbol names, the
 * description, the issue, specs, the intent text) goes through `wrapUntrusted`.
 * Headings and truncation markers stay outside the wrap, so the model can tell
 * our framing from the data.
 *
 * Budget (NFR-1/NFR-2): each section renders at its ceiling; if the total
 * (system + user) still exceeds `INPUT_TOKEN_BUDGET`, sections shrink in
 * `SHRINK_ORDER` — halved twice, then dropped — re-measuring after each step.
 * The always-kept block never shrinks, so the loop ends at worst with every
 * section dropped.
 */

export interface BriefFileFact {
  path: string;
  role: SmartDiffRole;
  additions: number;
  deletions: number;
  ranges: LineRange[];
}

export interface BriefFacts {
  title: string;
  intent: {
    sentence: string;
    inScope: string[];
    outOfScope: string[];
    riskAreas: { label: string; path: string | null }[];
  } | null;
  blast: {
    summary: string;
    degraded: boolean;
    symbols: { name: string; file: string; kind: string }[];
    downstream: DownstreamImpact[];
  } | null;
  files: BriefFileFact[];
  totals: { files: number; additions: number; deletions: number };
  roleCounts: Record<SmartDiffRole, number>;
  description: string | null;
  issue: { title: string; body: string | null } | null;
  specs: { path: string; content: string }[];
  inputs: BriefInputs;
}

export interface BriefMessages {
  messages: ChatMessage[];
  inputTokens: number;
  truncatedSections: BriefSection[];
}

type Count = (s: string) => number;

interface Rendered {
  text: string;
  truncated: boolean;
}

const OMITTED = '[omitted for budget]';
const TRUNCATED = '[truncated]';
const ROLE_ORDER: SmartDiffRole[] = ['core', 'tests', 'wiring', 'docs', 'boilerplate'];

/** Largest k in [0, n] for which `fits(k)` holds, assuming monotonicity; -1 if none. */
function largestFitting(n: number, fits: (k: number) => boolean): number {
  if (fits(n)) return n;
  if (!fits(0)) return -1;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function omitted(heading: string): Rendered {
  return { text: `${heading}\n${OMITTED}`, truncated: true };
}

/** A free-text section (description / issue) cut at the budget with a marker. */
function renderText(
  heading: string,
  label: string,
  body: string,
  budget: number,
  count: Count,
): Rendered {
  if (!body.trim()) return { text: '', truncated: false };
  if (budget <= 0) return omitted(heading);
  const full = `${heading}\n${wrapUntrusted(label, body)}`;
  if (count(full) <= budget) return { text: full, truncated: false };
  const render = (len: number) =>
    `${heading}\n${wrapUntrusted(label, body.slice(0, len))}\n${TRUNCATED}`;
  const len = largestFitting(body.length, (k) => count(render(k)) <= budget);
  if (len <= 0) return omitted(heading);
  return { text: render(len), truncated: true };
}

function formatRanges(ranges: LineRange[]): string {
  if (ranges.length === 0) return 'lines n/a';
  return `lines ${ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`)).join(',')}`;
}

/** `core` first, then by churn (additions + deletions) descending. */
function orderFiles(files: BriefFileFact[]): BriefFileFact[] {
  return [...files].sort((a, b) => {
    const ac = a.role === 'core' ? 0 : 1;
    const bc = b.role === 'core' ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return b.additions + b.deletions - (a.additions + a.deletions);
  });
}

function renderFiles(files: BriefFileFact[], budget: number, count: Count): Rendered {
  const heading =
    '## CHANGED FILES (path [role] +additions -deletions, changed new-side line ranges)';
  if (files.length === 0) return { text: '', truncated: false };
  if (budget <= 0) return omitted(heading);
  const ordered = orderFiles(files);
  const render = (k: number) => {
    const lines = ordered
      .slice(0, k)
      .map((f) => `${f.path} [${f.role}] +${f.additions} -${f.deletions} ${formatRanges(f.ranges)}`);
    const rest = new Map<SmartDiffRole, number>();
    for (const f of ordered.slice(k)) rest.set(f.role, (rest.get(f.role) ?? 0) + 1);
    const more = ROLE_ORDER.filter((r) => rest.has(r)).map(
      (r) => `+${rest.get(r)} more ${r} files`,
    );
    return [heading, wrapUntrusted('changed-files', lines.join('\n')), ...more].join('\n');
  };
  const k = largestFitting(ordered.length, (n) => count(render(n)) <= budget);
  if (k < 0) return omitted(heading);
  return { text: render(k), truncated: k < ordered.length };
}

function renderBlastDetail(
  blast: BriefFacts['blast'],
  budget: number,
  count: Count,
): Rendered {
  const heading = '## BLAST RADIUS DETAIL (changed symbols, their callers file:line, endpoints, crons)';
  if (!blast || (blast.symbols.length === 0 && blast.downstream.length === 0)) {
    return { text: '', truncated: false };
  }
  if (budget <= 0) return omitted(heading);

  const bySymbol = new Map(blast.downstream.map((d) => [d.symbol, d]));
  const maxCallers = Math.max(0, ...blast.downstream.map((d) => d.callers.length));

  const render = (symbolCount: number, callerCap: number) => {
    const lines: string[] = [];
    const shown = blast.symbols.slice(0, symbolCount);
    for (const sym of shown) {
      lines.push(`${sym.name} (${sym.kind}) declared in ${sym.file}`);
      const d = bySymbol.get(sym.name);
      if (!d) continue;
      // Callers stay in the index's rank order; omissions are reported.
      for (const c of d.callers.slice(0, callerCap)) lines.push(`  caller ${c.name} at ${c.file}:${c.line}`);
      const omittedCallers = d.callers.length - Math.min(callerCap, d.callers.length);
      if (omittedCallers > 0) lines.push(`  (+${omittedCallers} more callers)`);
      if (d.endpoints_affected.length) lines.push(`  endpoints: ${d.endpoints_affected.join(', ')}`);
      if (d.crons_affected.length) lines.push(`  crons: ${d.crons_affected.join(', ')}`);
    }
    const extra = blast.symbols.length - shown.length;
    return [
      heading,
      wrapUntrusted('blast-radius', lines.join('\n')),
      ...(extra > 0 ? [`(+${extra} more symbols)`] : []),
    ].join('\n');
  };

  const all = blast.symbols.length;
  if (count(render(all, maxCallers)) <= budget) return { text: render(all, maxCallers), truncated: false };
  const cap = largestFitting(maxCallers, (c) => count(render(all, c)) <= budget);
  if (cap >= 0) return { text: render(all, cap), truncated: true };
  const n = largestFitting(all, (k) => count(render(k, 0)) <= budget);
  if (n <= 0) return omitted(heading);
  return { text: render(n, 0), truncated: true };
}

function renderSpecs(specs: BriefFacts['specs'], budget: number, count: Count): Rendered {
  const heading = '## PROJECT CONTEXT SPECS (attached to this repository\'s review agents)';
  if (specs.length === 0) return { text: '', truncated: false };
  if (budget <= 0) return omitted(heading);

  // The path is repo-controlled, so it rides inside the wrapped content; the
  // label stays a fixed `spec-<n>` (wrapUntrusted neutralises content, not labels).
  const wrapSpec = (n: number, path: string, content: string) =>
    wrapUntrusted(`spec-${n}`, `path: ${path}\n\n${content}`);

  const parts: string[] = [heading];
  let truncated = false;
  let i = 0;
  for (; i < specs.length; i++) {
    const spec = specs[i]!;
    const whole = wrapSpec(i, spec.path, spec.content);
    if (count([...parts, whole].join('\n')) <= budget) {
      parts.push(whole);
      continue;
    }
    // The first spec that does not fit is cut; everything after is skipped.
    truncated = true;
    const cut = (len: number) => `${wrapSpec(i, spec.path, spec.content.slice(0, len))}\n${TRUNCATED}`;
    const render = (len: number) => [...parts, cut(len)].join('\n');
    const len = largestFitting(spec.content.length, (k) => count(render(k)) <= budget);
    if (len > 0) {
      parts.push(cut(len));
      i++;
    }
    break;
  }
  const skipped = specs.length - i;
  if (skipped > 0) parts.push(`[+${skipped} more specs omitted]`);
  if (parts.length === 1) return omitted(heading);
  return { text: parts.join('\n'), truncated };
}

const INPUT_LABELS: Record<keyof BriefInputs, Record<'missing' | 'partial' | 'stale', string>> = {
  intent: {
    missing: 'Intent (never derived)',
    partial: 'Intent (partial)',
    stale: 'Intent (derived for an older commit — may be outdated)',
  },
  blast: {
    missing: 'Blast radius (index unavailable)',
    partial: 'Blast radius (index degraded, partial)',
    stale: 'Blast radius (stale)',
  },
  description: {
    missing: 'PR description (empty)',
    partial: 'PR description (partial)',
    stale: 'PR description (stale)',
  },
  linked_issue: {
    missing: 'Linked issue (none referenced, or unreadable)',
    partial: 'Linked issue (partial)',
    stale: 'Linked issue (stale)',
  },
  project_context: {
    missing: 'Project Context specs (none attached)',
    partial: 'Project Context specs (partial)',
    stale: 'Project Context specs (stale)',
  },
};

/** FR-10 — tell the model which inputs it does NOT have, so it invents none. */
export function missingInputsNote(inputs: BriefInputs): string {
  const missing: string[] = [];
  const degraded: string[] = [];
  for (const key of Object.keys(INPUT_LABELS) as (keyof BriefInputs)[]) {
    const status = inputs[key];
    if (status === 'present') continue;
    (status === 'missing' ? missing : degraded).push(INPUT_LABELS[key][status]);
  }
  const lines: string[] = [];
  if (missing.length) lines.push(`NOT AVAILABLE: ${missing.join('; ')}. Do not guess at them.`);
  if (degraded.length) lines.push(`PARTIAL OR OUTDATED: ${degraded.join('; ')}.`);
  return lines.join('\n');
}

function renderIntent(intent: NonNullable<BriefFacts['intent']>): string {
  const lines = [
    `Intent: ${intent.sentence}`,
    ...(intent.inScope.length ? [`In scope: ${intent.inScope.join('; ')}`] : []),
    ...(intent.outOfScope.length ? [`Out of scope: ${intent.outOfScope.join('; ')}`] : []),
    ...intent.riskAreas.map((r) => `Intent risk area: ${r.label}${r.path ? ` (${r.path})` : ''}`),
  ];
  const text = lines.join('\n');
  return text.length > MAX_INTENT_CHARS ? `${text.slice(0, MAX_INTENT_CHARS)}…` : text;
}

/** The block that never shrinks: title, totals, role counts, intent, blast summary, missing note. */
function renderAlwaysKept(facts: BriefFacts): string {
  const roles = ROLE_ORDER.filter((r) => facts.roleCounts[r] > 0)
    .map((r) => `${r} ${facts.roleCounts[r]}`)
    .join(' · ');
  const parts = [
    '## PULL REQUEST',
    wrapUntrusted('pr-title', facts.title),
    `Totals: ${facts.totals.files} files changed, +${facts.totals.additions} -${facts.totals.deletions}`,
    `Files by role: ${roles || 'none'}`,
  ];
  if (facts.intent) {
    parts.push('## INTENT (derived earlier, for context)', wrapUntrusted('intent', renderIntent(facts.intent)));
  }
  if (facts.blast) {
    const callers = facts.blast.downstream.reduce((n, d) => n + d.callers.length, 0);
    const endpoints = new Set(facts.blast.downstream.flatMap((d) => d.endpoints_affected)).size;
    const crons = new Set(facts.blast.downstream.flatMap((d) => d.crons_affected)).size;
    parts.push(
      '## BLAST RADIUS SUMMARY',
      `Counts: ${facts.blast.symbols.length} symbols, ${callers} callers, ${endpoints} endpoints, ${crons} crons${facts.blast.degraded ? ' (index degraded — may be incomplete)' : ''}`,
      wrapUntrusted('blast-summary', facts.blast.summary),
    );
  }
  const note = missingInputsNote(facts.inputs);
  if (note) parts.push('## MISSING INPUTS', note);
  return parts.join('\n');
}

/**
 * Assemble the system + user messages within the input budget, measuring the
 * total with the caller's counter (the server's shared tokenizer).
 */
export function buildBriefMessages(facts: BriefFacts, count: Count, system: string): BriefMessages {
  const budgets: Record<BriefSection, number> = { ...SECTION_CEILINGS };
  const halvings: Record<BriefSection, number> = {
    files: 0,
    blast_detail: 0,
    description: 0,
    linked_issue: 0,
    project_context: 0,
  };
  const alwaysKept = renderAlwaysKept(facts);
  const systemTokens = count(system);

  const renderAll = (): Record<BriefSection, Rendered> => ({
    files: renderFiles(facts.files, budgets.files, count),
    blast_detail: renderBlastDetail(facts.blast, budgets.blast_detail, count),
    description: renderText(
      '## PR DESCRIPTION',
      'pr-description',
      facts.description ?? '',
      budgets.description,
      count,
    ),
    linked_issue: facts.issue
      ? renderText(
          '## LINKED ISSUE',
          'linked-issue',
          `${facts.issue.title}\n\n${facts.issue.body ?? ''}`,
          budgets.linked_issue,
          count,
        )
      : { text: '', truncated: false },
    project_context: renderSpecs(facts.specs, budgets.project_context, count),
  });

  // Sections appear in reading order; the shrink order is separate.
  const assemble = (r: Record<BriefSection, Rendered>) =>
    [
      alwaysKept,
      r.files.text,
      r.blast_detail.text,
      r.description.text,
      r.linked_issue.text,
      r.project_context.text,
    ]
      .filter(Boolean)
      .join('\n\n');

  let rendered = renderAll();
  let user = assemble(rendered);
  let total = systemTokens + count(user);
  let cursor = 0;
  while (total > INPUT_TOKEN_BUDGET && cursor < SHRINK_ORDER.length) {
    const section = SHRINK_ORDER[cursor]!;
    if (budgets[section] === 0 || rendered[section].text === '') {
      cursor++;
      continue;
    }
    if (halvings[section] < 2) {
      budgets[section] = Math.floor(budgets[section] / 2);
      halvings[section]++;
    } else {
      budgets[section] = 0;
    }
    rendered = renderAll();
    user = assemble(rendered);
    total = systemTokens + count(user);
  }

  const truncatedSections = (Object.keys(rendered) as BriefSection[]).filter(
    (s) => rendered[s].truncated,
  );
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    inputTokens: total,
    truncatedSections,
  };
}
