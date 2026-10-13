import { describe, it, expect } from "vitest";
import type { AgentStats } from "@devdigest/shared";
import { makeAgentStats } from "@/test/agent-performance-fixtures";
import { sortRows } from "./helpers";

/* Pure table sorting. Breakage covered: a low-sample (e.g. 1-of-1) agent
   outranking agents with real evidence in either sort direction (R10), and
   null costs / never-run agents sorting to the top. */

const row = (agent_name: string, o: Partial<AgentStats>) =>
  makeAgentStats({ agent_id: agent_name, agent_name, ...o });

const RANKED_HIGH = row("Ranked high", { accept_rate: 0.9, decisions: 20, low_sample: false });
const RANKED_LOW = row("Ranked low", { accept_rate: 0.5, decisions: 12, low_sample: false });
const LOW_PERFECT = row("Low perfect", { accept_rate: 1, decisions: 1, low_sample: true });
const LOW_MORE = row("Low more", { accept_rate: 0.5, decisions: 8, low_sample: true });
const NO_RUNS = row("No runs", {
  runs: 0,
  accept_rate: null,
  decisions: 0,
  low_sample: true,
  avg_cost_usd: null,
  last_run_at: null,
});
const ALL = [NO_RUNS, LOW_PERFECT, RANKED_LOW, LOW_MORE, RANKED_HIGH];
const names = (rows: AgentStats[]) => rows.map((r) => r.agent_name);

describe("sortRows", () => {
  it("ranks only agents with enough decisions by accept rate, then low-sample by decisions, then no-run agents — both directions", () => {
    expect(names(sortRows(ALL, "accept", "desc"))).toEqual([
      "Ranked high",
      "Ranked low",
      "Low more",
      "Low perfect",
      "No runs",
    ]);
    expect(names(sortRows(ALL, "accept", "asc"))).toEqual([
      "Ranked low",
      "Ranked high",
      "Low more",
      "Low perfect",
      "No runs",
    ]);
  });

  it("keeps null costs and never-run agents last whichever way cost or last run is sorted", () => {
    const priced = [row("Cheap", { avg_cost_usd: 0.001 }), NO_RUNS, row("Dear", { avg_cost_usd: 0.1 })];
    expect(names(sortRows(priced, "avgCost", "desc"))).toEqual(["Dear", "Cheap", "No runs"]);
    expect(names(sortRows(priced, "avgCost", "asc"))).toEqual(["Cheap", "Dear", "No runs"]);

    const dated = [
      row("Old", { last_run_at: "2026-10-01T00:00:00Z" }),
      NO_RUNS,
      row("New", { last_run_at: "2026-10-12T00:00:00Z" }),
    ];
    expect(names(sortRows(dated, "lastRun", "desc"))).toEqual(["New", "Old", "No runs"]);
    expect(names(sortRows(dated, "lastRun", "asc"))).toEqual(["Old", "New", "No runs"]);
  });
});
