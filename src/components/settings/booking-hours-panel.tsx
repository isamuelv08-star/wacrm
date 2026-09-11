'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import type { Profile, StaffAvailability } from '@/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

// 0=Sunday..6=Saturday (JS Date#getDay() convention — matches the DB
// column and the availability engine, src/lib/booking/availability.ts).
// Displayed Monday-first since that's the week almost every business
// using this actually runs on; the stored `weekday` value is untouched.
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

interface DayRow {
  weekday: number
  enabled: boolean
  start: string
  end: string
}

function defaultDays(): DayRow[] {
  return DISPLAY_ORDER.map((weekday) => ({
    weekday,
    enabled: weekday >= 1 && weekday <= 5,
    start: '09:00',
    end: '18:00',
  }))
}

export function BookingHoursPanel() {
  const t = useTranslations('Settings.booking.hours')
  const supabase = createClient()
  const { accountId, canEditSettings } = useAuth()

  const [staff, setStaff] = useState<Profile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [days, setDays] = useState<DayRow[]>(defaultDays())
  const [loading, setLoading] = useState(true)
  const [loadingDays, setLoadingDays] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.from('profiles').select('*').order('full_name')
      if (cancelled) return
      const rows = (data ?? []) as Profile[]
      setStaff(rows)
      if (rows.length > 0) setSelectedProfileId(rows[0].id)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  useEffect(() => {
    if (!selectedProfileId) return
    let cancelled = false
    ;(async () => {
      setLoadingDays(true)
      const { data } = await supabase
        .from('staff_availability')
        .select('*')
        .eq('profile_id', selectedProfileId)
      if (cancelled) return
      const rows = (data ?? []) as StaffAvailability[]
      const byWeekday = new Map(rows.map((r) => [r.weekday, r]))
      setDays(
        DISPLAY_ORDER.map((weekday) => {
          const existing = byWeekday.get(weekday)
          return existing
            ? {
                weekday,
                enabled: true,
                start: existing.start_time.slice(0, 5),
                end: existing.end_time.slice(0, 5),
              }
            : { weekday, enabled: false, start: '09:00', end: '18:00' }
        }),
      )
      setLoadingDays(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId])

  function updateDay(weekday: number, patch: Partial<DayRow>) {
    setDays((prev) => prev.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)))
  }

  async function save() {
    if (!accountId || !selectedProfileId) return
    for (const d of days) {
      if (d.enabled && d.start >= d.end) {
        toast.error(t('invalidRange', { day: t(`day.${d.weekday}`) }))
        return
      }
    }
    setSaving(true)
    const { error: deleteErr } = await supabase
      .from('staff_availability')
      .delete()
      .eq('profile_id', selectedProfileId)
    if (deleteErr) {
      setSaving(false)
      toast.error(t('saveFailed'))
      return
    }
    const enabledDays = days.filter((d) => d.enabled)
    if (enabledDays.length > 0) {
      const { error: insertErr } = await supabase.from('staff_availability').insert(
        enabledDays.map((d) => ({
          account_id: accountId,
          profile_id: selectedProfileId,
          weekday: d.weekday,
          start_time: d.start,
          end_time: d.end,
        })),
      )
      if (insertErr) {
        setSaving(false)
        toast.error(t('saveFailed'))
        return
      }
    }
    setSaving(false)
    toast.success(t('saveSuccess'))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noStaff')}</p>
        ) : (
          <>
            <div className="grid gap-2 sm:max-w-xs">
              <label className="text-sm text-muted-foreground">{t('staffLabel')}</label>
              <select
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                disabled={!canEditSettings || saving}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
              >
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>

            {loadingDays ? (
              <div className="flex items-center py-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
              </div>
            ) : (
              <div className="space-y-2">
                {days.map((d) => (
                  <div
                    key={d.weekday}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2.5"
                  >
                    <label className="flex w-28 shrink-0 items-center gap-2 text-sm text-foreground">
                      <Checkbox
                        checked={d.enabled}
                        onCheckedChange={(checked) =>
                          updateDay(d.weekday, { enabled: checked === true })
                        }
                        disabled={!canEditSettings || saving}
                      />
                      {t(`day.${d.weekday}`)}
                    </label>
                    <input
                      type="time"
                      value={d.start}
                      onChange={(e) => updateDay(d.weekday, { start: e.target.value })}
                      disabled={!d.enabled || !canEditSettings || saving}
                      className="h-8 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
                    />
                    <span className="text-xs text-muted-foreground">{t('to')}</span>
                    <input
                      type="time"
                      value={d.end}
                      onChange={(e) => updateDay(d.weekday, { end: e.target.value })}
                      disabled={!d.enabled || !canEditSettings || saving}
                      className="h-8 rounded-md border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
                    />
                  </div>
                ))}
              </div>
            )}

            {canEditSettings && (
              <Button onClick={() => void save()} disabled={saving || loadingDays}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('save')}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
