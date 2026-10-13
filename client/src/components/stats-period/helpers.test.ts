import { describe, it, expect } from "vitest";
import { periodSearchParams, readPeriodState, windowFor } from "./helpers";

/* The `[from, to)` window both stats pages send, and the URL form a View link
   carries. Breakage covered: a preset window of the wrong length or with a
   moving (unstable) end, a custom range off by a day or in UTC instead of
   local midnight, an invalid range still firing a request, and the period
   params clobbering `tab` or leaking stale custom dates. */

const NOW = new Date("2026-10-13T12:34:56.789Z");

describe("windowFor", () => {
  it("rolls presets back from now, truncated to the minute", () => {
    expect(windowFor("1d", null, null, NOW)).toEqual({
      from: "2026-10-12T12:34:00.000Z",
      to: "2026-10-13T12:34:00.000Z",
    });
    expect(windowFor("30d", null, null, NOW)).toEqual({
      from: "2026-09-13T12:34:00.000Z",
      to: "2026-10-13T12:34:00.000Z",
    });
    // Seconds don't move the window (stable query key)
    expect(windowFor("30d", null, null, new Date("2026-10-13T12:34:01.000Z"))).toEqual(
      windowFor("30d", null, null, NOW),
    );
  });

  it("maps a custom range to local midnight of the start through local midnight after the inclusive end", () => {
    expect(windowFor("custom", "2026-10-01", "2026-10-07", NOW)).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 9, 8).toISOString(),
    });
    // A single day is a valid one-day range
    expect(windowFor("custom", "2026-10-01", "2026-10-01", NOW)).toEqual({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 9, 2).toISOString(),
    });
  });

  it("returns null (fetch nothing) for incomplete, reversed, impossible or too-long custom ranges", () => {
    expect(windowFor("custom", null, "2026-10-07", NOW)).toBeNull();
    expect(windowFor("custom", "2026-10-01", "", NOW)).toBeNull();
    expect(windowFor("custom", "2026-10-07", "2026-10-01", NOW)).toBeNull();
    expect(windowFor("custom", "2026-02-30", "2026-03-02", NOW)).toBeNull();
    expect(windowFor("custom", "2025-01-01", "2026-01-02", NOW)).toBeNull(); // 367 days
    expect(windowFor("custom", "2025-01-01", "2026-01-01", NOW)).not.toBeNull(); // 366 days
  });
});

describe("periodSearchParams / readPeriodState", () => {
  it("round-trips presets and custom ranges through the URL", () => {
    for (const state of [
      { period: "1d" as const, from: null, to: null },
      { period: "30d" as const, from: null, to: null },
      { period: "custom" as const, from: "2026-10-01", to: "2026-10-07" },
    ]) {
      expect(readPeriodState(new URLSearchParams(periodSearchParams(state)))).toEqual(state);
    }
  });

  it("keeps unrelated params like tab and drops stale custom dates when switching to a preset", () => {
    const base = new URLSearchParams("tab=stats&period=custom&from=2026-10-01&to=2026-10-07");
    const sp = new URLSearchParams(periodSearchParams({ period: "1d", from: null, to: null }, base));
    expect(sp.get("tab")).toBe("stats");
    expect(sp.get("period")).toBe("1d");
    expect(sp.has("from")).toBe(false);
    expect(sp.has("to")).toBe(false);
  });

  it("falls back to 30 days for a missing or unknown period and ignores dates outside custom", () => {
    expect(readPeriodState(new URLSearchParams(""))).toEqual({ period: "30d", from: null, to: null });
    expect(readPeriodState(new URLSearchParams("period=7d&from=2026-10-01&to=2026-10-02"))).toEqual({
      period: "30d",
      from: null,
      to: null,
    });
  });
});
