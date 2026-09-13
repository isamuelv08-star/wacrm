'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CalendarClock } from 'lucide-react';

import { SettingsPanelHead } from './settings-panel-head';
import { ConnectPlatformButton } from './connect-platform-button';
import { WhatsAppApiConnectCard } from './whatsapp-api-connect-card';
import { MessengerConnectCard } from './messenger-connect-card';
import { GoogleCalendarConnect } from './google-calendar-connect';
import { IntegrationCard } from './integration-card';
import { PlatformIcon } from '@/components/inbox/platform-accent';
import { useAuth } from '@/hooks/use-auth';

/**
 * Integrations tab — an app-store-style grid of connection tiles
 * instead of a stacked list of full-width rows: WhatsApp and Messenger
 * each have two ways to connect (Zernio's guided Meta OAuth flow via
 * <ConnectPlatformButton>, or your own credentials via
 * <WhatsAppApiConnectCard> / <MessengerConnectCard> — both rendered
 * with `variant="card"` here; onboarding's linear list still uses
 * their default row variant), plus Instagram (coming soon) and Google
 * Calendar.
 *
 * Also picks up the `zernio_*` query params that /api/zernio/callback
 * redirects back with and surfaces them as a toast, then strips them
 * from the URL so a refresh doesn't re-fire it.
 */
export function IntegrationsPanel() {
  const t = useTranslations('Settings.integrations');
  const { accountId } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
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

  // Same handling as zernio_* above, for the Google Calendar OAuth
  // round trip (/api/integrations/google-calendar/callback).
  const handledGcalRef = useRef(false);
  useEffect(() => {
    const connected = searchParams.get('gcal_connected');
    if (connected === null || handledGcalRef.current) return;
    handledGcalRef.current = true;

    const error = searchParams.get('gcal_error');
    if (connected === '1') {
      toast.success(t('googleCalendar.toastConnected'));
    } else {
      toast.error(error || t('toastFailedGeneric'));
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete('gcal_connected');
    params.delete('gcal_error');
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  }, [searchParams, router, t]);

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <IntegrationCard
          icon={<PlatformIcon platform="whatsapp" />}
          name={t('platform.whatsapp')}
          subtitle={t('whatsappHint')}
          action={accountId ? <ConnectPlatformButton platform="whatsapp" profileId={accountId} /> : null}
        />

        <WhatsAppApiConnectCard variant="card" />

        <IntegrationCard
          icon={<PlatformIcon platform="messenger" />}
          name={t('platform.facebook')}
          subtitle={t('facebookHint')}
          action={accountId ? <ConnectPlatformButton platform="facebook" profileId={accountId} /> : null}
        />

        <MessengerConnectCard variant="card" />

        <IntegrationCard
          icon={<PlatformIcon platform="instagram" />}
          name={t('platform.instagram')}
          badge={
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t('comingSoon')}
            </span>
          }
          subtitle={t('instagramComingSoonHint')}
          action={null}
          muted
        />

        <IntegrationCard
          icon={<CalendarClock />}
          name={t('googleCalendar.title')}
          subtitle={t('googleCalendar.hint')}
          action={<GoogleCalendarConnect />}
        />
      </div>
    </section>
  );
}
