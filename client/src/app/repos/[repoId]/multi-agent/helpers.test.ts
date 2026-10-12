import { describe, it, expect } from "vitest";
import type { MultiAgentCandidate } from "@devdigest/shared";
import { agentIdentity, formatCostEstimate, readView, selectionTotals, withParams } from "./helpers";

function c(id: string, ms: number | null, usd: number | null, n = 5): MultiAgentCandidate {
  return {
    agent_id: id,
    agent_name: id,
    provider: "openai",
    model: "m",
    description: "",
    latest_summary: null,
    estimate: { avg_duration_ms: ms, avg_cost_usd: usd, sample_size: n },
  };
}

describe("agentIdentity", () => {
  it("is deterministic and only uses tokens", () => {
    const a = agentIdentity("agent-1", "Security");
    expect(agentIdentity("agent-1", "Renamed")).toEqual(a);
    expect(a.color).toMatch(/^var\(--agent-\d\)$/);
    expect(a.bg).toMatch(/^var\(--agent-\d-bg\)$/);
    expect(agentIdentity(null, "Security")).toEqual(agentIdentity(null, "Security"));
  });
});

describe("selectionTotals", () => {
  const all = [c("a", 8200, 0.06), c("b", 7400, 0.05), c("c", 6900, 0.04), c("d", 7100, 0.05)];

  it("takes the max duration and sums cost of ticked agents only (AC-11)", () => {
    expect(selectionTotals(all, ["a", "b", "c", "d"])).toEqual({ durationMs: 8200, costUsd: 0.2, partial: false });
    expect(selectionTotals(all, ["b", "c"])).toEqual({ durationMs: 7400, costUsd: 0.09, partial: false });
  });

  it("is partial when a ticked agent has no estimate (AC-12)", () => {
    const withNone = [...all, c("e", null, null, 0)];
    expect(selectionTotals(withNone, ["a", "e"])).toEqual({ durationMs: 8200, costUsd: 0.06, partial: true });
    expect(selectionTotals(withNone, ["e"])).toEqual({ durationMs: null, costUsd: null, partial: true });
  });
});

describe("formatCostEstimate / readView / withParams", () => {
  it("formats estimates to cents and unknown as null", () => {
    expect(formatCostEstimate(0.2)).toBe("$0.20");
    expect(formatCostEstimate(null)).toBeNull();
  });
  it("reads and writes the results search params", () => {
    expect(readView(new URLSearchParams(""))).toBe("columns");
    expect(readView(new URLSearchParams("view=tabs"))).toBe("tabs");
    const sp = withParams(new URLSearchParams("trace=x"), { view: "tabs", agent: "r1", trace: null });
    expect(sp.toString()).toBe("view=tabs&agent=r1");
  });
});
