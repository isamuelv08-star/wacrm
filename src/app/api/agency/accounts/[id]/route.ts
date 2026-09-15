import { NextResponse } from 'next/server'

import { requireSuperAdmin } from '@/lib/auth/agency'
import {
  deleteAgencyAccount,
  loadAgencyAccountDetail,
  updateAgencyAccountStatus,
  type AgencyAccountStatus,
} from '@/lib/agency/account-detail'

// UUID shape check — cheap defense against feeding a garbage id
// straight into the queries below (see the same pattern in
// whatsapp/templates/[id]/route.ts).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ACCOUNT_STATUSES: AgencyAccountStatus[] = ['pending', 'active', 'suspended']

/**
 * GET    /api/agency/accounts/[id] — full detail for one account
 *        (members, WhatsApp connection, 30-day AI usage). Powers the
 *        agency panel's account detail sheet.
 * PATCH  /api/agency/accounts/[id] — update the account's status
 *        (migration 088) — activate a pending self-signup, or
 *        suspend/reactivate an existing client.
 * DELETE /api/agency/accounts/[id] — permanently delete the account:
 *        all its data (cascades) AND every member's login. See
 *        deleteAgencyAccount's doc comment. Irreversible.
 *
 * All gated by requireSuperAdmin() — same identity check as every
 * other /api/agency/* route and the /agency page itself.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
  }

  const detail = await loadAgencyAccountDetail(id)
  if (!detail) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }
  return NextResponse.json({ account: detail })
}

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
    return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as { status?: unknown } | null
  const status = body?.status
  if (typeof status !== 'string' || !ACCOUNT_STATUSES.includes(status as AgencyAccountStatus)) {
    return NextResponse.json(
      { error: `'status' must be one of: ${ACCOUNT_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    await updateAgencyAccountStatus(id, status as AgencyAccountStatus)
  } catch (err) {
    console.error('[PATCH /api/agency/accounts/[id]] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update account' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
  }

  try {
    await deleteAgencyAccount(id)
  } catch (err) {
    console.error('[DELETE /api/agency/accounts/[id]] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete account' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
