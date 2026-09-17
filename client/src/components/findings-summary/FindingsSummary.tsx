/* FindingsSummary — one run's findings as severity icon+count badges, with a
   read-only preview card on hover. Shared by the PR list's FINDINGS column and
   the PR timeline's run tiles; both are display-only, so nothing here is
   clickable. Accept/Reject live on the real FindingCard inside a review run.

   The card is positioned `fixed` off the trigger's rect on purpose: the PR list
   table clips overflow, so an absolutely-positioned card would be cut off. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge, CategoryTag, ConfidenceNum, type Category } from "@devdigest/ui";
import type { Finding, Severity } from "@devdigest/shared";

const WIDTH = 380;

/** Severity display order (worst first). */
const SEVERITIES: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Tally findings by severity — a plain group-by, never an LLM call. */
export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

export function FindingsSummary({
  findings,
  empty = null,
}: {
  findings: Finding[];
  /** Rendered when the run produced no findings (e.g. a "—" placeholder). */
  empty?: React.ReactNode;
}) {
  const t = useTranslations("prReview");
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  const open = React.useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 12)),
    });
  }, []);

  if (findings.length === 0) return <>{empty}</>;
  const counts = countBySeverity(findings);

  return (
    <span
      ref={anchorRef}
      data-findings-summary
      onMouseEnter={open}
      onMouseLeave={() => setPos(null)}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
        <SeverityBadge key={s} severity={s} count={counts[s]} compact />
      ))}
      {pos && (
        <div role="tooltip" style={cardStyle(pos)}>
          <div style={headerStyle}>{t("findingsPopover.title", { count: findings.length })}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {findings.map((f) => (
              <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <SeverityBadge severity={f.severity} compact />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    {f.title}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CategoryTag category={f.category as Category} />
                  <span className="mono" style={{ fontSize: 12, color: "var(--accent-text)" }}>
                    {f.file}:
                    {f.start_line === f.end_line
                      ? f.start_line
                      : `${f.start_line}-${f.end_line}`}
                  </span>
                  <ConfidenceNum value={f.confidence} />
                </div>
                <p style={rationaleStyle}>{f.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

const cardStyle = (pos: { top: number; left: number }): React.CSSProperties => ({
  position: "fixed",
  top: pos.top,
  left: pos.left,
  width: WIDTH,
  maxHeight: 420,
  overflowY: "auto",
  zIndex: 60,
  padding: 12,
  borderRadius: 10,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-elevated)",
  boxShadow: "0 12px 32px rgba(0,0,0,.45)",
  cursor: "default",
});

const headerStyle: React.CSSProperties = {
  marginBottom: 10,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const rationaleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--text-secondary)",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
