'use client'

// ============================================================
// /agendar/[slug] — public self-service booking wizard (migration
// 079). No auth, no Supabase client here — everything goes through
// the public /api/book/[slug] endpoints, which run server-side with
// the service-role client after their own validation. See that
// route's header comment for the security rationale.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft, Calendar, Check, Clock, Loader2, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

interface PageService {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  price: number | null
  color: string | null
}

interface PageInfo {
  businessName: string
  name: string
  description: string | null
  timezone: string
  bookingWindowDays: number
  services: PageService[]
}

interface Slot {
  startsAt: string
  endsAt: string
  profileId: string
  staffName: string
}

type Step = 'loading' | 'not_found' | 'pick_service' | 'pick_slot' | 'contact' | 'success'

const MAX_DAYS_SHOWN = 30

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export default function BookingPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const t = useTranslations('PublicBooking')

  const [step, setStep] = useState<Step>('loading')
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [service, setService] = useState<PageService | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()))
  const [slots, setSlots] = useState<Slot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/book/${slug}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setStep('not_found')
          return
        }
        setPageInfo(data)
        if (data.services.length === 1) {
          setService(data.services[0])
          setStep('pick_slot')
        } else {
          setStep('pick_service')
        }
      } catch {
        if (!cancelled) setStep('not_found')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  const loadSlots = useCallback(
    async (svc: PageService, date: string) => {
      setSlotsLoading(true)
      setSlots([])
      try {
        const res = await fetch(
          `/api/book/${slug}/slots?serviceId=${svc.id}&date=${date}`,
        )
        const data = await res.json()
        if (res.ok && data.ok) setSlots(data.slots ?? [])
      } catch {
        // best-effort — empty slots reads as "nothing open that day"
      } finally {
        setSlotsLoading(false)
      }
    },
    [slug],
  )

  // Fetch slots whenever the step/service/date changes — legitimate
  // synchronous setSlotsLoading inside `loadSlots`.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (step === 'pick_slot' && service) {
      void loadSlots(service, selectedDate)
    }
  }, [step, service, selectedDate, loadSlots])
  /* eslint-enable react-hooks/set-state-in-effect */

  const days = useMemo(() => {
    if (!pageInfo) return []
    const count = Math.min(pageInfo.bookingWindowDays, MAX_DAYS_SHOWN)
    const today = new Date()
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [pageInfo])

  function pickService(svc: PageService) {
    setService(svc)
    setSelectedDate(toDateKey(new Date()))
    setStep('pick_slot')
  }

  function pickSlot(slot: Slot) {
    setSelectedSlot(slot)
    setStep('contact')
  }

  async function submit() {
    if (!service || !selectedSlot) return
    if (!name.trim() || !phone.trim()) {
      toast.error(t('contactRequired'))
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/book/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: service.id,
          staffProfileId: selectedSlot.profileId,
          startsAt: selectedSlot.startsAt,
          name: name.trim(),
          phone: phone.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        if (data.reason === 'slot_unavailable') {
          toast.error(t('slotTaken'))
          setStep('pick_slot')
          void loadSlots(service, selectedDate)
        } else {
          toast.error(t('submitFailed'))
        }
        return
      }
      setStep('success')
    } catch {
      toast.error(t('submitFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const timeFormatter = useMemo(() => {
    if (!pageInfo) return null
    return new Intl.DateTimeFormat(undefined, {
      timeZone: pageInfo.timezone,
      hour: 'numeric',
      minute: '2-digit',
    })
  }, [pageInfo])

  const dateFormatter = useMemo(() => {
    if (!pageInfo) return null
    return new Intl.DateTimeFormat(undefined, {
      timeZone: pageInfo.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  }, [pageInfo])

  if (step === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (step === 'not_found') {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">{t('notFound')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">{pageInfo?.businessName}</p>
        <h1 className="text-xl font-semibold text-foreground">{pageInfo?.name}</h1>
        {pageInfo?.description && (
          <p className="mt-1 text-sm text-muted-foreground">{pageInfo.description}</p>
        )}
      </div>

      {step === 'pick_service' && pageInfo && (
        <div className="space-y-2">
          {pageInfo.services.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickService(s)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('durationMinutes', { minutes: s.duration_minutes })}
                  {s.price != null ? ` · ${s.price}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 'pick_slot' && service && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() =>
              pageInfo && pageInfo.services.length > 1
                ? setStep('pick_service')
                : undefined
            }
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            {pageInfo && pageInfo.services.length > 1 && (
              <>
                <ArrowLeft className="h-3.5 w-3.5" /> {service.name}
              </>
            )}
          </button>

          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {days.map((d) => {
              const key = toDateKey(d)
              const isSelected = key === selectedDate
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(key)}
                  className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-2 text-center transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-border text-foreground hover:bg-muted'
                  }`}
                >
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)}
                  </span>
                  <span className="text-sm font-medium">{d.getDate()}</span>
                </button>
              )
            })}
          </div>

          <div>
            {slotsLoading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadingSlots')}
              </div>
            ) : slots.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {t('noSlots')}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((s) => (
                  <button
                    key={`${s.startsAt}-${s.profileId}`}
                    type="button"
                    onClick={() => pickSlot(s)}
                    className="rounded-lg border border-border px-2 py-2 text-center text-sm text-foreground transition-colors hover:border-primary hover:bg-primary-soft"
                  >
                    {timeFormatter?.format(new Date(s.startsAt))}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {step === 'contact' && service && selectedSlot && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setStep('pick_slot')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t('back')}
          </button>

          <Card>
            <CardContent className="space-y-1.5 py-3">
              <p className="flex items-center gap-2 text-sm text-foreground">
                <Calendar className="h-4 w-4 text-primary" />
                {dateFormatter?.format(new Date(selectedSlot.startsAt))}
              </p>
              <p className="flex items-center gap-2 text-sm text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                {timeFormatter?.format(new Date(selectedSlot.startsAt))}
              </p>
              {selectedSlot.staffName && (
                <p className="flex items-center gap-2 text-sm text-foreground">
                  <MapPin className="h-4 w-4 text-primary" />
                  {selectedSlot.staffName}
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label htmlFor="booking-name">{t('nameLabel')}</Label>
            <Input
              id="booking-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="booking-phone">{t('phoneLabel')}</Label>
            <Input
              id="booking-phone"
              type="tel"
              placeholder="+52 55 1234 5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">{t('phoneHint')}</p>
          </div>

          <Button className="w-full" onClick={() => void submit()} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('confirmBooking')}
          </Button>
        </div>
      )}

      {step === 'success' && selectedSlot && (
        <Card>
          <CardHeader className="items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>{t('successTitle')}</CardTitle>
            <CardDescription>
              {service?.name} — {dateFormatter?.format(new Date(selectedSlot.startsAt))}{' '}
              {timeFormatter?.format(new Date(selectedSlot.startsAt))}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            {t('successBody')}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
