"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { computeQuoteTotals } from "@/lib/quotes/totals";

interface Line {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
}

interface ProductHit {
  id: string;
  name: string;
  sku: string | null;
  unit_price: number;
}

let keySeq = 0;
const newKey = () => `l${++keySeq}`;

/** Create (target 'new') or edit (target = quote id, drafts only) a quote. */
export function QuoteEditorDialog({
  target,
  contactId,
  conversationId,
  onClose,
  onSaved,
}: {
  target: string | "new" | null;
  contactId: string;
  conversationId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Quotes");
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [tax, setTax] = useState({ label: "IVA", rate: 0, includes: false, currency: "USD" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"draft" | "send" | null>(null);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [showHits, setShowHits] = useState(false);
  const searchBox = useRef<HTMLDivElement>(null);

  // Load settings (new) or the quote itself (edit).
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setQuery("");
    /* eslint-enable react-hooks/set-state-in-effect */
    (async () => {
      try {
        if (target === "new") {
          const data = await (await fetch("/api/account/quote-settings")).json();
          const s = data.settings ?? {};
          if (cancelled) return;
          setTax({
            label: s.quote_tax_label ?? "IVA",
            rate: Number(s.quote_tax_rate ?? 0),
            includes: s.quote_prices_include_tax === true,
            currency: (s.default_currency || "USD").toUpperCase(),
          });
          setLines([]);
          setNotes("");
        } else {
          const { quote } = await (await fetch(`/api/quotes/${target}`)).json();
          if (cancelled || !quote) return;
          setTax({
            label: quote.tax_label,
            rate: Number(quote.tax_rate),
            includes: quote.prices_include_tax === true,
            currency: quote.currency,
          });
          setNotes(quote.notes ?? "");
          setLines(
            (quote.items ?? []).map(
              (i: { description: string; quantity: number; unit_price: number; discount_pct: number }) => ({
                key: newKey(),
                productId: null,
                description: i.description,
                quantity: String(i.quantity),
                unitPrice: String(i.unit_price),
                discountPct: String(i.discount_pct ?? 0),
              }),
            ),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Catalog search.
  useEffect(() => {
    if (!showHits) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/products?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      setHits(data.products ?? []);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, showHits]);

  useEffect(() => {
    if (!showHits) return;
    const onDown = (e: MouseEvent) => {
      if (searchBox.current && !searchBox.current.contains(e.target as Node)) setShowHits(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showHits]);

  const addProduct = (p: ProductHit) => {
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        productId: p.id,
        description: p.name,
        quantity: "1",
        unitPrice: String(p.unit_price),
        discountPct: "0",
      },
    ]);
    setQuery("");
    setShowHits(false);
  };

  const addBlank = () =>
    setLines((prev) => [
      ...prev,
      { key: newKey(), productId: null, description: "", quantity: "1", unitPrice: "0", discountPct: "0" },
    ]);

  const update = (key: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const parsed = lines.map((l) => ({
    productId: l.productId,
    description: l.description.trim(),
    quantity: Number(l.quantity) || 0,
    unitPrice: Number(l.unitPrice) || 0,
    discountPct: Number(l.discountPct) || 0,
  }));
  const totals = computeQuoteTotals(parsed, tax.rate, tax.includes);
  const valid = parsed.length > 0 && parsed.every((l) => l.description && l.quantity > 0 && l.unitPrice >= 0);

  const money = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: tax.currency }).format(n);
    } catch {
      return `${tax.currency} ${n.toFixed(2)}`;
    }
  };

  const save = async (andSend: boolean) => {
    setSaving(andSend ? "send" : "draft");
    try {
      let quoteId = target as string;
      if (target === "new") {
        const res = await fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId, conversationId, lines: parsed, notes, send: andSend }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error === "no_conversation" ? t("errors.noConversation") : data.error);
        quoteId = data.quote.id;
      } else {
        const res = await fetch(`/api/quotes/${quoteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: parsed, notes }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        if (andSend) {
          const sendRes = await fetch(`/api/quotes/${quoteId}/send`, { method: "POST" });
          const data = await sendRes.json();
          if (!sendRes.ok) throw new Error(data.error === "no_conversation" ? t("errors.noConversation") : data.error);
        }
      }
      toast.success(andSend ? t("sent") : t("savedDraft"));
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("saveFailed"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target === "new" ? t("newTitle") : t("editTitle")}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            <div ref={searchBox} className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                value={query}
                onFocus={() => setShowHits(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowHits(true);
                }}
                placeholder={t("searchProducts")}
              />
              {showHits && (
                <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 text-sm shadow-lg">
                  {hits.length === 0 ? (
                    <li className="px-3 py-2 text-muted-foreground">{t("noProducts")}</li>
                  ) : (
                    hits.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => addProduct(p)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
                        >
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          {p.sku && <span className="text-xs text-muted-foreground">{p.sku}</span>}
                          <span className="tabular-nums">{money(Number(p.unit_price))}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>

            {lines.length > 0 && (
              <div className="space-y-2">
                <div className="hidden grid-cols-[1fr_64px_96px_64px_88px_28px] gap-2 px-1 text-[11px] font-medium uppercase text-muted-foreground sm:grid">
                  <span>{t("description")}</span>
                  <span>{t("quantity")}</span>
                  <span>{t("unitPrice")}</span>
                  <span>{t("discountPct")}</span>
                  <span className="text-right">{t("amount")}</span>
                  <span />
                </div>
                {lines.map((l, i) => (
                  <div key={l.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_64px_96px_64px_88px_28px] sm:items-center">
                    <Input
                      className="col-span-2 sm:col-span-1"
                      value={l.description}
                      onChange={(e) => update(l.key, { description: e.target.value })}
                      placeholder={t("description")}
                    />
                    <Input type="number" min={0} step="1" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                    <Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} />
                    <Input type="number" min={0} max={100} step="1" value={l.discountPct} onChange={(e) => update(l.key, { discountPct: e.target.value })} />
                    <span className="text-right text-sm font-medium tabular-nums">{money(totals.lineTotals[i] ?? 0)}</span>
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                      className="text-muted-foreground hover:text-red-600"
                      aria-label={t("removeLine")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" onClick={addBlank}>
              <Plus className="h-4 w-4" />
              {t("addLine")}
            </Button>

            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notesPlaceholder")} />

            <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>{t("subtotal")}</span>
                <span className="tabular-nums">{money(totals.subtotal)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("discounts")}</span>
                  <span className="tabular-nums">-{money(totals.discount)}</span>
                </div>
              )}
              {tax.rate > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    {tax.label} {tax.rate}%
                  </span>
                  <span className="tabular-nums">{money(totals.tax)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
                <span>{t("total")}</span>
                <span className="tabular-nums">{money(totals.total)}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => save(false)} disabled={!valid || saving !== null}>
            {saving === "draft" && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("saveDraft")}
          </Button>
          <Button onClick={() => save(true)} disabled={!valid || saving !== null}>
            {saving === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("saveAndSend")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
