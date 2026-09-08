import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { dashboardSummaryCacheTag } from '@/lib/cache/account-cache'

/**
 * POST /api/dashboard/ceo-summary/revalidate (viewer+)
 *
 * Busts the calling account's cached `/api/dashboard/ceo-summary`
 * entries on demand, ahead of the normal 3-minute TTL. Reported bug:
 * dragging a deal to a new stage updated `deals` immediately, and the
 * dashboard's realtime subscription noticed and re-fetched right away
 * — but the fetch just landed on the same stale cache entry, so the
 * funnel/KPIs kept showing pre-move numbers for up to 3 minutes.
 *
 * The dashboard page calls this (fire-and-forget, best-effort) from
 * its own `postgres_changes` handlers — the same real-time signal that
 * already knows "something relevant just changed" — right before
 * re-fetching, so the very next fetch recomputes fresh instead of
 * serving the old entry. `accountId` comes from the caller's own
 * session, never from the request body, so a member can only ever
 * evict their own account's cache.
 */
export async function POST() {
  try {
    const { accountId } = await requireRole('viewer')
    // `{ expire: 0 }`, not the recommended `'max'` profile — `'max'`
    // gives stale-while-revalidate semantics (the very next fetch still
    // gets the OLD value while a fresh one loads in the background),
    // which is exactly the staleness this route exists to skip. The
    // client calls this immediately before re-fetching, so that very
    // next request needs a real cache miss.
    revalidateTag(dashboardSummaryCacheTag(accountId), { expire: 0 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
