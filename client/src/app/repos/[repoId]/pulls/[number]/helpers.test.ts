/* The PR page's deep-link URL contract (`?tab=diff&file=<path>&line=<n>`, D9).
   A reload must land on the same file and line, a hostile or malformed `line`
   must not become a target line, and leaving the Files tab must drop the
   target so it does not re-fire later. */
import { describe, it, expect } from "vitest";
import { readDiffTarget, withDiffTarget, withoutDiffTarget } from "./helpers";

describe("PR route deep-link helpers", () => {
  it("round-trips a file and line through the URL, keeping unrelated params", () => {
    const next = withDiffTarget(new URLSearchParams("tab=overview&agent=a1"), "src/config.ts", 12);
    expect(next.get("tab")).toBe("diff");
    expect(next.get("agent")).toBe("a1");
    // What a reload would parse back.
    expect(readDiffTarget(new URLSearchParams(next.toString()))).toEqual({
      file: "src/config.ts",
      line: 12,
    });

    // A path with URL-significant characters survives encoding.
    const odd = withDiffTarget(new URLSearchParams(), "src/a b&c=d.ts", null);
    expect(readDiffTarget(new URLSearchParams(odd.toString()))).toEqual({
      file: "src/a b&c=d.ts",
      line: null,
    });
  });

  it("drops a stale line when re-targeting without one, and does not mutate its input", () => {
    const input = new URLSearchParams("tab=diff&file=a.ts&line=7");
    const next = withDiffTarget(input, "b.ts", null);
    expect(next.has("line")).toBe(false);
    expect(next.get("file")).toBe("b.ts");
    expect(input.get("line")).toBe("7");
  });

  it("reads a non-positive-integer line as no line, and no file as no target", () => {
    for (const bad of ["0", "-3", "1.5", "12abc", "", "1e3"]) {
      expect(readDiffTarget(new URLSearchParams({ file: "a.ts", line: bad }))).toEqual({
        file: "a.ts",
        line: null,
      });
    }
    expect(readDiffTarget(new URLSearchParams("tab=diff&line=4"))).toBeNull();
    expect(readDiffTarget(new URLSearchParams("tab=diff&file="))).toBeNull();
  });

  it("withoutDiffTarget removes file and line but nothing else", () => {
    const next = withoutDiffTarget(new URLSearchParams("tab=diff&file=a.ts&line=3&agent=x"));
    expect(next.toString()).toBe("tab=diff&agent=x");
  });
});
