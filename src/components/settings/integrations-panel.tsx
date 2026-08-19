'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { ConnectPlatformButton } from './connect-platform-button';
import { WhatsAppConfig } from './whatsapp-config';
import { useAuth } from '@/hooks/use-auth';

/**
 * Integrations tab — two groups:
 *   - "Channels": connect WhatsApp / Instagram via Zernio's guided
 *     Meta OAuth flow (no manual credentials).
 *   - "Integrations by API": the pre-existing manual WhatsApp setup
 *     (Cloud API credentials, or a Coexistence provider like
 *     Dualhook via "Send API Base URL") — unchanged, just relocated
 *     out of its own top-level tab into this one.
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
        </CardContent>
      </Card>

      <div className="mt-8 mb-1 text-[11px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
        {t('apiIntegrationsTitle')}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{t('apiIntegrationsDesc')}</p>
      <WhatsAppConfig />
    </section>
  );
}
