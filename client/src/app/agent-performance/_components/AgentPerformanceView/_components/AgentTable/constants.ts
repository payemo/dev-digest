import type { SortDir, SortKey } from "./helpers";

export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: "runs", dir: "desc" };

export const COLUMNS: { id: string; labelKey: string; sort?: SortKey }[] = [
  { id: "agent", labelKey: "table.agent" },
  { id: "runs", labelKey: "table.runs", sort: "runs" },
  { id: "avgCost", labelKey: "table.avgCost", sort: "avgCost" },
  { id: "avgDuration", labelKey: "table.avgDuration" },
  { id: "accept", labelKey: "table.accept", sort: "accept" },
  { id: "lastRun", labelKey: "table.lastRun", sort: "lastRun" },
  { id: "view", labelKey: "table.view" },
];
