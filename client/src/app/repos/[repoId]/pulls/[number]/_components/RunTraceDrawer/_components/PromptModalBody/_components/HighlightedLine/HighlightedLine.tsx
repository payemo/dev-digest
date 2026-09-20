/* One line of prompt text with every case-insensitive occurrence of `query`
   wrapped in <mark>. Was a camelCase function returning JSX (a "render
   factory") — that breaks reconciliation/identity on every re-render, so
   it's a real component now. */
import React from "react";

export function HighlightedLine({ line, query }: { line: string; query: string }) {
  if (!query) return <div>{line}</div>;
  const lower = line.toLowerCase();
  const ql = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i <= line.length) {
    const idx = lower.indexOf(ql, i);
    if (idx === -1) {
      parts.push(line.slice(i));
      break;
    }
    if (idx > i) parts.push(line.slice(i, idx));
    parts.push(
      <mark key={idx} style={{ background: "var(--accent)", color: "var(--bg-primary)", borderRadius: 2 }}>
        {line.slice(idx, idx + query.length)}
      </mark>,
    );
    i = idx + query.length;
  }
  return <div>{parts}</div>;
}
