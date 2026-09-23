import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadDecisionCenterPayload, parseDecisionCenterRange } from '@/lib/decision-center/payload'

/**
 * GET /api/manager/decision-center?preset=last7Days[&start=...&end=...]
 *                                  (admin+)
 *
 * Backing data for Centro de Decisiones — a SEPARATE endpoint from
 * /api/dashboard/ceo-summary (not a mode of it): that route's cache
 * entries and permission-per-widget filtering exist for the plain
 * /dashboard page's own contract, and this page has a materially
 * different one (admin+ only, one period selector driving every
 * section, no per-widget dashboard_permissions to check — the whole
 * page is the permission boundary, enforced again here as defense in
 * depth alongside the page's own server-side gate).
 *
 * The actual data assembly lives in
 * src/lib/decision-center/payload.ts::loadDecisionCenterPayload —
 * shared with POST /ask (Section 8, "Pregunta a Saleslid") so the Q&A
 * assistant always answers from the exact same numbers this page
 * shows, via the same cache entries.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const { searchParams } = new URL(request.url)
    const range = parseDecisionCenterRange(searchParams)
    const payload = await loadDecisionCenterPayload(supabase, accountId, userId, range)
    return NextResponse.json(payload)
  } catch (err) {
    return toErrorResponse(err)
  }
}
