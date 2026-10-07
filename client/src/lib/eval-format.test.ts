import { describe, it, expect } from "vitest";
import { costDelta, costLabel, pct, pointsDelta } from "./eval-format";

describe("eval-format", () => {
  it("not-applicable values render as an em dash, never 0", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
    expect(costLabel(null)).toBe("—");
    expect(pointsDelta(null)).toBeNull();
    expect(costDelta(null)).toBeNull();
  });

  it("formats metrics as whole percents and signed whole points", () => {
    expect(pct(0)).toBe("0%");
    expect(pct(0.824)).toBe("82%");
    expect(pointsDelta(0.04)).toBe("+4pt");
    expect(pointsDelta(-0.02)).toBe("-2pt");
    expect(pointsDelta(0)).toBe("0pt");
  });

  it("formats cost in dollars, keeping sub-cent precision", () => {
    expect(costLabel(0.23)).toBe("$0.23");
    expect(costLabel(0.004)).toBe("$0.0040");
    expect(costDelta(-0.05)).toBe("-$0.05");
  });
});
