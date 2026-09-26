/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments.

   A file that a review cited also shows a small severity-coloured dot right
   after its path. That dot is a PRESENCE indicator with no number, and it is
   deliberately a different thing from the MessageSquare GitHub-comment counter
   on the far right of the same row — never merge the two. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  cs,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import {
  anchorsForLine,
  partitionAnchors,
  type DiffFindingAnchor,
  type DiffFindingApi,
} from "../findings";
import { s, chevronFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Most severe first — the dot takes the worst severity on the file. */
const SEVERITY_RANK: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION", "INFO"];

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

function worstSeverity(anchors: DiffFindingAnchor[]): Severity {
  return SEVERITY_RANK.find((sev) => anchors.some((a) => a.severity === sev)) ?? "INFO";
}

export function FileCard({
  file,
  commenting,
  findings,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  findings?: DiffFindingApi;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState(
    (file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  // Same treatment for findings: anchor what this patch renders, and route the
  // rest into the footer block so a finding on a line outside the patch (or on
  // a `patch: null` file, which parses to zero lines) is never dropped.
  const anchors = findings?.anchors;
  const fileAnchors = React.useMemo(
    () => (anchors ?? []).filter((a) => a.path === file.path),
    [anchors, file.path],
  );
  const { matched: matchedAnchors, unanchored } = React.useMemo(() => {
    const renderedLines = new Set<number>();
    for (const ln of lines) if (ln.kind === "add" || ln.kind === "ctx") {
      if (ln.newNo != null) renderedLines.add(ln.newNo);
    }
    return partitionAnchors(fileAnchors, renderedLines);
  }, [fileAnchors, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={s.fileCard}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={s.fileHeader}
      >
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span style={s.pathWrap}>
          <span className="mono" style={s.filePathInline}>
            {file.path}
          </span>
          {fileAnchors.length > 0 && (
            <span
              data-testid="finding-dot"
              aria-hidden
              style={s.findingDot(SEV[worstSeverity(fileAnchors)].c)}
            />
          )}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                anchors={anchorsForLine(ln, matchedAnchors)}
                findings={findings}
              />
            ))
          )}
          {findings && findings.showFindings && unanchored.length > 0 && (
            <div style={cs.outdatedWrap}>
              <div style={cs.outdatedTitle}>{findings.unanchoredLabel}</div>
              {unanchored.map((a) => (
                <div key={a.id}>{findings.render(a.id)}</div>
              ))}
            </div>
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
