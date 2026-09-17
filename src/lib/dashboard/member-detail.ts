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

// ============================================================
// Behavioral Intelligence (fase 6 of the Auditoría Saleslid roadmap)
// — week-over-week trend for ONE member, built entirely from events
// that already carry a real timestamp (deals.closed_at,
// deal_stage_history.changed_at), never a reconstructed point-in-time
// snapshot (this app doesn't keep those — see loadCeoMetrics's own
// doc comment on why pipelineTotal has no historical reading either).
// Deliberately just two metrics, both plainly observable, neither a
// judgment call: deals actually won, and deals actually moved forward
// — never a "productivity score" or a label like "slow"/"underperforming".
// ============================================================

function startOfWeekMonday(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  const dow = (out.getDay() + 6) % 7 // 0 = Monday
  out.setDate(out.getDate() - dow)
  return out
}

function weekKey(d: Date): string {
  return startOfWeekMonday(d).toISOString().slice(0, 10)
}

export interface WeeklyTrendPoint {
  /** Monday of this week, YYYY-MM-DD. */
  weekStart: string
  dealsWon: number
  dealsWonValue: number
  /** Real stage-to-stage moves (excludes a deal's initial placement on
   *  creation) on deals CURRENTLY assigned to this member — the closest
   *  honest proxy for "kept working a deal forward" this schema
   *  supports, since deal_stage_history has no per-change actor column
   *  to attribute a historical move to whoever was assigned at the time. */
  dealsAdvanced: number
}

/**
 * `weeks` full Monday-anchored weeks, oldest first, zero-filled — so a
 * quiet week reads as "0", not a missing data point.
 */
export async function loadMemberBehavioralTrend(
  db: DB,
  member: { profileId: string },
  weeks = 8,
): Promise<WeeklyTrendPoint[]> {
  const earliestWeekStart = startOfWeekMonday(new Date())
  earliestWeekStart.setDate(earliestWeekStart.getDate() - 7 * (weeks - 1))
  const windowStartIso = earliestWeekStart.toISOString()

  const [wonRes, historyRes] = await Promise.all([
    db
      .from('deals')
      .select('value, closed_at')
      .eq('status', 'won')
      .eq('assigned_to', member.profileId)
      .gte('closed_at', windowStartIso),
    db
      .from('deal_stage_history')
      .select('changed_at, from_stage_id, deals!inner(assigned_to)')
      .eq('deals.assigned_to', member.profileId)
      .not('from_stage_id', 'is', null)
      .gte('changed_at', windowStartIso),
  ])
  if (wonRes.error) throw wonRes.error
  if (historyRes.error) throw historyRes.error

  const wonByWeek = new Map<string, { count: number; value: number }>()
  for (const d of (wonRes.data ?? []) as { value: number | null; closed_at: string }[]) {
    const key = weekKey(new Date(d.closed_at))
    const entry = wonByWeek.get(key) ?? { count: 0, value: 0 }
    entry.count += 1
    entry.value += d.value ?? 0
    wonByWeek.set(key, entry)
  }

  const advancedByWeek = new Map<string, number>()
  for (const h of (historyRes.data ?? []) as { changed_at: string }[]) {
    const key = weekKey(new Date(h.changed_at))
    advancedByWeek.set(key, (advancedByWeek.get(key) ?? 0) + 1)
  }

  const points: WeeklyTrendPoint[] = []
  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(earliestWeekStart)
    weekStart.setDate(weekStart.getDate() + 7 * i)
    const key = weekKey(weekStart)
    const won = wonByWeek.get(key)
    points.push({
      weekStart: key,
      dealsWon: won?.count ?? 0,
      dealsWonValue: won?.value ?? 0,
      dealsAdvanced: advancedByWeek.get(key) ?? 0,
    })
  }
  return points
}
