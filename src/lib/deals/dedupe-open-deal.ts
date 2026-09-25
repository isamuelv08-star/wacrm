import type { SupabaseClient } from '@supabase/supabase-js'

export interface OpenDealFields {
  accountId: string
  contactId: string
  userId: string
  pipelineId: string
  stageId: string
  title: string
  currency: string
  conversationId?: string | null
  assignedTo?: string | null
  value?: number
}

/**
 * Return the contact's open deal, creating one from `fields` only when
 * none exists. Goes through the `ensure_open_deal` RPC (migration 110),
 * which takes a per-contact advisory lock so two concurrent callers
 * (Meta/Zernio redelivery, two messages from a brand-new contact, the
 * webhook racing the AI's qualification) can never both insert.
 *
 * Falls back to lookup → insert → keepOnlyOldestOpenDeal when the RPC
 * isn't deployed yet, so shipping this code ahead of the migration
 * doesn't break deal creation. Must be called with a service-role
 * client (the RPC is not executable by `authenticated`).
 *
 * Returns null on error (already logged).
 */
export async function ensureOpenDeal(
  db: SupabaseClient,
  fields: OpenDealFields,
): Promise<{ dealId: string; created: boolean } | null> {
  const { data, error } = await db.rpc('ensure_open_deal', {
    p_account_id: fields.accountId,
    p_contact_id: fields.contactId,
    p_user_id: fields.userId,
    p_pipeline_id: fields.pipelineId,
    p_stage_id: fields.stageId,
    p_title: fields.title,
    p_currency: fields.currency,
    p_conversation_id: fields.conversationId ?? null,
    p_assigned_to: fields.assignedTo ?? null,
    p_value: fields.value ?? 0,
  })

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data
    if (row?.deal_id) return { dealId: row.deal_id as string, created: Boolean(row.created) }
    console.error('[deals] ensure_open_deal returned no row')
    return null
  }

  if (!isMissingFunction(error)) {
    console.error('[deals] ensure_open_deal failed:', error.message)
    return null
  }

  // Pre-110 fallback.
  const { data: existing, error: lookupErr } = await db
    .from('deals')
    .select('id')
    .eq('contact_id', fields.contactId)
    .eq('account_id', fields.accountId)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (lookupErr) {
    console.error('[deals] open-deal lookup failed:', lookupErr.message)
    return null
  }
  if (existing) return { dealId: existing.id, created: false }

  const { data: inserted, error: insertErr } = await db
    .from('deals')
    .insert({
      account_id: fields.accountId,
      user_id: fields.userId,
      pipeline_id: fields.pipelineId,
      stage_id: fields.stageId,
      contact_id: fields.contactId,
      conversation_id: fields.conversationId ?? null,
      title: fields.title,
      value: fields.value ?? 0,
      currency: fields.currency,
      status: 'open',
      assigned_to: fields.assignedTo ?? null,
    })
    .select('id')
    .single()
  if (insertErr || !inserted) {
    console.error('[deals] insert failed:', insertErr?.message)
    return null
  }

  const kept = await keepOnlyOldestOpenDeal(db, {
    accountId: fields.accountId,
    contactId: fields.contactId,
    insertedDealId: inserted.id,
  })
  if (kept) return { dealId: inserted.id, created: true }

  // Lost the race — hand back the survivor.
  const { data: survivor } = await db
    .from('deals')
    .select('id')
    .eq('contact_id', fields.contactId)
    .eq('account_id', fields.accountId)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return survivor ? { dealId: survivor.id, created: false } : null
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    /could not find the function|does not exist/i.test(error.message ?? '')
  )
}

/**
 * Race-safe follow-up to a plain "look for an open deal, insert one if
 * none". Call right after the insert with the id it produced: if an
 * OLDER open deal exists for the same contact, the one just inserted
 * is removed. Every concurrent caller sees the same oldest row
 * (created_at, then id), and each only ever deletes its own row.
 * Superseded by ensure_open_deal (migration 110); kept as its fallback.
 *
 * Returns true when the inserted deal was kept.
 */
export async function keepOnlyOldestOpenDeal(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; insertedDealId: string },
): Promise<boolean> {
  const { accountId, contactId, insertedDealId } = args

  const { data: openDeals, error } = await db
    .from('deals')
    .select('id, created_at')
    .eq('contact_id', contactId)
    .eq('account_id', accountId)
    .eq('status', 'open')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
  if (error || !openDeals || openDeals.length === 0) {
    if (error) console.error('[deals] duplicate check failed:', error.message)
    return true
  }

  if (openDeals[0].id === insertedDealId) return true

  const { error: deleteErr } = await db.from('deals').delete().eq('id', insertedDealId)
  if (deleteErr) {
    console.error('[deals] failed to drop duplicate open deal:', deleteErr.message)
    return true
  }
  console.warn(
    `[deals] dropped duplicate open deal ${insertedDealId} for contact ${contactId} (concurrent creation)`,
  )
  return false
}
