'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { WhatsAppConfig } from './whatsapp-config';

/**
 * Horizontal card for the manual "WhatsApp via API" connection —
 * mirrors <ConnectPlatformButton>'s layout exactly (title + hint on
 * the left, a status/action button on the right) so the two ways to
 * connect WhatsApp read as siblings, not two different UIs bolted
 * together. Clicking the button opens the full credentials form
 * (unchanged — still <WhatsAppConfig />, just relocated into a
 * dialog instead of always sitting inline on the page) rather than
 * permanently taking up page space.
 */
export function WhatsAppApiConnectCard() {
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
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('[WhatsAppApiConnectCard] status check failed:', error);
        setStatus('disconnected');
        return;
      }
      setStatus(data ? 'connected' : 'disconnected');
    })();

    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  // Re-check status when the dialog closes — the form inside may have
  // just saved (or reset) the config, and the card badge should reflect
  // that immediately instead of showing stale state until next reload.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && accountId) {
      supabase
        .from('whatsapp_config')
        .select('status')
        .eq('account_id', accountId)
        .maybeSingle()
        .then(({ data }) => setStatus(data ? 'connected' : 'disconnected'));
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-medium text-foreground">{t('platform.whatsappApi')}</p>
          <p className="text-xs text-muted-foreground">{t('whatsappApiHint')}</p>
        </div>
        {status === 'connected' ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 py-1.5 text-sm text-emerald-300">
              <CheckCircle2 className="size-4" />
              {t('connected', { platform: t('platform.whatsappApi') })}
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
            variant="outline"
            className="border-border text-foreground hover:bg-muted"
          >
            {status === 'checking' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ExternalLink className="size-4" />
            )}
            {t('connect', { platform: t('platform.whatsappApi') })}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="themed-scrollbar max-h-[85vh] overflow-y-auto bg-popover border-border sm:max-w-3xl">
          <WhatsAppConfig />
        </DialogContent>
      </Dialog>
    </>
  );
}
