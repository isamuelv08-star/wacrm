// ============================================================
// POST /api/calendar/events/[id]/cancel — mark an event cancelled
// AND remove it from the connected Google Calendar (agent+).
//
// complete/reopen stay client-side (src/lib/calendar/queries.ts) —
// there's no meaningful Google-side equivalent for "done" vs.
// "pending" on an internal task. Cancel is different: it means the
// appointment/commitment is void, so a synced Google event should
// disappear too rather than keep showing a booking that isn't
// actually happening.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { deleteEventFromGoogle } from '@/lib/calendar/google-sync'
import { googleCalendarAdmin } from '@/lib/google-calendar/admin-client'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await requireRole('agent')

    const { data, error } = await ctx.supabase
      .from('calendar_events')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('google_event_id')
      .single()

    if (error) {
      console.error('[POST /api/calendar/events/[id]/cancel] update error:', error)
      return NextResponse.json({ error: 'Failed to cancel event' }, { status: 500 })
    }

    await deleteEventFromGoogle(googleCalendarAdmin(), ctx.accountId, data.google_event_id)

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
