/* ContextTab (agent) — a thin wrapper around the shared attachments panel.
   Agents stay workspace-global while their attachments are per-repository, so
   the tab resolves the ACTIVE repo and asks the user to pick one when there
   isn't one. */
"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ContextAttachments } from "@/components/context-attachments";
import { useActiveRepo } from "@/lib/repo-context";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("context");
  const { activeRepo } = useActiveRepo();

  if (!activeRepo) {
    return (
      <div style={s.wrap}>
        <EmptyState
          icon="Folder"
          title={t("attach.noRepo.title")}
          body={t("attach.noRepo.body")}
        />
      </div>
    );
  }

  return <ContextAttachments ownerKind="agent" ownerId={agent.id} repoId={activeRepo.id} />;
}
