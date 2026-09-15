// ============================================================
// PATCH  /api/whatsapp/numbers/[id] — rename a number and/or (re)assign
//        it to a seller, or unassign it (owner_user_id: null).
// DELETE /api/whatsapp/numbers/[id] — remove one specific number.
//
// Both admin+, both scoped to the caller's own account (the `.eq('id',
// ...).eq('account_id', ...)` pair below is what makes a stray/guessed
// id from another account a 404 instead of a cross-tenant write —
// RLS would also block it, this just returns the right status code).
//
// Not gated on accounts.whatsapp_mode === 'multiwhatsapp' — a number
// created before a mode switch (or a 'shared' account with exactly
// one row) can still be renamed/removed the same way; the mode flag
// only decides which UI is shown, never what these routes will do.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const MAX_LABEL_LEN = 60

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const body = (await request.json().catch(() => null)) as {
      label?: unknown
      owner_user_id?: unknown
    } | null

    const update: Record<string, unknown> = {}

    if (body && 'label' in body) {
      const raw = body.label
      if (raw !== null && typeof raw !== 'string') {
        return NextResponse.json({ error: "'label' must be a string or null" }, { status: 400 })
      }
      if (typeof raw === 'string' && raw.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `'label' must be ${MAX_LABEL_LEN} characters or fewer` },
          { status: 400 },
        )
      }
      update.label = typeof raw === 'string' ? raw.trim() || null : null
    }

    if (body && 'owner_user_id' in body) {
      const raw = body.owner_user_id
      if (raw !== null && typeof raw !== 'string') {
        return NextResponse.json(
          { error: "'owner_user_id' must be a string or null" },
          { status: 400 },
        )
      }
      if (raw !== null) {
        // Must be an existing member of THIS account — otherwise an
        // admin could point a number at an arbitrary user id from
        // another account (RLS wouldn't catch this: it's a write to a
        // row this admin does own, just with a foreign-looking value
        // in one column).
        const { data: member, error: memberError } = await ctx.supabase
          .from('profiles')
          .select('user_id')
          .eq('account_id', ctx.accountId)
          .eq('user_id', raw)
          .maybeSingle()
        if (memberError) {
          console.error('[PATCH /api/whatsapp/numbers/[id]] member lookup failed:', memberError)
          return NextResponse.json({ error: 'Failed to validate the assignee' }, { status: 500 })
        }
        if (!member) {
          return NextResponse.json(
            { error: "'owner_user_id' must be a member of this account" },
            { status: 400 },
          )
        }
      }
      update.owner_user_id = raw
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data, error } = await ctx.supabase
      .from('whatsapp_config')
      .update(update)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id, phone_number_id, label, owner_user_id')
      .maybeSingle()

    if (error) {
      console.error('[PATCH /api/whatsapp/numbers/[id]] update error:', error)
      return NextResponse.json({ error: 'Failed to update the number' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    }

    return NextResponse.json({ number: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params

    const { data, error } = await ctx.supabase
      .from('whatsapp_config')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[DELETE /api/whatsapp/numbers/[id]] delete error:', error)
      return NextResponse.json({ error: 'Failed to remove the number' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'Number not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
