import type { SupabaseClient } from '@supabase/supabase-js'
import { monthsAgoStart } from './date-utils'

type DB = SupabaseClient

export interface TeamMember {
  userId: string
  profileId: string
  name: string
  avatarUrl: string | null
}

/**
 * Every member of the caller's account, straight from `profiles` —
 * unlike the older `loadSellerOptions` (seller-scope.ts), which only
 * ever produces rows once multiwhatsapp assigns numbers to owners,
 * this works identically for a 'shared'-mode account (the common
 * case: one shared number, several agents round-robin-assigned). Also
 * doubles as the team chat's participant roster (@-mention
 * autocomplete, sender name/avatar lookup) — see src/lib/team-chat/.
 * RLS scopes this to the caller's own account, same as every other
 * query in this directory.
 */
export async function loadTeamRoster(db: DB): Promise<TeamMember[]> {
  const { data, error } = await db
    .from('profiles')
    .select('id, user_id, full_name, email, avatar_url')
  if (error) throw error
  return (
    (data ?? []) as {
      id: string
      user_id: string
      full_name: string | null
      email: string | null
      avatar_url: string | null
    }[]
  ).map((p) => ({
    userId: p.user_id,
    profileId: p.id,
    name: p.full_name || p.email || '—',
    avatarUrl: p.avatar_url,
  }))
}

export interface MemberBreakdown {
  leadsHot: number
  leadsWarm: number
  leadsCold: number
  activeConversations: number
  openDealsCount: number
  openDealsValue: number
  soldThisMonth: number
}

/**
 * Full performance snapshot for ONE team member — leads by score,
 * open pipeline, and sales this month. Scoped by ASSIGNMENT
 * (conversations.assigned_agent_id / deals.assigned_to), not by
 * WhatsApp number ownership (whatsapp_config.owner_user_id, what
 * seller-scope.ts uses) — assignment exists and gets filled the same
 * way whether the account is 'shared' (round-robin) or
 * 'multiwhatsapp' (number-owner assignment, migration 085/phase 5),
 * so this single implementation covers both instead of only ever
 * working post-multiwhatsapp.
 *
 * `profileId` (profiles.id) — NOT `userId` (auth.users.id) — is what
 * `deals.assigned_to` actually references (migrations 002/053).
 * `loadTopSellers` (ceo-queries.ts) already hit and fixed this exact
 * mix-up once; `queries.ts`'s seller-scoped `dealBase()` and
 * `seller-scope.ts`'s `loadSellerBreakdown` still have it — out of
 * scope to touch here since this function supersedes their "who's
 * selling what" job with an assignment-based one that works
 * regardless of whatsapp_mode.
 */
export async function loadMemberBreakdown(
  db: DB,
  member: { userId: string; profileId: string },
): Promise<MemberBreakdown> {
  const monthStartIso = monthsAgoStart(0).toISOString()

  const leadScoreQuery = (score: 'hot' | 'warm' | 'cold') =>
    db
      .from('contacts')
      .select('id, conversations!inner(assigned_agent_id)', { count: 'exact', head: true })
      .eq('lead_score', score)
      .eq('conversations.assigned_agent_id', member.userId)

  const [hotRes, warmRes, coldRes, convRes, openDealsRes, soldRes] = await Promise.all([
    leadScoreQuery('hot'),
    leadScoreQuery('warm'),
    leadScoreQuery('cold'),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('assigned_agent_id', member.userId),
    db
      .from('deals')
      .select('value')
      .eq('status', 'open')
      .eq('assigned_to', member.profileId),
    db
      .from('deals')
      .select('value')
      .eq('status', 'won')
      .eq('assigned_to', member.profileId)
      .gte('closed_at', monthStartIso),
  ])

  const openDealRows = (openDealsRes.data ?? []) as { value: number | null }[]
  const soldRows = (soldRes.data ?? []) as { value: number | null }[]

  return {
    leadsHot: hotRes.count ?? 0,
    leadsWarm: warmRes.count ?? 0,
    leadsCold: coldRes.count ?? 0,
    activeConversations: convRes.count ?? 0,
    openDealsCount: openDealRows.length,
    openDealsValue: openDealRows.reduce((sum, d) => sum + (d.value ?? 0), 0),
    soldThisMonth: soldRows.reduce((sum, d) => sum + (d.value ?? 0), 0),
  }
}
