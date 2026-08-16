"use client";

import { Flame, Sun, Snowflake } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const STYLES = {
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
} as const;

interface LeadScoreBadgeProps {
  score: "hot" | "warm" | "cold" | null | undefined;
  className?: string;
}

/**
 * Small pill showing the AI's current HOT/WARM/COLD read on a lead
 * (`contacts.lead_score`, migration 038). Renders nothing when the
 * contact hasn't been scored yet (null) so unconfigured accounts don't
 * see a "Not scored" badge on every single contact.
 */
export function LeadScoreBadge({ score, className }: LeadScoreBadgeProps) {
  const t = useTranslations("Leads");
  if (!score) return null;

  const { icon: Icon, className: styleClassName } = STYLES[score];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        styleClassName,
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {t(score)}
    </span>
  );
}
