import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          h1: ({ children }) => (
            <h1 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ margin: "20px 0 8px", fontSize: 16, fontWeight: 650, color: "var(--text-primary)" }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ margin: "18px 0 6px", fontSize: 15, fontWeight: 650, color: "var(--text-primary)" }}>
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 style={{ margin: "16px 0 6px", fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
              {children}
            </h4>
          ),
          em: ({ children }) => (
            <em style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>{children}</em>
          ),
          ul: ({ children }) => (
            <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ol>
          ),
          li: ({ children }) => (
            <li style={{ marginBottom: 4, color: "var(--text-secondary)", lineHeight: 1.55 }}>{children}</li>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => (
            <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
