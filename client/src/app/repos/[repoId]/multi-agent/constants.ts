/* Multi-Agent Review route constants. Identity colours are CSS tokens defined
   in app/globals.css (never hex here); icons are @devdigest/ui Icon names. */
import type { IconName } from "@devdigest/ui";

/** Per-agent identity colour, indexed by a stable hash of the agent. */
export const AGENT_IDENTITY_COLORS = [
  "var(--agent-1)",
  "var(--agent-2)",
  "var(--agent-3)",
  "var(--agent-4)",
  "var(--agent-5)",
  "var(--agent-6)",
] as const;

/** Tinted background matching AGENT_IDENTITY_COLORS by index. */
export const AGENT_IDENTITY_BGS = [
  "var(--agent-1-bg)",
  "var(--agent-2-bg)",
  "var(--agent-3-bg)",
  "var(--agent-4-bg)",
  "var(--agent-5-bg)",
  "var(--agent-6-bg)",
] as const;

/** Per-agent identity icon, indexed by the same hash. */
export const AGENT_IDENTITY_ICONS: readonly IconName[] = [
  "Shield",
  "Zap",
  "Lightbulb",
  "Users",
  "Layers",
  "Boxes",
];

/** Results view modes (`?view=`). */
export const RESULT_VIEWS = ["columns", "tabs"] as const;
export type ResultView = (typeof RESULT_VIEWS)[number];

/** Search params the results page reads (`?view=&agent=&finding=&trace=`). */
export const PARAM = {
  view: "view",
  agent: "agent",
  finding: "finding",
  trace: "trace",
} as const;

/** Status colour tokens for a parent run or a child column. Labels live in messages. */
export const STATUS_COLOR: Record<string, string> = {
  running: "var(--pending)",
  done: "var(--ok)",
  partial: "var(--warn)",
  failed: "var(--failed)",
  cancelled: "var(--stale)",
};

/** Severity icon + colour token for compact finding rows. */
export const SEVERITY_ICON: Record<string, { icon: IconName; color: string }> = {
  CRITICAL: { icon: "AlertOctagon", color: "var(--crit)" },
  WARNING: { icon: "AlertTriangle", color: "var(--warn)" },
  SUGGESTION: { icon: "Lightbulb", color: "var(--sugg)" },
};
export const SEVERITY_ICON_FALLBACK = { icon: "Info" as IconName, color: "var(--text-muted)" };

/** Base height (px) of the live log shown for a running run (Tabs view doubles it). */
export const COLUMN_LOG_HEIGHT = 160;
