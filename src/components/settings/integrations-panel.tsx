'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { ConnectPlatformButton } from './connect-platform-button';
import { WhatsAppChannelOptions } from './whatsapp-channel-options';
import { useAuth } from '@/hooks/use-auth';

/**
 * Integrations tab — one "Channels" list, three ways to connect
 * WhatsApp/Instagram: Zernio's guided Meta OAuth flow (no manual
 * credentials), or your own Meta Cloud API credentials / a
 * Coexistence provider like Dualhook (the "WhatsApp (API)" card,
 * whose full form now opens in a dialog instead of always sitting
 * inline on the page). The two WhatsApp options are grouped together
 * via <WhatsAppChannelOptions> — shared with the onboarding wizard so
 * both surfaces offer the same choice instead of onboarding hardcoding
 * just the API form.
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
          {/* Both ways to connect WhatsApp, grouped together. */}
          <WhatsAppChannelOptions />

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">{t('platform.instagram')}</p>
              <p className="text-xs text-muted-foreground">{t('instagramHint')}</p>
            </div>
            {accountId ? (
              <ConnectPlatformButton platform="instagram" profileId={accountId} />
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
