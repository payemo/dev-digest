/* BlastRadiusCard — what else in the repository this PR's diff can reach: for
   every symbol its changed files declare, who calls it and which HTTP endpoints
   or scheduled jobs depend on those callers. It costs no model call and reads
   no new table — the server answers from the index repo-intel built at clone
   time — so this card fetches on every visit and renders for a PR that has
   never been reviewed. An unindexed repo comes back `degraded` rather than
   failing, which is a state this card must SHOW, not hide. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  MonoLink,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import type { BlastCaller } from "@devdigest/shared";
import { usePrBlastRadius, type PrBlastRadius } from "@/lib/hooks/reviews";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { githubBlobUrl } from "@/lib/github-urls";
import {
  CRON_COLOR,
  CRON_ICON,
  DEGRADED_COLOR,
  ENDPOINT_COLOR,
  ENDPOINT_ICON,
  EXPANDED_BY_DEFAULT,
  GRAPH,
  GRAPH_NODE_COLOR,
  REASON_LABEL_KEY,
  UNKNOWN_REASON_KEY,
} from "./constants";
import { callerLabel, declaringFileOf, graphRows, hasNoCallers, statCounts } from "./helpers";
import { s } from "./styles";

type ViewMode = "tree" | "graph";

interface BlastRadiusCardProps {
  prId: string | null;
  repoId: string;
  /** "owner/repo", null until the repo has loaded — see CallerRef. */
  repoFullName: string | null;
  headSha: string;
}

/**
 * A caller's `file:line`. With a repo slug it is a BLOB link at the PR's head
 * sha — a caller file is by definition not in the diff, so a diff link would
 * point at nothing. Without one it degrades to plain monospace text rather than
 * a `MonoLink` with no href, which would render a dead <button>.
 */
function CallerRef({
  caller,
  repoFullName,
  headSha,
}: {
  caller: BlastCaller;
  repoFullName: string | null;
  headSha: string;
}) {
  const label = callerLabel(caller);
  if (!repoFullName) return <span className="mono" style={s.callerPlain}>{label}</span>;
  return (
    <MonoLink href={githubBlobUrl(repoFullName, headSha, caller.file, caller.line)}>
      {label}
    </MonoLink>
  );
}

/** Read-only labels, so `Badge` (a <span>) — never `Chip`, which is a <button>. */
function ImpactChips({ endpoints, crons }: { endpoints: string[]; crons: string[] }) {
  if (endpoints.length === 0 && crons.length === 0) return null;
  return (
    <div style={s.chipRow}>
      {endpoints.map((endpoint) => (
        <Badge key={`e:${endpoint}`} mono icon={ENDPOINT_ICON} color={ENDPOINT_COLOR}>
          {endpoint}
        </Badge>
      ))}
      {crons.map((cron) => (
        <Badge key={`c:${cron}`} mono icon={CRON_ICON} color={CRON_COLOR}>
          {cron}
        </Badge>
      ))}
    </div>
  );
}

/**
 * The three-column diagram: changed symbol → its callers → the endpoints those
 * callers serve. Hand-rolled SVG on purpose — a charting dependency for a
 * handful of boxes would be a lockfile change for nothing.
 */
function ImpactGraph({ data, label }: { data: PrBlastRadius; label: string }) {
  const t = useTranslations("blast");
  const { rows, hidden } = graphRows(data, GRAPH.maxRows, GRAPH.maxPerColumn);
  // Per-column truncation is real data loss in a "what else does this reach?"
  // view, so it is reported rather than left silent.
  const trimmed = rows.reduce((n, r) => n + r.overflow.callers + r.overflow.endpoints, 0);
  if (rows.length === 0) return <p style={s.noDownstream}>{t("graph.empty")}</p>;

  const band = GRAPH.nodeHeight + GRAPH.rowGap;
  // A row is as tall as its tallest column, so nothing overlaps.
  const heights = rows.map((r) => Math.max(1, r.callers.length, r.endpoints.length) * band);
  const tops = heights.reduce<number[]>(
    (acc, h, i) => [...acc, i === 0 ? GRAPH.padTop : acc[i - 1]! + heights[i - 1]!],
    [],
  );
  const height = GRAPH.padTop + heights.reduce((n, h) => n + h, 0) + GRAPH.padBottom;

  function node(x: number, y: number, text: string, color: string, key: string) {
    return (
      <g key={key}>
        <rect
          x={x}
          y={y}
          width={GRAPH.nodeWidth}
          height={GRAPH.nodeHeight}
          rx={5}
          fill="var(--bg-surface)"
          stroke={color}
        />
        <text x={x + 9} y={y + GRAPH.nodeHeight / 2 + 4} style={s.nodeLabel(color)} className="mono">
          {text}
        </text>
      </g>
    );
  }

  /** A curved connector from one node's right edge to the next node's left edge. */
  function edge(fromX: number, fromY: number, toX: number, toY: number, key: string) {
    const mid = (fromX + toX) / 2;
    return (
      <path
        key={key}
        d={`M ${fromX} ${fromY} C ${mid} ${fromY}, ${mid} ${toY}, ${toX} ${toY}`}
        fill="none"
        stroke="var(--border-strong)"
      />
    );
  }

  return (
    <>
      <div style={s.graphWrap}>
        <svg role="img" aria-label={label} width={GRAPH.width} height={height}>
          {rows.map((row, ri) => {
            const top = tops[ri]!;
            const symbolY = top + (heights[ri]! - GRAPH.nodeHeight) / 2 - GRAPH.rowGap / 2;
            return (
              <g key={row.symbol}>
                {row.callers.map((caller, ci) => {
                  const callerY = top + ci * band;
                  return (
                    <React.Fragment key={`${caller.file}:${caller.line}`}>
                      {edge(
                        GRAPH.colX[0] + GRAPH.nodeWidth,
                        symbolY + GRAPH.nodeHeight / 2,
                        GRAPH.colX[1],
                        callerY + GRAPH.nodeHeight / 2,
                        `e0-${ri}-${ci}`,
                      )}
                      {node(
                        GRAPH.colX[1],
                        callerY,
                        caller.name,
                        GRAPH_NODE_COLOR.caller,
                        `c-${ri}-${ci}`,
                      )}
                    </React.Fragment>
                  );
                })}
                {row.endpoints.map((endpoint, ei) => {
                  const endpointY = top + ei * band;
                  const fromY = top + Math.min(ei, row.callers.length - 1) * band;
                  return (
                    <React.Fragment key={endpoint}>
                      {edge(
                        GRAPH.colX[1] + GRAPH.nodeWidth,
                        fromY + GRAPH.nodeHeight / 2,
                        GRAPH.colX[2],
                        endpointY + GRAPH.nodeHeight / 2,
                        `e1-${ri}-${ei}`,
                      )}
                      {node(
                        GRAPH.colX[2],
                        endpointY,
                        endpoint,
                        GRAPH_NODE_COLOR.endpoint,
                        `p-${ri}-${ei}`,
                      )}
                    </React.Fragment>
                  );
                })}
                {node(
                  GRAPH.colX[0],
                  symbolY,
                  row.symbol,
                  GRAPH_NODE_COLOR.symbol,
                  `s-${ri}`,
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={s.legend}>
        <span style={s.legendItem}>
          <span style={s.legendDot(GRAPH_NODE_COLOR.symbol)} />
          {t("graph.legend.symbol")}
        </span>
        <span style={s.legendItem}>
          <span style={s.legendDot(GRAPH_NODE_COLOR.caller)} />
          {t("graph.legend.caller")}
        </span>
        <span style={s.legendItem}>
          <span style={s.legendDot(GRAPH_NODE_COLOR.endpoint)} />
          {t("graph.legend.endpoint")}
        </span>
        {hidden > 0 && <span>{t("graph.more", { count: hidden })}</span>}
        {trimmed > 0 && <span>{t("graph.moreNodes", { count: trimmed })}</span>}
      </div>
    </>
  );
}

export function BlastRadiusCard({ prId, repoId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError } = usePrBlastRadius(prId);
  const resync = useResyncRepoIntel(repoId);
  const [mode, setMode] = React.useState<ViewMode>("tree");
  // Seeded from the response so the first row is open and the rest are not; a
  // row the user has touched is whatever they left it as.
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  const heading = <SectionLabel icon="Workflow">{t("heading")}</SectionLabel>;

  if (isLoading) {
    return (
      <Card>
        {heading}
        <div style={s.loading}>
          <Skeleton height={18} />
          <Skeleton width="70%" height={14} />
          <Skeleton width="45%" height={14} />
        </div>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        {heading}
        <EmptyState icon="AlertTriangle" title={t("error")} />
      </Card>
    );
  }

  // `Badge` is vendored and accepts no `title`, so the tooltip goes on a wrapper.
  const degraded = data.degraded ? (
    <div style={s.degradedRow}>
      <span title={t("degraded.hint")}>
        <Badge icon="AlertTriangle" color={DEGRADED_COLOR}>
          {t("degraded.badge")} ·{" "}
          {t(REASON_LABEL_KEY[data.reason ?? ""] ?? UNKNOWN_REASON_KEY)}
        </Badge>
      </span>
      {/* Not EmptyState's CTA: that one hardcodes a "+" icon, which is wrong
          for a re-index action. */}
      <Button
        kind="tertiary"
        size="sm"
        icon="RefreshCw"
        loading={resync.isPending}
        onClick={() => resync.mutate()}
      >
        {resync.isPending ? t("degraded.resyncing") : t("degraded.resync")}
      </Button>
    </div>
  ) : null;

  if (data.changed_symbols.length === 0) {
    return (
      <Card>
        <SectionLabel icon="Workflow" right={degraded}>
          {t("heading")}
        </SectionLabel>
        <EmptyState icon="Workflow" title={t("empty")} body={t("emptyHint")} />
      </Card>
    );
  }

  const counts = statCounts(data);
  const stats: [string, number][] = [
    [t("stat.symbols"), counts.symbols],
    [t("stat.callers"), counts.callers],
    [t("stat.endpoints"), counts.endpoints],
    [t("stat.crons"), counts.crons],
  ];

  function isOpen(symbol: string, index: number): boolean {
    return open[symbol] ?? index < EXPANDED_BY_DEFAULT;
  }

  function toggle(symbol: string, index: number) {
    // Read from `prev`, not from the render closure: the seeded default only
    // applies until the row has been touched once.
    setOpen((prev) => ({
      ...prev,
      [symbol]: !(prev[symbol] ?? index < EXPANDED_BY_DEFAULT),
    }));
  }

  return (
    <Card>
      <SectionLabel icon="Workflow" right={degraded}>
        {t("heading")}
      </SectionLabel>

      <div style={s.statRow}>
        {stats.map(([label, value], i) => (
          <React.Fragment key={label}>
            {i > 0 && <span style={s.statSeparator}>·</span>}
            <span style={s.stat}>
              <span className="tnum" style={s.statValue}>
                {value}
              </span>
              <span>{label}</span>
            </span>
          </React.Fragment>
        ))}
        <div style={s.viewToggle} role="group" aria-label={t("view.ariaLabel")}>
          <Chip active={mode === "tree"} onClick={() => setMode("tree")}>
            {t("view.tree")}
          </Chip>
          <Chip active={mode === "graph"} onClick={() => setMode("graph")}>
            {t("view.graph")}
          </Chip>
        </div>
      </div>

      {mode === "graph" ? (
        <ImpactGraph data={data} label={t("graph.ariaLabel")} />
      ) : hasNoCallers(data) ? (
        <p style={s.noDownstream}>
          {t("noDownstream", { count: data.changed_symbols.length })}
        </p>
      ) : (
        <div style={s.tree}>
          {data.downstream.map((entry, index) => {
            const expanded = isOpen(entry.symbol, index);
            const file = declaringFileOf(data.changed_symbols, entry.symbol);
            return (
              // Each row is its own landmark: these headers and the diff
              // viewer's FileCard headers are both role="button" +
              // aria-expanded, and without a labelled region they are
              // indistinguishable to assistive tech and to a role query.
              <section key={entry.symbol} aria-label={entry.symbol}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  style={s.symbolHeader}
                  onClick={() => toggle(entry.symbol, index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(entry.symbol, index);
                    }
                  }}
                >
                  <span style={s.chevron(expanded)}>
                    <Icon.ChevronRight size={13} />
                  </span>
                  <span className="mono" style={s.symbolName}>
                    {entry.symbol}
                  </span>
                  {file && <span className="mono" style={s.declaredIn}>{t("symbol.declaredIn", { file })}</span>}
                  <span style={s.callerCount}>
                    {t("callerCount", { count: entry.callers.length })}
                  </span>
                </div>

                {expanded && (
                  <div style={s.symbolBody}>
                    {entry.callers.length > 0 && (
                      <div style={s.callerList}>
                        {entry.callers.map((caller) => (
                          <div key={`${caller.file}:${caller.line}`} style={s.callerRow}>
                            <CallerRef
                              caller={caller}
                              repoFullName={repoFullName}
                              headSha={headSha}
                            />
                            <span className="mono" style={s.callerSymbol}>
                              {caller.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <ImpactChips
                      endpoints={entry.endpoints_affected}
                      crons={entry.crons_affected}
                    />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
