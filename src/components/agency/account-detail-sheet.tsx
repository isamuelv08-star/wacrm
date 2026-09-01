'use client';

// ============================================================
// AccountDetailSheet — click-through detail for one agency-panel card.
//
// Wraps the (server-rendered) card as its trigger — see agency-page's
// composition: <AccountDetailSheet account={...}><AgencyAccountCard
// account={...} /></AccountDetailSheet>. Fetches
// GET /api/agency/accounts/[id] on open (members + presence, WhatsApp
// connection, 30-day AI usage) and hosts the two delete actions this
// view exists for: removing one member's login entirely, or deleting
// the whole client account. Both are permanent — see the confirm UX
// below and the doc comments on deleteAgencyAccount(Member) in
// src/lib/agency/account-detail.ts for exactly what each does.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import {
  Bot,
  Loader2,
  Radio,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface DetailMember {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: 'owner' | 'admin' | 'agent' | 'viewer';
  createdAt: string;
  lastSeenAt: string | null;
}

interface DetailConnection {
  method: 'meta' | 'coexistence' | 'zernio' | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  status: string | null;
  sendApiBase: string | null;
  registeredAt: string | null;
  connectedAt: string | null;
  lastRegistrationError: string | null;
}

interface DetailData {
  accountId: string;
  accountName: string;
  ownerUserId: string;
  members: DetailMember[];
  connection: DetailConnection | null;
  aiUsage: {
    windowDays: number;
    totalCalls: number;
    totalTokens: number;
    byModel: { provider: string; model: string; calls: number; tokens: number }[];
  };
}

function timeAgo(iso: string | null, locale: string, t: (k: string) => string): string {
  if (!iso) return t('never');
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return t('justNow');
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(-days, 'day');
}

export function AccountDetailSheet({
  accountId,
  accountName,
  children,
}: {
  accountId: string;
  accountName: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('Agency.detail');
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [removingMember, setRemovingMember] = useState<DetailMember | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function fetchDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/agency/accounts/${accountId}`);
      if (!res.ok) {
        toast.error(t('loadError'));
        return;
      }
      const payload = (await res.json()) as { account: DetailData };
      setDetail(payload.account);
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !detail) {
      void fetchDetail();
    }
  }

  async function handleRemoveMember() {
    if (!removingMember) return;
    setPendingUserId(removingMember.userId);
    try {
      const res = await fetch(
        `/api/agency/accounts/${accountId}/members/${removingMember.userId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('removeMemberError'));
        return;
      }
      toast.success(t('removeMemberSuccess'));
      setDetail((prev) =>
        prev
          ? { ...prev, members: prev.members.filter((m) => m.userId !== removingMember.userId) }
          : prev,
      );
      setRemovingMember(null);
      router.refresh();
    } catch {
      toast.error(t('removeMemberError'));
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/agency/accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('deleteAccountError'));
        return;
      }
      toast.success(t('deleteAccountSuccess', { name: accountName }));
      setDeleteDialogOpen(false);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(t('deleteAccountError'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger
          render={
            <button
              type="button"
              className="block w-full cursor-pointer text-left"
              aria-label={t('openDetail', { name: accountName })}
            >
              {children}
            </button>
          }
        />

        <SheetContent
          side="right"
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>{accountName}</SheetTitle>
            <SheetDescription>{t('subtitle')}</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
            {loading && !detail && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}

            {detail && (
              <>
                {/* ---- Members ---- */}
                <section>
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {t('membersTitle', { count: detail.members.length })}
                  </h3>
                  <div className="mt-2 divide-y divide-border rounded-xl border border-border">
                    {detail.members.map((m) => (
                      <div key={m.userId} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {m.fullName || m.email || m.userId}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t(`role_${m.role}`)} · {t('lastSeen')}{' '}
                            {timeAgo(m.lastSeenAt, locale, t)}
                          </p>
                        </div>
                        {m.role !== 'owner' && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 text-muted-foreground hover:text-red-600"
                            disabled={pendingUserId === m.userId}
                            onClick={() => setRemovingMember(m)}
                            aria-label={t('removeMemberAction')}
                          >
                            {pendingUserId === m.userId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>

                {/* ---- Connection ---- */}
                <section>
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Radio className="h-3.5 w-3.5" />
                    {t('connectionTitle')}
                  </h3>
                  <div className="mt-2 rounded-xl border border-border p-3 text-sm">
                    {!detail.connection && (
                      <p className="text-muted-foreground">{t('noConnection')}</p>
                    )}
                    {detail.connection && (
                      <dl className="space-y-1.5">
                        <Row
                          label={t('connectionMethod')}
                          value={
                            detail.connection.method
                              ? t(`method_${detail.connection.method}`)
                              : t('methodNone')
                          }
                        />
                        {detail.connection.phoneNumberId && (
                          <Row label={t('phoneNumberId')} value={detail.connection.phoneNumberId} mono />
                        )}
                        {detail.connection.wabaId && (
                          <Row label={t('wabaId')} value={detail.connection.wabaId} mono />
                        )}
                        {detail.connection.status && (
                          <Row label={t('status')} value={detail.connection.status} />
                        )}
                        {detail.connection.lastRegistrationError && (
                          <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            {detail.connection.lastRegistrationError}
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                </section>

                {/* ---- AI usage ---- */}
                <section>
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Bot className="h-3.5 w-3.5" />
                    {t('aiUsageTitle', { days: detail.aiUsage.windowDays })}
                  </h3>
                  <div className="mt-2 rounded-xl border border-border p-3">
                    {detail.aiUsage.totalCalls === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('noAiUsage')}</p>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-4">
                          <div>
                            <p className="text-2xl font-bold text-foreground">
                              {detail.aiUsage.totalTokens.toLocaleString(locale)}
                            </p>
                            <p className="text-xs text-muted-foreground">{t('tokens')}</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-foreground">
                              {detail.aiUsage.totalCalls.toLocaleString(locale)}
                            </p>
                            <p className="text-xs text-muted-foreground">{t('calls')}</p>
                          </div>
                        </div>
                        <div className="mt-3 space-y-1">
                          {detail.aiUsage.byModel.map((m) => (
                            <div
                              key={`${m.provider}:${m.model}`}
                              className="flex items-center justify-between text-xs"
                            >
                              <span className="text-muted-foreground">
                                {m.provider} · {m.model}
                              </span>
                              <span className="font-mono tabular-nums text-foreground">
                                {m.tokens.toLocaleString(locale)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {/* ---- Danger zone ---- */}
                <section className="rounded-xl border border-red-500/25 bg-red-500/[0.03] p-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {t('dangerZoneTitle')}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t('dangerZoneDesc')}</p>
                  <Button
                    variant="outline"
                    className="mt-2.5 w-full border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('deleteAccountAction')}
                  </Button>
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ---- Remove-member confirm ---- */}
      <Dialog
        open={!!removingMember}
        onOpenChange={(next) => !next && setRemovingMember(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('removeMemberTitle')}</DialogTitle>
            <DialogDescription>
              {t('removeMemberDesc', {
                name: removingMember?.fullName || removingMember?.email || '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemovingMember(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={handleRemoveMember}
              disabled={!!pendingUserId}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {pendingUserId ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('removing')}
                </>
              ) : (
                t('removeMemberAction')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete-account confirm (type-to-confirm) ---- */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(next) => {
          setDeleteDialogOpen(next);
          if (!next) setDeleteConfirmText('');
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <TriangleAlert className="h-4 w-4" />
              {t('deleteAccountTitle')}
            </DialogTitle>
            <DialogDescription>{t('deleteAccountDesc', { name: accountName })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t('deleteAccountConfirmLabel', { name: accountName })}
            </label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={accountName}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={handleDeleteAccount}
              disabled={deleting || deleteConfirmText.trim() !== accountName}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('deleting')}
                </>
              ) : (
                t('deleteAccountAction')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs text-foreground' : 'text-foreground'}>{value}</dd>
    </div>
  );
}
