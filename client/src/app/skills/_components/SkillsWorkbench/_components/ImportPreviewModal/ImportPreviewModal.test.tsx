import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseArchive, parseMarkdownSkill } from "./helpers";

/**
 * Pure parser tests — no DOM. These pin the security-relevant behavior: an
 * executable inside an archive is never decoded past the zip index, and
 * nothing outside .md/.markdown is ever turned into a skill body.
 */

describe("parseMarkdownSkill", () => {
  it("prefers frontmatter name + description when present", () => {
    const text = `---\nname: pr-quality-rubric\ndescription: Evaluate PR quality.\n---\n# Ignored heading\nThe body.`;
    const parsed = parseMarkdownSkill(text, "whatever.md");
    expect(parsed.name).toBe("pr-quality-rubric");
    expect(parsed.description).toBe("Evaluate PR quality.");
    expect(parsed.body).toContain("The body.");
  });

  it("falls back to the first # heading for the name when there is no frontmatter", () => {
    const text = `# API contract rubric\n\nFlag breaking changes.\n\nMore rule text.`;
    const parsed = parseMarkdownSkill(text, "some-file.md");
    expect(parsed.name).toBe("API contract rubric");
    expect(parsed.description).toBe("Flag breaking changes.");
  });

  it("falls back to the filename stem when there is neither frontmatter nor a heading", () => {
    const parsed = parseMarkdownSkill("Just some rule text, no heading.", "my-skill.md");
    expect(parsed.name).toBe("my-skill");
  });

  it("strips a directory prefix from the filename fallback", () => {
    const parsed = parseMarkdownSkill("text", "skills/nested/my-skill.md");
    expect(parsed.name).toBe("my-skill");
  });
});

describe("parseArchive", () => {
  function archive(files: Record<string, string>): Uint8Array {
    const entries: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) entries[path] = strToU8(content);
    return zipSync(entries);
  }

  it("keeps .md entries and parses them into skills", () => {
    const bytes = archive({ "SKILL.md": "# My skill\n\nDoes a thing." });
    const entries = parseArchive(bytes);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kept).toBe(true);
    expect(entries[0]!.parsed?.name).toBe("My skill");
  });

  it("drops a non-.md entry (e.g. a script) and never turns it into a skill", () => {
    const bytes = archive({
      "SKILL.md": "# Kept\n\nbody",
      "scripts/run.sh": "#!/bin/sh\nrm -rf /",
    });
    const entries = parseArchive(bytes);
    expect(entries).toHaveLength(2);

    const script = entries.find((e) => e.path === "scripts/run.sh");
    expect(script?.kept).toBe(false);
    expect(script?.reason).toBe("extension");
    // The dropped entry never got decoded into a skill body — the shell
    // script's contents must not be reachable as a "parsed" skill.
    expect(script?.parsed).toBeUndefined();

    const kept = entries.find((e) => e.path === "SKILL.md");
    expect(kept?.kept).toBe(true);
  });

  it("rejects an absolute path as unsafe, even if it happens to end in .md", () => {
    const bytes = archive({ "/etc/SKILL.md": "# x\n\ny" });
    const entries = parseArchive(bytes);
    expect(entries[0]!.kept).toBe(false);
    expect(entries[0]!.reason).toBe("unsafe-path");
  });

  it("rejects a path traversal entry as unsafe", () => {
    const bytes = archive({ "../../SKILL.md": "# x\n\ny" });
    const entries = parseArchive(bytes);
    expect(entries[0]!.kept).toBe(false);
    expect(entries[0]!.reason).toBe("unsafe-path");
  });

  it("drops an empty .md entry", () => {
    const bytes = archive({ "empty.md": "   \n  " });
    const entries = parseArchive(bytes);
    expect(entries[0]!.kept).toBe(false);
    expect(entries[0]!.reason).toBe("empty");
  });
});
