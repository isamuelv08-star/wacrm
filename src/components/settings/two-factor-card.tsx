'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';

type Status = 'loading' | 'off' | 'on' | 'enrolling';

interface PendingEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export function TwoFactorCard() {
  const t = useTranslations('Settings.profile');
  const supabase = createClient();

  const [status, setStatus] = useState<Status>('loading');
  const [pending, setPending] = useState<PendingEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [activeFactorId, setActiveFactorId] = useState<string | null>(null);

  const loadStatus = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      toast.error(t('twoFactorLoadFailed'));
      setStatus('off');
      return;
    }
    const verified = data.totp.find((f) => f.status === 'verified');
    if (verified) {
      setActiveFactorId(verified.id);
      setStatus('on');
    } else {
      setActiveFactorId(null);
      setStatus('off');
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEnroll = async () => {
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error) {
      const message =
        error.code === 'mfa_totp_enroll_not_enabled'
          ? t('twoFactorNotEnabledOnProject')
          : error.message;
      toast.error(t('twoFactorEnrollFailed', { message }));
      return;
    }
    setPending({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
    setCode('');
    setConfirmError(null);
    setStatus('enrolling');
  };

  const cancelEnroll = async () => {
    // Drop the unverified factor GoTrue created for this attempt —
    // otherwise a user who backs out mid-enrollment accumulates
    // orphaned unverified factors (GoTrue caps enrolled factors per
    // user, so this would eventually block re-enrollment).
    if (pending) {
      await supabase.auth.mfa.unenroll({ factorId: pending.factorId }).catch(() => {});
    }
    setPending(null);
    setCode('');
    setConfirmError(null);
    setStatus('off');
  };

  const confirmEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    setConfirming(true);
    setConfirmError(null);

    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: pending.factorId,
      code: code.trim(),
    });

    if (error) {
      setConfirmError(
        error.code === 'mfa_verification_failed'
          ? t('twoFactorInvalidCode')
          : error.message,
      );
      setConfirming(false);
      return;
    }

    toast.success(t('twoFactorEnabledSuccess'));
    setPending(null);
    setCode('');
    setConfirming(false);
    setActiveFactorId(pending.factorId);
    setStatus('on');
  };

  const confirmDisable = async () => {
    if (!activeFactorId) return;
    setDisabling(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: activeFactorId });
    setDisabling(false);
    setDisableOpen(false);
    if (error) {
      toast.error(t('twoFactorDisableFailed', { message: error.message }));
      return;
    }
    toast.success(t('twoFactorDisabledSuccess'));
    setActiveFactorId(null);
    setStatus('off');
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="size-4 text-primary" />
            {t('twoFactorTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('twoFactorDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('twoFactorLoading')}
            </div>
          )}

          {status === 'off' && (
            <div className="flex items-center justify-between gap-4">
              <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {t('twoFactorDisabledBadge')}
              </span>
              <Button type="button" onClick={startEnroll}>
                {t('twoFactorEnable')}
              </Button>
            </div>
          )}

          {status === 'on' && (
            <div className="flex items-center justify-between gap-4">
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {t('twoFactorEnabledBadge')}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDisableOpen(true)}
              >
                {t('twoFactorDisable')}
              </Button>
            </div>
          )}

          {status === 'enrolling' && pending && (
            <form onSubmit={confirmEnroll} className="space-y-4">
              <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">{t('twoFactorScanQr')}</p>
                {/* eslint-disable-next-line @next/next/no-img-element -- data: SVG from Supabase, not an optimizable remote asset */}
                <img
                  src={pending.qrCode}
                  alt=""
                  className="h-40 w-40 rounded-md bg-white p-2"
                />
                <p className="text-center text-xs break-all text-muted-foreground">
                  {t('twoFactorSecretFallback')} <code>{pending.secret}</code>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tfa-code" className="text-foreground">
                  {t('twoFactorCodeLabel')}
                </Label>
                <Input
                  id="tfa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={t('twoFactorCodePlaceholder')}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={10}
                  disabled={confirming}
                  required
                  autoFocus
                  className="text-center text-lg tracking-[0.3em]"
                />
              </div>

              {confirmError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {confirmError}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={cancelEnroll}
                  disabled={confirming}
                >
                  {t('twoFactorCancel')}
                </Button>
                <Button type="submit" disabled={confirming || !code}>
                  {confirming ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      {t('twoFactorConfirming')}
                    </>
                  ) : (
                    t('twoFactorConfirm')
                  )}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('twoFactorDisableConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('twoFactorDisableConfirmDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDisableOpen(false)}
              disabled={disabling}
            >
              {t('twoFactorCancel')}
            </Button>
            <Button type="button" onClick={confirmDisable} disabled={disabling}>
              {disabling ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('twoFactorDisabling')}
                </>
              ) : (
                t('twoFactorDisableConfirmAction')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
