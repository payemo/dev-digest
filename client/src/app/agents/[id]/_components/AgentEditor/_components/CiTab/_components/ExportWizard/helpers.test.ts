import { describe, it, expect } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { blockingFromError, buildZip, formatBytes, toggleTrigger, zipFileName } from "./helpers";

/* Pure wizard helpers: trigger order (a reordered selection would regenerate
   a different workflow file), the zip contents/name, and pulling blocking
   reasons out of an untrusted error payload. */

describe("ExportWizard helpers", () => {
  it("toggleTrigger adds/removes while keeping the canonical order", () => {
    expect(toggleTrigger(["reopened"], "opened")).toEqual(["opened", "reopened"]);
    expect(toggleTrigger(["opened", "synchronize"], "opened")).toEqual(["synchronize"]);
    expect(toggleTrigger(["synchronize"], "synchronize")).toEqual([]);
  });

  it("buildZip keeps repo-relative paths and contents; zipFileName uses the manifest slug", () => {
    const files = [
      { path: ".devdigest/agents/sec-2.yaml", contents: "name: x\n", role: "manifest" as const },
      { path: ".github/workflows/devdigest-review-sec-2.yml", contents: "on: {}\n", role: "workflow" as const },
    ];
    const out = unzipSync(buildZip(files));
    expect(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, strFromU8(v)]))).toEqual({
      ".devdigest/agents/sec-2.yaml": "name: x\n",
      ".github/workflows/devdigest-review-sec-2.yml": "on: {}\n",
    });
    expect(zipFileName(files)).toBe("devdigest-ci-sec-2.zip");
    expect(zipFileName([{ path: "x", role: "workflow" }])).toBe("devdigest-ci-agent.zip");
  });

  it("formatBytes", () => {
    expect(formatBytes(300)).toBe("300 B");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(null)).toBe("—");
  });

  it("blockingFromError keeps only well-formed reasons", () => {
    expect(
      blockingFromError({ blocking: [{ code: "a", message: "A" }, { code: "b" }, null, "x"] }),
    ).toEqual([{ code: "a", message: "A" }]);
    expect(blockingFromError(null)).toEqual([]);
    expect(blockingFromError({ blocking: "nope" })).toEqual([]);
  });
});
