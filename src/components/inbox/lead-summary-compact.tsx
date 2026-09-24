"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useLeadSummary } from "@/hooks/use-lead-summary";
import { cn } from "@/lib/utils";
import type { Contact } from "@/types";

/** "hace 3 horas" / "3 hours ago" — same helper as lead-summary-tab.tsx. */
function relativeTime(iso: string, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "second");
}

/**
 * Compact "what's going on + what to do next" card for the inbox
 * sidebar — the executive-summary slice of the same AI lead profile
 * Contacts → "Resumen" shows in full (useLeadSummary, shared), so the
 * two never drift out of sync or regenerate independently. Silent
 * (renders nothing) once there's genuinely no summary to show yet —
 * this sits above the contact fields, not worth a placeholder card
 * for a brand-new lead with no messages.
 */
export function LeadSummaryCompact({ contact }: { contact: Contact }) {
  const t = useTranslations("Inbox.sidebar.summary");
  const locale = useLocale();
  const { profile, status, canRefresh, refresh } = useLeadSummary(contact);

  const generating = status === "generating";
  const summary = profile?.summary;

  if (!summary && !generating) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          {t("title")}
        </h4>
        <button
          type="button"
          onClick={refresh}
          disabled={!canRefresh || generating}
          title={t("refresh")}
          aria-label={t("refresh")}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3 w-3", generating && "animate-spin")} />
        </button>
      </div>

      {summary ? (
        <div className="space-y-2">
          <p className="line-clamp-3 text-xs leading-relaxed text-foreground">{summary.summary}</p>
          {summary.next_step && (
            <div className="rounded-md border border-primary/25 bg-primary/5 p-2">
              <p className="mb-0.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-primary">
                <ArrowRight className="h-2.5 w-2.5" />
                {t("nextStep")}
              </p>
              <p className="text-[11px] text-foreground">{summary.next_step}</p>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/80">
            {generating ? t("updating") : t("generated", { time: relativeTime(summary.generated_at, locale) })}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground" aria-busy="true">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("analyzing")}
        </div>
      )}
    </div>
  );
}
