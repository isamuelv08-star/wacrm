"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PeriodPreset } from "@/lib/period";

interface AskSaleslidProps {
  preset: PeriodPreset;
  customStart: string;
  customEnd: string;
}

interface AskResponse {
  answer: string;
  evidence: string[];
  recommendation: string | null;
}

/**
 * Section 8, "Pregunta a Saleslid" — answers ONLY from the exact same
 * data Centro de Decisiones is already showing for the currently
 * selected period (see src/lib/decision-center/assistant.ts's own
 * doc comment on why the snapshot is built from the page's payload
 * instead of a second, independent query).
 */
export function AskSaleslid({ preset, customStart, customEnd }: AskSaleslidProps) {
  const t = useTranslations("DecisionCenter");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);

  async function handleAsk() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ preset });
      if (preset === "custom") {
        params.set("start", customStart);
        params.set("end", customEnd);
      }
      const res = await fetch(`/api/manager/decision-center/ask?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.code === "ai_not_configured" ? t("askNotConfigured") : t("askError"));
        return;
      }
      setResult(json as AskResponse);
    } catch (err) {
      console.error("[ask-saleslid] request failed:", err);
      setError(t("askError"));
    } finally {
      setAsking(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAsk();
            }}
            placeholder={t("askPlaceholder")}
            disabled={asking}
            className="flex-1"
          />
          <Button onClick={handleAsk} disabled={asking || !question.trim()}>
            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>

        {error && <p className="text-sm text-rose-500">{error}</p>}

        {result && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm text-foreground">{result.answer}</p>
            </div>
            {result.evidence.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("askEvidence")}
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                  {result.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.recommendation && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("askRecommendation")}
                </p>
                <p className="mt-1 text-sm text-foreground">{result.recommendation}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
