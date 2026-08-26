"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import {
  fetchLeadScoreHistory,
  type LeadScoreHistoryEntry,
} from "@/lib/contacts/lead-score-api";

const SCORE_LABEL_KEY: Record<"hot" | "warm" | "cold", "hot" | "warm" | "cold"> = {
  hot: "hot",
  warm: "warm",
  cold: "cold",
};

/**
 * Compact audit trail of every `contacts.lead_score` change for one
 * contact (migration 061) — every AI (re)score and every manual
 * override, newest first. Lazily fetched, same posture as the other
 * per-tab fetches in `contact-detail-view.tsx`.
 */
export function LeadScoreHistory({ contactId }: { contactId: string }) {
  const t = useTranslations("Leads");
  const [entries, setEntries] = useState<LeadScoreHistoryEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntries(null);
    setError(false);
    fetchLeadScoreHistory(contactId)
      .then((history) => alive && setEntries(history))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [contactId]);

  if (entries === null && !error) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-muted-foreground">{t("historyLoadError")}</p>;
  }

  if (entries!.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("historyEmpty")}</p>;
  }

  return (
    <ul className="space-y-2">
      {entries!.map((entry) => (
        <li key={entry.id} className="rounded-md border border-border/50 bg-muted/30 p-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">
              {entry.old_score ? `${t(SCORE_LABEL_KEY[entry.old_score])} → ` : ""}
              {t(SCORE_LABEL_KEY[entry.new_score])}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {new Date(entry.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          {entry.reason && <p className="mt-1 text-muted-foreground">{entry.reason}</p>}
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            {entry.source === "ai" ? t("sourceAi") : (entry.changed_by_name ?? t("sourceManual"))}
          </p>
        </li>
      ))}
    </ul>
  );
}
