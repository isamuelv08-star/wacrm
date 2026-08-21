"use client";

import { useEffect, useState } from "react";
import { Clock, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { computeStalenessTier, minutesUnanswered } from "@/lib/pipelines/lead-staleness";

/** How often the badge re-checks the clock. Coarse on purpose — the
 *  tiers are 5+ minutes apart, so a minute of drift is invisible. */
const TICK_MS = 30_000;

const TIER_STYLE: Record<number, string> = {
  1: "bg-amber-500/15 text-amber-500",
  2: "bg-amber-500/20 text-amber-600",
  3: "bg-orange-500/20 text-orange-500",
  4: "bg-red-500/15 text-red-500",
};

interface LeadStalenessBadgeProps {
  lastMessageAt: string | null | undefined;
  lastMessageSenderType: string | null | undefined;
  className?: string;
}

/**
 * "Lead is cooling off" badge — escalates through 4 tiers the longer a
 * customer message goes unanswered (see lead-staleness.ts for the
 * exact thresholds). Renders nothing once the tier is 0 (fresh, or
 * the last message wasn't the customer's) so an actively-worked lead
 * doesn't carry a badge at all. Ticks on its own `setInterval` — not
 * just recomputed on parent re-render — so it visibly ages on a board
 * left open in the background, the way the inbox's 24h session timer
 * does not (that one only recomputes when `messages` changes).
 */
export function LeadStalenessBadge({
  lastMessageAt,
  lastMessageSenderType,
  className,
}: LeadStalenessBadgeProps) {
  const t = useTranslations("Pipelines.card.staleness");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const minutes = minutesUnanswered(lastMessageAt, lastMessageSenderType, now);
  if (minutes === null) return null;

  const tier = computeStalenessTier(minutes);
  if (tier === 0) return null;

  const elapsedLabel =
    minutes >= 60
      ? t("hoursSuffix", { hours: Math.floor(minutes / 60) })
      : t("minutesSuffix", { minutes: Math.floor(minutes / 5) * 5 });

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        TIER_STYLE[tier],
        className,
      )}
      title={t(`tier${tier}Hint`)}
    >
      {tier >= 4 ? <TriangleAlert className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
      {t(`tier${tier}`)} · {elapsedLabel}
    </span>
  );
}
