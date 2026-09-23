"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, DollarSign, Flame, Sparkles, Target, TrendingDown, Users2, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { rangeForPreset, type PeriodPreset } from "@/lib/period";
import { PeriodSelector } from "@/components/period-selector";
import { MetricCard, type MetricCardTint } from "@/components/dashboard/metric-card";
import { SkeletonCard } from "@/components/dashboard/skeleton";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { Card, CardContent } from "@/components/ui/card";
import type { Insight } from "@/lib/sales-intelligence/insights";
import type { SellerPeriodPerformance } from "@/lib/dashboard/ceo-queries";
import type { StageDropoff } from "@/lib/decision-center/breakdown";

// ============================================================
// Centro de Decisiones — client-side content. The role gate already
// happened server-side in page.tsx before this ever mounted; nothing
// here re-checks it (client-side role checks elsewhere in the app,
// e.g. useAuth()'s canViewDashboardSection, exist to hide/show WIDGETS
// within an already-accessible page — this page's very existence is
// the thing being gated, at the server, once).
//
// Built stage by stage per the approved plan. This stage: Section 1
// ("¿Cómo está tu negocio?") — the period selector + the five
// headline KPIs, each with a comparison against the immediately
// preceding equal-length period. Every number comes from
// GET /api/manager/decision-center, itself built entirely on
// ceo-queries.ts functions already proven on /dashboard — no new
// calculation logic beyond loadPeriodCommercialTrend (added
// alongside this stage for the one comparison /dashboard never
// needed: win rate/avg ticket tied to an arbitrary selected period
// rather than a fixed trailing window).
// ============================================================

interface PeriodValue {
  current: number;
  previous: number;
}

interface DecisionCenterKpis {
  sales: PeriodValue;
  leads: PeriodValue;
  /** Percent (0-100), not a PeriodValue — a period with zero closed
   *  deals has no rate to report at all, not a rate of 0. */
  conversion: { current: number | null; previous: number | null };
  avgTicket: PeriodValue;
  opportunities: PeriodValue;
}

interface DecisionCenterBreakdown {
  bySeller: SellerPeriodPerformance[];
  worstDecliningSeller: (SellerPeriodPerformance & { winRateDeltaPts: number }) | null;
  stageDropoffs: StageDropoff[];
  biggestLeakStage: StageDropoff | null;
}

interface DecisionCenterResponse {
  range: { label: PeriodPreset; start: string; end: string };
  kpis: DecisionCenterKpis;
  interpretation: string;
  decisions: Insight[];
  breakdown: DecisionCenterBreakdown;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Percent change vs the previous period — null when there's nothing
 *  to compare against (previous was 0), so the card shows "—" instead
 *  of a nonsensical "+∞%" or a misleading "+100%". */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function DecisionCenterView() {
  const t = useTranslations("DecisionCenter");
  const { defaultCurrency } = useAuth();

  const [preset, setPreset] = useState<PeriodPreset>("last7Days");
  const [customStart, setCustomStart] = useState(todayIso());
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [data, setData] = useState<DecisionCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (preset === "custom" && customStart && customEnd) {
      return rangeForPreset("custom", { start: new Date(customStart), end: new Date(customEnd) });
    }
    return rangeForPreset(preset);
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- entering a loading state for the fetch this same effect kicks off below
    setLoading(true);
    const params = new URLSearchParams({ preset: range.label });
    if (range.label === "custom") {
      params.set("start", customStart);
      params.set("end", customEnd);
    }
    fetch(`/api/manager/decision-center?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`decision-center request failed: ${res.status}`);
        return res.json() as Promise<DecisionCenterResponse>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => console.error("[decision-center] load failed:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `range` is derived from preset/customStart/customEnd every render; depending on those three directly (not the derived object) avoids an extra fetch from a new-but-equal range reference
  }, [preset, customStart, customEnd]);

  const kpis = data?.kpis ?? null;

  const deltaLabel = (pct: number | null) => {
    if (pct == null) return t("noComparison");
    if (pct === 0) return t("noChange");
    const sign = pct > 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}% ${t("vsPreviousPeriod")}`;
  };

  const pointsLabel = (deltaPts: number | null) => {
    if (deltaPts == null) return t("noComparison");
    if (deltaPts === 0) return t("noChange");
    const sign = deltaPts > 0 ? "+" : "";
    return `${sign}${deltaPts.toFixed(1)} ${t("points")}`;
  };

  const card = (
    key: string,
    title: string,
    value: string,
    icon: typeof DollarSign,
    tint: MetricCardTint,
    delta: { sign: number; label: string },
  ) => <MetricCard key={key} title={title} value={value} icon={icon} tint={tint} delta={delta} />;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("stateTitle")}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {loading || !kpis ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              {card(
                "sales",
                t("kpiSales"),
                formatCurrency(kpis.sales.current, defaultCurrency),
                DollarSign,
                "green",
                { sign: kpis.sales.current - kpis.sales.previous, label: deltaLabel(pctChange(kpis.sales.current, kpis.sales.previous)) },
              )}
              {card(
                "leads",
                t("kpiLeads"),
                kpis.leads.current.toLocaleString(),
                Users2,
                "blue",
                { sign: kpis.leads.current - kpis.leads.previous, label: deltaLabel(pctChange(kpis.leads.current, kpis.leads.previous)) },
              )}
              {card(
                "conversion",
                t("kpiConversion"),
                kpis.conversion.current != null ? `${kpis.conversion.current.toFixed(1)}%` : "—",
                Target,
                "purple",
                {
                  sign:
                    kpis.conversion.current != null && kpis.conversion.previous != null
                      ? kpis.conversion.current - kpis.conversion.previous
                      : 0,
                  label: pointsLabel(
                    kpis.conversion.current != null && kpis.conversion.previous != null
                      ? kpis.conversion.current - kpis.conversion.previous
                      : null,
                  ),
                },
              )}
              {card(
                "avgTicket",
                t("kpiAvgTicket"),
                formatCurrency(kpis.avgTicket.current, defaultCurrency),
                Wallet,
                "amber",
                {
                  sign: kpis.avgTicket.current - kpis.avgTicket.previous,
                  label: deltaLabel(pctChange(kpis.avgTicket.current, kpis.avgTicket.previous)),
                },
              )}
              {card(
                "opportunities",
                t("kpiOpportunities"),
                kpis.opportunities.current.toLocaleString(),
                Flame,
                "rose",
                {
                  sign: kpis.opportunities.current - kpis.opportunities.previous,
                  label: deltaLabel(pctChange(kpis.opportunities.current, kpis.opportunities.previous)),
                },
              )}
            </>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("interpretationTitle")}
        </h2>
        {loading || !data ? (
          <SkeletonCard />
        ) : (
          <Card>
            <CardContent className="flex items-start gap-3 pt-6">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="text-sm leading-relaxed text-foreground">{data.interpretation}</p>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("decisionsTitle")}
        </h2>
        <InsightsPanel
          insights={data?.decisions ?? null}
          loading={loading}
          currency={defaultCurrency}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {t("breakdownTitle")}
        </h2>
        {loading || !data ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : (
          <div className="space-y-3">
            {data.breakdown.biggestLeakStage && (data.breakdown.biggestLeakStage.dropPct ?? 0) > 0 && (
              <Card>
                <CardContent className="flex items-start gap-3 pt-6">
                  <TrendingDown className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
                  <p className="text-sm leading-relaxed text-foreground">
                    {t("biggestLeak", {
                      from: data.breakdown.biggestLeakStage.fromLabel,
                      to: data.breakdown.biggestLeakStage.toLabel,
                      pct: (data.breakdown.biggestLeakStage.dropPct ?? 0).toFixed(1),
                    })}
                  </p>
                </CardContent>
              </Card>
            )}

            {data.breakdown.bySeller.length > 0 && (
              <Card>
                <CardContent className="pt-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="pb-2 font-medium">{t("sellerColumn")}</th>
                        <th className="pb-2 font-medium">{t("wonColumn")}</th>
                        <th className="pb-2 font-medium">{t("winRateColumn")}</th>
                        <th className="pb-2 font-medium">{t("winRateDeltaColumn")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.breakdown.bySeller]
                        .sort((a, b) => {
                          const da = a.winRateCurrent != null && a.winRatePrevious != null ? a.winRateCurrent - a.winRatePrevious : 0;
                          const db = b.winRateCurrent != null && b.winRatePrevious != null ? b.winRateCurrent - b.winRatePrevious : 0;
                          return da - db;
                        })
                        .map((s) => {
                          const delta = s.winRateCurrent != null && s.winRatePrevious != null ? s.winRateCurrent - s.winRatePrevious : null;
                          const isWorst = data.breakdown.worstDecliningSeller?.userId === s.userId;
                          return (
                            <tr key={s.userId} className={`border-b border-border/50 last:border-0 ${isWorst ? "bg-rose-500/[0.06]" : ""}`}>
                              <td className="py-2 text-foreground">{s.name}</td>
                              <td className="py-2 tabular-nums text-foreground">{s.dealsWonCurrent}</td>
                              <td className="py-2 tabular-nums text-foreground">
                                {s.winRateCurrent != null ? `${s.winRateCurrent.toFixed(1)}%` : "—"}
                              </td>
                              <td className="py-2 tabular-nums">
                                {delta == null ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <span className={`inline-flex items-center gap-1 ${delta < 0 ? "text-rose-500" : delta > 0 ? "text-emerald-500" : "text-muted-foreground"}`}>
                                    {delta < 0 ? <ArrowDown className="h-3.5 w-3.5" /> : delta > 0 ? <ArrowUp className="h-3.5 w-3.5" /> : null}
                                    {Math.abs(delta).toFixed(1)} {t("points")}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {data.breakdown.bySeller.length === 0 && !data.breakdown.biggestLeakStage && (
              <p className="text-sm text-muted-foreground">{t("noBreakdownData")}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
