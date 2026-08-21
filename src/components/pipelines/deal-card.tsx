"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X, Phone, Building2, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";
import { LeadScoreBadge } from "@/components/leads/lead-score-badge";
import { LeadStalenessBadge } from "./lead-staleness-badge";
import type { ConversationStaleness } from "@/lib/pipelines/lead-staleness";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  /** Drives the "cooling off" badge — omit to render the card without one. */
  conversationStaleness?: ConversationStaleness;
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
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const assigneeLabel = deal.assignee?.full_name || null;

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
          open deal) — clamped to 2 lines so a long one doesn't blow up
          card height on a crowded column. */}
      {deal.ai_summary && (
        <p className="mt-1.5 line-clamp-2 flex items-start gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="mt-0.5 h-2.5 w-2.5 shrink-0 text-primary" />
          <span>{deal.ai_summary}</span>
        </p>
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
        <LeadScoreBadge score={deal.contact?.lead_score} />
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
