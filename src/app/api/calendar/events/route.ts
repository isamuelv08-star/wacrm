// ============================================================
// POST /api/calendar/events — create a calendar event (agent+).
//
// The manual Calendar page (event-form-dialog.tsx) used to insert
// straight into `calendar_events` from the client via the RLS-scoped
// Supabase client. It now goes through this route instead so the
// create can also push the event to the account's connected Google
// Calendar server-side (see src/lib/calendar/google-sync.ts) — the
// browser never holds a Google access token, so that push can only
// happen here, not client-side.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { resolveProfileId } from '@/lib/ai/profile-id'
import { syncEventToGoogle } from '@/lib/calendar/google-sync'
import { googleCalendarAdmin } from '@/lib/google-calendar/admin-client'
import { sendAppointmentNotification } from '@/lib/booking/notify'
import type { CalendarEventType } from '@/types'

const EVENT_TYPES: readonly CalendarEventType[] = [
  'call',
  'meeting',
  'follow_up',
  'task',
  'appointment',
  'other',
]

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const type = body.type as CalendarEventType
    if (!EVENT_TYPES.includes(type)) {
      return bad(`type must be one of: ${EVENT_TYPES.join(', ')}`)
    }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return bad('title is required')

    const startsAt = typeof body.startsAt === 'string' ? body.startsAt : ''
    if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) {
      return bad('startsAt must be a valid ISO timestamp')
    }
    const endsAt =
      typeof body.endsAt === 'string' && !Number.isNaN(new Date(body.endsAt).getTime())
        ? body.endsAt
        : null

    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
    const contactId = typeof body.contactId === 'string' && body.contactId ? body.contactId : null
    const dealId = typeof body.dealId === 'string' && body.dealId ? body.dealId : null
    const assignedTo = typeof body.assignedTo === 'string' && body.assignedTo ? body.assignedTo : null
    const reminderMinutesBefore =
      typeof body.reminderMinutesBefore === 'number' ? body.reminderMinutesBefore : null
    const serviceId = typeof body.serviceId === 'string' && body.serviceId ? body.serviceId : null

    const createdBy = await resolveProfileId(ctx.supabase, ctx.userId)

    const { data, error } = await ctx.supabase
      .from('calendar_events')
      .insert({
        account_id: ctx.accountId,
        created_by: createdBy,
        assigned_to: assignedTo,
        contact_id: contactId,
        deal_id: dealId,
        type,
        title,
        notes,
        starts_at: startsAt,
        ends_at: endsAt,
        reminder_minutes_before: reminderMinutesBefore,
        service_id: serviceId,
      })
      .select('*, contact:contacts(id, name, phone), deal:deals(id, title)')
      .single()

    if (error) {
      console.error('[POST /api/calendar/events] insert error:', error)
      return NextResponse.json({ error: 'Failed to create event' }, { status: 500 })
    }

    // Best-effort, never blocks the response — see google-sync.ts.
    // Service role: refreshing the account's Google token is a
    // settings-class write (admin-only RLS), which shouldn't gate an
    // agent's ability to create an event. See admin-client.ts.
    await syncEventToGoogle(googleCalendarAdmin(), ctx.accountId, {
      id: data.id,
      title: data.title,
      notes: data.notes,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      google_event_id: data.google_event_id,
    })

    // A manually-booked appointment with a contact phone gets the same
    // WhatsApp confirmation a public-link booking would — best-effort,
    // see notify.ts. Only fires for type='appointment' (a call/meeting/
    // task isn't a customer-facing commitment in the same sense).
    if (type === 'appointment' && data.contact?.phone) {
      let staffName = ''
      if (assignedTo) {
        const { data: assignee } = await ctx.supabase
          .from('profiles')
          .select('full_name')
          .eq('id', assignedTo)
          .maybeSingle()
        staffName = assignee?.full_name ?? ''
      }
      const { data: account } = await ctx.supabase
        .from('accounts')
        .select('timezone')
        .eq('id', ctx.accountId)
        .maybeSingle()
      const sent = await sendAppointmentNotification(ctx.supabase, {
        accountId: ctx.accountId,
        contactId: data.contact.id,
        contactName: data.contact.name || data.contact.phone,
        contactPhone: data.contact.phone,
        serviceName: title,
        staffName,
        startsAt: data.starts_at,
        timezone: account?.timezone ?? 'UTC',
        kind: 'confirmation',
      })
      if (sent) {
        await ctx.supabase
          .from('calendar_events')
          .update({ confirmation_sent_at: new Date().toISOString() })
          .eq('id', data.id)
        data.confirmation_sent_at = new Date().toISOString()
      }
    }

    return NextResponse.json({ event: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
