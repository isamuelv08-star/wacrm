// ============================================================
// GET /api/whatsapp/numbers
//
// Lists every whatsapp_config row for the caller's account — the
// multi-WhatsApp management dialog's data source. Any member can
// read (mirrors whatsapp_config's own RLS select policy, migration
// 017); only admin+ can act on what's returned (see [id]/route.ts).
//
// Doesn't return access_token/verify_token — the dialog only ever
// needs to show/label/reassign/remove a connection, never the raw
// credentials.
// ============================================================

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()

    const { data, error } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'id, phone_number_id, waba_id, status, label, owner_user_id, connected_at, registered_at, last_registration_error, created_at',
      )
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[GET /api/whatsapp/numbers] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load numbers' }, { status: 500 })
    }

    return NextResponse.json({ numbers: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
