"use client";

import { useState } from "react";
import { Flame, Sun, Snowflake, Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setLeadScore } from "@/lib/contacts/lead-score-api";

export type Score = "hot" | "warm" | "cold";

/** Shared hot/warm/cold icon + color vocabulary — reused by the Inbox's
 *  lead-score filter tabs and the Dashboard's "qualified today" card so
 *  every surface reads the same categories the same way. */
export const LEAD_SCORE_STYLES: Record<Score, { icon: typeof Flame; className: string }> = {
  hot: {
    icon: Flame,
    className: "bg-red-500/15 text-red-500",
  },
  warm: {
    icon: Sun,
    className: "bg-amber-500/15 text-amber-500",
  },
  cold: {
    icon: Snowflake,
    className: "bg-sky-500/15 text-sky-500",
  },
};

const SCORE_ORDER: Score[] = ["hot", "warm", "cold"];

/** A score that hasn't been reassessed in this long reads as potentially
 *  out of date rather than a fresh, confident verdict — see the badge's
 *  small clock indicator below. */
const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

interface LeadScoreBadgeProps {
  score: Score | null | undefined;
  /** Short explanation for the current score (`contacts.lead_score_reason`,
   *  migration 061) — shown in the tooltip / override popover. */
  reason?: string | null;
  /** When the current score was last (re)assessed
   *  (`contacts.lead_score_updated_at`, migration 061) — drives the
   *  staleness indicator. */
  updatedAt?: string | null;
  /** When true, the badge opens a popover letting an agent correct the
   *  score (migration 061's manual override). Requires `contactId`. */
  editable?: boolean;
  contactId?: string;
  /** Called after a successful manual override so the caller can update
   *  its local contact state without a full refetch. */
  onScoreChange?: (next: { score: Score; reason: string | null }) => void;
  className?: string;
}

function daysSince(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export function LeadScoreBadge({
  score,
  reason,
  updatedAt,
  editable = false,
  contactId,
  onScoreChange,
  className,
}: LeadScoreBadgeProps) {
  const t = useTranslations("Leads");
  const [open, setOpen] = useState(false);
  const [draftScore, setDraftScore] = useState<Score | null>(score ?? null);
  const [draftReason, setDraftReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lazy initializer (not a direct Date.now()/new Date() call in the
  // render body) — same "seed once, don't call an impure clock during
  // render" pattern as LeadStalenessBadge (pipelines/lead-staleness-badge.tsx).
  // A 14-day threshold needs no live ticking, so no setInterval either.
  const [now] = useState(() => new Date());

  if (!score) return null;

  const { icon: Icon, className: styleClassName } = LEAD_SCORE_STYLES[score];
  const stale = !!updatedAt && now.getTime() - new Date(updatedAt).getTime() > STALE_THRESHOLD_MS;

  const badge = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        styleClassName,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {t(score)}
      {stale && <Clock className="h-2.5 w-2.5 opacity-70" />}
    </span>
  );

  if (!editable) {
    const tooltipLines = [
      reason?.trim() || null,
      stale && updatedAt ? t("staleTooltip", { days: daysSince(updatedAt, now) }) : null,
    ].filter((line): line is string => !!line);

    if (tooltipLines.length === 0) return badge;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex">{badge}</span>} />
          <TooltipContent side="top" className="max-w-[240px] whitespace-normal text-left">
            {tooltipLines.join(" — ")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  async function handleSave() {
    if (!contactId || !draftScore) return;
    setSaving(true);
    setError(null);
    try {
      await setLeadScore(contactId, draftScore, draftReason.trim() || undefined);
      onScoreChange?.({ score: draftScore, reason: draftReason.trim() || null });
      setOpen(false);
      setDraftReason("");
    } catch {
      setError(t("overrideError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraftScore(score);
          setDraftReason("");
          setError(null);
        }
      }}
    >
      <PopoverTrigger render={<button type="button" className="inline-flex cursor-pointer">{badge}</button>} />
      <PopoverContent className="w-64" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-medium">{t("overrideTitle")}</p>
        {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
        <div className="flex gap-1.5">
          {SCORE_ORDER.map((s) => {
            const { icon: SIcon, className: sClassName } = LEAD_SCORE_STYLES[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setDraftScore(s)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold ring-1 ring-transparent",
                  sClassName,
                  draftScore === s && "ring-current",
                )}
              >
                <SIcon className="h-3 w-3" />
                {t(s)}
              </button>
            );
          })}
        </div>
        <Input
          value={draftReason}
          onChange={(e) => setDraftReason(e.target.value)}
          placeholder={t("overrideReasonPlaceholder")}
          className="h-8 text-xs"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          size="sm"
          className="h-7 w-full text-xs"
          disabled={saving || !draftScore}
          onClick={handleSave}
        >
          {saving ? t("overrideSaving") : t("overrideSave")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
