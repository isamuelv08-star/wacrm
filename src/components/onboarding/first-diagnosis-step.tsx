"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { InsightsPanel } from "@/components/dashboard/insights-panel";
import { useAuth } from "@/hooks/use-auth";
import type { Insight } from "@/lib/sales-intelligence/insights";

interface Summary {
  insights: Insight[] | null;
  totalClients: number;
}

/**
 * Onboarding's closing step — the "primer momento de valor" the audit
 * calls for, replacing the old generic "Todo listo" screen that
 * showed no real numbers and led nowhere. Reuses the exact same
 * /api/dashboard/ceo-summary + InsightsPanel the real dashboard and
 * Centro de Decisiones already use — no separate diagnosis engine,
 * just the first real read of whatever data already exists on this
 * account at this point (pipeline just created, WhatsApp maybe
 * connected, contacts/deals maybe imported).
 *
 * A genuinely empty account (no clients, no signals — the very
 * common case for a same-day signup) gets an honest "nothing yet"
 * message instead of InsightsPanel's own "todo en orden" empty
 * state, which would misleadingly read as a clean bill of health
 * rather than "no data to read yet". Per the audit brief: never
 * invent numbers.
 */
export function FirstDiagnosisStep() {
  const t = useTranslations("Onboarding.diagnosis");
  const { defaultCurrency } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/ceo-summary");
        if (!res.ok) return;
        const data = (await res.json()) as {
          insights?: Insight[] | null;
          ceoMetrics?: { totalClients?: number } | null;
        };
        setSummary({
          insights: data.insights ?? null,
          totalClients: data.ceoMetrics?.totalClients ?? 0,
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const insights = summary?.insights ?? [];
  const isEmpty = !loading && summary !== null && summary.totalClients === 0 && insights.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {!loading && summary && summary.totalClients > 0 && (
        <p className="text-sm text-muted-foreground">
          {t("clientsFound", { count: summary.totalClients })}
        </p>
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-8 text-center">
          <Sparkles className="h-6 w-6 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <InsightsPanel
          insights={summary?.insights ?? null}
          loading={loading}
          currency={defaultCurrency}
          compact
        />
      )}
    </div>
  );
}
