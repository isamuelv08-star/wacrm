'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { CalendarClock } from 'lucide-react';

import { SettingsPanelHead } from './settings-panel-head';
import { ConnectPlatformButton } from './connect-platform-button';
import { WhatsAppApiConnectCard } from './whatsapp-api-connect-card';
import { GoogleCalendarConnect } from './google-calendar-connect';
import { IntegrationCard } from './integration-card';
import { PlatformLogoMono } from './platform-logo-mono';
import { WhatsAppModeCard } from './whatsapp-mode-card';
import { useAuth } from '@/hooks/use-auth';

/**
 * Integrations tab — an app-store-style grid of connection tiles.
 * WhatsApp has two ways to connect (the guided Meta OAuth flow via
 * <ConnectPlatformButton>, or your own credentials via
 * <WhatsAppApiConnectCard>, rendered with `variant="card"` here;
 * onboarding's linear list still uses its default row variant).
 * Messenger and Instagram are guided-OAuth only — no "bring your own
 * Meta credentials" card for either, unlike WhatsApp — plus Google
 * Calendar. Card icons use the monochrome <PlatformLogoMono> mark
 * rather than the inbox's brand-colored badges, matching this grid's
 * plainer, less "chat app" visual language.
 *
 * Also picks up the `zernio_*` query params that the OAuth callback
 * redirects back with and surfaces them as a toast, then strips them
 * from the URL so a refresh doesn't re-fire it. Nothing in this panel
 * names the OAuth provider — the guided flow is presented as "the
 * app's own" connection method, not a third party's.
 */
export function IntegrationsPanel() {
  const t = useTranslations('Settings.integrations');
  const { accountId, account } = useAuth();
  const isMultiWhatsApp = account?.whatsapp_mode === 'multiwhatsapp';
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
          icon={<PlatformLogoMono platform="whatsapp" />}
          name={t('platform.whatsapp')}
          subtitle={t('whatsappHint')}
          action={accountId ? <ConnectPlatformButton platform="whatsapp" profileId={accountId} /> : null}
        />

        {/* Hidden once multi-WhatsApp is active: this card's whole
            save/status flow assumes "the account's one number"
            (.maybeSingle() throws on 2+ rows) — once there can be
            several, WhatsAppModeCard's dialog is the only supported
            way to add/edit/remove a direct-API number. The number(s)
            connected before switching modes keep working either way;
            this only hides the entry point that could otherwise
            silently create a 3rd row instead of editing one. */}
        {!isMultiWhatsApp && <WhatsAppApiConnectCard variant="card" />}

        <WhatsAppModeCard />

        <IntegrationCard
          icon={<PlatformLogoMono platform="messenger" />}
          name={t('platform.facebook')}
          subtitle={t('facebookHint')}
          action={accountId ? <ConnectPlatformButton platform="facebook" profileId={accountId} /> : null}
        />

        <IntegrationCard
          icon={<PlatformLogoMono platform="instagram" />}
          name={t('platform.instagram')}
          subtitle={t('instagramHint')}
          action={accountId ? <ConnectPlatformButton platform="instagram" profileId={accountId} /> : null}
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
