// ============================================================
// GET  /api/book/[slug] — public booking-page info (business name,
//      description, bookable services). No auth — anyone with the
//      link can view it, same posture as /api/invitations/[token]/peek.
// POST /api/book/[slug] — public booking submit: files the
//      appointment, best-effort notifies staff + sends the WhatsApp
//      confirmation to the customer.
//
// Both run on the service-role client (src/lib/booking/admin-client.ts)
// — a booking-page visitor has no account membership, so RLS would
// block every read/write here. Validation that would otherwise be
// RLS's job (page must belong to an active page, slot must still be
// free) happens explicitly below instead.
// ============================================================

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/booking/admin-client'
import { computeAvailableSlots } from '@/lib/booking/availability'
import { sendAppointmentNotification } from '@/lib/booking/notify'
import { findOrCreateContact, resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

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
  const db = supabaseAdmin()

  const { data: page } = await db
    .from('booking_pages')
    .select(
      'id, account_id, name, description, is_active, timezone, buffer_minutes, min_notice_hours, booking_window_days, accounts(name, timezone)',
    )
    .eq('slug', slug)
    .maybeSingle()

  if (!page || !page.is_active) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }

  const [{ data: pageServices }, { data: pageStaff }] = await Promise.all([
    db
      .from('booking_page_services')
      .select('services(id, name, description, duration_minutes, price, color)')
      .eq('booking_page_id', page.id),
    db.from('booking_page_staff').select('profile_id').eq('booking_page_id', page.id),
  ])

  const account = page.accounts as unknown as { name: string; timezone: string } | null

  return NextResponse.json({
    ok: true,
    businessName: account?.name ?? '',
    name: page.name,
    description: page.description,
    timezone: page.timezone || account?.timezone || 'UTC',
    bookingWindowDays: page.booking_window_days,
    services: (pageServices ?? [])
      .map((r) => r.services)
      .filter((s): s is NonNullable<typeof s> => s != null),
    hasStaffRestriction: (pageStaff ?? []).length > 0,
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const ip = getClientIp(request)
  const limit = checkRateLimit(`book-submit:${ip}`, RATE_LIMITS.bookingSubmit)
  if (!limit.success) return rateLimitResponse(limit)

  const { slug } = await params
  const db = supabaseAdmin()

  let body: {
    serviceId?: string
    staffProfileId?: string
    startsAt?: string
    name?: string
    phone?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad_request' }, { status: 400 })
  }

  const { serviceId, staffProfileId, startsAt, name, phone } = body
  if (!serviceId || !staffProfileId || !startsAt || !name || !phone) {
    return NextResponse.json(
      { ok: false, reason: 'bad_request', message: 'serviceId, staffProfileId, startsAt, name and phone are required' },
      { status: 400 },
    )
  }

  const { data: page } = await db
    .from('booking_pages')
    .select('id, account_id, is_active, buffer_minutes, min_notice_hours, timezone, accounts(timezone)')
    .eq('slug', slug)
    .maybeSingle()
  if (!page || !page.is_active) {
    return NextResponse.json({ ok: false, reason: 'not_found' }, { status: 404 })
  }

  const { data: service } = await db
    .from('services')
    .select('id, name, duration_minutes, active')
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

  const account = page.accounts as unknown as { timezone: string } | null
  const timezone = page.timezone || account?.timezone || 'UTC'
  const date = new Date(startsAt).toISOString().slice(0, 10)

  // Re-derive the actual open slots for this exact day/service/staff and
  // confirm the requested start is still one of them — the authoritative
  // race-safe check (the client's own slot list could be stale by the
  // time it submits).
  const { data: staffLink } = await db
    .from('booking_page_staff')
    .select('profile_id')
    .eq('booking_page_id', page.id)
  const restrictTo = (staffLink ?? []).map((r) => r.profile_id as string)

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
  const chosen = slots.find(
    (s) => s.profileId === staffProfileId && s.startsAt === new Date(startsAt).toISOString(),
  )
  if (!chosen) {
    return NextResponse.json({ ok: false, reason: 'slot_unavailable' }, { status: 409 })
  }

  let auditUserId: string
  try {
    auditUserId = await resolveAuditUserId(db, page.account_id)
  } catch (err) {
    if (err instanceof ContactError) {
      return NextResponse.json({ ok: false, reason: 'server_error' }, { status: err.status })
    }
    throw err
  }

  let contact: { id: string }
  try {
    contact = await findOrCreateContact(db, page.account_id, auditUserId, {
      phone,
      name,
    })
  } catch (err) {
    if (err instanceof ContactError) {
      return NextResponse.json(
        { ok: false, reason: 'bad_request', message: err.message },
        { status: err.status },
      )
    }
    throw err
  }

  const { data: staffProfile } = await db
    .from('profiles')
    .select('id, full_name, user_id')
    .eq('id', staffProfileId)
    .maybeSingle()

  const { data: event, error: insertErr } = await db
    .from('calendar_events')
    .insert({
      account_id: page.account_id,
      // No `created_by` — nobody on the team filed this, the customer
      // booked it themselves through the public link.
      assigned_to: staffProfileId,
      contact_id: contact.id,
      type: 'appointment',
      title: service.name,
      notes: `Booked online via ${slug}`,
      starts_at: chosen.startsAt,
      ends_at: chosen.endsAt,
      service_id: serviceId,
      booking_page_id: page.id,
      source: 'public_link',
      reminder_minutes_before: 60 * 24, // 24h ahead, matches a typical appointment reminder
    })
    .select('id')
    .single()

  if (insertErr || !event) {
    console.error('[book] appointment insert failed:', insertErr)
    return NextResponse.json({ ok: false, reason: 'server_error' }, { status: 500 })
  }

  // Best-effort from here — the appointment is already filed.
  if (staffProfile?.user_id) {
    await db.from('notifications').insert({
      account_id: page.account_id,
      user_id: staffProfile.user_id,
      type: 'appointment_booked',
      contact_id: contact.id,
      title: service.name,
      body: `${name} booked ${service.name} via the online booking page`,
    })
  }

  const sent = await sendAppointmentNotification(db, {
    accountId: page.account_id,
    contactId: contact.id,
    contactName: name,
    contactPhone: phone,
    serviceName: service.name,
    staffName: staffProfile?.full_name ?? '',
    startsAt: chosen.startsAt,
    timezone,
    kind: 'confirmation',
  })
  if (sent) {
    await db
      .from('calendar_events')
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq('id', event.id)
  }

  return NextResponse.json({ ok: true, appointmentId: event.id })
}
