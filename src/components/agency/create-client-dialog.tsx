'use client';

// ============================================================
// CreateClientDialog — /agency's "Crear cliente" flow.
//
// Two-step modal, mirrors src/components/settings/invite-member-dialog.tsx
// exactly (same copy-to-clipboard + WhatsApp-share result step):
//   1. Form  — business name, owner email, default currency → POST
//              creates the account + a one-time owner-role invite.
//   2. Result — the invite link, shown ONCE. The agency owner copies
//              it and sends it to the client themselves; there's no
//              email step, same as inviting a team member today.
//
// On close after a successful create, router.refresh() re-runs the
// server component so the new (zero-metric) account appears in the
// grid immediately.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Building2, Copy, Loader2, MessageCircle, Plus, Sparkles } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currency';

const MAX_NAME_LEN = 120;

interface CreatedAccount {
  url: string;
  accountName: string;
  expiresInDays: number;
}

export function CreateClientDialog() {
  const t = useTranslations('Agency.createDialog');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedAccount | null>(null);
  // Snapshot so a later dialog reopen can't retroactively change
  // what the just-closed result screen refers to.
  const [createdAnAccount, setCreatedAnAccount] = useState(false);

  function reset() {
    setName('');
    setOwnerEmail('');
    setCurrency(DEFAULT_CURRENCY);
    setResult(null);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
      if (createdAnAccount) {
        setCreatedAnAccount(false);
        router.refresh();
      }
    }
    setOpen(next);
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    const trimmedEmail = ownerEmail.trim();
    if (!trimmedName) {
      toast.error(t('nameRequired'));
      return;
    }
    if (!trimmedEmail) {
      toast.error(t('emailRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/agency/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          ownerEmail: trimmedEmail,
          defaultCurrency: currency,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('createError'));
        return;
      }

      const data = (await res.json()) as { url: string; expiresInDays: number };

      setResult({
        url: data.url,
        accountName: trimmedName,
        expiresInDays: data.expiresInDays,
      });
      setCreatedAnAccount(true);
    } catch (err) {
      console.error('[CreateClientDialog] create error:', err);
      toast.error(t('connectError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success(t('linkCopied'));
    } catch {
      toast.error(t('copyError'));
    }
  }

  function whatsappShareUrl(url: string): string {
    const accountName = result?.accountName ?? t('defaultAccountName');
    const message = t('whatsappMessage', {
      account: accountName,
      days: result?.expiresInDays ?? 7,
      url,
    });
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="size-4" />
        {t('trigger')}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <Sparkles className="size-4 text-primary" />
                {t('accountCreatedTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('accountCreatedDesc', {
                  account: result.accountName,
                  days: result.expiresInDays,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <Label className="text-muted-foreground">{t('activationLinkLabel')}</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={result.url}
                  className="bg-muted border-border text-foreground font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  onClick={copyToClipboard}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                >
                  <Copy className="size-4" />
                  {t('copy')}
                </Button>
              </div>

              <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                <strong className="font-semibold text-amber-100">{t('saveNowTitle')}</strong>{' '}
                {t('saveNowBody')}
              </div>

              <a
                href={whatsappShareUrl(result.url)}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonVariants({
                  variant: 'outline',
                  className: 'w-full border-border text-muted-foreground hover:bg-muted',
                })}
              >
                <MessageCircle className="size-4" />
                {t('sendWhatsapp')}
              </a>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                onClick={() => handleOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {t('done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <Building2 className="size-4 text-primary" />
                {t('newClientTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('newClientDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('businessNameLabel')}</Label>
                <Input
                  placeholder={t('businessNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_NAME_LEN}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('ownerEmailLabel')}</Label>
                <Input
                  type="email"
                  placeholder={t('ownerEmailPlaceholder')}
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t('ownerEmailHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('defaultCurrencyLabel')}</Label>
                <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} — {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('creating')}
                  </>
                ) : (
                  t('createClient')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
      </Dialog>
    </>
  );
}
