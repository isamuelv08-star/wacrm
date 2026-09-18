"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { format } from "date-fns";
import { Headset, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface SupportRequestRow {
  id: string;
  subject: string;
  message: string;
  status: "open" | "resolved";
  created_at: string;
}

const STATUS_STYLE: Record<SupportRequestRow["status"], string> = {
  open: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  resolved: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
};

/**
 * "Contact support" — client-side half of migration 098's
 * support_requests table. A member submits a short subject/message,
 * insert goes straight through the regular Supabase client (RLS —
 * is_account_member — scopes it, no API route needed, same posture as
 * team_chat_messages). The agency owner sees every account's requests
 * cross-account in /agency's Soporte section and resolves them there;
 * this dialog only ever shows THIS account's own history, and has no
 * way to mark one resolved itself (no UPDATE policy for members).
 */
export function SupportRequestDialog({
  trigger,
}: {
  /** The sidebar row that opens this dialog. */
  trigger: React.ReactNode;
}) {
  const t = useTranslations("SupportRequest");
  const { accountId, user } = useAuth();

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<SupportRequestRow[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!accountId) return;
    setLoadingHistory(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_requests")
        .select("id, subject, message, status, created_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false });
      if (error) {
        toast.error(t("loadError"));
        return;
      }
      setRequests(data as SupportRequestRow[]);
    } finally {
      setLoadingHistory(false);
    }
  }, [accountId, t]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && requests === null) void fetchHistory();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !user) return;
    if (!subject.trim() || !message.trim()) {
      toast.error(t("requiredFieldsError"));
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("support_requests")
        .insert({
          account_id: accountId,
          created_by_user_id: user.id,
          subject: subject.trim(),
          message: message.trim(),
        })
        .select("id, subject, message, status, created_at")
        .single();
      if (error) {
        toast.error(t("submitError"));
        return;
      }
      toast.success(t("submitSuccess"));
      setRequests((prev) => [data as SupportRequestRow, ...(prev ?? [])]);
      setSubject("");
      setMessage("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Headset className="h-4 w-4 text-primary" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {t("subjectLabel")}
            </label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("subjectPlaceholder")}
              className="mt-1"
              maxLength={200}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {t("messageLabel")}
            </label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("messagePlaceholder")}
              className="mt-1 min-h-24"
              maxLength={4000}
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </form>

        <div className="mt-2 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("historyTitle")}
          </p>
          {loadingHistory ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : !requests || requests.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("noRequests")}</p>
          ) : (
            <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
              {requests.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{r.subject}</p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        STATUS_STYLE[r.status],
                      )}
                    >
                      {r.status === "open" ? t("statusOpen") : t("statusResolved")}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {format(new Date(r.created_at), "d MMM yyyy, HH:mm")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
