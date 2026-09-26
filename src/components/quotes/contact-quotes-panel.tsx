"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, FileText, Loader2, Pencil, Plus, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QuoteEditorDialog } from "./quote-editor-dialog";

interface QuoteRow {
  id: string;
  number: string;
  status: "draft" | "sent" | "accepted" | "rejected";
  total: number;
  currency: string;
  created_at: string;
  created_by_ai?: boolean;
}

const STATUS_STYLE: Record<QuoteRow["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  accepted: "bg-green-500/10 text-green-600 dark:text-green-400",
  rejected: "bg-red-500/10 text-red-600 dark:text-red-400",
};

/**
 * Inbox sidebar: this contact's quotes (migration 120) — create one from
 * the catalog, send it as a PDF on WhatsApp, record the answer.
 */
export function ContactQuotesPanel({
  contactId,
  conversationId,
}: {
  contactId: string;
  conversationId: string | null;
}) {
  const t = useTranslations("Quotes");
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<string | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/quotes?contact_id=${contactId}`);
      const data = await res.json();
      setAvailable(data.available !== false);
      setQuotes(data.quotes ?? []);
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (n: number, currency: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
    } catch {
      return `${currency} ${Number(n).toFixed(2)}`;
    }
  };

  const send = async (q: QuoteRow) => {
    setBusyId(q.id);
    try {
      const res = await fetch(`/api/quotes/${q.id}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(errorText(t, data.error));
      toast.success(t("sent"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("sendFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (q: QuoteRow, status: "accepted" | "rejected") => {
    setBusyId(q.id);
    try {
      const res = await fetch(`/api/quotes/${q.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setBusyId(null);
    }
  };

  if (!available) return null;

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <FileText className="h-3 w-3" />
        <span className="flex-1">{t("title")}</span>
        <button
          type="button"
          onClick={() => setEditor("new")}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] normal-case tracking-normal text-primary hover:bg-primary/10"
        >
          <Plus className="h-3 w-3" />
          {t("new")}
        </button>
      </div>

      <div className="mt-2 space-y-1.5">
        {loading ? (
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
        ) : quotes.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("none")}</p>
        ) : (
          quotes.map((q) => (
            <div key={q.id} className="rounded-lg border border-border px-2.5 py-2 text-xs">
              <div className="flex items-center gap-2">
                <a
                  href={`/api/quotes/${q.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-foreground hover:underline"
                >
                  {q.number}
                </a>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", STATUS_STYLE[q.status])}>
                  {t(`status.${q.status}`)}
                </span>
                {q.created_by_ai && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {t("byAi")}
                  </span>
                )}
                <span className="ml-auto font-semibold tabular-nums">{money(Number(q.total), q.currency)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {q.status === "draft" && (
                  <>
                    <Button size="xs" variant="outline" disabled={busyId === q.id} onClick={() => setEditor(q.id)}>
                      <Pencil className="h-3 w-3" />
                      {t("edit")}
                    </Button>
                    <Button size="xs" disabled={busyId === q.id} onClick={() => send(q)}>
                      {busyId === q.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      {t("send")}
                    </Button>
                  </>
                )}
                {q.status === "sent" && (
                  <>
                    <Button size="xs" variant="outline" disabled={busyId === q.id} onClick={() => setStatus(q, "accepted")}>
                      <Check className="h-3 w-3 text-green-600" />
                      {t("markAccepted")}
                    </Button>
                    <Button size="xs" variant="outline" disabled={busyId === q.id} onClick={() => setStatus(q, "rejected")}>
                      <X className="h-3 w-3 text-red-600" />
                      {t("markRejected")}
                    </Button>
                    <Button size="xs" variant="ghost" disabled={busyId === q.id} onClick={() => send(q)}>
                      <Send className="h-3 w-3" />
                      {t("resend")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <QuoteEditorDialog
        target={editor}
        contactId={contactId}
        conversationId={conversationId}
        onClose={() => setEditor(null)}
        onSaved={() => {
          setEditor(null);
          void load();
        }}
      />
    </div>
  );
}

export function errorText(t: ReturnType<typeof useTranslations>, code: unknown): string {
  if (code === "no_conversation") return t("errors.noConversation");
  if (code === "empty") return t("errors.empty");
  if (typeof code === "string" && code) return code;
  return t("sendFailed");
}
