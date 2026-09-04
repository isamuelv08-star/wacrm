// ============================================================
// /api/ai/media-library/[id]
//
//   PATCH  — edit title/description (admin+). The key and the
//            underlying file are immutable after creation — swap them
//            by deleting and re-adding instead, keeping this route
//            (and what the model was taught mid-conversation) simple.
//   DELETE — remove the item (admin+) and best-effort delete the
//            underlying Storage object so orphaned files don't
//            accumulate in the bucket.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const update: Record<string, unknown> = {}
    if ('title' in body) {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (!title) return bad('title cannot be empty')
      update.title = title
    }
    if ('description' in body) {
      const description = typeof body.description === 'string' ? body.description.trim() : ''
      if (!description) return bad('description cannot be empty')
      update.description = description
    }
    if (Object.keys(update).length === 0) return bad('Nothing to update')

    const { data, error } = await supabase
      .from('ai_media_library')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, key, title, description, media_kind, media_url, created_at')
      .maybeSingle()

    if (error) {
      console.error('[ai/media-library PATCH] update error:', error)
      return NextResponse.json({ error: 'Failed to update the item' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    return NextResponse.json({ item: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const { data: existing, error: fetchError } = await supabase
      .from('ai_media_library')
      .select('storage_path')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (fetchError) {
      console.error('[ai/media-library DELETE] lookup error:', fetchError)
      return NextResponse.json({ error: 'Failed to look up the item' }, { status: 500 })
    }
    if (!existing) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    const { error: deleteError } = await supabase
      .from('ai_media_library')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (deleteError) {
      console.error('[ai/media-library DELETE] delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete the item' }, { status: 500 })
    }

    // Best-effort — an orphaned Storage object is a nit, not worth
    // failing the request the user is waiting on.
    if (existing.storage_path) {
      const { error: storageError } = await supabase.storage
        .from('ai-media-library')
        .remove([existing.storage_path])
      if (storageError) {
        console.error('[ai/media-library DELETE] storage cleanup failed:', storageError.message)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
