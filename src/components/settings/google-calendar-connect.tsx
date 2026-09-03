'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ExternalLink, Unlink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

/**
 * Connect/disconnect Google Calendar for the caller's account. Same
 * shape as <ConnectPlatformButton> (Zernio) — checking / connected
 * (with the linked Google email) / disconnected — but talks to our
 * own OAuth routes (`/api/integrations/google-calendar/*`) instead of
 * a broker, since this is a direct Google OAuth integration, not
 * something proxied through Zernio.
 */
export function GoogleCalendarConnect() {
  const t = useTranslations('Settings.integrations');
  const { canEditSettings } = useAuth();

  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const loadedRef = useRef(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/integrations/google-calendar');
      const data = await res.json();
      if (res.ok) {
        setStatus(data.connected ? 'connected' : 'disconnected');
        setGoogleEmail(data.googleEmail ?? null);
      } else {
        setStatus('disconnected');
      }
    } catch {
      setStatus('disconnected');
    }
  };

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void fetchStatus();
  }, []);

  function handleConnect() {
    setRedirecting(true);
    window.location.href = '/api/integrations/google-calendar/connect';
  }

  async function handleDisconnect() {
    if (!window.confirm(t('googleCalendar.disconnectConfirm'))) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/integrations/google-calendar', { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error || t('googleCalendar.disconnectError'));
        return;
      }
      setStatus('disconnected');
      setGoogleEmail(null);
      toast.success(t('googleCalendar.disconnected'));
      if (body?.googleRevoked === false) {
        toast.warning(t('disconnectPartial'));
      }
    } catch {
      toast.error(t('googleCalendar.disconnectError'));
    } finally {
      setDisconnecting(false);
    }
  }

  if (status === 'connected') {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-1.5 text-sm text-emerald-300">
          <CheckCircle2 className="size-4" />
          {googleEmail ? t('googleCalendar.connectedAs', { email: googleEmail }) : t('googleCalendar.connected')}
        </span>
        <Button
          onClick={handleDisconnect}
          disabled={disconnecting || !canEditSettings}
          variant="outline"
          size="sm"
          className="border-border text-muted-foreground hover:bg-muted hover:text-destructive"
          title={!canEditSettings ? t('adminOnly') : undefined}
        >
          {disconnecting ? <Loader2 className="size-4 animate-spin" /> : <Unlink className="size-4" />}
          {t('disconnect')}
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleConnect}
      disabled={status === 'checking' || redirecting || !canEditSettings}
      variant="outline"
      className="border-border text-foreground hover:bg-muted"
      title={!canEditSettings ? t('adminOnly') : undefined}
    >
      {status === 'checking' || redirecting ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <ExternalLink className="size-4" />
      )}
      {t('googleCalendar.connect')}
    </Button>
  );
}
