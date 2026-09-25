"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Upload, FileText, Loader2, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { parseDealCsv, type ParsedDealRow } from "@/lib/deals/parse-deal-csv";
import { dedupeByPhone, findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const PREVIEW_LIMIT = 5;

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
}

/**
 * Onboarding's opportunities/deals importer — onboarding audit
 * finding D.4: no importer for deals existed anywhere in the product
 * before this. Deliberately simpler than the contacts ImportModal it
 * sits next to: no tag system, no column-mapping UI (just synonym
 * auto-detection, see parse-deal-csv.ts) — every imported row lands
 * in the account's own pipeline, in its first stage, matching or
 * creating the contact it belongs to by phone.
 */
export function DealImportCard() {
  const t = useTranslations("Onboarding.import.deals");
  const supabase = createClient();
  const { accountId } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedDealRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const { rows: parsed } = parseDealCsv(text);
    if (parsed.length === 0) {
      toast.error(t("noValidRows"));
      setRows([]);
      return;
    }
    setRows(parsed);
  }

  async function handleImport() {
    if (rows.length === 0 || !accountId) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error("Not authenticated");

      // A fresh onboarding account has exactly one pipeline at this
      // point (created by the wizard's own pipeline step) — take the
      // oldest one, and its first (position 0, "New Lead") stage, the
      // same starting point every other automatic deal-creation path
      // in this app uses (webhook-processor.ts's ensureLeadDeal, the
      // AI qualified-lead flow).
      const { data: pipeline } = await supabase
        .from("pipelines")
        .select("id")
        .eq("account_id", accountId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      const { data: stage } = pipeline
        ? await supabase
            .from("pipeline_stages")
            .select("id")
            .eq("pipeline_id", pipeline.id)
            .order("position")
            .limit(1)
            .maybeSingle()
        : { data: null };

      if (!pipeline || !stage) {
        toast.error(t("noPipeline"));
        setImporting(false);
        return;
      }

      // One open deal per contact — the same invariant the webhook and
      // the AI enforce. A second row for the same phone, or a contact
      // that already has an open deal, is skipped instead of creating a
      // parallel card.
      const { unique, duplicates } = dedupeByPhone(rows);
      let imported = 0;
      let skipped = duplicates;
      let failed = 0;

      // The account's currency, not the deals.currency DB default (USD).
      const { data: account } = await supabase
        .from("accounts")
        .select("default_currency")
        .eq("id", accountId)
        .maybeSingle();
      const currency = account?.default_currency ?? "USD";

      for (const row of unique) {
        let contactId: string | null = null;
        const existing = await findExistingContact(supabase, accountId, row.phone);
        if (existing) {
          contactId = existing.id;
        } else {
          const { data: newContact, error: contactErr } = await supabase
            .from("contacts")
            .insert({
              user_id: user.id,
              account_id: accountId,
              phone: row.phone,
              name: row.contactName || null,
            })
            .select("id")
            .single();
          if (contactErr) {
            if (isUniqueViolation(contactErr)) {
              // Raced with another row for the same normalized phone
              // (e.g. two rows differing only in formatting) — look it
              // up again rather than failing the deal outright.
              const retried = await findExistingContact(supabase, accountId, row.phone);
              contactId = retried?.id ?? null;
            }
          } else {
            contactId = newContact?.id ?? null;
          }
        }

        if (!contactId) {
          failed++;
          continue;
        }

        const { data: openDeal } = await supabase
          .from("deals")
          .select("id")
          .eq("contact_id", contactId)
          .eq("status", "open")
          .limit(1)
          .maybeSingle();
        if (openDeal) {
          skipped++;
          continue;
        }

        const { error: dealErr } = await supabase.from("deals").insert({
          account_id: accountId,
          user_id: user.id,
          pipeline_id: pipeline.id,
          stage_id: stage.id,
          contact_id: contactId,
          title: row.title,
          value: row.value,
          currency,
          status: "open",
        });
        if (dealErr) failed++;
        else imported++;
      }

      setResult({ imported, skipped, failed });
      if (imported > 0) toast.success(t("toastImported", { count: imported }));
      if (failed > 0) toast.error(t("toastFailed", { count: failed }));
    } catch {
      toast.error(t("toastError"));
    } finally {
      setImporting(false);
    }
  }

  const preview = rows.slice(0, PREVIEW_LIMIT);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-4 text-center transition-colors",
          file ? "border-primary/35 bg-primary/[0.04]" : "border-border hover:border-primary/40",
        )}
      >
        {file ? (
          <>
            <FileText className="h-5 w-5 text-primary" />
            <p className="max-w-full truncate text-xs font-medium text-foreground">{file.name}</p>
            <span className="text-[11px] text-muted-foreground">{t("rowsReady", { count: rows.length })}</span>
          </>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{t("dropzone")}</p>
          </>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />

      {preview.length > 0 && !result && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{t("columns.phone")}</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{t("columns.title")}</th>
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{t("columns.value")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {preview.map((row, i) => (
                <tr key={i}>
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{row.phone}</td>
                  <td className="truncate px-2 py-1.5 text-foreground">{row.title}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {row.value > 0 ? formatCurrency(row.value) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > PREVIEW_LIMIT && (
            <p className="border-t border-border px-2 py-1.5 text-center text-[11px] text-muted-foreground">
              {t("moreRows", { count: rows.length - PREVIEW_LIMIT })}
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="flex flex-wrap gap-3 text-xs">
          {result.imported > 0 && (
            <span className="flex items-center gap-1 text-primary">
              <CheckCircle className="h-3.5 w-3.5" />
              {t("resultImported", { count: result.imported })}
            </span>
          )}
          {result.skipped > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("resultSkipped", { count: result.skipped })}
            </span>
          )}
          {result.failed > 0 && (
            <span className="flex items-center gap-1 text-red-500">
              <XCircle className="h-3.5 w-3.5" />
              {t("resultFailed", { count: result.failed })}
            </span>
          )}
        </div>
      )}

      {rows.length > 0 && !result && (
        <Button type="button" size="sm" onClick={() => void handleImport()} disabled={importing} className="self-start">
          {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {t("importBtn", { count: rows.length })}
        </Button>
      )}
    </div>
  );
}
