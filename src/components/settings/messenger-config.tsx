'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Copy, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const MASKED_TOKEN = '••••••••••••••••';

/**
 * Manual Messenger connection form — the Messenger counterpart to
 * <WhatsAppConfig>, trimmed to what a Page Access Token connection
 * actually needs (no PIN/2FA registration step; that's a WhatsApp
 * Cloud API concept). Same never-select-the-secret-column pattern:
 * the GET below never fetches page_access_token/verify_token, only a
 * masked placeholder is ever shown.
 */
export function MessengerConfig() {
  const t = useTranslations('Settings.messenger');
  const supabase = createClient();
  const { accountId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown');
  const [statusMessage, setStatusMessage] = useState('');
  const loadedAccountIdRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [pageId, setPageId] = useState('');
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  const webhookUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/messenger/webhook` : '/api/messenger/webhook';

  const fetchConfig = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('messenger_config')
      .select('page_id, page_name, status')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!error && data) {
      setHasConfig(true);
      setPageId(data.page_id ?? '');
      setPageAccessToken(MASKED_TOKEN);
      setTokenEdited(false);
      setConnectionStatus(data.status === 'connected' ? 'connected' : 'disconnected');
    } else {
      setHasConfig(false);
      setConnectionStatus('unknown');
    }
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  const handleCopyWebhook = useCallback(() => {
    void navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [webhookUrl]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setStatusMessage('');
    try {
      const res = await fetch('/api/messenger/config');
      const data = await res.json();
      if (data.connected) {
        setConnectionStatus('connected');
        setStatusMessage(t('connectedAs', { name: data.page_info?.name ?? pageId }));
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage(data.message ?? t('disconnected'));
      }
    } catch (err) {
      setConnectionStatus('disconnected');
      setStatusMessage(err instanceof Error ? err.message : 'Error');
    } finally {
      setTesting(false);
    }
  }, [pageId, t]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = { page_id: pageId };
      if (!hasConfig || tokenEdited) body.page_access_token = pageAccessToken;
      if (verifyToken) body.verify_token = verifyToken;

      const res = await fetch('/api/messenger/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('saveError'));
        return;
      }

      if (data.subscribe_error) {
        toast.warning(t('subscribeWarning', { error: data.subscribe_error }));
      } else {
        toast.success(t('saveSuccess'));
      }
      await fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  }, [pageId, pageAccessToken, verifyToken, hasConfig, tokenEdited, fetchConfig, t]);

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      await fetch('/api/messenger/config', { method: 'DELETE' });
      setHasConfig(false);
      setPageId('');
      setPageAccessToken('');
      setVerifyToken('');
      setConnectionStatus('unknown');
      setStatusMessage('');
    } finally {
      setResetting(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('description')}</p>
      </div>

      {connectionStatus !== 'unknown' && (
        <Alert className={connectionStatus === 'connected' ? 'border-emerald-700/50 bg-emerald-950/20' : 'border-border'}>
          {connectionStatus === 'connected' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-foreground" />
          )}
          <AlertTitle className="text-foreground">
            {connectionStatus === 'connected' ? t('connected') : t('disconnected')}
          </AlertTitle>
          {statusMessage && <AlertDescription className="text-muted-foreground">{statusMessage}</AlertDescription>}
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="messenger-page-id">{t('pageId')}</Label>
        <Input
          id="messenger-page-id"
          value={pageId}
          onChange={(e) => setPageId(e.target.value)}
          className="bg-background"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="messenger-token">{t('pageAccessToken')}</Label>
        <div className="flex gap-2">
          <Input
            id="messenger-token"
            type={showToken ? 'text' : 'password'}
            value={pageAccessToken}
            onFocus={() => {
              if (!tokenEdited && pageAccessToken === MASKED_TOKEN) {
                setPageAccessToken('');
                setTokenEdited(true);
              }
            }}
            onChange={(e) => {
              setPageAccessToken(e.target.value);
              setTokenEdited(true);
            }}
            className="bg-background"
          />
          <Button type="button" variant="outline" size="icon" onClick={() => setShowToken((v) => !v)}>
            {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="messenger-verify-token">{t('verifyToken')}</Label>
        <Input
          id="messenger-verify-token"
          value={verifyToken}
          onChange={(e) => setVerifyToken(e.target.value)}
          placeholder={hasConfig ? MASKED_TOKEN : ''}
          className="bg-background"
        />
        <p className="text-xs text-muted-foreground">{t('verifyTokenHint')}</p>
      </div>

      <div className="space-y-2">
        <Label>{t('webhookUrl')}</Label>
        <div className="flex gap-2">
          <Input readOnly value={webhookUrl} className="bg-background font-mono text-xs" />
          <Button type="button" variant="outline" size="icon" onClick={handleCopyWebhook}>
            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving || !pageId || (!hasConfig && !pageAccessToken)}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? t('saving') : t('save')}
        </Button>
        {hasConfig && (
          <>
            <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {testing ? t('testing') : t('testConnection')}
            </Button>
            <Button type="button" variant="outline" onClick={handleReset} disabled={resetting}>
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {resetting ? t('resetting') : t('resetConfig')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
