"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Sparkles } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { formatCurrency } from "@/lib/currency"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { InsightsPanel } from "./insights-panel"
import type { Insight } from "@/lib/sales-intelligence/insights"
import type { CeoMetrics, CommercialMetrics } from "@/lib/dashboard/ceo-types"
import { ceoSummaryRangeParams, rangeForPreset } from "@/lib/period"

interface ReportResponse {
  ceoMetrics: CeoMetrics | null
  commercialMetrics: CommercialMetrics | null
  insights: Insight[] | null
}

/**
 * The popup itself — same data /dashboard/informe shows in full,
 * compacted to 3 insights. Own small fetch (default preset=thisMonth)
 * rather than threading /dashboard's already-fetched state down here:
 * this mounts at the SHELL level, above every page, so it can't
 * assume /dashboard's own state exists yet.
 *
 * Both "Ver informe completo" and "Ahora no" close the dialog the same
 * way (`onOpenChange(false)`) — DailyReportGate stamps the "seen
 * today" watermark on ANY close, not just an explicit dismissal, so
 * clicking through to the full report also counts as having seen
 * today's summary and the popup doesn't return later in the same
 * session.
 */
export function DailyReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("Dashboard.dailyReport")
  const router = useRouter()
  const { defaultCurrency } = useAuth()
  const [data, setData] = useState<ReportResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/dashboard/ceo-summary?${ceoSummaryRangeParams(rangeForPreset("thisMonth")).toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`ceo-summary request failed: ${res.status}`)
        return res.json() as Promise<ReportResponse>
      })
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch((err) => console.error("[daily-report-dialog] load failed:", err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const ceoMetrics = data?.ceoMetrics ?? null
  const commercialMetrics = data?.commercialMetrics ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("dialogTitle")}
          </DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        {!loading && ceoMetrics && (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">{t("kpiSales")}</p>
              <p className="font-semibold text-foreground">
                {formatCurrency(ceoMetrics.salesThisMonth.current, defaultCurrency)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">{t("kpiLeads")}</p>
              <p className="font-semibold text-foreground">
                {Math.round(ceoMetrics.newClients.current).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">{t("kpiOpportunities")}</p>
              <p className="font-semibold text-foreground">
                {formatCurrency(ceoMetrics.pipelineTotal, defaultCurrency)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">{t("kpiConversion")}</p>
              <p className="font-semibold text-foreground">
                {commercialMetrics?.winRatePct != null ? `${commercialMetrics.winRatePct.toFixed(0)}%` : "—"}
              </p>
            </div>
          </div>
        )}

        <InsightsPanel
          insights={data?.insights ?? null}
          loading={loading}
          currency={defaultCurrency}
          compact
        />

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("notNow")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onOpenChange(false)
              router.push("/dashboard/informe")
            }}
          >
            {t("viewFullReport")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
