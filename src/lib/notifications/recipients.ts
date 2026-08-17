import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Every owner/admin on an account — the fallback recipient list
 * whenever a lead-lifecycle notification (new message, hot-lead
 * alert, ...) has no specific assignee to go to instead. Shared by
 * every notifier under src/lib/notifications/ and src/lib/ai so the
 * "who owns an unassigned lead" definition can't drift between them.
 */
export async function resolveOwnersAndAdmins(
  db: SupabaseClient,
  accountId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .in('account_role', ['owner', 'admin'])
  if (error) {
    console.error('[notifications] owners/admins lookup failed:', error.message)
    return []
  }
  return (data ?? []).map((r) => r.user_id as string)
}
