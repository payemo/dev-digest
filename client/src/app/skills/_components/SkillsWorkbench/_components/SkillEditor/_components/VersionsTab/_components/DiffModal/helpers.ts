import { diffLines, type Change } from "diff";

export interface DiffLine {
  kind: "add" | "del" | "context";
  text: string;
}

/**
 * Line-level diff between two version bodies, expanded from `diff`'s
 * multi-line Change chunks into one DiffLine per line so each row renders
 * (and colors) independently instead of as one multi-line block.
 */
export function computeLineDiff(base: string, current: string): DiffLine[] {
  // `diffLines` tokenizes a line together with its trailing "\n", so a body
  // missing one (any body that doesn't end in a blank line) makes its last
  // line compare unequal to an otherwise-identical line elsewhere that does
  // carry one — false-diffing the whole tail. Normalize both sides to always
  // end in "\n" so line matching is consistent regardless of source trivia.
  const withTrailingNewline = (text: string) => (text.endsWith("\n") ? text : text + "\n");
  const changes: Change[] = diffLines(withTrailingNewline(base), withTrailingNewline(current));
  const lines: DiffLine[] = [];
  for (const change of changes) {
    const kind: DiffLine["kind"] = change.added ? "add" : change.removed ? "del" : "context";
    // diffLines keeps a trailing "\n" inside `value` — split then drop the
    // empty string that trailing newline produces, so no phantom blank row.
    const chunkLines = change.value.split("\n");
    if (chunkLines[chunkLines.length - 1] === "") chunkLines.pop();
    for (const text of chunkLines) lines.push({ kind, text });
  }
  return lines;
}
