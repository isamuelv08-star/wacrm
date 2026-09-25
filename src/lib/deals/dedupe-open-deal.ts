import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Race-safe follow-up to the "look for an open deal, insert one if
 * none" pattern (webhook-processor.ts's ensureLeadDeal, lead-scoring.ts's
 * ensureDealInQualifiedStage). Two webhook deliveries landing at the
 * same moment (Meta/Zernio redelivery, or two messages from a brand-new
 * contact) both pass the lookup before either inserts, so the contact
 * ends up with two identical open deals created milliseconds apart.
 *
 * Call right after the insert with the id it produced: if an OLDER open
 * deal exists for the same contact, the one just inserted is removed.
 * Every concurrent caller sees the same oldest row (created_at, then id
 * as a tiebreak), so exactly one survives, and each caller only ever
 * deletes the row it created itself — never a pre-existing deal.
 *
 * Returns true when the inserted deal was kept. Best-effort: on a
 * lookup error the deal is left in place.
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
