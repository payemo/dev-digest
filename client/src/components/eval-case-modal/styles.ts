import type { CSSProperties } from "react";
import type { DiffLineKind } from "./helpers";

const DIFF_LINE: Record<DiffLineKind, CSSProperties> = {
  add: { background: "var(--code-add)", color: "var(--code-add-text)" },
  del: { background: "var(--code-del)", color: "var(--code-del-text)" },
  hunk: { color: "var(--accent-text)" },
  header: { color: "var(--text-secondary)", fontWeight: 600 },
  context: {},
};

export const s = {
  grid: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", minHeight: 460 } satisfies CSSProperties,
  left: { padding: "18px 20px", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } satisfies CSSProperties,
  right: { padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  required: { color: "var(--crit)", marginLeft: 2 } satisfies CSSProperties,
  fieldError: { fontSize: 12, color: "var(--crit)", marginTop: 4 } satisfies CSSProperties,
  kindRow: { display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerSpacer: { flex: 1 } satisfies CSSProperties,
  toggleLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  pre: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    background: "var(--code-bg)",
    border: "1px solid var(--border)",
    fontSize: 12.5,
    lineHeight: 1.6,
    overflow: "auto",
    maxHeight: 300,
    whiteSpace: "pre",
  } satisfies CSSProperties,
  diffLine: (kind: DiffLineKind): CSSProperties => ({ display: "block", padding: "0 4px", ...DIFF_LINE[kind] }),
  state: { padding: 28, fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
  refusal: { padding: 28, display: "flex", gap: 10, alignItems: "flex-start", color: "var(--crit)", fontSize: 14 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
