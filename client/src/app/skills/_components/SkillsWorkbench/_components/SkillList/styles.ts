import type { CSSProperties } from "react";

/** Co-located styles for SkillList. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%" } satisfies CSSProperties,
  header: { padding: "16px 16px 12px" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  scroll: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
} as const;
