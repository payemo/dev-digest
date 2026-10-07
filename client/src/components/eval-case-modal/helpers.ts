/* Pure helpers for the eval-case modal — parse/validate the expected-output
   JSON against the shared contract, build the skeleton, derive the banner
   location and classify diff lines for colouring. */
import { z } from "zod";
import {
  EvalCaseInput,
  EvalExpectedFinding,
  type EvalCaseInputBody,
  type EvalCaseRecord,
  type EvalExpectationKind,
  type EvalInputFile,
  type EvalLocation,
  type EvalPrMeta,
} from "@devdigest/shared";
import { SKELETON_DEFAULTS } from "./constants";

const ExpectedList = z.array(EvalExpectedFinding);

export type ExpectedParse =
  | { ok: true; value: EvalExpectedFinding[] }
  | { ok: false; error: "invalid_json" | "wrong_shape" | "kind_rule" };

/** Parse the expected-output text: valid JSON, the right shape, and the kind rule. */
export function parseExpected(text: string, kind: EvalExpectationKind): ExpectedParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const parsed = ExpectedList.safeParse(json);
  if (!parsed.success) return { ok: false, error: "wrong_shape" };
  if (kind === "must_find" && parsed.data.length === 0) return { ok: false, error: "kind_rule" };
  if (kind === "must_not_flag" && parsed.data.length > 0) return { ok: false, error: "kind_rule" };
  return { ok: true, value: parsed.data };
}

/** The first file path named in a unified diff (`+++ b/<path>`), if any. */
export function firstDiffFile(diff: string): string | null {
  const m = diff.match(/^\+\+\+ (?:b\/)?(.+)$/m);
  const path = m?.[1]?.trim();
  return path && path !== "/dev/null" ? path : null;
}

/** A finding skeleton: severity, category, title, file and start line. */
export function skeletonFor(location?: { file?: string | null; start_line?: number }) {
  return {
    severity: SKELETON_DEFAULTS.severity,
    category: SKELETON_DEFAULTS.category,
    title: SKELETON_DEFAULTS.title,
    file: location?.file || "src/file.ts",
    start_line: location?.start_line ?? 1,
  };
}

/** Append a skeleton to the current JSON array (or start a new one if the text is not an array). */
export function insertSkeleton(text: string, diff: string): string {
  const skeleton = skeletonFor({ file: firstDiffFile(diff) });
  let current: unknown;
  try {
    current = JSON.parse(text);
  } catch {
    current = null;
  }
  const list = Array.isArray(current) ? [...current, skeleton] : [skeleton];
  return JSON.stringify(list, null, 2);
}

/** "src/config.ts:12" or "src/config.ts:12-14". */
export function locationLabel(loc: { file: string; start_line: number; end_line?: number }): string {
  const end = loc.end_line ?? loc.start_line;
  return end !== loc.start_line ? `${loc.file}:${loc.start_line}-${end}` : `${loc.file}:${loc.start_line}`;
}

/** The banner's subject: the first expectation (positive) or the forbidden location (negative). */
export function bannerLocation(c: {
  kind: EvalExpectationKind;
  expected_output: EvalExpectedFinding[];
  forbidden_location?: EvalLocation | null;
}): { title: string | null; location: string | null } {
  if (c.kind === "must_find") {
    const first = c.expected_output[0];
    return first ? { title: first.title, location: locationLabel(first) } : { title: null, location: null };
  }
  return {
    title: null,
    location: c.forbidden_location ? locationLabel(c.forbidden_location) : null,
  };
}

export type DiffLineKind = "add" | "del" | "hunk" | "header" | "context";

/** Classify one unified-diff line for colouring. */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git")) return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/** Editable form state of a case (camelCase local state; DTO fields stay snake_case). */
export interface CaseFormState {
  name: string;
  kind: EvalExpectationKind;
  diff: string;
  files: EvalInputFile[];
  meta: EvalPrMeta;
  expectedText: string;
  forbidden: { file: string; start: string; end: string };
  notes: string;
}

export function formStateFrom(input: EvalCaseInputBody): CaseFormState {
  const f = input.forbidden_location;
  return {
    name: input.name,
    kind: input.kind,
    diff: input.input_diff,
    files: input.input_files ?? [],
    meta: input.input_meta,
    expectedText: JSON.stringify(input.expected_output, null, 2),
    forbidden: {
      file: f?.file ?? "",
      start: f ? String(f.start_line) : "",
      end: f ? String(f.end_line) : "",
    },
    notes: input.notes ?? "",
  };
}

/** The optional forbidden location from the form ("" file = none). */
function forbiddenFrom(f: CaseFormState["forbidden"]): EvalLocation | null {
  if (!f.file.trim()) return null;
  const start = Number(f.start);
  const end = f.end.trim() ? Number(f.end) : start;
  return { file: f.file.trim(), start_line: start, end_line: end };
}

export type FormValidation =
  | { ok: true; input: EvalCaseInput }
  | { ok: false; reason: "name" | "invalid_json" | "wrong_shape" | "kind_rule" | "diff" | "other" };

/** Validate the whole form with the shared `EvalCaseInput` contract (the server runs the same). */
export function validateForm(state: CaseFormState): FormValidation {
  if (!state.name.trim()) return { ok: false, reason: "name" };
  const expected = parseExpected(state.expectedText, state.kind);
  if (!expected.ok) return { ok: false, reason: expected.error };
  if (!state.diff.trim()) return { ok: false, reason: "diff" };
  const parsed = EvalCaseInput.safeParse({
    name: state.name.trim(),
    kind: state.kind,
    input_diff: state.diff,
    input_files: state.files.filter((f) => f.path.trim()),
    input_meta: state.meta,
    expected_output: expected.value,
    forbidden_location: state.kind === "must_not_flag" ? forbiddenFrom(state.forbidden) : null,
    notes: state.notes.trim() ? state.notes : null,
  });
  return parsed.success ? { ok: true, input: parsed.data } : { ok: false, reason: "other" };
}

/** A saved case as form input. */
export function caseInputFrom(c: EvalCaseRecord): EvalCaseInputBody {
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

/** The blank hand-made case (a must_find with one skeleton expectation to fill in). */
export const EMPTY_CASE: EvalCaseInputBody = {
  name: "",
  kind: "must_find",
  input_diff: "",
  input_files: [],
  input_meta: { title: "", number: null, description: null, author: null },
  expected_output: [],
  forbidden_location: null,
  notes: null,
};
