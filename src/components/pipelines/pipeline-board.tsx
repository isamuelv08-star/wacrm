"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Deal, PipelineStage } from "@/types";
import type { ConversationStaleness } from "@/lib/pipelines/lead-staleness";
import { DealCard } from "./deal-card";
import { Button } from "@/components/ui/button";
import {
  Plus,
  UserPlus,
  PhoneCall,
  Star,
  FileText,
  Handshake,
  Trophy,
  XCircle,
  Layers,
  Target,
  Flag,
  CircleDot,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";

// Stage names are freely renamed by the user (no fixed enum), so the icon
// is picked heuristically off common English/Spanish/Portuguese wording,
// with a position-based fallback cycle for anything unmatched — keeps
// every column feeling distinct even for fully custom stage names.
//
// The heuristic only ever resolves a *key*; the actual icon component is
// then looked up from a plain static map (mirroring ROLE_META's pattern
// in settings/role-meta.ts). Returning a component straight out of a
// regex-branching function instead trips the "components created during
// render" check, since the compiler can't prove that kind of function is
// stable across renders.
const STAGE_ICON_MAP: Record<string, LucideIcon> = {
  new: UserPlus,
  contact: PhoneCall,
  qualify: Star,
  proposal: FileText,
  negotiate: Handshake,
  won: Trophy,
  lost: XCircle,
};
const STAGE_ICON_FALLBACKS: LucideIcon[] = [Layers, Target, Flag, CircleDot];

function stageIconKey(name: string): string {
  const n = name.toLowerCase();
  if (/\b(new|nuevo|novo)\b/.test(n)) return "new";
  if (/\b(contact|contactad|contato)/.test(n)) return "contact";
  if (/\b(qualif|calific)/.test(n)) return "qualify";
  if (/\b(propos|cotiz|orcamento|orçamento)/.test(n)) return "proposal";
  if (/\b(negoti|nego)/.test(n)) return "negotiate";
  if (/\b(won|ganado|ganho|cerrad|fechad)/.test(n)) return "won";
  if (/\b(lost|perdido|perdid)/.test(n)) return "lost";
  return "";
}

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  /** Optional — omit to render every card without a staleness badge. */
  conversationStaleness?: Map<string, ConversationStaleness>;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onAddDeal,
  onEditDeal,
  conversationStaleness,
}: PipelineBoardProps) {
  const { defaultCurrency } = useAuth();
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor),
  );

  const activeDeal = activeDealId
    ? deals.find((d) => d.id === activeDealId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    onDealMoved(dealId, targetStageId);
  }

  function handleDragCancel() {
    setActiveDealId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* snap-x + snap-mandatory on mobile so swipes land the next
          stage cleanly at the viewport edge instead of mid-column.
          Disabled on lg+ where snapping would interfere with the
          natural layout. The board can still overflow horizontally on
          lg+ once a pipeline has many stages (columns keep a 260px
          min-width), so a thin scrollbar stays visible on desktop. */}
      <div className="pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none">
        {sortedStages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const totalValue = stageDeals.reduce(
            (s, d) => s + Number(d.value || 0),
            0,
          );
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              totalValue={totalValue}
              currency={defaultCurrency}
              onAddDeal={onAddDeal}
              onEditDeal={onEditDeal}
              conversationStaleness={conversationStaleness}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              onEdit={() => {}}
              isOverlay
              conversationStaleness={
                activeDeal.contact_id
                  ? conversationStaleness?.get(activeDeal.contact_id)
                  : undefined
              }
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          scroll-behavior: smooth;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
  totalValue,
  currency,
  onAddDeal,
  onEditDeal,
  conversationStaleness,
}: {
  stage: PipelineStage;
  deals: Deal[];
  totalValue: number;
  currency: string;
  onAddDeal: (stageId: string) => void;
  onEditDeal: (deal: Deal) => void;
  conversationStaleness?: Map<string, ConversationStaleness>;
}) {
  const t = useTranslations("Pipelines.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const iconKey = stageIconKey(stage.name);
  const StageIcon =
    STAGE_ICON_MAP[iconKey] ??
    STAGE_ICON_FALLBACKS[stage.position % STAGE_ICON_FALLBACKS.length];

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    //
    // The whole column is tinted with the stage's own color (via
    // color-mix against the card surface) so it reads as a "vistoso"
    // KPI tile rather than a flat table column — mirrors the colored
    // summary-card treatment used elsewhere in the redesign.
    <div
      className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-2xl border p-4 shadow-sm shadow-black/5 transition-shadow hover:shadow-md lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none"
      style={{
        backgroundColor: `color-mix(in oklch, ${stage.color} 10%, var(--card))`,
        borderColor: `color-mix(in oklch, ${stage.color} 28%, var(--border))`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {stage.name}
          </h3>
          <p className="mt-1 text-3xl font-bold leading-none text-foreground">
            {deals.length}
          </p>
        </div>
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{
            backgroundColor: `color-mix(in oklch, ${stage.color} 24%, transparent)`,
            color: stage.color,
          }}
        >
          <StageIcon className="h-[18px] w-[18px]" />
        </span>
      </div>

      <div
        className="mt-3 flex items-center justify-between border-t pt-2 text-xs"
        style={{ borderColor: `color-mix(in oklch, ${stage.color} 20%, var(--border))` }}
      >
        <span className="text-muted-foreground">{t("pipelineValue")}</span>
        <span className="font-semibold text-foreground">
          {formatCurrency(totalValue, currency)}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropDealHere")}
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              onEdit={onEditDeal}
              conversationStaleness={
                deal.contact_id ? conversationStaleness?.get(deal.contact_id) : undefined
              }
            />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="mt-3 w-full justify-start border border-dashed border-border bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("addDeal")}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  onEdit,
  conversationStaleness,
}: {
  deal: Deal;
  stage: PipelineStage;
  onEdit: (deal: Deal) => void;
  conversationStaleness?: ConversationStaleness;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <DealCard
        deal={deal}
        stage={stage}
        onEdit={onEdit}
        conversationStaleness={conversationStaleness}
      />
    </div>
  );
}
