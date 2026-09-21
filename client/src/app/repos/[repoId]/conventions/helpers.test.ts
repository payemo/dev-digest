import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import {
  confidencePercent,
  countByStatus,
  evidenceGithubUrl,
  evidenceLabel,
  filterCandidates,
} from "./helpers";

function candidate(overrides: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    repo_id: "r1",
    category: "errors",
    rule: "Use async/await instead of .then() chains.",
    rationale: null,
    evidence_path: "src/api/users.ts",
    evidence_line: 23,
    evidence_snippet: "const user = await db.users.find(id);",
    confidence: 0.85,
    status: "pending",
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("countByStatus", () => {
  it("tallies each status and the total", () => {
    const counts = countByStatus([
      candidate({ id: "1", status: "pending" }),
      candidate({ id: "2", status: "approved" }),
      candidate({ id: "3", status: "approved" }),
      candidate({ id: "4", status: "rejected" }),
    ]);
    expect(counts).toEqual({ pending: 1, approved: 2, rejected: 1, total: 4 });
  });

  it("returns all zeros for an empty list", () => {
    expect(countByStatus([])).toEqual({ pending: 0, approved: 0, rejected: 0, total: 0 });
  });
});

describe("filterCandidates", () => {
  const all = [
    candidate({ id: "1", status: "pending" }),
    candidate({ id: "2", status: "approved" }),
    candidate({ id: "3", status: "rejected" }),
  ];

  it("returns everything for 'all'", () => {
    expect(filterCandidates(all, "all")).toHaveLength(3);
  });

  it("returns only the matching status otherwise", () => {
    expect(filterCandidates(all, "approved").map((c) => c.id)).toEqual(["2"]);
    expect(filterCandidates(all, "rejected").map((c) => c.id)).toEqual(["3"]);
    expect(filterCandidates(all, "pending").map((c) => c.id)).toEqual(["1"]);
  });
});

describe("confidencePercent", () => {
  it("converts 0..1 to a rounded percentage", () => {
    expect(confidencePercent(0.85)).toBe(85);
    expect(confidencePercent(1)).toBe(100);
    expect(confidencePercent(0)).toBe(0);
  });

  it("clamps out-of-range values and treats null as 0", () => {
    expect(confidencePercent(1.5)).toBe(100);
    expect(confidencePercent(-0.2)).toBe(0);
    expect(confidencePercent(null)).toBe(0);
  });
});

describe("evidenceLabel", () => {
  it("joins path and line", () => {
    expect(evidenceLabel({ evidence_path: "src/a.ts", evidence_line: 5 })).toBe("src/a.ts:5");
  });

  it("falls back to the bare path when there is no line", () => {
    expect(evidenceLabel({ evidence_path: "src/a.ts", evidence_line: null })).toBe("src/a.ts");
  });

  it("is empty when there is no evidence path", () => {
    expect(evidenceLabel({ evidence_path: null, evidence_line: null })).toBe("");
  });
});

describe("evidenceGithubUrl", () => {
  it("builds a blob URL pinned to the default branch, with a line anchor", () => {
    const url = evidenceGithubUrl("acme/app", "main", { evidence_path: "src/a.ts", evidence_line: 5 });
    expect(url).toBe("https://github.com/acme/app/blob/main/src/a.ts#L5");
  });

  it("returns null without a path or without a repo full name", () => {
    expect(evidenceGithubUrl("acme/app", "main", { evidence_path: null, evidence_line: null })).toBeNull();
    expect(evidenceGithubUrl("", "main", { evidence_path: "src/a.ts", evidence_line: 5 })).toBeNull();
  });
});
