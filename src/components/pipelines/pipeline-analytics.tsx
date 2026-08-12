"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Deal, PipelineStage } from "@/types";
import {
  DollarSign,
  TrendingUp,
  Target,
  BarChart3,
  Trophy,
  XCircle,
  Info,
  UserPlus,
  Award,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

type Period = "week" | "month";

interface PipelineAnalyticsProps {
  /** Needed for the "reached qualified" query — a deal_stage_history
   *  lookup scoped to this pipeline, not derivable from `deals` alone. */
  pipelineId: string;
  stages: PipelineStage[];
  deals: Deal[];
}

/**
 * Weighted pipeline value: value × per-stage probability.
 * First stage ≈ 10%, stages interpolate up to 90% before the final stage,
 * final stage (Won) = 100%. Lost deals excluded.
 */
function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[],
): number {
  const n = sortedStages.length;
  if (n <= 1) return 1;
  const index = sortedStages.findIndex((s) => s.id === stage.id);
  if (index < 0) return 0;
  if (index === n - 1) return 1;
  const slots = n - 1;
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}

function periodStart(period: Period): Date {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function PipelineAnalytics({ pipelineId, stages, deals }: PipelineAnalyticsProps) {
  const t = useTranslations("Pipelines.analytics");
  const { defaultCurrency } = useAuth();
  const [period, setPeriod] = useState<Period>("month");
  // null = loading/not applicable; a real query (deal_stage_history isn't
  // part of the already-loaded `deals` list) so it resolves separately
  // from the client-side `stats` below.
  const [reachedQualifiedCount, setReachedQualifiedCount] = useState<number | null>(null);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );
  const qualifiedStage = useMemo(
    () => stages.find((s) => s.is_qualified_stage) ?? null,
    [stages],
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== "lost");
    const openDeals = active.filter((d) => d.status !== "won");

    const totalCount = active.length;
    const totalValue = active.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const avgValue = totalCount > 0 ? totalValue / totalCount : 0;

    const stageById = new Map(sortedStages.map((s) => [s.id, s]));
    const weightedValue = openDeals.reduce((sum, d) => {
      const stage = stageById.get(d.stage_id);
      if (!stage) return sum;
      const prob = computeStageProbability(stage, sortedStages);
      return sum + Number(d.value || 0) * prob;
    }, 0);

    const start = periodStart(period);
    const inPeriod = (d: Deal) => {
      const ts = d.updated_at ?? d.created_at;
      return ts ? new Date(ts) >= start : false;
    };
    const wonInPeriod = deals.filter((d) => d.status === "won" && inPeriod(d)).length;
    const lostInPeriod = deals.filter((d) => d.status === "lost" && inPeriod(d)).length;
    const leadsEntered = deals.filter((d) => new Date(d.created_at) >= start).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonInPeriod,
      lostInPeriod,
      leadsEntered,
    };
  }, [deals, sortedStages, period]);

  // "Reached qualified" needs deal_stage_history (migration 039) — not
  // part of the `deals` list the page already loaded — so it's the one
  // metric here that's a real query instead of a client-side reduction.
  // Counts DISTINCT deals so one bouncing in/out of the stage twice in
  // the period still counts once.
  useEffect(() => {
    if (!qualifiedStage) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReachedQualifiedCount(null);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    const start = periodStart(period);
    supabase
      .from("deal_stage_history")
      .select("deal_id")
      .eq("pipeline_id", pipelineId)
      .eq("to_stage_id", qualifiedStage.id)
      .gte("changed_at", start.toISOString())
      .limit(5000)
      .then(({ data }) => {
        if (cancelled) return;
        setReachedQualifiedCount(new Set((data ?? []).map((r) => r.deal_id as string)).size);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineId, qualifiedStage, period]);

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* Snapshot metrics — current state, not affected by the period selector. */}
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-4">
          <Metric
            icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
            label={t("totalDeals")}
            value={String(stats.totalCount)}
            tooltip={t("totalDealsTooltip")}
            t={t}
          />
          <Metric
            icon={<DollarSign className="h-4 w-4 text-primary" />}
            label={t("pipelineValue")}
            value={formatCurrency(stats.totalValue, defaultCurrency)}
            tooltip={t("pipelineValueTooltip")}
            t={t}
          />
          <Metric
            icon={<Target className="h-4 w-4 text-blue-400" />}
            label={t("avgDealSize")}
            value={formatCurrency(stats.avgValue, defaultCurrency)}
            tooltip={t("avgDealSizeTooltip")}
            t={t}
          />
          <Metric
            icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
            label={t("weightedValue")}
            value={formatCurrency(stats.weightedValue, defaultCurrency)}
            tooltip={t("weightedValueTooltip")}
            t={t}
          />
        </div>

        {/* Period metrics — activity during the selected window. */}
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("periodLabel")}
            </span>
            <div className="flex rounded-md border border-border p-0.5">
              {(["week", "month"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                    period === p
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p === "week" ? t("periodWeek") : t("periodMonth")}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              icon={<UserPlus className="h-4 w-4 text-blue-400" />}
              label={t("leadsEntered")}
              value={String(stats.leadsEntered)}
              tooltip={t("leadsEnteredTooltip")}
              t={t}
            />
            {qualifiedStage ? (
              <Metric
                icon={<Award className="h-4 w-4 text-amber-400" />}
                label={t("reachedQualified")}
                value={reachedQualifiedCount === null ? "…" : String(reachedQualifiedCount)}
                tooltip={t("reachedQualifiedTooltip")}
                t={t}
              />
            ) : (
              <div className="rounded-lg bg-muted/50 p-3 text-[11px] leading-snug text-muted-foreground">
                {t("noQualifiedStage")}
              </div>
            )}
            <Metric
              icon={<Trophy className="h-4 w-4 text-primary" />}
              label={t("won")}
              value={String(stats.wonInPeriod)}
              tooltip={t("wonTooltip")}
              t={t}
            />
            <Metric
              icon={<XCircle className="h-4 w-4 text-red-400" />}
              label={t("lost")}
              value={String(stats.lostInPeriod)}
              tooltip={t("lostTooltip")}
              t={t}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Metric({
  icon,
  label,
  value,
  tooltip,
  t,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t("howCalculated", { label })}
                className="ml-auto text-muted-foreground hover:text-foreground focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}
