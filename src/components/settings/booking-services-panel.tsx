'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, Plus, Pencil, Trash2, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import type { Service } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const EMPTY_FORM = { name: '', description: '', durationMinutes: '30', price: '', active: true }

export function BookingServicesPanel() {
  const t = useTranslations('Settings.booking.services')
  const supabase = createClient()
  const { accountId, canEditSettings } = useAuth()

  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Service | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    if (!accountId) return
    setLoading(true)
    const { data } = await supabase
      .from('services')
      .select('*')
      .order('created_at', { ascending: true })
    setServices((data ?? []) as Service[])
    setLoading(false)
  }

  // Fetch-on-mount/account-change — legitimate synchronous setLoading
  // inside `load`.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])
  /* eslint-enable react-hooks/set-state-in-effect */

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  function openEdit(service: Service) {
    setEditing(service)
    setForm({
      name: service.name,
      description: service.description ?? '',
      durationMinutes: String(service.duration_minutes),
      price: service.price != null ? String(service.price) : '',
      active: service.active,
    })
    setDialogOpen(true)
  }

  async function save() {
    if (!accountId) return
    const name = form.name.trim()
    const duration = Number(form.durationMinutes)
    if (!name) {
      toast.error(t('nameRequired'))
      return
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      toast.error(t('durationInvalid'))
      return
    }
    const price = form.price.trim() ? Number(form.price) : null
    if (form.price.trim() && (!Number.isFinite(price) || (price as number) < 0)) {
      toast.error(t('priceInvalid'))
      return
    }

    setSaving(true)
    const payload = {
      name,
      description: form.description.trim() || null,
      duration_minutes: duration,
      price,
      active: form.active,
    }
    const { error } = editing
      ? await supabase.from('services').update(payload).eq('id', editing.id)
      : await supabase.from('services').insert({ ...payload, account_id: accountId })
    setSaving(false)
    if (error) {
      toast.error(t('saveFailed'))
      return
    }
    toast.success(t('saveSuccess'))
    setDialogOpen(false)
    await load()
  }

  async function remove(service: Service) {
    setDeletingId(service.id)
    const { error } = await supabase.from('services').delete().eq('id', service.id)
    setDeletingId(null)
    if (error) {
      toast.error(t('deleteFailed'))
      return
    }
    toast.success(t('deleteSuccess'))
    setServices((prev) => prev.filter((s) => s.id !== service.id))
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center py-4 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
            </div>
          ) : (
            <>
              {services.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('noItems')}</p>
              )}
              {services.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {services.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm text-foreground">
                          {s.name}
                          {!s.active && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {t('inactive')}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {t('durationMinutesShort', { minutes: s.duration_minutes })}
                          {s.price != null ? ` · ${s.price}` : ''}
                        </p>
                      </div>
                      {canEditSettings && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => openEdit(s)}
                            title={t('edit')}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => void remove(s)}
                            disabled={deletingId === s.id}
                            title={t('delete')}
                          >
                            {deletingId === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEditSettings && (
                <Button variant="outline" size="sm" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" /> {t('addItem')}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="flex max-h-[85vh] w-[95vw] sm:max-w-lg flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editing ? t('editItem') : t('addItem')}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="service-name">{t('nameLabel')}</Label>
              <Input
                id="service-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                disabled={saving}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="service-duration">{t('durationLabel')}</Label>
                <Input
                  id="service-duration"
                  type="number"
                  min={1}
                  value={form.durationMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="service-price">{t('priceLabel')}</Label>
                <Input
                  id="service-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  disabled={saving}
                  placeholder={t('pricePlaceholder')}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-description">{t('descriptionLabel')}</Label>
              <Textarea
                id="service-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="min-h-[80px] resize-y"
                disabled={saving}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('activeLabel')}</p>
                <p className="text-xs text-muted-foreground">{t('activeDesc')}</p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, active: checked }))}
                disabled={saving}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
