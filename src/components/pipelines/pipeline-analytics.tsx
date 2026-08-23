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
  Download,
  Printer,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";
import { rangeForPreset, type PeriodPreset, type PeriodRange } from "@/lib/pipelines/period";
import { downloadDealsCsv, openPrintableReport, dealsInRange, type ReportStageRow } from "@/lib/pipelines/report";
import { PeriodSelector } from "./period-selector";
import { toast } from "sonner";

interface PipelineAnalyticsProps {
  /** Needed for the "reached qualified" query — a deal_stage_history
   *  lookup scoped to this pipeline, not derivable from `deals` alone. */
  pipelineId: string;
  pipelineName: string;
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

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PipelineAnalytics({ pipelineId, pipelineName, stages, deals }: PipelineAnalyticsProps) {
  const t = useTranslations("Pipelines.analytics");
  const { defaultCurrency } = useAuth();
  const [preset, setPreset] = useState<PeriodPreset>("thisMonth");
  // Seeded to today so flipping to "Custom" always starts from a valid
  // (if trivial) range instead of two empty date inputs.
  const [customStart, setCustomStart] = useState(todayIso());
  const [customEnd, setCustomEnd] = useState(todayIso());
  // null = loading/not applicable; a real query (deal_stage_history isn't
  // part of the already-loaded `deals` list) so it resolves separately
  // from the client-side `stats` below.
  const [reachedQualifiedCount, setReachedQualifiedCount] = useState<number | null>(null);

  const range: PeriodRange = useMemo(() => {
    if (preset === "custom" && customStart && customEnd) {
      return rangeForPreset("custom", { start: new Date(customStart), end: new Date(customEnd) });
    }
    return rangeForPreset(preset === "custom" ? "thisMonth" : preset);
  }, [preset, customStart, customEnd]);

  const rangeLabel = useMemo(() => formatRangeLabel(range, t), [range, t]);

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

    // `closed_at` (migration 053), not `updated_at` — updated_at moves
    // on any unrelated edit (title, notes, value), which would count a
    // deal won/lost weeks ago as "in period" just because someone
    // fixed a typo in its notes today.
    const closedInRange = (d: Deal) =>
      d.closed_at ? new Date(d.closed_at) >= range.start && new Date(d.closed_at) < range.end : false;
    const wonInPeriod = deals.filter((d) => d.status === "won" && closedInRange(d)).length;
    const lostInPeriod = deals.filter((d) => d.status === "lost" && closedInRange(d)).length;
    const leadsEntered = deals.filter((d) => {
      const created = new Date(d.created_at);
      return created >= range.start && created < range.end;
    }).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonInPeriod,
      lostInPeriod,
      leadsEntered,
    };
  }, [deals, sortedStages, range]);

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
    supabase
      .from("deal_stage_history")
      .select("deal_id")
      .eq("pipeline_id", pipelineId)
      .eq("to_stage_id", qualifiedStage.id)
      .gte("changed_at", range.start.toISOString())
      .lt("changed_at", range.end.toISOString())
      .limit(5000)
      .then(({ data }) => {
        if (cancelled) return;
        setReachedQualifiedCount(new Set((data ?? []).map((r) => r.deal_id as string)).size);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineId, qualifiedStage, range]);

  function handleExportCsv() {
    downloadDealsCsv(deals, stages, range, pipelineName, {
      title: t("csvColTitle"),
      contact: t("csvColContact"),
      value: t("csvColValue"),
      currency: t("csvColCurrency"),
      stage: t("csvColStage"),
      status: t("csvColStatus"),
      assignee: t("csvColAssignee"),
      createdAt: t("csvColCreated"),
      closedAt: t("csvColClosed"),
      statusOpen: t("statusOpen"),
      statusWon: t("statusWon"),
      statusLost: t("statusLost"),
    });
  }

  function handleExportPdf() {
    const inRange = dealsInRange(deals, range);
    const stageBreakdown: ReportStageRow[] = sortedStages.map((s) => {
      const stageDeals = inRange.filter((d) => d.stage_id === s.id);
      return {
        name: s.name,
        color: s.color || "#64748b",
        count: stageDeals.length,
        value: formatCurrency(
          stageDeals.reduce((sum, d) => sum + Number(d.value || 0), 0),
          defaultCurrency,
        ),
      };
    });

    const opened = openPrintableReport({
      pipelineName,
      rangeLabel,
      generatedOnLabel: t("reportGeneratedOn", { date: new Date().toLocaleDateString() }),
      reportTitle: t("reportTitle"),
      stageBreakdownTitle: t("reportStageBreakdown"),
      stageColumnStage: t("reportColStage"),
      stageColumnDeals: t("reportColDeals"),
      stageColumnValue: t("reportColValue"),
      metrics: [
        { label: t("totalDeals"), value: String(stats.totalCount) },
        { label: t("pipelineValue"), value: formatCurrency(stats.totalValue, defaultCurrency) },
        { label: t("leadsEntered"), value: String(stats.leadsEntered) },
        { label: t("won"), value: String(stats.wonInPeriod) },
        { label: t("lost"), value: String(stats.lostInPeriod) },
        ...(qualifiedStage
          ? [{ label: t("reachedQualified"), value: String(reachedQualifiedCount ?? 0) }]
          : []),
      ],
      stageBreakdown,
    });
    if (!opened) toast.error(t("toastPopupBlocked"));
  }

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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("periodLabel")}
              </span>
              <PeriodSelector
                preset={preset}
                customStart={customStart}
                customEnd={customEnd}
                onPresetChange={setPreset}
                onCustomChange={(start, end) => {
                  setCustomStart(start);
                  setCustomEnd(end);
                }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportCsv}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Download className="h-3.5 w-3.5" />
                {t("downloadCsv")}
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Printer className="h-3.5 w-3.5" />
                {t("downloadPdf")}
              </button>
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatRangeLabel(range: PeriodRange, t: any): string {
  switch (range.label) {
    case "thisMonth":
    case "lastMonth":
      return range.start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    case "thisQuarter":
      return `Q${Math.floor(range.start.getMonth() / 3) + 1} ${range.start.getFullYear()}`;
    case "thisYear":
      return String(range.start.getFullYear());
    case "allTime":
      return t("presetAllTime");
    case "custom": {
      const inclusiveEnd = new Date(range.end.getTime() - 1);
      return `${range.start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${inclusiveEnd.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    }
  }
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
