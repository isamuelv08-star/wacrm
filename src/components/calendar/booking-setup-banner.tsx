'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarCheck, Check, Copy, Link2, Loader2, MessageCircle, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button, buttonVariants } from '@/components/ui/button'

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6)
}

type Status = 'checking' | 'hidden' | 'idle' | 'creating' | 'success'

/**
 * Small animated promo banner at the top of the Calendar page, pitching
 * the self-service booking flow (migration 079) to accounts that
 * haven't set one up yet. "One click" creates a starter service +
 * booking page with sensible defaults — refinable afterwards in
 * Settings → Booking — so a business can see a working, shareable link
 * immediately instead of having to fill in three settings tabs first.
 *
 * Hidden once the account already has at least one booking page (it
 * did its job), and for anyone who can't act on it (non-admins can't
 * write `services`/`booking_pages` per RLS — see migration 079).
 */
export function BookingSetupBanner() {
  const t = useTranslations('Calendar.bookingPromo')
  const supabase = createClient()
  const { accountId, canEditSettings } = useAuth()

  const [status, setStatus] = useState<Status>('checking')
  const [link, setLink] = useState('')

  useEffect(() => {
    if (!accountId || !canEditSettings) return
    let cancelled = false
    ;(async () => {
      const { count } = await supabase
        .from('booking_pages')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
      if (cancelled) return
      setStatus(count && count > 0 ? 'hidden' : 'idle')
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, canEditSettings])

  async function createStarterCalendar() {
    if (!accountId) return
    setStatus('creating')
    try {
      // Reuse an existing active service if one's already there
      // (e.g. added ahead of the page); otherwise create a starter one.
      const { data: existingServices } = await supabase
        .from('services')
        .select('id')
        .eq('account_id', accountId)
        .eq('active', true)
      let serviceIds = (existingServices ?? []).map((s) => s.id as string)

      if (serviceIds.length === 0) {
        const { data: created, error } = await supabase
          .from('services')
          .insert({
            account_id: accountId,
            name: t('defaultServiceName'),
            duration_minutes: 30,
            active: true,
          })
          .select('id')
          .single()
        if (error || !created) throw error ?? new Error('service create failed')
        serviceIds = [created.id]
      }

      const { data: account } = await supabase
        .from('accounts')
        .select('name')
        .eq('id', accountId)
        .maybeSingle()
      const base = slugify(account?.name || 'reservas') || 'reservas'

      let pageId: string | null = null
      let slug = ''
      for (let attempt = 0; attempt < 5 && !pageId; attempt++) {
        slug = attempt === 0 ? base : `${base}-${randomSuffix()}`
        const { data: created, error } = await supabase
          .from('booking_pages')
          .insert({
            account_id: accountId,
            slug,
            name: t('defaultPageName'),
            is_active: true,
          })
          .select('id')
          .single()
        if (created) {
          pageId = created.id
        } else if (error?.code !== '23505') {
          throw error
        }
      }
      if (!pageId) throw new Error('could not allocate a unique slug')

      await supabase.from('booking_page_services').insert(
        serviceIds.map((serviceId) => ({ booking_page_id: pageId, service_id: serviceId })),
      )

      const baseUrl = (
        process.env.NEXT_PUBLIC_SITE_URL ||
        (typeof window !== 'undefined' ? window.location.origin : '')
      ).replace(/\/+$/, '')
      setLink(`${baseUrl}/agendar/${slug}`)
      setStatus('success')
      toast.success(t('createSuccess'))
    } catch (err) {
      console.error('[booking-setup-banner] one-click create failed:', err)
      toast.error(t('createFailed'))
      setStatus('idle')
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  if (status === 'checking' || status === 'hidden') return null

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 duration-500 animate-in fade-in slide-in-from-top-2 sm:p-5">
      <div
        className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl"
        style={{ animation: 'metric-glow-pulse 3.2s ease-in-out infinite' }}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3 w-3" />
            {t('eyebrow')}
          </div>
          <h3 className="text-base font-semibold text-foreground sm:text-lg">
            {t('headline')}
          </h3>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">{t('subtext')}</p>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 text-primary" /> {t('featureLink')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MessageCircle className="h-3.5 w-3.5 text-primary" /> {t('featureWhatsapp')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheck className="h-3.5 w-3.5 text-primary" /> {t('featureBot')}
            </span>
          </div>
        </div>

        <div className="shrink-0">
          {status === 'success' ? (
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                <Check className="h-4 w-4" /> {t('readyLabel')}
              </div>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => void copyLink()}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> {t('copyLink')}
                </Button>
                <Link
                  href="/settings?tab=booking"
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  {t('refine')}
                </Link>
              </div>
            </div>
          ) : (
            <Button onClick={() => void createStarterCalendar()} disabled={status === 'creating'}>
              {status === 'creating' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarCheck className="mr-2 h-4 w-4" />
              )}
              {t('cta')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
