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

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import {
  Bot,
  CreditCard,
  KeyRound,
  Loader2,
  Radio,
  Save,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  lastSignInAt: string | null;
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

type AccountStatus = 'pending' | 'active' | 'suspended';
type BillingCycle = 'monthly' | 'yearly';
type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'canceled';

interface DetailBilling {
  planName: string | null;
  priceAmount: number | null;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  renewalDate: string | null;
}

interface DetailData {
  accountId: string;
  accountName: string;
  ownerUserId: string;
  status: AccountStatus;
  members: DetailMember[];
  connection: DetailConnection | null;
  aiUsage: {
    windowDays: number;
    totalCalls: number;
    totalTokens: number;
    byModel: { provider: string; model: string; calls: number; tokens: number }[];
  };
  billing: DetailBilling | null;
}

const SUBSCRIPTION_STATUS_STYLE: Record<SubscriptionStatus, string> = {
  trial: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  active: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  past_due: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  canceled: 'bg-red-500/12 text-red-600 dark:text-red-400',
};

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
  const [sendingResetUserId, setSendingResetUserId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Target status of the pending confirm dialog — null means closed.
  const [statusTarget, setStatusTarget] = useState<AccountStatus | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Billing form draft — local copy so typing doesn't write on every
  // keystroke; re-seeds whenever a fresh `detail` loads (fetchDetail
  // runs once per sheet open, so this only fires on open/account
  // change, not on every render). priceAmount is kept as a string
  // while editing so an empty/partial input doesn't fight `type="number"`.
  const [billingDraft, setBillingDraft] = useState<{
    planName: string;
    priceAmount: string;
    billingCycle: BillingCycle;
    subscriptionStatus: SubscriptionStatus;
    renewalDate: string;
  }>({
    planName: '',
    priceAmount: '',
    billingCycle: 'monthly',
    subscriptionStatus: 'active',
    renewalDate: '',
  });
  const [savingBilling, setSavingBilling] = useState(false);

  useEffect(() => {
    if (!detail) return;
    const b = detail.billing;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBillingDraft({
      planName: b?.planName ?? '',
      priceAmount: b?.priceAmount != null ? String(b.priceAmount) : '',
      billingCycle: b?.billingCycle ?? 'monthly',
      subscriptionStatus: b?.subscriptionStatus ?? 'active',
      renewalDate: b?.renewalDate ?? '',
    });
  }, [detail]);

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

  async function handleSendReset(member: DetailMember) {
    setSendingResetUserId(member.userId);
    try {
      const res = await fetch(
        `/api/agency/accounts/${accountId}/members/${member.userId}/reset-password`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('sendResetError'));
        return;
      }
      toast.success(t('sendResetSuccess', { email: member.email || '' }));
    } catch {
      toast.error(t('sendResetError'));
    } finally {
      setSendingResetUserId(null);
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

  async function handleUpdateStatus() {
    if (!statusTarget) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/agency/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusTarget }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('statusUpdateError'));
        return;
      }
      toast.success(t('statusUpdateSuccess'));
      setDetail((prev) => (prev ? { ...prev, status: statusTarget } : prev));
      setStatusTarget(null);
      router.refresh();
    } catch {
      toast.error(t('statusUpdateError'));
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleSaveBilling() {
    const trimmedPrice = billingDraft.priceAmount.trim();
    const priceAmount = trimmedPrice === '' ? null : Number(trimmedPrice);
    if (priceAmount !== null && !Number.isFinite(priceAmount)) {
      toast.error(t('billingPriceInvalid'));
      return;
    }
    setSavingBilling(true);
    try {
      const res = await fetch(`/api/agency/accounts/${accountId}/billing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: billingDraft.planName.trim() || null,
          priceAmount,
          billingCycle: billingDraft.billingCycle,
          subscriptionStatus: billingDraft.subscriptionStatus,
          renewalDate: billingDraft.renewalDate || null,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('billingSaveError'));
        return;
      }
      toast.success(t('billingSaveSuccess'));
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              billing: {
                planName: billingDraft.planName.trim() || null,
                priceAmount,
                billingCycle: billingDraft.billingCycle,
                subscriptionStatus: billingDraft.subscriptionStatus,
                renewalDate: billingDraft.renewalDate || null,
              },
            }
          : prev,
      );
      router.refresh();
    } catch {
      toast.error(t('billingSaveError'));
    } finally {
      setSavingBilling(false);
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
                {/* ---- Access status (migration 088) ---- */}
                {detail.status !== 'active' && (
                  <section
                    className={
                      detail.status === 'pending'
                        ? 'rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-3'
                        : 'rounded-xl border border-red-500/25 bg-red-500/[0.05] p-3'
                    }
                  >
                    <p
                      className={
                        detail.status === 'pending'
                          ? 'text-sm font-medium text-amber-700 dark:text-amber-400'
                          : 'text-sm font-medium text-red-600 dark:text-red-400'
                      }
                    >
                      {detail.status === 'pending' ? t('statusPendingTitle') : t('statusSuspendedTitle')}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {detail.status === 'pending' ? t('statusPendingDesc') : t('statusSuspendedDesc')}
                    </p>
                    <Button
                      size="sm"
                      className="mt-2.5 w-full"
                      onClick={() => setStatusTarget('active')}
                    >
                      {detail.status === 'pending' ? t('activateAction') : t('reactivateAction')}
                    </Button>
                  </section>
                )}

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
                          {m.fullName && m.email && (
                            <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                          )}
                          <p className="truncate text-xs text-muted-foreground">
                            {t(`role_${m.role}`)} · {t('lastSeen')}{' '}
                            {timeAgo(m.lastSeenAt, locale, t)} · {t('lastSignIn')}{' '}
                            {timeAgo(m.lastSignInAt, locale, t)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {m.email && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-primary"
                              disabled={sendingResetUserId === m.userId}
                              onClick={() => handleSendReset(m)}
                              aria-label={t('sendResetAction')}
                              title={t('sendResetAction')}
                            >
                              {sendingResetUserId === m.userId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <KeyRound className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {m.role !== 'owner' && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-red-600"
                              disabled={pendingUserId === m.userId}
                              onClick={() => setRemovingMember(m)}
                              aria-label={t('removeMemberAction')}
                              title={t('removeMemberAction')}
                            >
                              {pendingUserId === m.userId ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* ---- Subscription / billing (migration 097) ----
                    Manual record — no payment processor is wired up
                    anywhere in this codebase, so this is the agency
                    owner's own note of what a client is paying,
                    edited here and saved as a whole on submit. */}
                <section>
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <CreditCard className="h-3.5 w-3.5" />
                      {t('billingTitle')}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SUBSCRIPTION_STATUS_STYLE[billingDraft.subscriptionStatus]}`}
                    >
                      {t(`billingStatus_${billingDraft.subscriptionStatus}`)}
                    </span>
                  </div>
                  <div className="mt-2 space-y-2.5 rounded-xl border border-border p-3">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-xs text-muted-foreground">{t('billingPlanName')}</label>
                        <Input
                          value={billingDraft.planName}
                          onChange={(e) =>
                            setBillingDraft((prev) => ({ ...prev, planName: e.target.value }))
                          }
                          placeholder={t('billingPlanNamePlaceholder')}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">{t('billingPrice')}</label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={billingDraft.priceAmount}
                          onChange={(e) =>
                            setBillingDraft((prev) => ({ ...prev, priceAmount: e.target.value }))
                          }
                          placeholder="0.00"
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-xs text-muted-foreground">{t('billingCycle')}</label>
                        <Select
                          value={billingDraft.billingCycle}
                          onValueChange={(v) =>
                            setBillingDraft((prev) => ({ ...prev, billingCycle: v as BillingCycle }))
                          }
                        >
                          <SelectTrigger className="mt-1 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">{t('billingCycle_monthly')}</SelectItem>
                            <SelectItem value="yearly">{t('billingCycle_yearly')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">{t('billingStatusLabel')}</label>
                        <Select
                          value={billingDraft.subscriptionStatus}
                          onValueChange={(v) =>
                            setBillingDraft((prev) => ({
                              ...prev,
                              subscriptionStatus: v as SubscriptionStatus,
                            }))
                          }
                        >
                          <SelectTrigger className="mt-1 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="trial">{t('billingStatus_trial')}</SelectItem>
                            <SelectItem value="active">{t('billingStatus_active')}</SelectItem>
                            <SelectItem value="past_due">{t('billingStatus_past_due')}</SelectItem>
                            <SelectItem value="canceled">{t('billingStatus_canceled')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">{t('billingRenewalDate')}</label>
                      <Input
                        type="date"
                        value={billingDraft.renewalDate}
                        onChange={(e) =>
                          setBillingDraft((prev) => ({ ...prev, renewalDate: e.target.value }))
                        }
                        className="mt-1"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={handleSaveBilling}
                      disabled={savingBilling}
                    >
                      {savingBilling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {t('billingSaveAction')}
                    </Button>
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
                  {detail.status === 'active' && (
                    <Button
                      variant="outline"
                      className="mt-2.5 w-full border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                      onClick={() => setStatusTarget('suspended')}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      {t('suspendAction')}
                    </Button>
                  )}
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

      {/* ---- Status-change confirm (activate / reactivate / suspend) ---- */}
      <ConfirmDialog
        open={statusTarget !== null}
        onOpenChange={(next) => !next && setStatusTarget(null)}
        title={
          statusTarget === 'suspended'
            ? t('suspendConfirmTitle')
            : detail?.status === 'pending'
              ? t('activateConfirmTitle')
              : t('reactivateConfirmTitle')
        }
        description={
          statusTarget === 'suspended' ? t('suspendConfirmDesc', { name: accountName }) : undefined
        }
        confirmLabel={
          statusTarget === 'suspended'
            ? t('suspendAction')
            : detail?.status === 'pending'
              ? t('activateAction')
              : t('reactivateAction')
        }
        cancelLabel={t('cancel')}
        onConfirm={handleUpdateStatus}
        variant={statusTarget === 'suspended' ? 'destructive' : 'default'}
        loading={updatingStatus}
      />
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
