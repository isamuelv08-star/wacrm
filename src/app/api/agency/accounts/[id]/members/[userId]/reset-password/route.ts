import { NextResponse, type NextRequest } from 'next/server'

import { requireSuperAdmin } from '@/lib/auth/agency'
import { sendAgencyMemberPasswordReset } from '@/lib/agency/account-detail'
import { getPublicOrigin } from '@/lib/http/request-origin'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/agency/accounts/[id]/members/[userId]/reset-password
 *
 * Triggers the standard Supabase Auth "reset your password" email for
 * one member — see sendAgencyMemberPasswordReset's doc comment for why
 * this (and not viewing/setting the password directly) is the panel's
 * answer to "help a client back into their account". Gated by
 * requireSuperAdmin(), same as every other /api/agency/* route.
 */
export async function POST(
  request: NextRequest,
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

  const origin = getPublicOrigin(request)
  try {
    // Straight to /reset-password, NOT through /auth/callback: this reset is
    // triggered by the service-role admin client (see
    // sendAgencyMemberPasswordReset's doc comment), which can't complete the
    // PKCE flow /auth/callback expects, so Supabase falls back to an implicit
    // grant delivered as a `#access_token=...` URL fragment. That fragment
    // never reaches our server — routing through /auth/callback first would
    // have it redirect away (no `?code`) before the browser ever gets to read
    // the hash. /reset-password's client-side code reads it directly instead.
    await sendAgencyMemberPasswordReset(
      id,
      userId,
      `${origin}/reset-password`,
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send reset email' },
      { status: 400 },
    )
  }

  return NextResponse.json({ ok: true })
}
