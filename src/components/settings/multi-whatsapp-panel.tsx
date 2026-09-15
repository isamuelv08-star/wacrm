'use client';

// ============================================================
// MultiWhatsAppPanel — dedicated Settings section for
// accounts.whatsapp_mode (migration 085), replacing the old
// WhatsAppModeCard tile that used to live inside Integrations.
//
// It used to be a small card mixed in with the connection grid,
// whose blurb described the CURRENT (shared) state while its own
// confirm dialog described the mode being switched TO — confusing
// side by side. Splitting it into its own section fixes that: this
// screen is unambiguously about the multi-WhatsApp feature itself
// (what it is, what it looks like once active, how to get the most
// out of it), with a single, congruent piece of copy for the one
// action available in each state.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Lightbulb,
  LayoutGrid,
  MessageCircleMore,
  Settings2,
  ShieldCheck,
  Smartphone,
  UserCog,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { WhatsAppNumbersDialog } from './whatsapp-numbers-dialog';
import { useAuth } from '@/hooks/use-auth';

const FEATURES = [
  { key: 'PerSeller', icon: Smartphone },
  { key: 'SeparateChats', icon: MessageCircleMore },
  { key: 'Consolidated', icon: LayoutGrid },
  { key: 'Permissions', icon: ShieldCheck },
] as const;

const TIP_KEYS = ['tipLabel', 'tipAssign', 'tipKeepCurrent', 'tipConsolidated'] as const;

export function MultiWhatsAppPanel() {
  const t = useTranslations('Settings.whatsappNumbers');
  const router = useRouter();
  const { account, canEditSettings } = useAuth();
  const isActive = (account?.whatsapp_mode ?? 'shared') === 'multiwhatsapp';

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const [numbersOpen, setNumbersOpen] = useState(false);

  async function handleActivate() {
    setActivating(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp_mode: 'multiwhatsapp' }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('activateError'));
        return;
      }
      toast.success(t('activateSuccess'));
      setConfirmOpen(false);
      router.refresh();
      setNumbersOpen(true);
    } catch {
      toast.error(t('activateError'));
    } finally {
      setActivating(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('pageTitle')} description={t('pageDescription')} />

      {/* Illustrated banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary-soft via-card to-card p-6">
        <Smartphone
          aria-hidden
          className="pointer-events-none absolute -top-6 -right-6 size-32 text-primary/10"
        />
        <div className="relative flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <UserCog className="size-6" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{t('bannerTitle')}</h3>
            <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">{t('bannerDesc')}</p>
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {FEATURES.map(({ key, icon: Icon }) => (
          <div
            key={key}
            className="flex items-start gap-3 rounded-xl border border-border bg-card p-4"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{t(`feature${key}Title`)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(`feature${key}Desc`)}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tips */}
      <div className="mt-5 rounded-xl border border-dashed border-border p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Lightbulb className="size-4 text-primary" />
          {t('tipsTitle')}
        </div>
        <ul className="mt-2.5 space-y-1.5">
          {TIP_KEYS.map((key) => (
            <li key={key} className="flex gap-2 text-sm text-muted-foreground">
              <span className="text-primary">•</span>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>

      {/* Status / CTA */}
      <div className="mt-5 flex flex-col items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {isActive ? t('statusActiveTitle') : t('statusInactiveTitle')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isActive ? t('statusActiveDesc') : t('statusInactiveDesc')}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => (isActive ? setNumbersOpen(true) : setConfirmOpen(true))}
          disabled={!isActive && !canEditSettings}
          title={!isActive && !canEditSettings ? t('adminOnly') : undefined}
          className="w-full sm:w-auto"
        >
          {isActive ? <Settings2 className="h-4 w-4" /> : null}
          {isActive ? t('manage') : t('activate')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('activateConfirmTitle')}
        description={t('activateConfirmDesc')}
        confirmLabel={t('activate')}
        cancelLabel={t('cancel')}
        onConfirm={handleActivate}
        loading={activating}
      />

      <WhatsAppNumbersDialog open={numbersOpen} onOpenChange={setNumbersOpen} />
    </section>
  );
}
