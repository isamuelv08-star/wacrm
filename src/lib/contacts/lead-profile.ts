import type { SupabaseClient } from '@supabase/supabase-js'
import { loadTeamRoster } from '@/lib/dashboard/member-detail'

/**
 * Everything the Contacts → "Resumen" tab shows about one lead, except
 * the AI narrative's generation. All of it already lives in the CRM
 * (lead scoring, contact_intelligence, deals, promises, conversations,
 * messages, tags); this module only assembles it, through the caller's
 * RLS-scoped client — so a seller in a multi-WhatsApp account never
 * counts or reads messages from a number that isn't theirs.
 */

type DB = SupabaseClient

export type LeadScoreValue = 'hot' | 'warm' | 'cold'

/** Row shape of `contact_ai_summaries` (migration 099). */
export interface StoredLeadSummary {
  contact_id: string
  summary: string
  highlights: string[]
  next_step: string | null
  source_message_id: string | null
  source_message_at: string | null
  language: string | null
  generated_at: string
}

export interface LeadIntelligence {
  need: string | null
  budget: string | null
  objection: string | null
  productInterest: string | null
  updatedAt: string
}

export interface LeadDeal {
  id: string
  title: string
  value: number
  currency: string | null
  status: 'open' | 'won' | 'lost'
  stageName: string | null
}

export interface LeadPromise {
  id: string
  text: string
  dueAt: string
  /** `overdue` in the DB, or still `pending` but past its due date and
   *  not yet swept — computed here so the view stays render-pure. */
  overdue: boolean
}

export interface LeadActivity {
  conversationCount: number
  channels: string[]
  inbound: number
  outbound: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  lastCustomerMessageAt: string | null
  assignedAgentName: string | null
  adHeadline: string | null
}

export interface LeadProfile {
  intelligence: LeadIntelligence | null
  scoreTrend: { score: LeadScoreValue; at: string }[]
  deals: LeadDeal[]
  promises: LeadPromise[]
  activity: LeadActivity
  tags: { id: string; name: string; color: string }[]
  summary: StoredLeadSummary | null
  latestMessage: { id: string; createdAt: string } | null
}

const first = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

export async function loadLeadProfile(db: DB, contactId: string): Promise<LeadProfile> {
  const [convRes, intelRes, trendRes, dealsRes, promisesRes, tagsRes, summaryRes, roster] =
    await Promise.all([
      db
        .from('conversations')
        .select('id, platform, assigned_agent_id, ad_referral, updated_at')
        .eq('contact_id', contactId)
        .order('updated_at', { ascending: false }),
      db
        .from('contact_intelligence')
        .select('need, budget, objection, product_interest, updated_at')
        .eq('contact_id', contactId)
        .maybeSingle(),
      db
        .from('lead_score_history')
        .select('new_score, created_at')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(4),
      db
        .from('deals')
        .select('id, title, value, currency, status, stage:pipeline_stages(name)')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(6),
      db
        .from('promises')
        .select('id, promise_text, due_at, status')
        .eq('contact_id', contactId)
        .in('status', ['pending', 'overdue'])
        .order('due_at', { ascending: true })
        .limit(5),
      db.from('contact_tags').select('tag:tags(id, name, color)').eq('contact_id', contactId),
      db.from('contact_ai_summaries').select('*').eq('contact_id', contactId).maybeSingle(),
      loadTeamRoster(db).catch(() => []),
    ])

  const conversations = (convRes.data ?? []) as {
    id: string
    platform: string | null
    assigned_agent_id: string | null
    ad_referral: { headline?: string | null } | null
  }[]
  const conversationIds = conversations.map((c) => c.id)

  let inbound = 0
  let outbound = 0
  let firstAt: string | null = null
  let latest: { id: string; created_at: string } | null = null
  let lastCustomerAt: string | null = null

  if (conversationIds.length > 0) {
    const scope = () => db.from('messages').select('id, created_at', { count: 'exact', head: true }).in('conversation_id', conversationIds)
    const [inRes, outRes, firstRes, latestRes, lastCustRes] = await Promise.all([
      scope().eq('sender_type', 'customer'),
      scope().in('sender_type', ['agent', 'bot']),
      db
        .from('messages')
        .select('created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: true })
        .limit(1),
      db
        .from('messages')
        .select('id, created_at')
        .in('conversation_id', conversationIds)
        .order('created_at', { ascending: false })
        .limit(1),
      db
        .from('messages')
        .select('created_at')
        .in('conversation_id', conversationIds)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    inbound = inRes.count ?? 0
    outbound = outRes.count ?? 0
    firstAt = (firstRes.data?.[0] as { created_at: string } | undefined)?.created_at ?? null
    latest = (latestRes.data?.[0] as { id: string; created_at: string } | undefined) ?? null
    lastCustomerAt =
      (lastCustRes.data?.[0] as { created_at: string } | undefined)?.created_at ?? null
  }

  const assignedId = conversations.find((c) => c.assigned_agent_id)?.assigned_agent_id ?? null
  const intel = intelRes.data as {
    need: string | null
    budget: string | null
    objection: string | null
    product_interest: string | null
    updated_at: string
  } | null
  const hasIntel = !!intel && (intel.need || intel.budget || intel.objection || intel.product_interest)

  return {
    intelligence: hasIntel
      ? {
          need: intel.need,
          budget: intel.budget,
          objection: intel.objection,
          productInterest: intel.product_interest,
          updatedAt: intel.updated_at,
        }
      : null,
    // Newest-first from the DB; shown oldest → newest ("cold → warm → hot").
    scoreTrend: ((trendRes.data ?? []) as { new_score: LeadScoreValue; created_at: string }[])
      .map((r) => ({ score: r.new_score, at: r.created_at }))
      .reverse(),
    deals: ((dealsRes.data ?? []) as unknown as {
      id: string
      title: string
      value: number
      currency: string | null
      status: 'open' | 'won' | 'lost' | null
      stage: { name: string } | { name: string }[] | null
    }[]).map((d) => ({
      id: d.id,
      title: d.title,
      value: Number(d.value) || 0,
      currency: d.currency,
      status: d.status ?? 'open',
      stageName: first(d.stage)?.name ?? null,
    })),
    promises: ((promisesRes.data ?? []) as {
      id: string
      promise_text: string
      due_at: string
      status: 'pending' | 'overdue'
    }[]).map((p) => ({
      id: p.id,
      text: p.promise_text,
      dueAt: p.due_at,
      overdue: p.status === 'overdue' || new Date(p.due_at).getTime() < Date.now(),
    })),
    activity: {
      conversationCount: conversations.length,
      channels: [...new Set(conversations.map((c) => c.platform ?? 'whatsapp'))],
      inbound,
      outbound,
      firstMessageAt: firstAt,
      lastMessageAt: latest?.created_at ?? null,
      lastCustomerMessageAt: lastCustomerAt,
      assignedAgentName: assignedId
        ? (roster.find((m) => m.userId === assignedId)?.name ?? null)
        : null,
      adHeadline: conversations.find((c) => c.ad_referral?.headline)?.ad_referral?.headline ?? null,
    },
    tags: ((tagsRes.data ?? []) as unknown as {
      tag: { id: string; name: string; color: string } | { id: string; name: string; color: string }[] | null
    }[])
      .map((r) => first(r.tag))
      .filter((t): t is { id: string; name: string; color: string } => !!t),
    summary: (summaryRes.data as StoredLeadSummary | null) ?? null,
    latestMessage: latest ? { id: latest.id, createdAt: latest.created_at } : null,
  }
}

/** True when the AI narrative should be (re)generated on open: there is
 *  a conversation, and no summary exists yet, or it was written from an
 *  older message, or in another UI language. Mirrors the server's
 *  `isSummaryFresh` so the client never triggers a call the server would
 *  answer from cache. */
export function summaryNeedsRefresh(profile: LeadProfile, locale: string): boolean {
  if (!profile.latestMessage) return false
  const s = profile.summary
  return !s || s.source_message_id !== profile.latestMessage.id || s.language !== locale
}
