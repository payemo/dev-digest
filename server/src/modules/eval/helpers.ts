/**
 * Pure helpers for the eval module (L06): slugging, seeding a case from a
 * finding, citability, skill snapshots, compare, trend/alert aggregation and
 * row → DTO mapping. Side-effect free — data in, data out; the caller passes
 * anything time- or storage-dependent. Row types are imported type-only.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  EvalExpectedFinding,
  EvalInputFile,
  EvalLocation,
  EvalPrMeta,
  EvalSkillSnapshotEntry,
  EvalSkillSnapshotItem,
  Finding,
  FindingCategory,
  Severity,
  type EvalAgentRun,
  type EvalCaseInput,
  type EvalCaseRecord,
  type EvalCaseResult,
  type EvalCompare,
  type EvalExpectationKind,
  type EvalMetricTriple,
  type EvalPrecisionDip,
  type EvalSkillDiff,
  type EvalSourceDecision,
  type EvalTrendPoint,
  type UnifiedDiff,
} from '@devdigest/shared';
import { groundFindings } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type {
  EvalAgentRunRow,
  EvalCaseResultRow,
  EvalCaseRow,
  FindingRow,
  PullRow,
  SkillRow,
} from '../../db/rows.js';
import { renderSkillBlock } from '../reviews/helpers.js';
import {
  EVAL_DIP_THRESHOLD_POINTS,
  EVAL_FILE_NOTE,
  EVAL_NAME_MAX,
  EVAL_NEGATIVE_PREFIX,
  EVAL_POSITIVE_PREFIX,
} from './constants.js';

// ---------------------------------------------------------------------------
// Request origin (CSRF guard on the model-spending POSTs)
// ---------------------------------------------------------------------------

/**
 * True when a request carries an `Origin` header naming a site other than the
 * studio. No header (curl, server-to-server, `app.inject`) is not foreign:
 * CORS already covers reading the response; this only stops a
 * page on another site from *sending* a state-changing request.
 */
export function isForeignOrigin(origin: string | undefined, allowed: string): boolean {
  return origin !== undefined && origin !== allowed;
}

// ---------------------------------------------------------------------------
// Names (FR-5)
// ---------------------------------------------------------------------------

function trimHyphens(s: string): string {
  return s.replace(/^-+/, '').replace(/-+$/, '');
}

/**
 * Kind-prefixed, lower-case, hyphen-separated slug of `title`, at most
 * `EVAL_NAME_MAX` characters with no trailing hyphen, and not in `taken`
 * (a `-2`, `-3`, … suffix is appended, re-truncating the base to fit).
 */
export function slugifyCaseName(
  kind: EvalExpectationKind,
  title: string,
  taken: Set<string>,
): string {
  const prefix = kind === 'must_find' ? EVAL_POSITIVE_PREFIX : EVAL_NEGATIVE_PREFIX;
  const body = trimHyphens(title.toLowerCase().replace(/[^a-z0-9]+/g, '-')) || 'case';
  return uniqueCaseName(`${prefix}${body}`, taken);
}

/**
 * `name` capped at `EVAL_NAME_MAX` (no trailing hyphen) and made unique against
 * `taken` with a `-2`, `-3`, … suffix, re-truncating the base so it still fits.
 */
export function uniqueCaseName(name: string, taken: Set<string>): string {
  const cap = (s: string, max: number) => trimHyphens(s.slice(0, max));
  const base = cap(name, EVAL_NAME_MAX);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${cap(base, EVAL_NAME_MAX - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Seeding a case from a finding (FR-2 – FR-6)
// ---------------------------------------------------------------------------

/** The single-file unified diff text frozen into a seeded case. */
export function fileDiffText(path: string, patch: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`;
}

/**
 * True iff `loc` falls on citable lines of `diff` — i.e. a plain finding at that
 * location would survive the real grounding gate. Always checked as a plain
 * `finding`, so file-only kinds still need citable lines (AC-19).
 */
export function isCitable(
  diff: UnifiedDiff,
  loc: { file: string; start_line: number; end_line: number },
): boolean {
  const synthetic: Finding = {
    id: 'citability-probe',
    severity: 'SUGGESTION',
    category: 'bug',
    title: 'probe',
    file: loc.file,
    start_line: loc.start_line,
    end_line: loc.end_line,
    rationale: '',
    confidence: 1,
    kind: 'finding',
  };
  return groundFindings([synthetic], diff).kept.length === 1;
}

/** The decision a finding carries, or null when it was neither accepted nor dismissed. */
export function findingDecision(
  finding: Pick<FindingRow, 'acceptedAt' | 'dismissedAt'>,
): EvalSourceDecision | null {
  if (finding.acceptedAt) return 'accepted';
  if (finding.dismissedAt) return 'dismissed';
  return null;
}

export type SeedDraftResult =
  | { decision: EvalSourceDecision; draft: EvalCaseInput }
  | { refused: string };

/**
 * D3 — the seeded case for a decided finding, with its input frozen by value
 * from the stored per-file patch + PR record. Refuses (nothing to save) when the
 * finding has no decision, there is no stored diff for its file, or its lines
 * are not citable in that diff.
 */
export function buildSeedDraft(args: {
  finding: Pick<
    FindingRow,
    'acceptedAt' | 'dismissedAt' | 'file' | 'startLine' | 'endLine' | 'severity' | 'category' | 'title'
  >;
  pull: Pick<PullRow, 'number' | 'title' | 'body' | 'author'>;
  patch: string | null | undefined;
  taken: Set<string>;
}): SeedDraftResult {
  const { finding, pull, patch } = args;
  const decision = findingDecision(finding);
  if (!decision) {
    return { refused: 'Accept or dismiss this finding before turning it into an eval case.' };
  }
  if (!patch) {
    return {
      refused: `No stored diff for ${finding.file} — this finding can't be frozen into a case.`,
    };
  }
  const startLine = Math.min(finding.startLine, finding.endLine);
  const endLine = Math.max(finding.startLine, finding.endLine);
  const inputDiff = fileDiffText(finding.file, patch);
  const loc = { file: finding.file, start_line: startLine, end_line: endLine };
  if (startLine < 1 || !isCitable(parseUnifiedDiff(inputDiff), loc)) {
    return {
      refused: `Lines ${startLine}–${endLine} of ${finding.file} are not in its stored diff — this finding can't be frozen into a case.`,
    };
  }

  const kind: EvalExpectationKind = decision === 'accepted' ? 'must_find' : 'must_not_flag';
  const common = {
    name: slugifyCaseName(kind, finding.title, args.taken),
    kind,
    input_diff: inputDiff,
    input_files: [{ path: finding.file, note: EVAL_FILE_NOTE }],
    input_meta: {
      number: pull.number,
      title: pull.title,
      description: pull.body ?? null,
      author: pull.author,
    },
    notes: null,
  };

  if (kind === 'must_not_flag') {
    return {
      decision,
      draft: { ...common, expected_output: [], forbidden_location: loc },
    };
  }

  const severity = Severity.safeParse(finding.severity);
  const category = FindingCategory.safeParse(finding.category);
  if (!severity.success || !category.success) {
    return { refused: 'This finding has an unknown severity or category and cannot be seeded.' };
  }
  return {
    decision,
    draft: {
      ...common,
      expected_output: [
        {
          severity: severity.data,
          category: category.data,
          title: finding.title,
          file: finding.file,
          start_line: startLine,
          ...(endLine !== startLine ? { end_line: endLine } : {}),
        },
      ],
      forbidden_location: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Skill snapshots (R3)
// ---------------------------------------------------------------------------

/** One linked skill as `AgentsRepository.linkedSkills` returns it. */
export interface SnapshotLink {
  skill: Pick<SkillRow, 'id' | 'name' | 'description' | 'body' | 'enabled' | 'version'>;
  order: number;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Pin every linked skill, in link order, with the exact prompt block it renders
 * to and a hash of that block (so a description edit that leaves the skill's
 * version unchanged is still a different state).
 */
export function buildSkillSnapshot(links: SnapshotLink[]): EvalSkillSnapshotEntry[] {
  return [...links]
    .sort((a, b) => a.order - b.order)
    .map((l) => {
      const rendered = renderSkillBlock(l.skill);
      return {
        skill_id: l.skill.id,
        name: l.skill.name,
        version: l.skill.version,
        enabled: l.skill.enabled,
        order: l.order,
        content_hash: sha256(rendered),
        rendered,
      };
    });
}

/** The skill blocks a pinned run injects: enabled entries, in snapshot order. */
export function injectableBodies(snapshot: EvalSkillSnapshotEntry[]): string[] {
  return snapshot.filter((s) => s.enabled).map((s) => s.rendered);
}

type SkillState = Pick<
  EvalSkillSnapshotEntry,
  'skill_id' | 'name' | 'version' | 'enabled' | 'content_hash'
>;

/** Skills added, removed, reordered or at a different content state between two snapshots. */
export function skillDiff(a: SkillState[], b: SkillState[]): EvalSkillDiff {
  const aIds = new Set(a.map((s) => s.skill_id));
  const bIds = new Set(b.map((s) => s.skill_id));
  const commonA = a.filter((s) => bIds.has(s.skill_id)).map((s) => s.skill_id);
  const commonB = b.filter((s) => aIds.has(s.skill_id)).map((s) => s.skill_id);
  const byIdA = new Map(a.map((s) => [s.skill_id, s]));
  const changed: EvalSkillDiff['changed'] = [];
  for (const s of b) {
    const old = byIdA.get(s.skill_id);
    if (old && (old.content_hash !== s.content_hash || old.enabled !== s.enabled)) {
      changed.push({ name: s.name, from_version: old.version, to_version: s.version });
    }
  }
  return {
    added: b.filter((s) => !aIds.has(s.skill_id)).map((s) => s.name),
    removed: a.filter((s) => !bIds.has(s.skill_id)).map((s) => s.name),
    reordered: commonA.some((id, i) => commonB[i] !== id),
    changed,
  };
}

/** Same skills, same order, same content state and enabled flag. */
export function sameSkillState(a: SkillState[], b: SkillState[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (s, i) =>
      s.skill_id === b[i]!.skill_id &&
      s.content_hash === b[i]!.content_hash &&
      s.enabled === b[i]!.enabled,
  );
}

// ---------------------------------------------------------------------------
// Deltas, trend, precision dip, compare (FR-20 – FR-22)
// ---------------------------------------------------------------------------

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function delta(newer: number | null, older: number | null): number | null {
  return newer == null || older == null ? null : round4(newer - older);
}

type Metrics = Pick<EvalAgentRun, 'recall' | 'precision' | 'citation_accuracy'>;

/** Signed deltas latest − previous; null when either side is not applicable (or there is no previous run). */
export function metricDeltas(latest: Metrics | null, previous: Metrics | null): EvalMetricTriple {
  return {
    recall: delta(latest?.recall ?? null, previous?.recall ?? null),
    precision: delta(latest?.precision ?? null, previous?.precision ?? null),
    citation_accuracy: delta(latest?.citation_accuracy ?? null, previous?.citation_accuracy ?? null),
  };
}

/**
 * FR-21 / D6 — the dip in whole points (rounded difference). Raised iff both
 * precisions are applicable and the drop is at least the threshold.
 */
export function precisionDip(
  latest: (Metrics & Pick<EvalAgentRun, 'agent_version'>) | null,
  previous: Metrics | null,
): EvalPrecisionDip | null {
  if (!latest || !previous) return null;
  if (latest.precision == null || previous.precision == null) return null;
  const points = Math.round((previous.precision - latest.precision) * 100);
  if (points < EVAL_DIP_THRESHOLD_POINTS) return null;
  return {
    points,
    version: latest.agent_version,
    recall_delta: delta(latest.recall, previous.recall),
    citation_delta: delta(latest.citation_accuracy, previous.citation_accuracy),
  };
}

/** One point per COMPLETED run, oldest → newest; not-applicable metrics stay null. */
export function trendPoints(runs: EvalAgentRun[]): EvalTrendPoint[] {
  return runs
    .filter((r) => r.status === 'completed')
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((r) => ({
      ran_at: r.started_at,
      version: r.agent_version,
      recall: r.recall,
      precision: r.precision,
      citation_accuracy: r.citation_accuracy,
      pass_rate: r.cases_total > 0 ? r.passed / r.cases_total : 0,
      cost_usd: r.cost_usd,
    }));
}

/** A run plus the system prompt of the agent version it was pinned to. */
export interface RunWithPrompt {
  run: EvalAgentRun;
  prompt: string;
}

/**
 * FR-22 — compare two runs of one agent, always ordered older → newer by
 * `started_at` (the caller's order is irrelevant). `currentSnapshot` is the
 * live skill state, used to warn that Promote leaves skill links as they are.
 */
export function compareRuns(
  a: RunWithPrompt,
  b: RunWithPrompt,
  currentSnapshot: SkillState[],
  activeVersion: number,
): EvalCompare {
  const [older, newer] = a.run.started_at <= b.run.started_at ? [a, b] : [b, a];
  const o = older.run;
  const n = newer.run;
  const samePrompt = older.prompt === newer.prompt;
  const modelChange = o.model !== n.model ? { from: o.model, to: n.model } : null;
  const sameSkills = sameSkillState(o.skill_snapshot, n.skill_snapshot);
  const oCases = new Set(o.case_ids);
  const nCases = new Set(n.case_ids);
  const onlyOld = o.case_ids.filter((id) => !nCases.has(id)).length;
  const onlyNew = n.case_ids.filter((id) => !oCases.has(id)).length;
  return {
    old: o,
    new: n,
    delta: {
      ...metricDeltas(n, o),
      cost_usd: delta(n.cost_usd, o.cost_usd),
    },
    old_prompt: older.prompt,
    new_prompt: newer.prompt,
    same_prompt: samePrompt,
    model_change: modelChange,
    skill_diff: skillDiff(o.skill_snapshot, n.skill_snapshot),
    no_config_change:
      o.agent_version === n.agent_version && samePrompt && !modelChange && sameSkills,
    case_set: { same: onlyOld === 0 && onlyNew === 0, only_old: onlyOld, only_new: onlyNew },
    promote: {
      version: n.agent_version,
      available: n.agent_version !== activeVersion,
      skill_mismatch: !sameSkillState(n.skill_snapshot, currentSnapshot),
    },
  };
}

// ---------------------------------------------------------------------------
// Row → DTO mapping (snake_case wire; server-only `rendered` stripped)
// ---------------------------------------------------------------------------

const InputFiles = z.array(EvalInputFile).catch([]);
const Expected = z.array(EvalExpectedFinding).catch([]);
const Findings = z.array(Finding).catch([]);
const Matched = z.array(z.number().int()).catch([]);
const CaseIds = z.array(z.string()).catch([]);
const SnapshotWire = z.array(EvalSkillSnapshotItem).catch([]);
const SnapshotFull = z.array(EvalSkillSnapshotEntry).catch([]);
const Meta = EvalPrMeta.catch({ title: '' });
const Location = EvalLocation.nullable().catch(null);

/** The full stored snapshot (with `rendered`) — server-side use only. */
export function storedSnapshot(row: Pick<EvalAgentRunRow, 'skillSnapshot'>): EvalSkillSnapshotEntry[] {
  return SnapshotFull.parse(row.skillSnapshot);
}

export function toResultDto(row: EvalCaseResultRow): EvalCaseResult {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: row.caseName ?? '',
    case_kind: row.caseKind ?? 'must_find',
    suite_run_id: row.suiteRunId,
    agent_version: row.agentVersion ?? 0,
    status: row.status ?? 'errored',
    reason: row.reason,
    emitted: row.emitted ?? 0,
    grounded: row.grounded ?? 0,
    expected_n: row.expectedN ?? 0,
    got_m: row.gotM ?? 0,
    matched: Matched.parse(row.matched),
    findings: Findings.parse(row.actualOutput),
    duration_ms: row.durationMs ?? 0,
    cost_usd: row.costUsd,
    ran_at: row.ranAt.toISOString(),
  };
}

export function toCaseRecord(
  row: EvalCaseRow,
  lastResult: EvalCaseResultRow | null,
  sourceAvailable: boolean,
): EvalCaseRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    kind: row.kind,
    input_diff: row.inputDiff ?? '',
    input_files: InputFiles.parse(row.inputFiles),
    input_meta: Meta.parse(row.inputMeta),
    expected_output: Expected.parse(row.expectedOutput),
    forbidden_location: Location.parse(row.forbiddenLocation ?? null),
    source_finding_id: row.sourceFindingId,
    source_decision: row.sourceDecision,
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_result: lastResult ? toResultDto(lastResult) : null,
    source_available: sourceAvailable,
  };
}

/** A saved case as an editable input (used as the "draft" when a seed finds the existing case). */
export function caseInputFromRecord(c: EvalCaseRecord): EvalCaseInput {
  return {
    name: c.name,
    kind: c.kind,
    input_diff: c.input_diff,
    input_files: c.input_files,
    input_meta: c.input_meta,
    expected_output: c.expected_output,
    forbidden_location: c.forbidden_location,
    notes: c.notes ?? null,
  };
}

/** The frozen fields of a case row, typed — what the runner executes. */
export function caseSpec(row: EvalCaseRow): {
  kind: EvalExpectationKind;
  expected: EvalExpectedFinding[];
  forbidden: EvalLocation | null;
  meta: EvalPrMeta;
} {
  return {
    kind: row.kind,
    expected: Expected.parse(row.expectedOutput),
    forbidden: Location.parse(row.forbiddenLocation ?? null),
    meta: Meta.parse(row.inputMeta),
  };
}

export function toAgentRunDto(row: EvalAgentRunRow): EvalAgentRun {
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    provider: row.provider,
    model: row.model,
    status: row.status,
    skill_snapshot: SnapshotWire.parse(row.skillSnapshot),
    case_ids: CaseIds.parse(row.caseIds),
    cases_total: row.casesTotal,
    cases_done: row.casesDone,
    passed: row.passed,
    errored: row.errored,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cost_usd: row.costUsd,
    duration_ms: row.durationMs,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
    error: row.error,
  };
}
