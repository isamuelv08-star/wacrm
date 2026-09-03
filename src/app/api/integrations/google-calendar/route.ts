// ============================================================
// /api/integrations/google-calendar
//
//   GET    — connection status for the caller's account. Any member
//            (mirrors ConnectPlatformButton reading
//            client_zernio_accounts directly) — never returns tokens.
//   DELETE — disconnect. Admin+, same bar as connecting.
// ============================================================

import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { getConnectionStatus, getConnection, deleteConnection } from '@/lib/google-calendar/connection'
import { revokeToken } from '@/lib/google-calendar/oauth'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const status = await getConnectionStatus(supabase, accountId)
    return NextResponse.json(status)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')

    // Best-effort revoke on Google's side so the connected Google
    // account actually sees this app's access removed, not just our
    // own row — but the local row is always cleared regardless of
    // whether the revoke call succeeds, same posture as the Zernio
    // disconnect route.
    let googleRevoked = true
    const connection = await getConnection(ctx.supabase, ctx.accountId)
    if (connection) {
      googleRevoked = await revokeToken(connection.refreshToken)
    }

    await deleteConnection(ctx.supabase, ctx.accountId)

    return NextResponse.json({ success: true, googleRevoked })
  } catch (err) {
    return toErrorResponse(err)
  }
}
