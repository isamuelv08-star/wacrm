'use client';

// ============================================================
// InviteMemberDialog — "Add member"
//
// Two-step modal:
//   1. Form  — role, individual sales goal, dashboard access, optional
//              label → POST creates the member's account + a link for
//              them to set their own password.
//   2. Result — the share link, returned ONCE. Copy-to-clipboard, plus
//              a "Send via WhatsApp" deep link that pre-fills wa.me
//              with a friendly message containing it.
//
// Why there's still a link at all
// --------------------------------
// This can't be a single click that finishes the whole job: Supabase
// Auth requires the new member to set their OWN password (there's no
// "create a working login for someone else" short-cut without either
// emailing them — unreliable on a self-hosted deploy with no SMTP
// configured — or generating a password on their behalf and handing
// it over insecurely). The link is that one unavoidable step; the
// member row itself is created immediately (shows up in the roster
// as a real member, not a "pending invite"), and the link never
// meaningfully expires (see DEFAULT_INVITE_EXPIRY_DAYS) — no expiry
// picker, no separate "pending invitations" waiting period to reason
// about, as close to "just add them" as the auth model allows.
//
// The plaintext token is server-stored only as a SHA-256 hash, so once
// the result step is dismissed the link is gone forever — the dialog
// shouts this in copy.
// ============================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, MessageCircle, Sparkles } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import {
  canViewDashboardSection,
  DASHBOARD_PERMISSION_KEYS,
  type DashboardPermissionKey,
  type DashboardPermissions,
} from '@/lib/auth/roles';

type InviteRole = 'admin' | 'agent' | 'viewer';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create so the parent re-fetches the
   *  pending-invitations list. */
  onCreated: () => void;
}

// Server caps label at 80 chars (see src/app/api/account/invitations/route.ts).
// Mirror it on the client so we short-circuit before the round-trip
// rather than letting the user submit and bounce off a 400.
const MAX_LABEL_LEN = 80;

interface CreatedInvite {
  url: string;
  role: InviteRole;
  /** Snapshotted at creation time so a later account rename can't
   *  retroactively change the wa.me message text on the result step. */
  accountName: string;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  onCreated,
}: InviteMemberDialogProps) {
  const t = useTranslations('Settings.invite');
  const tRoles = useTranslations('Settings.roles');
  const { account, defaultCurrency } = useAuth();
  const [role, setRole] = useState<InviteRole>('agent');
  const [label, setLabel] = useState('');
  // Raw text so the field can be legitimately empty (no goal set) —
  // parsed to a number only at submit time.
  const [individualSalesGoal, setIndividualSalesGoal] = useState('');
  // Only the EXPLICIT overrides the inviter makes — a key absent here
  // just falls back to the role default (computed live below via
  // `canViewDashboardSection`), same resolution the dashboard itself
  // uses. Sending `{}` when nothing was touched means a brand-new
  // agent gets exactly the role default with no special-casing here.
  const [permissionOverrides, setPermissionOverrides] = useState<DashboardPermissions>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedInvite | null>(null);

  function reset() {
    setRole('agent');
    setLabel('');
    setIndividualSalesGoal('');
    setPermissionOverrides({});
    setResult(null);
    setSubmitting(false);
  }

  function isPermissionChecked(key: DashboardPermissionKey): boolean {
    return permissionOverrides[key] ?? canViewDashboardSection(role, null, key);
  }

  function togglePermission(key: DashboardPermissionKey) {
    setPermissionOverrides((prev) => ({ ...prev, [key]: !isPermissionChecked(key) }));
  }

  async function handleCreate() {
    // Mirror the server's max-length check so we don't ship an
    // obviously-too-long label across the wire just to bounce off
    // a 400. The Input also has a `maxLength={MAX_LABEL_LEN}` cap
    // but a paste can land an over-limit string into state before
    // the limit kicks in on the next keystroke — this is the safety
    // net for that path.
    const trimmedLabel = label.trim();
    if (trimmedLabel.length > MAX_LABEL_LEN) {
      toast.error(t('labelTooLong', { max: MAX_LABEL_LEN }));
      return;
    }

    const trimmedGoal = individualSalesGoal.trim();
    let goalValue: number | undefined;
    if (trimmedGoal !== '') {
      const parsed = Number(trimmedGoal);
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast.error(t('individualGoalInvalid'));
        return;
      }
      goalValue = parsed;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/account/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          label: trimmedLabel || undefined,
          dashboardPermissions: permissionOverrides,
          individualSalesGoal: goalValue,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to create invitation');
        return;
      }

      const data = (await res.json()) as { url: string };

      setResult({
        url: data.url,
        role,
        // Snapshot the account name into the result so the wa.me
        // share message has team context. Falls back to a generic
        // string if `account` hasn't loaded yet (shouldn't happen
        // — the dialog requires admin+ which requires a loaded
        // profile — but stay safe).
        accountName: account?.name ?? 'our wacrm account',
      });
      onCreated();
    } catch (err) {
      console.error('[InviteMemberDialog] create error:', err);
      toast.error('Could not reach the server. Try again?');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success(t('copied'));
    } catch {
      // Most likely "not in a secure context" — happens on http://
      // local IPs. Surface the link in the toast so the admin can
      // hand-copy it.
      toast.error(t('clipboardBlocked'));
    }
  }

  function whatsappShareUrl(url: string): string {
    // Include the account name so the recipient knows which team
    // they're being invited to before clicking through. This matters
    // for users in multi-team contexts where "our wacrm account"
    // wouldn't be enough to disambiguate.
    const accountName = result?.accountName ?? 'our wacrm account';
    const message = t('whatsappMessage', { accountName, url });
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reset state when the dialog closes — both for cancel and
        // for dismissal after a successful create. The plaintext URL
        // is intentionally NOT preserved across opens.
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md max-h-[85vh] overflow-y-auto">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <Sparkles className="size-4 text-primary" />
                {t('inviteCreated')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t.rich('inviteCreatedDesc', {
                  role: tRoles(result.role),
                  bold: (chunks: React.ReactNode) => <strong>{chunks}</strong>
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <Label className="text-muted-foreground">{t('inviteLink')}</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={result.url}
                  className="bg-muted border-border text-foreground font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  onClick={copyToClipboard}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0"
                >
                  <Copy className="size-4" />
                  {t('copy')}
                </Button>
              </div>

              {/* Higher-contrast amber than the original 10% / amber-200.
                  Reviewed against slate-900 to meet WCAG AAA for body
                  text (target ratio 7:1). Border bumped to /50, bg to
                  /15, foreground promoted to amber-100 for the strong
                  intro, amber-200 for the body. */}
              <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                <strong className="font-semibold text-amber-100">
                  {t('saveLinkNow')}
                </strong>{' '}
                {t('saveLinkHint')}
              </div>

              {/* Anchor styled with `buttonVariants` rather than wrapping
                  in <Button asChild>. The wacrm Button is the Base UI
                  ButtonPrimitive — it has no Radix-style asChild slot.
                  Direct anchor preserves right-click "Open in new tab"
                  behaviour too. */}
              <a
                href={whatsappShareUrl(result.url)}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonVariants({
                  variant: 'outline',
                  className:
                    'w-full border-border text-muted-foreground hover:bg-muted',
                })}
              >
                <MessageCircle className="size-4" />
                {t('sendViaWhatsApp')}
              </a>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                onClick={() => onOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {t('done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t('dialogTitle')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('dialogDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('roleLabel')}</Label>
                <Select
                  value={role}
                  onValueChange={(v) => v && setRole(v as InviteRole)}
                >
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue>{tRoles(role)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{tRoles('admin')}</SelectItem>
                    <SelectItem value="agent">{tRoles('agent')}</SelectItem>
                    <SelectItem value="viewer">{tRoles('viewer')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {tRoles(`${role}Hint` as 'adminHint' | 'agentHint' | 'viewerHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('individualGoalLabel', { currency: defaultCurrency })}{' '}
                  <span className="text-xs text-muted-foreground">{t('optional')}</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={individualSalesGoal}
                  onChange={(e) => setIndividualSalesGoal(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t('individualGoalHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">
                  {t('labelTitle')}{' '}
                  <span className="text-xs text-muted-foreground">{t('optional')}</span>
                </Label>
                <Input
                  placeholder={t('labelPlaceholder')}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={MAX_LABEL_LEN}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  {t('labelHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('dashboardPermissions.title')}</Label>
                <p className="text-xs text-muted-foreground">{t('dashboardPermissions.hint')}</p>
                <div className="space-y-2 rounded-md border border-border p-3">
                  {DASHBOARD_PERMISSION_KEYS.map((key) => (
                    <label key={key} className="flex cursor-pointer items-start gap-2.5">
                      <Checkbox
                        checked={isPermissionChecked(key)}
                        onCheckedChange={() => togglePermission(key)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-foreground">
                          {t(`dashboardPermissions.${key}Label`)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t(`dashboardPermissions.${key}Desc`)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('creating')}
                  </>
                ) : (
                  t('generateLink')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
