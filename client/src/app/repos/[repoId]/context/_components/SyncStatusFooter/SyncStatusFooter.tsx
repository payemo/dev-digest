/* SyncStatusFooter — document count, time since the last completed sync, and
   the health state with its reason.

   Deliberately carries NO chunk count and no content-volume figure: nothing
   about these documents is chunked, so a figure like that would describe a
   pipeline that does not exist. */
"use client";

import { useTranslations } from "next-intl";
import type { ContextSetStatus } from "@/lib/types";
import { HEALTH_COLOR } from "../../constants";
import { elapsedLabel, parseBoundedReason } from "../../helpers";
import { s } from "./styles";

export function SyncStatusFooter({ status }: { status: ContextSetStatus }) {
  const t = useTranslations("context");
  const ago = elapsedLabel(status.last_synced_at, Date.now());
  const bounded = parseBoundedReason(status.reason);

  return (
    <div style={s.wrap}>
      <span style={s.dot(HEALTH_COLOR[status.health])} aria-hidden />
      <span style={s.line}>
        {t("footer.documents", { count: status.document_count })} ·{" "}
        {ago ? t("footer.lastSynced", { ago }) : t("footer.neverSynced")} ·{" "}
        {t(`footer.health.${status.health}`)}
      </span>
      {status.health === "failed" && (
        <span style={s.reason}>
          {status.reason === "no_clone"
            ? t("footer.reason.noClone")
            : t("footer.reason.other", { reason: status.reason ?? "" })}
        </span>
      )}
      {status.health === "bounded" && (
        <span style={s.reason}>
          {bounded
            ? t("footer.reason.bounded", { kept: bounded.kept, dropped: bounded.dropped })
            : t("footer.reason.other", { reason: status.reason ?? "" })}
        </span>
      )}
    </div>
  );
}
