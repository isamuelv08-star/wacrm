import type { SupabaseClient } from '@supabase/supabase-js'

export interface SellerScope {
  userId: string
  whatsappConfigIds: string[]
}

export interface SellerOption {
  userId: string
  name: string
  whatsappConfigIds: string[]
}

/**
 * Resolve which whatsapp_config rows a given seller owns, for
 * loadMetrics' `seller` scoping param (phase 7, multiwhatsapp
 * dashboards). RLS already scopes this to the caller's own account —
 * same posture as every other query in this directory.
 */
export async function resolveSellerScope(
  db: SupabaseClient,
  userId: string,
): Promise<SellerScope> {
  const { data } = await db.from('whatsapp_config').select('id').eq('owner_user_id', userId)
  return { userId, whatsappConfigIds: (data ?? []).map((r) => r.id as string) }
}

// The account-wide "who's connected which number, and what's their
// current activity/pipeline" roster (loadSellerOptions/
// loadSellerBreakdown) that used to live here was removed — it only
// ever produced rows once multiwhatsapp assigned numbers to owners,
// and its deal query compared deals.assigned_to (profiles.id) against
// an auth.users.id, a mismatch that meant its pipeline-value column
// silently always read 0 (never caught because no real account has
// activated multiwhatsapp yet). MemberBreakdownCard's
// loadMemberBreakdown (src/lib/dashboard/member-detail.ts) supersedes
// it with an assignment-scoped equivalent that works for any
// whatsapp_mode and gets the id space right.
