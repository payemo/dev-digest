/**
 * countBySeverity — the group-by behind every severity counter/pill in the
 * app (PR list column, Timeline tiles, per-run accordion chips). Must stay a
 * plain COUNT/filter over already-loaded findings: no LLM call, no network.
 */
import { describe, it, expect } from "vitest";
import type { Finding } from "@devdigest/shared";
import { countBySeverity } from "./FindingsSummary";

function finding(severity: Finding["severity"]): Finding {
  return {
    id: `f-${severity}-${Math.random()}`,
    severity,
    category: "security",
    title: "x",
    file: "x.ts",
    start_line: 1,
    end_line: 1,
    rationale: "x",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
  };
}

describe("countBySeverity", () => {
  it("groups findings by severity", () => {
    const counts = countBySeverity([
      finding("CRITICAL"),
      finding("CRITICAL"),
      finding("WARNING"),
      finding("SUGGESTION"),
    ]);
    expect(counts).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it("returns all-zero counts for an empty list", () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});
