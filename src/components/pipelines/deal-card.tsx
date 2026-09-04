"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X, Phone, Building2, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";
import { LeadScoreBadge } from "@/components/leads/lead-score-badge";
import { LeadStalenessBadge } from "./lead-staleness-badge";
import type { ConversationStaleness } from "@/lib/pipelines/lead-staleness";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  /** Drives the "cooling off" badge — omit to render the card without one. */
  conversationStaleness?: ConversationStaleness;
  /** Collapses the card to a single dense row (avatar, name, value) —
   *  used once a column has enough leads that full cards would push
   *  most of them below the fold. See StageColumn's COMPACT_THRESHOLD. */
  compact?: boolean;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({
  deal,
  stage,
  onEdit,
  isOverlay,
  conversationStaleness,
  compact,
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const assigneeLabel = deal.assignee?.full_name || null;

  if (compact) {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (isOverlay) return;
          e.stopPropagation();
          onEdit(deal);
        }}
        title={deal.title}
        className={`group relative flex w-full items-center gap-2 rounded-xl border border-border/50 bg-muted/70 py-1.5 pl-3 pr-2.5 text-left shadow-sm transition-all ${
          isOverlay ? "shadow-xl" : "hover:border-border hover:bg-muted hover:shadow-md"
        }`}
      >
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
          style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
        />
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {deal.title}
        </span>
        {deal.status === "won" && (
          <Check className="h-3 w-3 shrink-0 text-primary" aria-label={t("won")} />
        )}
        {deal.status === "lost" && (
          <X className="h-3 w-3 shrink-0 text-red-400" aria-label={t("lost")} />
        )}
        <span className="shrink-0 text-xs font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-2xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-2xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      {/* Name — the ONE place the lead's name renders. It used to also
          repeat in a "contact row" right below, since deal.title
          defaults to the contact's name for every auto-created lead
          (webhook-processor.ts's ensureLeadDeal) — that row is gone
          now, replaced by phone/company below. */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {/* AI running summary (sales mode / any AI-assisted lead with an
          open deal) — a single truncated line, not the old 2-line
          clamp, so a crowded column doesn't grow every card for a
          summary nobody reads at a glance. Hover the icon for the
          full text instead of it eating card space outright. */}
      {deal.ai_summary && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="shrink-0 text-primary" onClick={(e) => e.stopPropagation()}>
                    <Sparkles className="h-2.5 w-2.5" />
                  </span>
                }
              />
              <TooltipContent side="top" className="max-w-[260px] whitespace-normal text-left">
                {deal.ai_summary}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="truncate">{deal.ai_summary}</span>
        </div>
      )}

      {/* Phone + score */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {initials(deal.contact?.name, deal.contact?.phone)}
          </span>
          {deal.contact?.phone && (
            <span className="flex min-w-0 items-center gap-1 truncate">
              <Phone className="h-3 w-3 shrink-0" />
              {deal.contact.phone}
            </span>
          )}
        </span>
        <LeadScoreBadge
          score={deal.contact?.lead_score}
          reason={deal.contact?.lead_score_reason}
          updatedAt={deal.contact?.lead_score_updated_at}
        />
      </div>

      {/* Company */}
      {deal.contact?.company && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{deal.contact.company}</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {/* "Cooling off" escalation — only for open deals; a won/lost
          deal isn't waiting on anyone anymore. */}
      {deal.status === "open" && conversationStaleness && (
        <div className="mt-2">
          <LeadStalenessBadge
            lastMessageAt={conversationStaleness.last_message_at}
            lastMessageSenderType={conversationStaleness.last_message_sender_type}
          />
        </div>
      )}

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
