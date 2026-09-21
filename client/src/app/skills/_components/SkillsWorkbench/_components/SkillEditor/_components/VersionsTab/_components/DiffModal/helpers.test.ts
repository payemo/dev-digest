import { describe, it, expect } from "vitest";
import { computeLineDiff } from "./helpers";

describe("computeLineDiff", () => {
  it("marks a line only in the base as removed", () => {
    const lines = computeLineDiff("a\nb", "a");
    expect(lines).toEqual([
      { kind: "context", text: "a" },
      { kind: "del", text: "b" },
    ]);
  });

  it("marks a line only in current as added", () => {
    const lines = computeLineDiff("a", "a\nb");
    expect(lines).toEqual([
      { kind: "context", text: "a" },
      { kind: "add", text: "b" },
    ]);
  });

  it("returns no del/add lines for identical text", () => {
    const lines = computeLineDiff("a\nb\nc", "a\nb\nc");
    expect(lines.every((l) => l.kind === "context")).toBe(true);
  });

  it("produces no phantom trailing blank line", () => {
    const lines = computeLineDiff("a\nb", "a\nb");
    expect(lines).toHaveLength(2);
  });
});
