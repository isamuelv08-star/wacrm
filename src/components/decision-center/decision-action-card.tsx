"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import type { Insight } from "@/lib/sales-intelligence/insights";
import { actionHref } from "@/components/dashboard/insights-panel";
import { buildActionGuidance } from "@/lib/decision-center/action-guidance";
import { formatCurrency } from "@/lib/currency";
import { Card, CardContent } from "@/components/ui/card";

export type DecisionCardTier = "actNow" | "reviewToday";

interface DecisionActionCardProps {
  insight: Insight;
  currency: string;
  tier: DecisionCardTier;
}

const TIER_STYLE: Record<DecisionCardTier, { emoji: string; border: string; badge: string }> = {
  actNow: { emoji: "🔴", border: "border-rose-500/30", badge: "bg-rose-500/15 text-rose-500" },
  reviewToday: { emoji: "🟠", border: "border-amber-400/30", badge: "bg-amber-400/15 text-amber-500" },
};

/**
 * The "Problema → Impacto → Acción" card format for 🔴 Actúa ahora /
 * 🟠 Revisa hoy — a richer, Centro de Decisiones-only presentation of
 * the same `Insight` <InsightsPanel /> already renders as a compact
 * row on /dashboard. Deliberately a NEW component rather than a mode
 * added to InsightsPanel: that component is shared with /dashboard's
 * "Saleslid detectó" panel and the daily report dialog, and this
 * format (title + qué pasa + qué hacer + value badge + action link,
 * each its own labeled block) is Decision-Center-specific — adding it
 * there would mean a `richFormat` prop neither of those other two
 * callers would ever pass, just extra branches in a file they depend
 * on staying exactly as it is. 🟡 Vigila stays on the plain
 * <InsightsPanel /> row: lower urgency, doesn't need the same
 * ceremony (see decision-center-view.tsx).
 */
export function DecisionActionCard({ insight, currency, tier }: DecisionActionCardProps) {
  const t = useTranslations("Dashboard.insights");
  const tc = useTranslations("DecisionCenter");
  const style = TIER_STYLE[tier];
  const guidance = buildActionGuidance(insight);

  return (
    <Card className={`border ${style.border}`}>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">
            <span className="mr-1.5">{style.emoji}</span>
            {t(insight.titleKey, insight.params)}
          </p>
          {insight.valueAtRisk != null && insight.valueAtRisk > 0 && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${style.badge}`}>
              {formatCurrency(insight.valueAtRisk, currency)}
            </span>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {tc("whatIsHappening")}
          </p>
          <p className="mt-0.5 text-sm text-foreground">{t(insight.descriptionKey, insight.params)}</p>
        </div>

        {guidance && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {tc("whatToDo")}
            </p>
            <p className="mt-0.5 text-sm text-foreground">{guidance}</p>
          </div>
        )}

        <Link
          href={actionHref(insight)}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {tc("reviewAction")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
