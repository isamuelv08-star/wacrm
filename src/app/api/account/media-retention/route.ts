import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * /api/account/media-retention (migration 119)
 *   GET   — { days: number | null, available }   any member
 *   PATCH — { days: number | null }              admin+
 * null = keep chat files forever.
 */

const MIN_DAYS = 7
const MAX_DAYS = 3650

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('accounts')
      .select('media_retention_days')
      .eq('id', accountId)
      .maybeSingle()
    if (error) return NextResponse.json({ days: null, available: false })
    return NextResponse.json({ days: (data?.media_retention_days as number | null) ?? null, available: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as { days?: unknown } | null
    const days = body?.days
    if (days !== null && (typeof days !== 'number' || !Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS)) {
      return NextResponse.json(
        { error: `'days' must be null or an integer between ${MIN_DAYS} and ${MAX_DAYS}` },
        { status: 400 },
      )
    }
    const { error } = await supabase.from('accounts').update({ media_retention_days: days }).eq('id', accountId)
    if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    return NextResponse.json({ days })
  } catch (err) {
    return toErrorResponse(err)
  }
}
