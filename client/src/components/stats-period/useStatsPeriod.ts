/* useStatsPeriod — the stats period in the URL (`?period=…&from=…&to=…`),
   shared by the Agent Performance dashboard and the agent Stats tab. Writes
   with router.replace and keeps every other search param (`tab`). */
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { StatsWindow } from "@devdigest/shared";
import { ROLLING_REANCHOR_MS, type StatsPeriod } from "./constants";
import {
  defaultCustomRange,
  periodSearchParams,
  readPeriodState,
  truncateToMinute,
  windowFor,
  type PeriodState,
} from "./helpers";

export interface StatsPeriodApi {
  state: PeriodState;
  period: StatsPeriod;
  setPeriod: (period: StatsPeriod) => void;
  customRange: { from: string | null; to: string | null };
  setCustomRange: (from: string, to: string) => void;
  /** null for an incomplete or invalid custom range — fetch nothing then. */
  window: StatsWindow | null;
}

export function useStatsPeriod(): StatsPeriodApi {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const params = useSearchParams();
  const search = new URLSearchParams(params?.toString() ?? "");
  const state = readPeriodState(search);
  // The rolling window's end, truncated to the minute so it (and its query key)
  // doesn't move on every render. It is re-anchored when the user picks a
  // period and, for a rolling preset, once a minute while the page is visible
  // and when it becomes visible again — otherwise a run that finishes after the
  // page opened is outside the window and never shows up.
  const [anchor, setAnchor] = useState(() => truncateToMinute(new Date()));
  const rolling = state.period !== "custom";

  useEffect(() => {
    if (!rolling) return;
    const reanchor = () => {
      if (document.visibilityState !== "visible") return;
      const now = truncateToMinute(new Date());
      setAnchor((cur) => (cur.getTime() === now.getTime() ? cur : now));
    };
    const id = window.setInterval(reanchor, ROLLING_REANCHOR_MS);
    document.addEventListener("visibilitychange", reanchor);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", reanchor);
    };
  }, [rolling]);

  const write = (next: PeriodState) => {
    router.replace(`${pathname}?${periodSearchParams(next, search)}`);
  };

  const setPeriod = (period: StatsPeriod) => {
    const now = truncateToMinute(new Date());
    setAnchor(now);
    if (period === "custom") {
      const range = state.from && state.to ? { from: state.from, to: state.to } : defaultCustomRange(now);
      write({ period, ...range });
    } else {
      write({ period, from: null, to: null });
    }
  };

  const setCustomRange = (from: string, to: string) => write({ period: "custom", from, to });

  return {
    state,
    period: state.period,
    setPeriod,
    customRange: { from: state.from, to: state.to },
    setCustomRange,
    window: windowFor(state.period, state.from, state.to, anchor),
  };
}
