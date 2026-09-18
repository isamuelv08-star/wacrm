import { NextResponse } from 'next/server'

import { requireSuperAdmin } from '@/lib/auth/agency'
import { loadAgencySupportRequests } from '@/lib/agency/support-requests'

/**
 * GET /api/agency/support-requests — every client account's support
 * requests, newest-open-first. Used by AgencySidebar for the "Soporte"
 * nav badge (the /agency/support page itself loads this server-side
 * directly, not through this route — this exists for the client-side
 * badge fetch only).
 */
export async function GET() {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const requests = await loadAgencySupportRequests()
  return NextResponse.json({ requests })
}
