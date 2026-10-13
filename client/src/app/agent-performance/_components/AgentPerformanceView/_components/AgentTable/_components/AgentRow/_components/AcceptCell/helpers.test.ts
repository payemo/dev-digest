import { describe, it, expect } from "vitest";
import { makeAgentStats } from "@/test/agent-performance-fixtures";
import { acceptColor } from "./helpers";

/* Pure accept-rate colouring. Breakage covered: a low-sample rate being
   coloured as if it meant something, and the 70 / 50 band boundaries. */

const ranked = makeAgentStats({ accept_rate: 0.9, decisions: 20, low_sample: false });
const lowSample = makeAgentStats({ accept_rate: 1, decisions: 1, low_sample: true });

describe("acceptColor", () => {
  it("colours by band but never colours a low-sample rate", () => {
    expect(acceptColor(ranked, 70)).toBe("var(--ok)");
    expect(acceptColor(ranked, 69)).toBe("var(--warn)");
    expect(acceptColor(ranked, 49)).toBe("var(--crit)");
    expect(acceptColor(lowSample, 100)).toBeNull();
  });
});
