import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canViewDashboardSection,
  type AccountRole,
  type DashboardPermissionKey,
  type DashboardPermissions,
} from './roles'

/**
 * Resolve which /dashboard sales widgets the calling user is allowed
 * to see, server-side — the same rule `useAuth`'s
 * `canViewDashboardSection` applies on the client (owner sees
 * everything; everyone else falls back to their role default unless
 * a per-member override is set). Shared by every server-side consumer
 * of this account's dashboard data (the cached CEO summary route, the
 * sidebar AI assistant's snapshot) so there's one place computing
 * "can this caller see X", not two copies that can drift apart.
 */
export async function loadDashboardAccess(
  db: SupabaseClient,
  args: { role: AccountRole; userId: string },
): Promise<{ can: (key: DashboardPermissionKey) => boolean }> {
  const { role, userId } = args
  const isOwner = role === 'owner'

  const permsRow = await db
    .from('profiles')
    .select('dashboard_permissions')
    .eq('user_id', userId)
    .maybeSingle()
  const permissions = (permsRow.data?.dashboard_permissions ?? null) as DashboardPermissions | null

  return {
    can: (key: DashboardPermissionKey) => isOwner || canViewDashboardSection(role, permissions, key),
  }
}
