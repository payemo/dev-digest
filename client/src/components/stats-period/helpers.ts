import type { StatsWindow } from "@devdigest/shared";
import {
  DEFAULT_PERIOD,
  FROM_PARAM,
  MAX_CUSTOM_DAYS,
  PERIODS,
  PERIOD_PARAM,
  PRESET_DAYS,
  TO_PARAM,
  type StatsPeriod,
} from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The period as it lives in the URL: custom dates are local `YYYY-MM-DD`. */
export interface PeriodState {
  period: StatsPeriod;
  from: string | null;
  to: string | null;
}

/** `now` with seconds and milliseconds dropped, so a window's query key is stable. */
export function truncateToMinute(now: Date): Date {
  const d = new Date(now.getTime());
  d.setSeconds(0, 0);
  return d;
}

/** Local midnight of a `YYYY-MM-DD` date, or null when it isn't a real date. */
export function parseLocalDate(value: string | null | undefined): Date | null {
  const m = value ? DATE_RE.exec(value) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(y, mo, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date;
}

/** A local date as `YYYY-MM-DD`. */
export function formatLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The `[from, to)` window for a period, as ISO strings.
 *   1d / 30d → rolling, ending at `now` truncated to the minute
 *   custom   → local midnight of the start date to local midnight after the
 *              (inclusive) end date; null when incomplete, reversed or longer
 *              than the server accepts — so no request is fired for it.
 */
export function windowFor(
  period: StatsPeriod,
  customFrom: string | null,
  customTo: string | null,
  now: Date,
): StatsWindow | null {
  if (period !== "custom") {
    const to = truncateToMinute(now);
    const from = new Date(to.getTime() - PRESET_DAYS[period] * DAY_MS);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const start = parseLocalDate(customFrom);
  const end = parseLocalDate(customTo);
  if (!start || !end) return null;
  const after = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  if (start.getTime() >= after.getTime()) return null;
  if (after.getTime() - start.getTime() > MAX_CUSTOM_DAYS * DAY_MS) return null;
  return { from: start.toISOString(), to: after.toISOString() };
}

/** Read the period from search params; unknown values fall back to the default. */
export function readPeriodState(params: URLSearchParams): PeriodState {
  const raw = params.get(PERIOD_PARAM);
  const period = (PERIODS as readonly string[]).includes(raw ?? "")
    ? (raw as StatsPeriod)
    : DEFAULT_PERIOD;
  return {
    period,
    from: period === "custom" ? params.get(FROM_PARAM) : null,
    to: period === "custom" ? params.get(TO_PARAM) : null,
  };
}

/**
 * Write the period into `base` (other params, e.g. `tab`, are kept) and return
 * the query string. With no `base` it serialises just the period — what a link
 * to another stats page carries so it opens on the same window.
 */
export function periodSearchParams(state: PeriodState, base?: URLSearchParams): string {
  const sp = new URLSearchParams(base?.toString() ?? "");
  sp.set(PERIOD_PARAM, state.period);
  sp.delete(FROM_PARAM);
  sp.delete(TO_PARAM);
  if (state.period === "custom") {
    if (state.from) sp.set(FROM_PARAM, state.from);
    if (state.to) sp.set(TO_PARAM, state.to);
  }
  return sp.toString();
}

/** Default custom range when switching to Custom: the last 30 local days, inclusive. */
export function defaultCustomRange(now: Date): { from: string; to: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (PRESET_DAYS["30d"] - 1));
  return { from: formatLocalDate(start), to: formatLocalDate(now) };
}

/** An accept rate (0..1) as the integer percent both stats pages display. */
export function ratePct(rate: number): number {
  return Math.round(rate * 100);
}

/** "61%", or "—" for a null rate (no decisions) — never a misleading "0%". */
export function formatRatePct(rate: number | null | undefined): string {
  return rate == null ? "—" : `${ratePct(rate)}%`;
}
