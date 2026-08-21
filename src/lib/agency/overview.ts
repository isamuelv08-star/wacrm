import { supabaseAdmin } from './admin-client'

/** No activity (any message, either direction) for this long counts
 *  as "gone quiet" — a signal the client may have stopped using the
 *  system or something's misconfigured on their end (disconnected
 *  number, etc). Fixed for v1 — see the plan's "out of scope" note
 *  for why this isn't per-account configurable yet. */
export const AGENCY_INACTIVITY_DAYS = 3

export interface AgencyAccountOverview {
  accountId: string
  accountName: string
  accountCreatedAt: string
  defaultCurrency: string
  whatsappStatus: 'connected' | 'disconnected' | null
  activeConversations: number
  messagesToday: number
  newLeadsToday: number
  newLeadsWeek: number
  hotLeads: number
  openPipelineValue: number
  lastActivityAt: string | null
  /** Derived client-side-friendly read on `lastActivityAt` — null
   *  means "not stale", so callers can `if (staleness)` directly. */
  staleness: { neverActive: true } | { daysSinceActivity: number } | null
  /** True when WhatsApp is disconnected OR the account is stale —
   *  computed once here so the default sort and the card's "needs
   *  attention" styling can never disagree on what counts as an
   *  alert. */
  hasAlert: boolean
}

interface AgencyOverviewRow {
  account_id: string
  account_name: string
  account_created_at: string
  default_currency: string
  whatsapp_status: 'connected' | 'disconnected' | null
  active_conversations: number
  messages_today: number
  new_leads_today: number
  new_leads_week: number
  hot_leads: number
  open_pipeline_value: number
  last_activity_at: string | null
}

function computeStaleness(
  lastActivityAt: string | null,
): AgencyAccountOverview['staleness'] {
  if (!lastActivityAt) return { neverActive: true }
  const days = (Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000
  if (days < AGENCY_INACTIVITY_DAYS) return null
  return { daysSinceActivity: Math.floor(days) }
}

/**
 * One row per account, every metric the agency panel shows. Reads
 * `agency_account_overview` (migration 051) through the service-role
 * client — see that migration's header and requireSuperAdmin's doc
 * comment for why this is safe. Callers MUST have already called
 * requireSuperAdmin() before this — this function does not check
 * identity itself, it trusts the caller did.
 *
 * Default order: accounts needing attention (WhatsApp disconnected or
 * stale) first, so the whole point of the panel — "what needs me
 * right now" — doesn't require scrolling past healthy accounts to
 * find. Within each group, biggest open pipeline first — among
 * healthy accounts that's "which client matters most today"; among
 * alerted ones it's "which of these is the most costly to keep
 * ignoring". Re-sort here (not in the SQL view) if this ever needs to
 * become a user-facing toggle instead of a fixed default.
 */
export async function loadAgencyOverview(): Promise<AgencyAccountOverview[]> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('agency_account_overview')
    .select('*')
    .order('account_name', { ascending: true })

  if (error) {
    console.error('[agency] overview load failed:', error.message)
    throw new Error('Failed to load agency overview')
  }

  const accounts = ((data ?? []) as AgencyOverviewRow[]).map((row) => {
    const staleness = computeStaleness(row.last_activity_at)
    return {
      accountId: row.account_id,
      accountName: row.account_name,
      accountCreatedAt: row.account_created_at,
      defaultCurrency: row.default_currency,
      whatsappStatus: row.whatsapp_status,
      activeConversations: row.active_conversations,
      messagesToday: row.messages_today,
      newLeadsToday: row.new_leads_today,
      newLeadsWeek: row.new_leads_week,
      hotLeads: row.hot_leads,
      openPipelineValue: row.open_pipeline_value,
      lastActivityAt: row.last_activity_at,
      staleness,
      hasAlert: row.whatsapp_status !== 'connected' || staleness !== null,
    }
  })

  accounts.sort((a, b) => {
    if (a.hasAlert !== b.hasAlert) return a.hasAlert ? -1 : 1
    return b.openPipelineValue - a.openPipelineValue
  })

  return accounts
}
