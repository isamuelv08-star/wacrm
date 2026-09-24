"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportModal } from "@/components/contacts/import-modal";
import { DealImportCard } from "./deal-import-card";

/**
 * Onboarding's import step (audit Fase 3 / brief section 9) — reuses
 * the existing, already-polished contacts ImportModal as-is (now with
 * synonym-based column detection, see parse-contact-csv.ts) rather
 * than rebuilding that UI, and adds the new deals/opportunities
 * importer next to it (parse-deal-csv.ts / DealImportCard — no such
 * importer existed anywhere in the product before). Both are
 * optional: skipping this step (or just clicking through with neither
 * file uploaded) leaves a brand-new account exactly as before.
 */
export function ImportStep() {
  const t = useTranslations("Onboarding.import");
  const [contactsOpen, setContactsOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-medium text-foreground">{t("contactsTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("contactsDescription")}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setContactsOpen(true)}>
          <Users className="h-3.5 w-3.5" />
          {t("contactsCta")}
        </Button>
      </div>

      <DealImportCard />

      <ImportModal open={contactsOpen} onOpenChange={setContactsOpen} onImported={() => {}} />
    </div>
  );
}
