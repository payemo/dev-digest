/* ContextAttachments — the Context tab for an agent AND for a skill.
   Shared rather than route-local because the agent editor (/agents/[id]) and
   the skill editor (/skills) are two different routes, and one route may not
   import another's _components/.

   Every gesture computes the next FULL ordered id array and PUTs it once —
   the same conflict-free whole-list write the Skills tab uses, so the UI can
   never drift from what's stored. Token figures are the server's stored
   per-document counts, summed; nothing is recounted here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, EmptyState, ErrorState, Icon, Skeleton, TextInput } from "@devdigest/ui";
import type { ContextAttachment, ContextDocument, ContextOwnerKind } from "@/lib/types";
import { useContextAttachments, useContextDocuments, useSetContextAttachments } from "@/lib/hooks/project-context";
import { CATEGORY_COLOR, SKELETON_ROWS } from "./constants";
import { DocumentPreviewModal } from "./DocumentPreviewModal";
import { filterDocuments, moveId, orderForDisplay, reorderIds, totalTokens, writableIds } from "./helpers";
import { s } from "./styles";

function DocumentRow({
  document: doc,
  attachment,
  position,
  lastPosition,
  dropSide,
  onToggle,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPreview,
}: {
  document: ContextDocument;
  attachment: ContextAttachment | undefined;
  position: number | null;
  lastPosition: number;
  dropSide: "before" | "after" | null;
  onToggle: (on: boolean) => void;
  onMove: (direction: "up" | "down") => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onPreview: () => void;
}) {
  const t = useTranslations("context");
  const attached = attachment !== undefined;
  const inheritedOnly = attachment?.provenance === "inherited";
  // Only a directly-attached document has a position in the writable order —
  // an inherited-only or unattached row has nothing to drag or drop onto.
  const draggable = attached && position !== null;

  const rowStyle = {
    ...(attached ? s.rowAttached : s.row),
    ...(dropSide === "before" ? s.rowDropBefore : dropSide === "after" ? s.rowDropAfter : null),
  };

  return (
    <div
      style={rowStyle}
      data-testid={`context-row-${doc.id}`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? onDrop : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      <div style={s.leftControls}>
        {/* An inherited-only document is toggled by detaching it from the
            skill that supplies it, not from here — so its checkbox is
            read-only rather than silently converting it into a direct
            attachment. */}
        <Checkbox checked={attached} onChange={inheritedOnly ? undefined : onToggle} />
        <button
          type="button"
          aria-label={t("attach.reorder")}
          title={t("attach.reorder")}
          tabIndex={draggable ? 0 : -1}
          onKeyDown={
            draggable
              ? (e) => {
                  if (e.key === "ArrowUp" && position !== 0) {
                    e.preventDefault();
                    onMove("up");
                  } else if (e.key === "ArrowDown" && position !== lastPosition) {
                    e.preventDefault();
                    onMove("down");
                  }
                }
              : undefined
          }
          style={draggable ? s.grip : { ...s.grip, ...s.gripDisabled }}
          disabled={!draggable}
        >
          <Icon.GripVertical size={14} />
        </button>
      </div>

      <div style={s.meta}>
        <span className="mono" style={s.name}>
          {doc.name}
        </span>
        <span className="mono" style={s.folder}>
          {doc.category}/{doc.folder ? `${doc.folder}/` : ""}
        </span>
      </div>

      {doc.origin === "user" && (
        <Badge color="var(--text-secondary)">{t("origin.user")}</Badge>
      )}
      {doc.availability === "missing" && (
        <Badge color="var(--crit)" icon="AlertTriangle">
          {t("doc.missing")}
        </Badge>
      )}
      {inheritedOnly && (
        <Badge color="var(--text-muted)" icon="Link">
          {t("attach.inherited")}
        </Badge>
      )}

      <span style={s.tokens}>{t("tokens.approx", { count: doc.token_count })}</span>
      <Badge color={CATEGORY_COLOR[doc.category]} mono>
        {doc.category}
      </Badge>

      <Button kind="ghost" size="sm" icon="Eye" onClick={onPreview}>
        {t("attach.preview")}
      </Button>
    </div>
  );
}

export function ContextAttachments({
  ownerKind,
  ownerId,
  repoId,
}: {
  ownerKind: ContextOwnerKind;
  ownerId: string;
  repoId: string;
}) {
  const t = useTranslations("context");
  const documents = useContextDocuments(repoId);
  const attachments = useContextAttachments(ownerKind, ownerId, repoId);
  const setAttachments = useSetContextAttachments();

  const [query, setQuery] = React.useState("");
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const [overBefore, setOverBefore] = React.useState(true);

  const set = attachments.data;
  const attached = set?.documents ?? [];
  const byId = new Map(attached.map((a) => [a.document.id, a]));
  const ownIds = writableIds(attached);
  const visible = orderForDisplay(filterDocuments(documents.data ?? [], query), ownIds);

  const apply = (nextIds: string[]) =>
    setAttachments.mutate({ kind: ownerKind, ownerId, repoId, documentIds: nextIds });

  const dragOverRow = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setOverId(id);
    setOverBefore(e.clientY - rect.top < rect.height / 2);
  };
  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };
  const dropOnRow = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragId && overId) apply(reorderIds(ownIds, dragId, overId, overBefore));
    endDrag();
  };

  if (documents.isLoading || attachments.isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={20} width={200} />
        {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
          <Skeleton key={i} height={40} />
        ))}
      </div>
    );
  }

  if (documents.isError || attachments.isError) {
    return (
      <div style={s.wrap}>
        <ErrorState
          body={t("attach.loadError")}
          onRetry={() => {
            void documents.refetch();
            void attachments.refetch();
          }}
        />
      </div>
    );
  }

  if ((documents.data ?? []).length === 0) {
    return (
      <div style={s.wrap}>
        <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
      </div>
    );
  }

  const total = totalTokens(attached);
  const overBudget = set ? set.over_budget : false;

  return (
    <div style={s.wrap}>
      <div style={s.headerRow}>
        <h2 style={s.h2}>
          {ownerKind === "skill" ? t("attach.skillTitle") : t("attach.title")}
        </h2>
        <Badge color="var(--accent)">
          {ownerKind === "skill"
            ? t("attach.countSkill", { attached: attached.length })
            : t("attach.count", { attached: attached.length, total: (documents.data ?? []).length })}
        </Badge>
        <div style={s.filterWrap}>
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder={t("attach.filterPlaceholder")}
            aria-label={t("attach.filterPlaceholder")}
          />
        </div>
      </div>

      <p style={s.hint}>
        {ownerKind === "skill" ? t("attach.skillHint") : t("attach.orderHint")}
      </p>

      <div style={s.list} data-testid="context-list">
        {visible.map((doc) => {
          const position = ownIds.indexOf(doc.id);
          return (
            <DocumentRow
              key={doc.id}
              document={doc}
              attachment={byId.get(doc.id)}
              position={position === -1 ? null : position}
              lastPosition={ownIds.length - 1}
              dropSide={overId === doc.id && dragId && dragId !== doc.id ? (overBefore ? "before" : "after") : null}
              onToggle={(on) =>
                apply(on ? [...ownIds, doc.id] : ownIds.filter((id) => id !== doc.id))
              }
              onMove={(direction) => apply(moveId(ownIds, position, direction))}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragId(doc.id);
              }}
              onDragOver={(e) => dragOverRow(e, doc.id)}
              onDrop={dropOnRow}
              onDragEnd={endDrag}
              onPreview={() => setPreviewId(doc.id)}
            />
          );
        })}
        {visible.length === 0 && <p style={s.hint}>{t("attach.noMatches", { query })}</p>}
      </div>

      {previewId && (
        <DocumentPreviewModal repoId={repoId} docId={previewId} onClose={() => setPreviewId(null)} />
      )}

      {ownerKind === "skill" && (
        <div>
          <p style={s.serializesLabel}>{t("attach.serializesAs")}</p>
          {/* A path list, captioned with the block the ENGINE actually
              assembles. A skill contributes which documents an agent reads; it
              never gets a section of its own, and the caption must not imply
              one. */}
          <div className="mono" style={s.serializesBox}>
            {`${t("attach.blockName")}\n${
              attached.length === 0
                ? t("attach.serializesEmpty")
                : attached.map((a) => `- ${a.document.path}`).join("\n")
            }`}
          </div>
          <p style={s.hint}>{t("attach.serializesNote")}</p>
        </div>
      )}

      <div style={s.footer}>
        <span style={s.total}>{t("tokens.total", { count: total })}</span>
        {overBudget && (
          <span style={s.budgetWarn} role="status">
            {t("tokens.overBudget", { threshold: set?.budget_threshold ?? 0 })}
          </span>
        )}
        <span style={s.trustLine}>{t("attach.trustLine")}</span>
      </div>
    </div>
  );
}
