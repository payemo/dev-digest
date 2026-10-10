import { describe, it, expect } from "vitest";
import { NAV } from "@devdigest/ui";
import { activeKeyFor } from "./helpers";

describe("Eval Dashboard nav entry (AC-51)", () => {
  it("sits under SKILLS LAB and is the active item on /eval and its detail pages", () => {
    const lab = NAV.find((g) => g.section === "SKILLS LAB");
    const item = lab?.items.find((i) => i.key === "eval");
    expect(item?.href).toBe("/eval");
    expect(activeKeyFor(item!.href)).toBe("eval");
    expect(activeKeyFor("/eval/agent-1")).toBe("eval");
  });
});
