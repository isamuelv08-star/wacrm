// ============================================================
// /api/calendar/events/[id]
//
//   PATCH  — full edit (agent+). Pushes the update to the linked
//            Google event too, same as the create route.
//   DELETE — delete (agent+). Also removes the linked Google event,
//            if any, so a deleted CRM event doesn't leave a phantom
//            booking visible on the connected Google Calendar.
//
// See src/app/api/calendar/events/route.ts's header for why this
// can't just be a client-side Supabase call like the rest of the
// Calendar page's actions (complete/reopen have no Google-side
// equivalent and stay client-side; cancel is handled by
// [id]/cancel/route.ts).
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { syncEventToGoogle, deleteEventFromGoogle } from '@/lib/calendar/google-sync'
import { googleCalendarAdmin } from '@/lib/google-calendar/admin-client'
import type { CalendarEventType } from '@/types'

const EVENT_TYPES: readonly CalendarEventType[] = ['call', 'meeting', 'follow_up', 'task', 'other']

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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

    const { data, error } = await ctx.supabase
      .from('calendar_events')
      .update({
        assigned_to: assignedTo,
        contact_id: contactId,
        deal_id: dealId,
        type,
        title,
        notes,
        starts_at: startsAt,
        ends_at: endsAt,
        reminder_minutes_before: reminderMinutesBefore,
        // Editing a still-pending reminder's timing should re-arm it —
        // mirrors src/lib/calendar/queries.ts's own updateEvent.
        reminder_sent_at: null,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*, contact:contacts(id, name, phone), deal:deals(id, title)')
      .single()

    if (error) {
      console.error('[PATCH /api/calendar/events/[id]] update error:', error)
      return NextResponse.json({ error: 'Failed to update event' }, { status: 500 })
    }

    await syncEventToGoogle(googleCalendarAdmin(), ctx.accountId, {
      id: data.id,
      title: data.title,
      notes: data.notes,
      starts_at: data.starts_at,
      ends_at: data.ends_at,
      google_event_id: data.google_event_id,
    })

    return NextResponse.json({ event: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await requireRole('agent')

    const { data: existing } = await ctx.supabase
      .from('calendar_events')
      .select('google_event_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    const { error } = await ctx.supabase
      .from('calendar_events')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)

    if (error) {
      console.error('[DELETE /api/calendar/events/[id]] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 })
    }

    await deleteEventFromGoogle(googleCalendarAdmin(), ctx.accountId, existing?.google_event_id ?? null)

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
