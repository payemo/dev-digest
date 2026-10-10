/* eval-format.ts — pure display formatting for eval metrics, shared by the
   agent Evals tab and the eval dashboard/detail routes. A metric that is not
   applicable (null) always renders as "—", never 0. */

/** 0.82 → "82%"; null → "—". */
export function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** 0.82 → "82"; null → null (the caller renders "—" without a "%" suffix). */
export function pctNumber(v: number | null | undefined): string | null {
  return v == null ? null : String(Math.round(v * 100));
}

/** Signed whole-point delta: 0.04 → "+4pt", -0.02 → "-2pt", 0 → "0pt"; null → null. */
export function pointsDelta(d: number | null | undefined): string | null {
  if (d == null) return null;
  const pts = Math.round(d * 100);
  return `${pts > 0 ? "+" : ""}${pts}pt`;
}

/** USD cost; null → "—" (unavailable, never $0). Sub-cent costs keep 4 decimals. */
export function costLabel(v: number | null | undefined): string {
  if (v == null) return "—";
  return v > 0 && v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

/** Signed USD delta; null → null. */
export function costDelta(d: number | null | undefined): string | null {
  if (d == null) return null;
  const sign = d > 0 ? "+" : d < 0 ? "-" : "";
  return `${sign}${costLabel(Math.abs(d))}`;
}

/** 1834 → "1.8s". */
export function durationLabel(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/** ISO timestamp → "2026-05-29 09:14" (local time). */
export function dateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
