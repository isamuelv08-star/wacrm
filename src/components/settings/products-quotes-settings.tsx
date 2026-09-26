'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { SettingsPanelHead } from './settings-panel-head';

interface Product {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit_price: number;
  is_active: boolean;
}

interface QuoteSettingsForm {
  taxLabel: string;
  taxRate: string;
  pricesIncludeTax: boolean;
  validityDays: string;
  prefix: string;
  terms: string;
}

/** Settings → Products & quotes (migration 120). */
export function ProductsQuotesSettings() {
  const t = useTranslations('Settings.productsQuotes');
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [available, setAvailable] = useState(true);
  const [currency, setCurrency] = useState('USD');
  const [form, setForm] = useState<QuoteSettingsForm | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  useEffect(() => {
    fetch('/api/account/quote-settings')
      .then((r) => r.json())
      .then((data) => {
        if (data.available === false) {
          setAvailable(false);
          return;
        }
        const s = data.settings ?? {};
        setCurrency((s.default_currency || 'USD').toUpperCase());
        setForm({
          taxLabel: s.quote_tax_label ?? 'IVA',
          taxRate: String(s.quote_tax_rate ?? 0),
          pricesIncludeTax: s.quote_prices_include_tax === true,
          validityDays: String(s.quote_validity_days ?? 15),
          prefix: s.quote_prefix ?? 'COT',
          terms: s.quote_terms ?? '',
        });
      })
      .catch(() => setAvailable(false));
  }, []);

  const loadProducts = useCallback(async (q: string) => {
    setLoadingProducts(true);
    try {
      const res = await fetch(`/api/products?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      const data = await res.json();
      setProducts(data.products ?? []);
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadProducts(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search, loadProducts]);

  const saveSettings = async () => {
    if (!form) return;
    setSavingSettings(true);
    try {
      const res = await fetch('/api/account/quote-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taxLabel: form.taxLabel,
          taxRate: Number(form.taxRate),
          pricesIncludeTax: form.pricesIncludeTax,
          validityDays: Number(form.validityDays),
          prefix: form.prefix,
          terms: form.terms,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(t('saved'));
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('saveFailed'));
    } finally {
      setSavingSettings(false);
    }
  };

  const removeProduct = async (p: Product) => {
    if (!confirm(t('confirmDelete', { name: p.name }))) return;
    const res = await fetch(`/api/products/${p.id}`, { method: 'DELETE' });
    if (!res.ok) toast.error(t('saveFailed'));
    else void loadProducts(search.trim());
  };

  const money = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
    } catch {
      return `${currency} ${n.toFixed(2)}`;
    }
  };

  if (!available) {
    return (
      <div className="space-y-4">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('settingsTitle')}</CardTitle>
          <CardDescription>{t('settingsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!form ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>{t('taxLabel')}</Label>
                  <Input value={form.taxLabel} disabled={!canEdit} onChange={(e) => setForm({ ...form, taxLabel: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t('taxRate')}</Label>
                  <Input type="number" min={0} max={100} step="0.01" value={form.taxRate} disabled={!canEdit} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t('validityDays')}</Label>
                  <Input type="number" min={1} max={365} value={form.validityDays} disabled={!canEdit} onChange={(e) => setForm({ ...form, validityDays: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.pricesIncludeTax} disabled={!canEdit} onCheckedChange={(v) => setForm({ ...form, pricesIncludeTax: v })} />
                {t('pricesIncludeTax')}
              </label>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>{t('prefix')}</Label>
                  <Input value={form.prefix} disabled={!canEdit} onChange={(e) => setForm({ ...form, prefix: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>{t('terms')}</Label>
                <Textarea rows={3} value={form.terms} disabled={!canEdit} placeholder={t('termsPlaceholder')} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
              </div>
              {canEdit && (
                <Button onClick={saveSettings} disabled={savingSettings}>
                  {savingSettings && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('catalogTitle')}</CardTitle>
          <CardDescription>{t('catalogDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} />
            </div>
            {canEdit && (
              <Button size="sm" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" />
                {t('addProduct')}
              </Button>
            )}
          </div>

          {loadingProducts ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : products.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('noProducts')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {products.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className={p.is_active ? 'truncate font-medium' : 'truncate font-medium text-muted-foreground line-through'}>
                      {p.name}
                    </p>
                    {(p.sku || p.description) && (
                      <p className="truncate text-xs text-muted-foreground">{[p.sku, p.description].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">{money(Number(p.unit_price))}</span>
                  {canEdit && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={t('edit')}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeProduct(p)} aria-label={t('delete')}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ProductDialog
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void loadProducts(search.trim());
        }}
      />
    </div>
  );
}

function ProductDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Product | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('Settings.productsQuotes');
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    const p = target === 'new' ? null : target;
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(p?.name ?? '');
    setSku(p?.sku ?? '');
    setDescription(p?.description ?? '');
    setPrice(p ? String(p.unit_price) : '');
    setActive(p?.is_active ?? true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [target]);

  const save = async () => {
    setSaving(true);
    try {
      const isNew = target === 'new';
      const res = await fetch(isNew ? '/api/products' : `/api/products/${(target as Product).id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, sku, description, unitPrice: Number(price), isActive: active }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target === 'new' ? t('addProduct') : t('editProduct')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t('productName')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('productNamePlaceholder')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t('price')}</Label>
              <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('sku')}</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t('productDescription')}</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={active} onCheckedChange={setActive} />
            {t('active')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={save} disabled={saving || !name.trim() || price === ''}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
