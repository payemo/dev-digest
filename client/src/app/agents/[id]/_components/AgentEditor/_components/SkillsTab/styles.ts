import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: 24, maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", marginBottom: 4 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)", marginBottom: 18, lineHeight: 1.45 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 8,
  } satisfies CSSProperties,
  reorderCol: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  description: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  meta: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  attachedSection: { marginBottom: 24 } satisfies CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 10px" } satisfies CSSProperties,
  browseRow: { display: "flex", justifyContent: "flex-end", marginBottom: 10 } satisfies CSSProperties,
} as const;
