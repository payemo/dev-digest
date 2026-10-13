import { describe, it, expect } from "vitest";
import { relativeAgo } from "./helpers";

/* Pure Last-run formatting. Breakage covered: the just now / minutes / hours /
   days bucket boundaries, and a never-run agent getting a time instead of
   null. */

describe("relativeAgo", () => {
  it("buckets into just now / minutes / hours / days, and null for no run", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(relativeAgo(null, now)).toBeNull();
    expect(relativeAgo("2026-10-13T11:59:30Z", now)).toEqual({ unit: "justNow" });
    expect(relativeAgo("2026-10-13T11:01:00Z", now)).toEqual({ unit: "minutes", n: 59 });
    expect(relativeAgo("2026-10-13T11:00:00Z", now)).toEqual({ unit: "hours", n: 1 });
    expect(relativeAgo("2026-10-11T11:00:00Z", now)).toEqual({ unit: "days", n: 2 });
  });
});
