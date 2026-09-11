// ============================================================
// GET /api/book/[slug]/slots?serviceId=<uuid>&date=YYYY-MM-DD
//
// Public — returns the open start times for one calendar day of one
// service on this booking page. See route.ts's header for the
// service-role rationale.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/booking/admin-client'
import { computeAvailableSlots } from '@/lib/booking/availability'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const ip = getClientIp(request)
  const limit = checkRateLimit(`book-view:${ip}`, RATE_LIMITS.bookingPageView)
  if (!limit.success) return rateLimitResponse(limit)

  const { slug } = await params
  const url = new URL(request.url)
  const serviceId = url.searchParams.get('serviceId')
  const date = url.searchParams.get('date')
  if (!serviceId || !date || !DATE_RE.test(date)) {
    return NextResponse.json(
      { ok: false, reason: 'bad_request', message: 'serviceId and date=YYYY-MM-DD are required' },
      { status: 400 },
    )
  }

  const db = supabaseAdmin()

  const { data: page } = await db
    .from('booking_pages')
    .select('id, account_id, is_active, buffer_minutes, min_notice_hours, booking_window_days, timezone, accounts(timezone)')
    .eq('slug', slug)
    .maybeSingle()
  if (!page || !page.is_active) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }

  const requestedDate = new Date(`${date}T00:00:00Z`)
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
  const daysOut = Math.round((requestedDate.getTime() - today.getTime()) / 86_400_000)
  if (daysOut < 0 || daysOut > page.booking_window_days) {
    return NextResponse.json({ ok: true, slots: [] })
  }

  const { data: service } = await db
    .from('services')
    .select('id, duration_minutes, active')
    .eq('id', serviceId)
    .eq('account_id', page.account_id)
    .maybeSingle()
  if (!service || !service.active) {
    return NextResponse.json({ ok: false, reason: 'invalid_service' }, { status: 400 })
  }

  const { data: pageServiceLink } = await db
    .from('booking_page_services')
    .select('service_id')
    .eq('booking_page_id', page.id)
    .eq('service_id', serviceId)
    .maybeSingle()
  if (!pageServiceLink) {
    return NextResponse.json({ ok: false, reason: 'invalid_service' }, { status: 400 })
  }

  const { data: staffLink } = await db
    .from('booking_page_staff')
    .select('profile_id')
    .eq('booking_page_id', page.id)
  const restrictTo = (staffLink ?? []).map((r) => r.profile_id as string)

  const account = page.accounts as unknown as { timezone: string } | null
  const timezone = page.timezone || account?.timezone || 'UTC'

  const slots = await computeAvailableSlots({
    db,
    accountId: page.account_id,
    serviceId,
    durationMinutes: service.duration_minutes,
    staffProfileIds: restrictTo.length > 0 ? restrictTo : null,
    timezone,
    bufferMinutes: page.buffer_minutes,
    minNoticeHours: page.min_notice_hours,
    date,
  })

  // Attach a display name to each slot — the public page shows "10:00
  // AM with Ana" when a page has more than one eligible staff member,
  // and the POST submit needs profileId regardless.
  const staffIds = Array.from(new Set(slots.map((s) => s.profileId)))
  const { data: staffRows } =
    staffIds.length > 0
      ? await db.from('profiles').select('id, full_name').in('id', staffIds)
      : { data: [] as { id: string; full_name: string }[] }
  const nameById = new Map((staffRows ?? []).map((r) => [r.id, r.full_name]))

  return NextResponse.json({
    ok: true,
    slots: slots.map((s) => ({ ...s, staffName: nameById.get(s.profileId) ?? '' })),
  })
}
