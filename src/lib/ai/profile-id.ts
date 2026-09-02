import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Translate an `auth.users.id` into its `profiles.id` — several tables
 * (`deals.assigned_to`, `calendar_events.assigned_to`/`created_by`)
 * reference `profiles.id` rather than the auth user id directly (see
 * migration 002's comment on `deals.assigned_to`), so every write path
 * that resolves "this agent" into one of those columns needs this
 * translation. Returns null for a null input, or when the user has no
 * profile row (shouldn't happen, but the FK isn't enforced at the
 * application layer).
 */
export async function resolveProfileId(
  db: SupabaseClient,
  authUserId: string | null,
): Promise<string | null> {
  if (!authUserId) return null
  const { data } = await db
    .from('profiles')
    .select('id')
    .eq('user_id', authUserId)
    .maybeSingle()
  return data?.id ?? null
}
