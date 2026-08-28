'use client';

import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { ConnectPlatformButton } from './connect-platform-button';
import { WhatsAppApiConnectCard } from './whatsapp-api-connect-card';

/**
 * The two ways to connect a WhatsApp number, as a plain list of rows
 * (no outer <Card> — callers own their own container). Extracted out
 * of <IntegrationsPanel> so the onboarding wizard's WhatsApp step can
 * show the same simplified "Zernio guided OAuth, or your own API
 * credentials" choice instead of always dropping the full
 * <WhatsAppConfig /> credentials form inline.
 */
export function WhatsAppChannelOptions() {
  const t = useTranslations('Settings.integrations');
  const { accountId } = useAuth();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-medium text-foreground">{t('platform.whatsapp')}</p>
          <p className="text-xs text-muted-foreground">{t('whatsappHint')}</p>
        </div>
        {accountId ? <ConnectPlatformButton platform="whatsapp" profileId={accountId} /> : null}
      </div>
      <WhatsAppApiConnectCard />
    </div>
  );
}
