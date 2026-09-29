/* hooks/project-context.ts — React Query hooks for Project Context: the
   repository's documents, its sync status, and the per-repo attachment set an
   agent or a skill owns. One hook per server call. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ContextAttachmentSet as ContextAttachmentSetSchema,
  ContextDocument as ContextDocumentSchema,
  ContextDocumentContent as ContextDocumentContentSchema,
  ContextSetStatus as ContextSetStatusSchema,
} from "@devdigest/shared";
import type {
  ContextAttachmentSet,
  ContextDocument,
  ContextDocumentContent,
  ContextDocumentIntake,
  ContextOwnerKind,
  ContextSetStatus,
} from "@devdigest/shared";
import { api } from "../api";
import { contextKeys } from "./keys";

const ContextDocumentList = z.array(ContextDocumentSchema);

/** Attachment routes are owner-shaped but repo-scoped; one path builder for both. */
function attachmentPath(kind: ContextOwnerKind, ownerId: string, repoId: string): string {
  return `/repos/${repoId}/context/${kind === "agent" ? "agents" : "skills"}/${ownerId}/attachments`;
}

export function useContextDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextKeys.documents(repoId),
    queryFn: () =>
      api.get<ContextDocument[]>(`/repos/${repoId}/context/documents`, ContextDocumentList),
    enabled: !!repoId,
  });
}

export function useContextDocument(
  repoId: string | null | undefined,
  docId: string | null | undefined,
) {
  return useQuery({
    queryKey: contextKeys.document(repoId, docId),
    queryFn: () =>
      api.get<ContextDocumentContent>(
        `/repos/${repoId}/context/documents/${docId}`,
        ContextDocumentContentSchema,
      ),
    enabled: !!repoId && !!docId,
  });
}

export function useContextStatus(repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextKeys.status(repoId),
    queryFn: () =>
      api.get<ContextSetStatus>(`/repos/${repoId}/context/status`, ContextSetStatusSchema),
    enabled: !!repoId,
  });
}

/** Rescan the clone. Invalidates the list and the status, never an attachment
 *  set — a sync changes which documents exist, not who attached what. */
export function useRefreshContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ContextSetStatus>(
        `/repos/${repoId}/context/refresh`,
        undefined,
        ContextSetStatusSchema,
      ),
    onSuccess: (_data, repoId) => {
      void qc.invalidateQueries({ queryKey: contextKeys.documents(repoId) });
      void qc.invalidateQueries({ queryKey: contextKeys.status(repoId) });
    },
  });
}

export function useCreateContextDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, intake }: { repoId: string; intake: ContextDocumentIntake }) =>
      api.post<ContextDocument>(
        `/repos/${repoId}/context/documents`,
        intake,
        ContextDocumentSchema,
      ),
    onSuccess: (_data, { repoId }) => {
      void qc.invalidateQueries({ queryKey: contextKeys.documents(repoId) });
      void qc.invalidateQueries({ queryKey: contextKeys.status(repoId) });
    },
  });
}

/** Deleting a document can empty an attachment set, so every set for this repo
 *  is invalidated alongside the list. */
export function useDeleteContextDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, docId }: { repoId: string; docId: string }) =>
      api.del<void>(`/repos/${repoId}/context/documents/${docId}`),
    onSuccess: (_data, { repoId }) => {
      void qc.invalidateQueries({ queryKey: contextKeys.documents(repoId) });
      void qc.invalidateQueries({ queryKey: contextKeys.status(repoId) });
      void qc.invalidateQueries({ queryKey: contextKeys.attachmentsRoot() });
    },
  });
}

export function useContextAttachments(
  kind: ContextOwnerKind,
  ownerId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: contextKeys.attachments(kind, ownerId, repoId),
    queryFn: () =>
      api.get<ContextAttachmentSet>(
        attachmentPath(kind, ownerId!, repoId!),
        ContextAttachmentSetSchema,
      ),
    enabled: !!ownerId && !!repoId,
  });
}

/** Writes the WHOLE ordered list — attach, detach and reorder are one call. The
 *  response is the recomputed set, so it seeds the cache directly rather than
 *  forcing a refetch; the document list is invalidated because "used by N
 *  agents" moves with it. */
export function useSetContextAttachments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      kind,
      ownerId,
      repoId,
      documentIds,
    }: {
      kind: ContextOwnerKind;
      ownerId: string;
      repoId: string;
      documentIds: string[];
    }) =>
      api.put<ContextAttachmentSet>(
        attachmentPath(kind, ownerId, repoId),
        { document_ids: documentIds },
        ContextAttachmentSetSchema,
      ),
    onSuccess: (data, { kind, ownerId, repoId }) => {
      qc.setQueryData(contextKeys.attachments(kind, ownerId, repoId), data);
      void qc.invalidateQueries({ queryKey: contextKeys.documents(repoId) });
    },
  });
}
