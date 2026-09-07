"use client";

import { useTranslations } from "next-intl";
import type { Deal, PipelineStage } from "@/types";
import type { WeekGroupEntry, MonthGroupEntry } from "@/lib/pipelines/deal-groups";
import { formatMonthGroupLabel, formatWeekGroupLabel } from "@/lib/pipelines/deal-groups";
import type { ConversationStaleness } from "@/lib/pipelines/lead-staleness";
import { formatCurrency } from "@/lib/currency";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { DraggableDealCard } from "./pipeline-board";

interface DealGroupRowProps {
  group: WeekGroupEntry | MonthGroupEntry;
  stage: PipelineStage;
  currency: string;
  /** Inherited from the column's own compact/full-size mode — cards
   *  revealed inside the group render the same way as the rest of the
   *  column, they don't get a mode of their own. */
  compact: boolean;
  onEditDeal: (deal: Deal) => void;
  conversationStaleness?: Map<string, ConversationStaleness>;
}

/**
 * One collapsed "N leads · Aug 2026"-style row standing in for a whole
 * week or month of older deals — see lib/pipelines/deal-groups.ts for
 * how deals land here. Deliberately not draggable (no useDraggable):
 * it's a virtual aggregate, not a real deal, so it's excluded from
 * dnd-kit's id space entirely. Each row owns its own independent
 * Accordion (rather than one shared per column) so expanding one
 * group never affects any other's open/closed state.
 */
export function DealGroupRow({
  group,
  stage,
  currency,
  compact,
  onEditDeal,
  conversationStaleness,
}: DealGroupRowProps) {
  const t = useTranslations("Pipelines.board");
  const label =
    group.kind === "week-group" ? formatWeekGroupLabel(group) : formatMonthGroupLabel(group);

  return (
    <Accordion>
      <AccordionItem>
        {/* Two faint rounded slivers peeking out from behind the
            trigger's bottom edge read as a stack of index cards — a
            cheap, purely decorative cue that this row is a bundle,
            not a single deal. Scoped to wrap only the trigger (not
            the whole item) so the peek stays pinned to the header
            and doesn't drift once the group is expanded. */}
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-2 top-full z-0 -mt-2 h-3 rounded-b-2xl border border-t-0 border-border/40 bg-muted/60"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-4 top-full z-0 -mt-1 h-2.5 rounded-b-2xl border border-t-0 border-border/25 bg-muted/35"
          />
          <AccordionTrigger className="relative z-10 rounded-2xl border border-border/50 bg-muted/70 py-2.5 pl-4 pr-3 no-underline shadow-sm transition-all hover:border-border hover:bg-muted hover:no-underline hover:shadow-md">
            {/* 4px left accent bar using the stage color — same
                convention as DealCard's own accent bar. */}
            <span
              aria-hidden
              className="absolute left-0 top-0 h-full w-1 rounded-l-2xl"
              style={{ backgroundColor: stage.color }}
            />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
              <span className="text-sm font-semibold text-foreground">
                {t("leadCount", { count: group.deals.length })}
              </span>
              <span className="text-[11px] text-muted-foreground">{label}</span>
            </span>
            <span className="shrink-0 text-sm font-bold text-primary">
              {formatCurrency(group.totalValue, currency)}
            </span>
          </AccordionTrigger>
        </div>
        <AccordionContent className="pt-2">
          <div className={compact ? "flex flex-col gap-1" : "flex flex-col gap-2"}>
            {group.deals.map((deal) => (
              <DraggableDealCard
                key={deal.id}
                deal={deal}
                stage={stage}
                onEdit={onEditDeal}
                compact={compact}
                conversationStaleness={
                  deal.contact_id ? conversationStaleness?.get(deal.contact_id) : undefined
                }
              />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
