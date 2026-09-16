import { describe, it, expect } from "vitest";
import { formatUsd, formatTokenCount, formatTokensCompact } from "./format";

describe("formatUsd", () => {
  it("renders null/undefined as a dash", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
  });

  it("renders NaN as a dash", () => {
    expect(formatUsd(NaN)).toBe("—");
  });

  it("renders exactly 0 as $0.00, not a dash", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("scales precision with magnitude", () => {
    expect(formatUsd(0.0013)).toBe("$0.0013");
    expect(formatUsd(0.014)).toBe("$0.014");
    expect(formatUsd(12.4)).toBe("$12.40");
  });

  it("floors a vanishingly small positive value instead of showing $0.0000", () => {
    expect(formatUsd(0.00002)).toBe("<$0.0001");
  });
});

describe("formatTokenCount", () => {
  it("groups thousands", () => {
    expect(formatTokenCount(9119)).toBe("9,119");
    expect(formatTokenCount(1000000)).toBe("1,000,000");
    expect(formatTokenCount(0)).toBe("0");
  });
});

describe("formatTokensCompact", () => {
  it("renders in→out in K", () => {
    expect(formatTokensCompact(8200, 1300)).toBe("8.2K→1.3K");
  });
});
