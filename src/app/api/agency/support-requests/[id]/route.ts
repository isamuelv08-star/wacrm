import { NextResponse } from 'next/server'

import { requireSuperAdmin } from '@/lib/auth/agency'
import { setAgencySupportRequestStatus } from '@/lib/agency/support-requests'
import type { SupportRequestStatus } from '@/lib/agency/support-requests'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: SupportRequestStatus[] = ['open', 'resolved']

/**
 * PATCH /api/agency/support-requests/[id] — mark a client's support
 * request resolved, or reopen it. Only reachable through the
 * service-role client (support_requests has no UPDATE policy for
 * regular members, migration 098), hence gated the same way as every
 * other /api/agency/* route.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid request id' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as { status?: unknown } | null
  const status = body?.status
  if (typeof status !== 'string' || !STATUSES.includes(status as SupportRequestStatus)) {
    return NextResponse.json(
      { error: `'status' must be one of: ${STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    await setAgencySupportRequestStatus(id, status as SupportRequestStatus)
  } catch (err) {
    console.error('[PATCH /api/agency/support-requests/[id]] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update support request' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
