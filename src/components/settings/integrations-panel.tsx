'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { ConnectPlatformButton } from './connect-platform-button';
import { WhatsAppApiConnectCard } from './whatsapp-api-connect-card';
import { useAuth } from '@/hooks/use-auth';

/**
 * Integrations tab — one "Channels" list, three ways to connect
 * WhatsApp/Instagram: Zernio's guided Meta OAuth flow (no manual
 * credentials), or your own Meta Cloud API credentials / a
 * Coexistence provider like Dualhook (the "WhatsApp (API)" card,
 * whose full form now opens in a dialog instead of always sitting
 * inline on the page).
 *
 * Also picks up the `zernio_*` query params that /api/zernio/callback
 * redirects back with and surfaces them as a toast, then strips them
 * from the URL so a refresh doesn't re-fire it.
 */
export function IntegrationsPanel() {
  const t = useTranslations('Settings.integrations');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountId } = useAuth();
  const handledRef = useRef(false);

  useEffect(() => {
    const connected = searchParams.get('zernio_connected');
    if (connected === null || handledRef.current) return;
    handledRef.current = true;

    const platform = searchParams.get('zernio_platform');
    const platformLabel = platform ? t(`platform.${platform}`) : '';
    const error = searchParams.get('zernio_error');

    if (connected === '1') {
      toast.success(t('toastConnected', { platform: platformLabel }));
    } else {
      toast.error(error || t('toastFailedGeneric'));
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete('zernio_connected');
    params.delete('zernio_platform');
    params.delete('zernio_error');
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  }, [searchParams, router, t]);

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('channelsTitle')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('channelsDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">{t('platform.whatsapp')}</p>
              <p className="text-xs text-muted-foreground">{t('whatsappHint')}</p>
            </div>
            {accountId ? (
              <ConnectPlatformButton platform="whatsapp" profileId={accountId} />
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">{t('platform.instagram')}</p>
              <p className="text-xs text-muted-foreground">{t('instagramHint')}</p>
            </div>
            {accountId ? (
              <ConnectPlatformButton platform="instagram" profileId={accountId} />
            ) : null}
          </div>

          {/* Manual Cloud API connection — same horizontal-card shape
              as the Zernio channels above, so the two ways to connect
              WhatsApp read as one consistent list. The full
              credentials form opens in a dialog on "Connect" rather
              than always sitting inline on the page. */}
          <WhatsAppApiConnectCard />
        </CardContent>
      </Card>
    </section>
  );
}
