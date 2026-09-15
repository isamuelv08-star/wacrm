'use client';

// ============================================================
// WhatsAppNumbersDialog — the floating window for a multiwhatsapp-
// mode account: list every connected number, assign/reassign/unassign
// each one to a seller, remove a number, or add another. Deliberately
// reuses existing pieces rather than a parallel connect flow:
//   - GET  /api/whatsapp/numbers        (new, list-only)
//   - GET  /api/account/members         (existing — Members tab's own
//     endpoint, reused verbatim for the assignment dropdown)
//   - POST /api/whatsapp/config with add_new:true (existing route,
//     same Meta-verification/registration logic the single-number
//     Settings flow already uses — see that route's doc comment)
//   - PATCH/DELETE /api/whatsapp/numbers/[id] (new — rename/assign/
//     remove one specific row)
// The "add a number" form only asks for what POST /api/whatsapp/config
// actually requires (phone_number_id + access_token, waba_id + pin
// optional) — no Coexistence-provider toggle here; an account that
// needs that can still add it from the single-number flow before
// switching modes, or via this form once the pin/coexistence case
// comes up in practice.
// ============================================================

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Plus, Trash2, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AccountMember } from '@/types';

const UNASSIGNED = '__unassigned__';

interface WhatsAppNumber {
  id: string;
  phone_number_id: string;
  waba_id: string | null;
  status: 'connected' | 'disconnected';
  label: string | null;
  owner_user_id: string | null;
  last_registration_error: string | null;
}

export function WhatsAppNumbersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('Settings.whatsappNumbers');

  const [numbers, setNumbers] = useState<WhatsAppNumber[] | null>(null);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [reassigningId, setReassigningId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WhatsAppNumber | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addPhoneNumberId, setAddPhoneNumberId] = useState('');
  const [addWabaId, setAddWabaId] = useState('');
  const [addAccessToken, setAddAccessToken] = useState('');
  const [addPin, setAddPin] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [numbersRes, membersRes] = await Promise.all([
        fetch('/api/whatsapp/numbers'),
        fetch('/api/account/members'),
      ]);
      if (numbersRes.ok) {
        const body = (await numbersRes.json()) as { numbers: WhatsAppNumber[] };
        setNumbers(body.numbers);
      } else {
        toast.error(t('loadError'));
      }
      if (membersRes.ok) {
        const body = (await membersRes.json()) as { members: AccountMember[] };
        setMembers(body.members);
      }
    } catch {
      toast.error(t('loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lazy-load on first open
    if (open && numbers === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() is stable enough here; re-running per its own identity would refetch on every render
  }, [open, numbers]);

  function resetAddForm() {
    setAddLabel('');
    setAddPhoneNumberId('');
    setAddWabaId('');
    setAddAccessToken('');
    setAddPin('');
    setAddOpen(false);
  }

  async function handleAssign(numberId: string, userId: string | null) {
    setReassigningId(numberId);
    try {
      const res = await fetch(`/api/whatsapp/numbers/${numberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_user_id: userId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('assignError'));
        return;
      }
      setNumbers((prev) =>
        prev?.map((n) => (n.id === numberId ? { ...n, owner_user_id: userId } : n)) ?? prev,
      );
    } catch {
      toast.error(t('assignError'));
    } finally {
      setReassigningId(null);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    const numberId = removeTarget.id;
    setRemovingId(numberId);
    try {
      const res = await fetch(`/api/whatsapp/numbers/${numberId}`, { method: 'DELETE' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('removeError'));
        return;
      }
      setNumbers((prev) => prev?.filter((n) => n.id !== numberId) ?? prev);
      toast.success(t('removeSuccess'));
      setRemoveTarget(null);
    } catch {
      toast.error(t('removeError'));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleAddNumber() {
    if (!addPhoneNumberId.trim() || !addAccessToken.trim()) {
      toast.error(t('addRequiredFields'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          add_new: true,
          phone_number_id: addPhoneNumberId.trim(),
          waba_id: addWabaId.trim() || undefined,
          access_token: addAccessToken.trim(),
          pin: addPin.trim() || undefined,
          label: addLabel.trim() || null,
          owner_user_id: null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('addError'));
        return;
      }
      toast.success(t('addSuccess'));
      resetAddForm();
      await load();
    } catch {
      toast.error(t('addError'));
    } finally {
      setSaving(false);
    }
  }

  function memberName(userId: string): string {
    const m = members.find((m) => m.user_id === userId);
    return m?.full_name || m?.email || userId;
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="themed-scrollbar max-h-[85vh] overflow-y-auto bg-popover border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {loading && numbers === null ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : numbers && numbers.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            numbers?.map((n) => (
              <div key={n.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {n.label || n.phone_number_id}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{n.phone_number_id}</p>
                  </div>
                  <span
                    className={
                      n.status === 'connected'
                        ? 'shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400'
                        : 'shrink-0 inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400'
                    }
                  >
                    {n.status === 'connected' ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <TriangleAlert className="h-3 w-3" />
                    )}
                    {n.status === 'connected' ? t('connected') : t('disconnected')}
                  </span>
                </div>

                <div className="mt-2.5 flex items-center gap-2">
                  <Select
                    value={n.owner_user_id ?? UNASSIGNED}
                    onValueChange={(v) => {
                      if (!v) return;
                      void handleAssign(n.id, v === UNASSIGNED ? null : v);
                    }}
                  >
                    <SelectTrigger
                      disabled={reassigningId === n.id}
                      className="h-8 flex-1 border-border bg-muted text-xs text-foreground"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>{t('unassigned')}</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.user_id} value={m.user_id}>
                          {m.full_name || m.email || m.user_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={removingId === n.id}
                    onClick={() => setRemoveTarget(n)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t('removeAction')}
                    title={t('removeAction')}
                  >
                    {removingId === n.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {n.owner_user_id && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {t('assignedTo', { name: memberName(n.owner_user_id) })}
                  </p>
                )}
              </div>
            ))
          )}

          {!addOpen ? (
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed border-border text-muted-foreground hover:text-foreground"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="h-4 w-4" />
              {t('addNumber')}
            </Button>
          ) : (
            <div className="space-y-2.5 rounded-xl border border-border p-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('addLabelField')}</Label>
                <Input
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder={t('addLabelPlaceholder')}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('addPhoneNumberIdField')}</Label>
                <Input
                  value={addPhoneNumberId}
                  onChange={(e) => setAddPhoneNumberId(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('addWabaIdField')}</Label>
                <Input
                  value={addWabaId}
                  onChange={(e) => setAddWabaId(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('addAccessTokenField')}</Label>
                <Input
                  type="password"
                  value={addAccessToken}
                  onChange={(e) => setAddAccessToken(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t('addPinField')}</Label>
                <Input
                  value={addPin}
                  onChange={(e) => setAddPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={resetAddForm} disabled={saving}>
                  {t('cancel')}
                </Button>
                <Button type="button" size="sm" onClick={handleAddNumber} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('addSave')}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      open={removeTarget !== null}
      onOpenChange={(next) => !next && setRemoveTarget(null)}
      title={removeTarget?.label || removeTarget?.phone_number_id || ''}
      description={t('removeConfirm')}
      confirmLabel={t('removeAction')}
      cancelLabel={t('cancel')}
      onConfirm={handleRemove}
      variant="destructive"
      loading={removingId === removeTarget?.id}
    />
    </>
  );
}
