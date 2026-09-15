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

/**
 * Every seller an admin/owner can pick from the dashboard's "view as"
 * selector — one entry per distinct owner_user_id among the account's
 * connected numbers, with that person's display name and the
 * whatsapp_config ids owned under their name (a seller can own more
 * than one number). Numbers with no owner assigned yet aren't
 * attributable to anyone and don't produce an entry.
 */
export async function loadSellerOptions(
  db: SupabaseClient,
  accountId: string,
): Promise<SellerOption[]> {
  const { data: configs } = await db
    .from('whatsapp_config')
    .select('id, owner_user_id')
    .eq('account_id', accountId)
    .not('owner_user_id', 'is', null)
  const rows = (configs ?? []) as { id: string; owner_user_id: string }[]
  if (rows.length === 0) return []

  const byOwner = new Map<string, string[]>()
  for (const row of rows) {
    const ids = byOwner.get(row.owner_user_id) ?? []
    ids.push(row.id)
    byOwner.set(row.owner_user_id, ids)
  }

  const ownerIds = Array.from(byOwner.keys())
  const { data: profiles } = await db
    .from('profiles')
    .select('user_id, full_name, email')
    .in('user_id', ownerIds)
  const nameByUser = new Map(
    ((profiles ?? []) as { user_id: string; full_name: string | null; email: string | null }[]).map(
      (p) => [p.user_id, p.full_name || p.email || p.user_id],
    ),
  )

  return ownerIds.map((userId) => ({
    userId,
    name: nameByUser.get(userId) ?? userId,
    whatsappConfigIds: byOwner.get(userId) ?? [],
  }))
}

export interface SellerBreakdownRow {
  userId: string
  name: string
  activeConversations: number
  messagesToday: number
  openPipelineValue: number
}

/**
 * The "detalle por vendedor" table an admin/owner sees on a
 * multiwhatsapp dashboard — one row per seller with a number
 * assigned, today-scoped and current-state only (no period deltas,
 * unlike loadMetrics — this is a quick roster, not another full set
 * of trend cards).
 */
export async function loadSellerBreakdown(
  db: SupabaseClient,
  accountId: string,
): Promise<SellerBreakdownRow[]> {
  const sellers = await loadSellerOptions(db, accountId)
  if (sellers.length === 0) return []

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartIso = todayStart.toISOString()

  return Promise.all(
    sellers.map(async (seller) => {
      const [convRes, msgRes, dealsRes] = await Promise.all([
        db
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open')
          .in('whatsapp_config_id', seller.whatsappConfigIds),
        db
          .from('messages')
          .select('id, conversations!inner(whatsapp_config_id)', { count: 'exact', head: true })
          .eq('sender_type', 'agent')
          .gte('created_at', todayStartIso)
          .in('conversations.whatsapp_config_id', seller.whatsappConfigIds),
        db.from('deals').select('value').eq('status', 'open').eq('assigned_to', seller.userId),
      ])
      const dealRows = (dealsRes.data ?? []) as { value: number | null }[]
      return {
        userId: seller.userId,
        name: seller.name,
        activeConversations: convRes.count ?? 0,
        messagesToday: msgRes.count ?? 0,
        openPipelineValue: dealRows.reduce((sum, d) => sum + (d.value ?? 0), 0),
      }
    }),
  )
}
