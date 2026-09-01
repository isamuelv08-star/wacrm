import { NextResponse } from 'next/server'

import { requireSuperAdmin } from '@/lib/auth/agency'
import { deleteAgencyAccountMember } from '@/lib/agency/account-detail'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * DELETE /api/agency/accounts/[id]/members/[userId]
 *
 * Permanently deletes one member of a client account — their Supabase
 * Auth user entirely, not just their membership (see
 * deleteAgencyAccountMember's doc comment for how this differs from
 * the in-app "remove member" flow). Rejects the account owner — delete
 * the whole account instead. Gated by requireSuperAdmin().
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    await requireSuperAdmin()
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id, userId } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    await deleteAgencyAccountMember(id, userId)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to delete member' },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true })
}
