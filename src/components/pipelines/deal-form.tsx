"use client";

import type { Deal, PipelineStage } from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTranslations } from "next-intl";
import { DealFormFields } from "./deal-form-fields";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

/**
 * Standalone deal editor Sheet. The fields themselves live in
 * `DealFormFields` — this is now just the Sheet chrome around it, kept
 * around for the one other place a deal is edited outside the pipeline
 * board: contact-sidebar.tsx's "click a deal" (see
 * `LeadSummarySheet`'s "Edit" tab for the pipeline-board case, which
 * embeds `DealFormFields` directly instead of stacking a second Sheet).
 */
export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <DealFormFields
            open={open}
            deal={deal}
            pipelineId={pipelineId}
            stages={stages}
            defaultStageId={defaultStageId}
            onSaved={onSaved}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
