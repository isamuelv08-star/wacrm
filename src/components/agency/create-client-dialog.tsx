'use client';

// ============================================================
// CreateClientDialog — /agency's "Crear cliente" flow.
//
// Two-step modal, mirrors src/components/settings/invite-member-dialog.tsx
// exactly (same copy-to-clipboard + WhatsApp-share result step):
//   1. Form  — business name, owner email, default currency → POST
//              creates the account + a one-time owner-role invite.
//   2. Result — the invite link, shown ONCE. The agency owner copies
//              it and sends it to the client themselves; there's no
//              email step, same as inviting a team member today.
//
// On close after a successful create, router.refresh() re-runs the
// server component so the new (zero-metric) account appears in the
// grid immediately.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Building2, Copy, Loader2, MessageCircle, Plus, Sparkles } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currency';

const MAX_NAME_LEN = 120;

interface CreatedAccount {
  url: string;
  accountName: string;
  expiresInDays: number;
}

export function CreateClientDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreatedAccount | null>(null);
  // Snapshot so a later dialog reopen can't retroactively change
  // what the just-closed result screen refers to.
  const [createdAnAccount, setCreatedAnAccount] = useState(false);

  function reset() {
    setName('');
    setOwnerEmail('');
    setCurrency(DEFAULT_CURRENCY);
    setResult(null);
    setSubmitting(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
      if (createdAnAccount) {
        setCreatedAnAccount(false);
        router.refresh();
      }
    }
    setOpen(next);
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    const trimmedEmail = ownerEmail.trim();
    if (!trimmedName) {
      toast.error('El nombre del negocio es obligatorio');
      return;
    }
    if (!trimmedEmail) {
      toast.error('El email del dueño es obligatorio');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/agency/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          ownerEmail: trimmedEmail,
          defaultCurrency: currency,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'No se pudo crear la cuenta');
        return;
      }

      const data = (await res.json()) as { url: string; expiresInDays: number };

      setResult({
        url: data.url,
        accountName: trimmedName,
        expiresInDays: data.expiresInDays,
      });
      setCreatedAnAccount(true);
    } catch (err) {
      console.error('[CreateClientDialog] create error:', err);
      toast.error('No se pudo conectar con el servidor. ¿Intentar de nuevo?');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyToClipboard() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      toast.success('Link copiado');
    } catch {
      toast.error('No se pudo copiar automáticamente — copiá el link manualmente');
    }
  }

  function whatsappShareUrl(url: string): string {
    const accountName = result?.accountName ?? 'tu cuenta';
    const message = `¡Bienvenido a ScalingCRM! Activá tu cuenta de ${accountName} acá (el link vence en ${result?.expiresInDays ?? 7} días): ${url}`;
    return `https://wa.me/?text=${encodeURIComponent(message)}`;
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="size-4" />
        Crear cliente
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <Sparkles className="size-4 text-primary" />
                Cuenta creada
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                <strong>{result.accountName}</strong> ya está dada de alta. Compartile
                este link al dueño para que active su cuenta — vence en{' '}
                {result.expiresInDays} días.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <Label className="text-muted-foreground">Link de activación</Label>
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
                  Copiar
                </Button>
              </div>

              <div className="rounded-md border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
                <strong className="font-semibold text-amber-100">Guardá este link ahora.</strong>{' '}
                No se puede volver a mostrar — si lo perdés, tenés que crear la cuenta de nuevo.
              </div>

              <a
                href={whatsappShareUrl(result.url)}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonVariants({
                  variant: 'outline',
                  className: 'w-full border-border text-muted-foreground hover:bg-muted',
                })}
              >
                <MessageCircle className="size-4" />
                Enviar por WhatsApp
              </a>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                onClick={() => handleOpenChange(false)}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Listo
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-popover-foreground">
                <Building2 className="size-4 text-primary" />
                Crear cliente nuevo
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Da de alta la cuenta y generá el link para que el dueño active su acceso.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Nombre del negocio</Label>
                <Input
                  placeholder="Ej. Panadería La Espiga"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={MAX_NAME_LEN}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Email del dueño</Label>
                <Input
                  type="email"
                  placeholder="dueño@negocio.com"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Solo de referencia — no restringe quién puede abrir el link.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Moneda por defecto</Label>
                <Select value={currency} onValueChange={(v) => v && setCurrency(v)}>
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} — {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="bg-popover border-border">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={submitting}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Creando…
                  </>
                ) : (
                  'Crear cliente'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
      </Dialog>
    </>
  );
}
