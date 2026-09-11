'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, Plus, Pencil, Trash2, Link2, Copy, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import type { BookingPage, Service } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const EMPTY_FORM = {
  name: '',
  slug: '',
  slugTouched: false,
  description: '',
  serviceIds: new Set<string>(),
  isActive: true,
  bufferMinutes: '0',
  minNoticeHours: '2',
  bookingWindowDays: '30',
}

export function BookingPagesPanel() {
  const t = useTranslations('Settings.booking.pages')
  const supabase = createClient()
  const { accountId, canEditSettings } = useAuth()

  const [pages, setPages] = useState<BookingPage[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BookingPage | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)

  const baseUrl =
    (process.env.NEXT_PUBLIC_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '')).replace(
      /\/+$/,
      '',
    )

  async function load() {
    if (!accountId) return
    setLoading(true)
    const [pagesRes, servicesRes] = await Promise.all([
      supabase.from('booking_pages').select('*').order('created_at', { ascending: true }),
      supabase.from('services').select('*').eq('active', true).order('name'),
    ])
    setPages((pagesRes.data ?? []) as BookingPage[])
    setServices((servicesRes.data ?? []) as Service[])
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

  async function openEdit(page: BookingPage) {
    setEditing(page)
    const { data: links } = await supabase
      .from('booking_page_services')
      .select('service_id')
      .eq('booking_page_id', page.id)
    setForm({
      name: page.name,
      slug: page.slug,
      slugTouched: true,
      description: page.description ?? '',
      serviceIds: new Set((links ?? []).map((l) => l.service_id as string)),
      isActive: page.is_active,
      bufferMinutes: String(page.buffer_minutes),
      minNoticeHours: String(page.min_notice_hours),
      bookingWindowDays: String(page.booking_window_days),
    })
    setDialogOpen(true)
  }

  function toggleService(id: string) {
    setForm((f) => {
      const next = new Set(f.serviceIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...f, serviceIds: next }
    })
  }

  async function save() {
    if (!accountId) return
    const name = form.name.trim()
    const slug = slugify(form.slug || form.name)
    if (!name) {
      toast.error(t('nameRequired'))
      return
    }
    if (!slug) {
      toast.error(t('slugRequired'))
      return
    }
    if (form.serviceIds.size === 0) {
      toast.error(t('servicesRequired'))
      return
    }

    setSaving(true)
    const payload = {
      name,
      slug,
      description: form.description.trim() || null,
      is_active: form.isActive,
      buffer_minutes: Number(form.bufferMinutes) || 0,
      min_notice_hours: Number(form.minNoticeHours) || 0,
      booking_window_days: Number(form.bookingWindowDays) || 30,
    }

    let pageId = editing?.id ?? null
    if (editing) {
      const { error } = await supabase.from('booking_pages').update(payload).eq('id', editing.id)
      if (error) {
        setSaving(false)
        toast.error(error.code === '23505' ? t('slugTaken') : t('saveFailed'))
        return
      }
    } else {
      const { data, error } = await supabase
        .from('booking_pages')
        .insert({ ...payload, account_id: accountId })
        .select('id')
        .single()
      if (error || !data) {
        setSaving(false)
        toast.error(error?.code === '23505' ? t('slugTaken') : t('saveFailed'))
        return
      }
      pageId = data.id
    }

    if (pageId) {
      await supabase.from('booking_page_services').delete().eq('booking_page_id', pageId)
      if (form.serviceIds.size > 0) {
        await supabase.from('booking_page_services').insert(
          Array.from(form.serviceIds).map((serviceId) => ({
            booking_page_id: pageId,
            service_id: serviceId,
          })),
        )
      }
    }

    setSaving(false)
    toast.success(t('saveSuccess'))
    setDialogOpen(false)
    await load()
  }

  async function remove(page: BookingPage) {
    setDeletingId(page.id)
    const { error } = await supabase.from('booking_pages').delete().eq('id', page.id)
    setDeletingId(null)
    if (error) {
      toast.error(t('deleteFailed'))
      return
    }
    toast.success(t('deleteSuccess'))
    setPages((prev) => prev.filter((p) => p.id !== page.id))
  }

  async function copyLink(slug: string) {
    const url = `${baseUrl}/agendar/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedSlug(slug)
      setTimeout(() => setCopiedSlug((s) => (s === slug ? null : s)), 2000)
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-primary" /> {t('title')}
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
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  {t('needServiceFirst')}
                </p>
              )}
              {pages.length === 0 && services.length > 0 && (
                <p className="text-sm text-muted-foreground">{t('noItems')}</p>
              )}
              {pages.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {pages.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm text-foreground">
                          {p.name}
                          {!p.is_active && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {t('inactive')}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {baseUrl}/agendar/{p.slug}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => void copyLink(p.slug)}
                          title={t('copyLink')}
                        >
                          {copiedSlug === p.slug ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        {canEditSettings && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => void openEdit(p)}
                              title={t('edit')}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              onClick={() => void remove(p)}
                              disabled={deletingId === p.id}
                              title={t('delete')}
                            >
                              {deletingId === p.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {canEditSettings && services.length > 0 && (
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
              <Label htmlFor="page-name">{t('nameLabel')}</Label>
              <Input
                id="page-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    name: e.target.value,
                    slug: f.slugTouched ? f.slug : slugify(e.target.value),
                  }))
                }
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="page-slug">{t('slugLabel')}</Label>
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <span className="truncate">{baseUrl}/agendar/</span>
                <Input
                  id="page-slug"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slug: slugify(e.target.value), slugTouched: true }))
                  }
                  disabled={saving}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="page-description">{t('descriptionLabel')}</Label>
              <Textarea
                id="page-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="min-h-[60px] resize-y"
                disabled={saving}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('servicesLabel')}</Label>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
                {services.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox
                      checked={form.serviceIds.has(s.id)}
                      onCheckedChange={() => toggleService(s.id)}
                      disabled={saving}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="page-buffer">{t('bufferLabel')}</Label>
                <Input
                  id="page-buffer"
                  type="number"
                  min={0}
                  value={form.bufferMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, bufferMinutes: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="page-notice">{t('noticeLabel')}</Label>
                <Input
                  id="page-notice"
                  type="number"
                  min={0}
                  value={form.minNoticeHours}
                  onChange={(e) => setForm((f) => ({ ...f, minNoticeHours: e.target.value }))}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="page-window">{t('windowLabel')}</Label>
                <Input
                  id="page-window"
                  type="number"
                  min={1}
                  value={form.bookingWindowDays}
                  onChange={(e) => setForm((f) => ({ ...f, bookingWindowDays: e.target.value }))}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('activeLabel')}</p>
                <p className="text-xs text-muted-foreground">{t('activeDesc')}</p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
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
