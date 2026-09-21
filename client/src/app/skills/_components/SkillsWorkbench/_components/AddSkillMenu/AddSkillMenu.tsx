/* AddSkillMenu — "+ Add Skill" dropdown: create from scratch, or import a
   local file/archive (parsed client-side; see ImportPreviewModal). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown } from "@devdigest/ui";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { ImportPreviewModal } from "../ImportPreviewModal";

export function AddSkillMenu() {
  const t = useTranslations("skills");
  const [modal, setModal] = React.useState<"create" | "import-file" | "import-archive" | null>(null);

  return (
    <>
      <Dropdown
        width={220}
        align="right"
        trigger={
          <Button kind="primary" size="sm" icon="Plus">
            {t("page.addSkill")}
          </Button>
        }
        items={[
          { label: t("page.menu.createFromScratch"), icon: "Edit", onClick: () => setModal("create") },
          { divider: true },
          { label: t("page.menu.fromFile"), icon: "FileText", onClick: () => setModal("import-file") },
          { label: t("page.menu.fromArchive"), icon: "Boxes", onClick: () => setModal("import-archive") },
        ]}
      />
      {modal === "create" && <CreateSkillModal onClose={() => setModal(null)} />}
      {(modal === "import-file" || modal === "import-archive") && (
        <ImportPreviewModal kind={modal === "import-file" ? "file" : "archive"} onClose={() => setModal(null)} />
      )}
    </>
  );
}
