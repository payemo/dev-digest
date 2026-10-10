import type { CSSProperties } from "react";

export const s = {
  panel: { paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  files: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  notice: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    padding: "8px 10px",
    borderRadius: 7,
    background: "var(--bg-surface)",
    border: "1px dashed var(--border-strong)",
  } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  fileRow: { fontSize: 13, padding: "6px 0", color: "var(--text-primary)" } satisfies CSSProperties,
  fileEdit: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  meta: { display: "grid", gridTemplateColumns: "110px 1fr", gap: "8px 12px", margin: 0, fontSize: 13 } satisfies CSSProperties,
  metaKey: { color: "var(--text-muted)" } satisfies CSSProperties,
  metaVal: { margin: 0, color: "var(--text-primary)" } satisfies CSSProperties,
} as const;
