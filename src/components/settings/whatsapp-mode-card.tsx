'use client';

// ============================================================
// WhatsAppModeCard — Settings → Integrations tile for
// accounts.whatsapp_mode (migration 085). Two states:
//   'shared'       — explains the shared-number setup and offers a
//                    one-click "activate multi-WhatsApp" upgrade for
//                    an EXISTING account (new accounts already picked
//                    in onboarding — see whatsapp-mode-step.tsx).
//   'multiwhatsapp' — opens WhatsAppNumbersDialog to manage numbers.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Settings2, UserCog, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { IntegrationCard } from './integration-card';
import { WhatsAppNumbersDialog } from './whatsapp-numbers-dialog';
import { useAuth } from '@/hooks/use-auth';

export function WhatsAppModeCard() {
  const t = useTranslations('Settings.whatsappNumbers');
  const router = useRouter();
  const { account, canEditSettings } = useAuth();
  const mode = account?.whatsapp_mode ?? 'shared';

  const [activating, setActivating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function handleActivate() {
    if (!window.confirm(t('activateConfirm'))) return;
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
      router.refresh();
      setDialogOpen(true);
    } catch {
      toast.error(t('activateError'));
    } finally {
      setActivating(false);
    }
  }

  if (mode === 'multiwhatsapp') {
    return (
      <>
        <IntegrationCard
          icon={<UserCog />}
          name={t('cardTitleActive')}
          subtitle={t('cardSubtitleActive')}
          action={
            <Button
              type="button"
              variant="outline"
              className="w-full border-border text-foreground hover:bg-muted"
              onClick={() => setDialogOpen(true)}
            >
              <Settings2 className="h-4 w-4" />
              {t('manage')}
            </Button>
          }
        />
        <WhatsAppNumbersDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <IntegrationCard
      icon={<Users />}
      name={t('cardTitleShared')}
      subtitle={t('cardSubtitleShared')}
      action={
        <Button
          type="button"
          variant="outline"
          className="w-full border-border text-foreground hover:bg-muted"
          disabled={activating || !canEditSettings}
          onClick={handleActivate}
          title={!canEditSettings ? t('adminOnly') : undefined}
        >
          {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t('activate')}
        </Button>
      }
    />
  );
}
