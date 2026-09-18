"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { format } from "date-fns";
import { Building2, Check, Loader2, RotateCcw, User } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Request {
  id: string;
  accountId: string;
  accountName: string;
  createdByName: string | null;
  createdByEmail: string | null;
  subject: string;
  message: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}

const STATUS_STYLE: Record<Request["status"], string> = {
  open: "border-amber-500/25 bg-amber-500/[0.04]",
  resolved: "border-border bg-card/50",
};

export function SupportRequestsList({ initialRequests }: { initialRequests: Request[] }) {
  const t = useTranslations("Agency.support");
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function toggleStatus(req: Request) {
    const nextStatus = req.status === "open" ? "resolved" : "open";
    setPendingId(req.id);
    try {
      const res = await fetch(`/api/agency/support-requests/${req.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        toast.error(t("updateError"));
        return;
      }
      setRequests((prev) =>
        prev.map((r) => (r.id === req.id ? { ...r, status: nextStatus } : r)),
      );
      toast.success(nextStatus === "resolved" ? t("resolvedSuccess") : t("reopenedSuccess"));
      router.refresh();
    } catch {
      toast.error(t("updateError"));
    } finally {
      setPendingId(null);
    }
  }

  if (requests.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      {requests.map((req) => (
        <div
          key={req.id}
          className={`rounded-xl border p-4 ${STATUS_STYLE[req.status]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <Building2 className="h-3 w-3" />
                  {req.accountName}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {req.createdByName || req.createdByEmail || "—"}
                </span>
                <span>·</span>
                <span>{format(new Date(req.createdAt), "d MMM yyyy, HH:mm")}</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-foreground">{req.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {req.message}
              </p>
            </div>
            <Button
              size="sm"
              variant={req.status === "open" ? "default" : "outline"}
              disabled={pendingId === req.id}
              onClick={() => toggleStatus(req)}
              className="shrink-0"
            >
              {pendingId === req.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : req.status === "open" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {req.status === "open" ? t("resolveAction") : t("reopenAction")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
