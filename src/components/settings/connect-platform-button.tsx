'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ExternalLink, Unlink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export type ZernioPlatform = 'whatsapp' | 'instagram';

const ACCOUNT_ID_COLUMN: Record<ZernioPlatform, 'whatsapp_account_id' | 'instagram_account_id'> = {
  whatsapp: 'whatsapp_account_id',
  instagram: 'instagram_account_id',
};

/**
 * Connect-via-Zernio button for one platform. Reads the current
 * connection status straight from `client_zernio_accounts` (RLS lets
 * any account member read it) and shows "Connected ✓" once that
 * platform's account id is set.
 *
 * `profileId` is the Zernio profile id for display/API-shape purposes
 * — the actual /api/zernio/connect/[platform] call always derives the
 * account from the caller's own session server-side, never trusts a
 * client-supplied id, so this component can't be used to connect a
 * channel onto someone else's account.
 */
export function ConnectPlatformButton({
  platform,
  profileId,
}: {
  platform: ZernioPlatform;
  profileId: string;
}) {
  const t = useTranslations('Settings.integrations');
  const { accountId, canEditSettings } = useAuth();
  const supabase = createClient();

  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [redirecting, setRedirecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const loadedAccountIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('client_zernio_accounts')
        .select(ACCOUNT_ID_COLUMN[platform])
        .eq('account_id', accountId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('[ConnectPlatformButton] status check failed:', error);
        setStatus('disconnected');
        return;
      }
      const connectedId = data ? (data as Record<string, string | null>)[ACCOUNT_ID_COLUMN[platform]] : null;
      setStatus(connectedId ? 'connected' : 'disconnected');
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, platform, supabase]);

  function handleConnect() {
    setRedirecting(true);
    const url = new URL(`/api/zernio/connect/${platform}`, window.location.origin);
    url.searchParams.set('profileId', profileId);
    window.location.href = url.toString();
  }

  async function handleDisconnect() {
    if (!window.confirm(t('disconnectConfirm', { platform: label }))) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/zernio/connect/${platform}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error || t('disconnectError'));
        return;
      }
      setStatus('disconnected');
      toast.success(t('disconnected', { platform: label }));
      if (body?.zernioRevoked === false) {
        toast.warning(t('disconnectPartial'));
      }
    } catch (err) {
      console.error('[ConnectPlatformButton] disconnect failed:', err);
      toast.error(t('disconnectError'));
    } finally {
      setDisconnecting(false);
    }
  }

  const label = t(`platform.${platform}`);

  if (status === 'connected') {
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-1.5 text-sm text-emerald-300">
          <CheckCircle2 className="size-4" />
          {t('connected', { platform: label })}
        </span>
        <Button
          onClick={handleDisconnect}
          disabled={disconnecting || !canEditSettings}
          variant="outline"
          size="sm"
          className="border-border text-muted-foreground hover:bg-muted hover:text-destructive"
          title={!canEditSettings ? t('adminOnly') : undefined}
        >
          {disconnecting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Unlink className="size-4" />
          )}
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
      {t('connect', { platform: label })}
    </Button>
  );
}
