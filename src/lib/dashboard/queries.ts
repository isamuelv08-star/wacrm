import type { SupabaseClient } from '@supabase/supabase-js'
import {
  daysAgoStart,
  lastNDayKeys,
  localDayKey,
  previousRange,
  rangeBuckets,
  type DateRange,
} from './date-utils'
import type {
  ConversationsSeriesPoint,
  HotUnansweredItem,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

// ------------------------------------------------------------
// All client-side aggregation. RLS scopes every query to the
// signed-in user automatically, so we never pass user_id explicitly
// here. Perf is acceptable for the current scale (low thousands of
// messages) — if a tenant's dataset outgrows this, we'd migrate the
// heavy aggregations to SQL RPCs. Noted in the PR.
// ------------------------------------------------------------

type DB = SupabaseClient

// --- 1. Metric cards ---------------------------------------------------

/**
 * `rangeDays` drives the two "activity in a period" cards (new
 * contacts, messages sent) and the delta on active conversations —
 * compared against the equal-length window immediately before it.
 * `activeConversations.current` and the open-deals value/count are
 * current-STATE snapshots (how many are open / worth right now) and
 * deliberately stay range-independent — there's no historical
 * snapshot to compare a live count against, only the deltas can be
 * windowed.
 */
export async function loadMetrics(db: DB, rangeDays: number): Promise<MetricsBundle> {
  const currentStart = daysAgoStart(rangeDays - 1).toISOString()
  const previousStart = daysAgoStart(rangeDays * 2 - 1).toISOString()

  const [
    openConvCur,
    newConvCurrent,
    newConvPrevious,
    newContactsCurrent,
    newContactsPrevious,
    openDeals,
    messagesCurrent,
    messagesPrevious,
  ] = await Promise.all([
    db.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gte('created_at', currentStart),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .gte('created_at', previousStart)
      .lt('created_at', currentStart),
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', currentStart),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', previousStart)
      .lt('created_at', currentStart),
    db.from('deals').select('value, status').eq('status', 'open'),
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_type', 'agent')
      .gte('created_at', currentStart),
    db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_type', 'agent')
      .gte('created_at', previousStart)
      .lt('created_at', currentStart),
  ])

  const openDealsRows = (openDeals.data ?? []) as { value: number | null }[]
  const openDealsValue = openDealsRows.reduce((sum, d) => sum + (d.value ?? 0), 0)

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      // "vs previous period" on a current-state count has no clean
      // answer without snapshots — we show the delta in NEW open
      // conversations this period vs the one before it instead.
      previous: (newConvCurrent.count ?? 0) - (newConvPrevious.count ?? 0),
    },
    newContactsToday: {
      current: newContactsCurrent.count ?? 0,
      previous: newContactsPrevious.count ?? 0,
    },
    openDealsValue,
    openDealsCount: openDealsRows.length,
    messagesSentToday: {
      current: messagesCurrent.count ?? 0,
      previous: messagesPrevious.count ?? 0,
    },
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1).toISOString()
  const { data, error } = await db
    .from('messages')
    .select('created_at, sender_type')
    .gte('created_at', start)
    .order('created_at', { ascending: true })
  if (error) throw error

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of (data ?? []) as { created_at: string; sender_type: string }[]) {
    const key = localDayKey(row.created_at)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1 // agent + bot both count as outgoing
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(db: DB): Promise<PipelineDonutData> {
  const [stagesRes, dealsRes] = await Promise.all([
    db.from('pipeline_stages').select('id, name, color, pipeline_id, position').order('position'),
    db.from('deals').select('stage_id, value, status').eq('status', 'open'),
  ])

  const stages =
    (stagesRes.data ?? []) as { id: string; name: string; color: string }[]
  const deals = (dealsRes.data ?? []) as { stage_id: string; value: number | null }[]

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += d.value ?? 0
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    // Hide empty stages from the ring (but we'd still show them in the
    // legend if the user wanted a full breakdown — trimming keeps the
    // visual clean for the common case).
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- 4. Response time over the selected range --------------------------

export async function loadResponseTime(db: DB, range: DateRange): Promise<ResponseTimeSummary> {
  // Pull messages spanning both the selected period AND the equal-
  // length period before it in one shot, then walk per conversation
  // to find each "first inbound" → "first subsequent outbound" pair.
  const currentStart = range.start
  const previousStart = previousRange(range).start
  const { data, error } = await db
    .from('messages')
    .select('conversation_id, sender_type, created_at')
    .gte('created_at', previousStart.toISOString())
    .lt('created_at', range.end.toISOString())
    .order('conversation_id', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = (data ?? []) as {
    conversation_id: string
    sender_type: string
    created_at: string
  }[]

  // Group per conversation, pair unreplied customer messages with the
  // next outbound message from the agent/bot. A single customer message
  // can only count once (avoids inflating averages if the customer
  // double-messages while the agent takes time to reply).
  interface Sample {
    customerAt: Date
    responseAt: Date
  }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const currentMins: number[] = []
  const previousMins: number[] = []
  const withDiff = samples
    .map((s) => ({ ...s, diffMin: (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000 }))
    .filter((s) => s.diffMin >= 0)

  for (const s of withDiff) {
    if (s.customerAt >= currentStart) {
      currentMins.push(s.diffMin)
    } else if (s.customerAt >= previousStart) {
      previousMins.push(s.diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  // Bucket the CURRENT period into up to 30 display points (1/bucket
  // for a short period, multi-day buckets for a quarter/year/all-time
  // period — see rangeBuckets' doc comment).
  const buckets: ResponseTimeBucket[] = rangeBuckets(range).map((b) => {
    const inBucket = withDiff
      .filter((s) => s.customerAt >= b.start && s.customerAt < b.end)
      .map((s) => s.diffMin)
    return { label: b.label, avgMinutes: avg(inBucket), samples: inBucket.length }
  })

  return {
    buckets,
    currentAvg: avg(currentMins),
    previousAvg: avg(previousMins),
  }
}

// --- 5. HOT leads waiting on a reply ------------------------------------

const MAX_HOT_CANDIDATES = 30

/**
 * Open conversations with a HOT-scored contact whose last message is
 * from the customer and still unanswered — the dashboard's "Juana
 * +15m sin respuesta" card. Read-only sibling of
 * `runHotLeadAlertScan` (src/lib/notifications/hot-lead-alerts.ts),
 * which does the same candidate scan to raise notifications; this one
 * just surfaces the live list, sorted longest-waiting first, and
 * never writes anything.
 */
export async function loadHotUnanswered(db: DB, limit = 6): Promise<HotUnansweredItem[]> {
  const { data: candidates, error } = await db
    .from('conversations')
    .select('id, contacts!inner(name, phone, lead_score)')
    .eq('status', 'open')
    .eq('contacts.lead_score', 'hot')
    .limit(MAX_HOT_CANDIDATES)
  if (error) throw error
  if (!candidates || candidates.length === 0) return []

  type Candidate = {
    id: string
    contacts:
      | { name: string | null; phone: string }[]
      | { name: string | null; phone: string }
      | null
  }

  const now = Date.now()
  const results = await Promise.all(
    (candidates as unknown as Candidate[]).map(async (conv) => {
      const { data: lastMessage } = await db
        .from('messages')
        .select('sender_type, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      // No message yet, or we already had the last word — not waiting.
      if (!lastMessage || lastMessage.sender_type !== 'customer') return null

      const contact = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts
      const waitingMinutes = Math.round((now - new Date(lastMessage.created_at).getTime()) / 60_000)
      return {
        conversationId: conv.id,
        contactName: contact?.name || contact?.phone || '—',
        waitingMinutes,
      } satisfies HotUnansweredItem
    }),
  )

  return results
    .filter((r): r is HotUnansweredItem => r !== null)
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes)
    .slice(0, limit)
}

