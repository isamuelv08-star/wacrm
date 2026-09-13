'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PlatformIcon } from '@/components/inbox/platform-accent';
import { MessengerConfig } from './messenger-config';
import { IntegrationCard } from './integration-card';

/**
 * The manual Messenger connection. Same two layouts as
 * <WhatsAppApiConnectCard> — `variant="row"` (default, for onboarding's
 * linear list) or `variant="card"` (for the Settings → Integrations
 * grid) — sharing the same status/dialog logic. See that component's
 * doc comment for why the form lives in a dialog rather than always
 * inline.
 */
export function MessengerConnectCard({ variant = 'row' }: { variant?: 'row' | 'card' }) {
  const t = useTranslations('Settings.integrations');
  const { accountId } = useAuth();
  const supabase = createClient();

  const [status, setStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [open, setOpen] = useState(false);
  const loadedAccountIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('messenger_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('[MessengerConnectCard] status check failed:', error);
        setStatus('disconnected');
        return;
      }
      setStatus(data ? 'connected' : 'disconnected');
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && accountId) {
      supabase
        .from('messenger_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle()
        .then(({ data }) => setStatus(data ? 'connected' : 'disconnected'));
    }
  }

  const action =
    status === 'connected' ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-1.5 text-sm text-emerald-300">
          <CheckCircle2 className="size-4" />
          {t('connected', { platform: t('platform.messenger') })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="border-border text-foreground hover:bg-muted"
        >
          <Settings2 className="size-4" />
          {t('manage')}
        </Button>
      </div>
    ) : (
      <Button
        onClick={() => setOpen(true)}
        disabled={status === 'checking'}
        variant={variant === 'card' ? 'default' : 'outline'}
        className={variant === 'card' ? 'w-full' : 'border-border text-foreground hover:bg-muted'}
      >
        {status === 'checking' ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ExternalLink className="size-4" />
        )}
        {t('connect', { platform: t('platform.messenger') })}
      </Button>
    );

  return (
    <>
      {variant === 'card' ? (
        <IntegrationCard
          icon={<PlatformIcon platform="messenger" />}
          name={t('platform.messenger')}
          subtitle={t('messengerHint')}
          action={action}
        />
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <PlatformIcon platform="messenger" className="h-4 w-4" />
            <div>
              <p className="text-sm font-medium text-foreground">{t('platform.messenger')}</p>
              <p className="text-xs text-muted-foreground">{t('messengerHint')}</p>
            </div>
          </div>
          {action}
        </div>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="themed-scrollbar max-h-[85vh] overflow-y-auto bg-popover border-border sm:max-w-2xl">
          <MessengerConfig />
        </DialogContent>
      </Dialog>
    </>
  );
}
