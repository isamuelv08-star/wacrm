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
  FollowupSummary,
  HotUnansweredItem,
  LeadsQualifiedToday,
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


// --- 6. Leads qualified today --------------------------------------------

/**
 * Today's lead-qualification breakdown, local-day boundary
 * (see `daysAgoStart`). Counts every contact the AI (or a manual
 * override) actually assessed today, via `lead_score_assessed_at`
 * (migration 064) — deliberately NOT `lead_score_updated_at`, which
 * only moves on a real value change and would silently miss every
 * lead the AI correctly re-confirmed in the same bucket it was
 * already in (exactly the steady HOT leads worth showing off).
 */
export async function loadLeadsQualifiedToday(db: DB): Promise<LeadsQualifiedToday> {
  const todayStart = daysAgoStart(0).toISOString()

  const [hot, warm, cold] = await Promise.all([
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('lead_score', 'hot')
      .gte('lead_score_assessed_at', todayStart),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('lead_score', 'warm')
      .gte('lead_score_assessed_at', todayStart),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('lead_score', 'cold')
      .gte('lead_score_assessed_at', todayStart),
  ])

  return {
    hot: hot.count ?? 0,
    warm: warm.count ?? 0,
    cold: cold.count ?? 0,
  }
}

// Cap on how many "no stage yet" candidate deals get the N+1
// last-message lookup below, same reasoning as MAX_HOT_CANDIDATES.
const MAX_FOLLOWUP_CANDIDATES = 50

/**
 * Open deals currently sitting in a "Seguimiento" stage (any stage
 * flagged `is_followup_stage`, migration 077), grouped by the
 * contact's hot/warm/cold `lead_score` — the Dashboard/Pipeline
 * "Seguimiento" cards. Pass `pipelineId` to scope to one pipeline
 * (used by the Pipelines page's own card); omitted, it covers every
 * pipeline in the account (the Dashboard card) — RLS already scopes
 * `pipelines` to the caller's account, same posture as every other
 * query in this file.
 *
 * A pipeline that hasn't had the stage created yet doesn't just read
 * empty: its open deals are scanned for the same "gone quiet" signal
 * the `no_reply_elapsed` automation condition uses (last message not
 * from the customer, elapsed >= the account's `followup_after_hours`,
 * migration 078) and surfaced as `isCandidate: true` items, still
 * sitting in their real current stage. `pipelinesWithoutStage` lists
 * which pipelines in scope need the one-click "create the stage" CTA.
 *
 * A lead whose contact has no `lead_score` yet (never assessed) isn't
 * placed in any bucket — same convention as `loadLeadsQualifiedToday`,
 * which only counts assessed contacts.
 */
export async function loadFollowupLeads(db: DB, opts?: { pipelineId?: string }): Promise<FollowupSummary> {
  let pipelineQuery = db
    .from('pipelines')
    .select('id, name, account_id, accounts!inner(followup_after_hours)')
  if (opts?.pipelineId) pipelineQuery = pipelineQuery.eq('id', opts.pipelineId)
  const { data: pipelineRows, error: pipelinesErr } = await pipelineQuery
  if (pipelinesErr) throw pipelinesErr
  const empty: FollowupSummary = { hot: [], warm: [], cold: [], pipelinesWithoutStage: [] }
  if (!pipelineRows || pipelineRows.length === 0) return empty

  type PipelineRow = {
    id: string
    name: string
    account_id: string
    accounts: { followup_after_hours: number } | { followup_after_hours: number }[] | null
  }
  const pipelineMeta = new Map(
    (pipelineRows as PipelineRow[]).map((p) => {
      const acct = Array.isArray(p.accounts) ? p.accounts[0] : p.accounts
      return [p.id, { name: p.name, followupAfterHours: acct?.followup_after_hours ?? 0 }]
    }),
  )
  const pipelineIds = Array.from(pipelineMeta.keys())

  const { data: stages, error: stagesErr } = await db
    .from('pipeline_stages')
    .select('id, name, pipeline_id')
    .eq('is_followup_stage', true)
    .in('pipeline_id', pipelineIds)
  if (stagesErr) throw stagesErr

  type StageRow = { id: string; name: string; pipeline_id: string }
  const stageMeta = new Map((stages as StageRow[] ?? []).map((s) => [s.id, s]))
  const stageIds = Array.from(stageMeta.keys())
  const pipelinesWithStageIds = new Set((stages as StageRow[] ?? []).map((s) => s.pipeline_id))
  const pipelinesWithoutStage = pipelineIds
    .filter((id) => !pipelinesWithStageIds.has(id))
    .map((id) => ({ id, name: pipelineMeta.get(id)?.name ?? '' }))

  const summary: FollowupSummary = { hot: [], warm: [], cold: [], pipelinesWithoutStage }
  const now = Date.now()

  // --- Pipelines that already have the stage: read the real deals in it. ---
  if (stageIds.length > 0) {
    const { data: deals, error: dealsErr } = await db
      .from('deals')
      .select('id, contact_id, conversation_id, pipeline_id, stage_id, contacts(name, phone, lead_score)')
      .in('stage_id', stageIds)
      .eq('status', 'open')
    if (dealsErr) throw dealsErr

    type ContactJoin = { name: string | null; phone: string; lead_score: string | null } | { name: string | null; phone: string; lead_score: string | null }[] | null
    type DealRow = {
      id: string
      contact_id: string | null
      conversation_id: string | null
      pipeline_id: string
      stage_id: string
      contacts: ContactJoin
    }
    const dealRows = (deals ?? []) as DealRow[]
    const dealIds = dealRows.map((d) => d.id)

    // Most recent placement into this stage per deal, for "days waiting".
    const enteredAt = new Map<string, string>()
    if (dealIds.length > 0) {
      const { data: history } = await db
        .from('deal_stage_history')
        .select('deal_id, changed_at')
        .in('deal_id', dealIds)
        .in('to_stage_id', stageIds)
        .order('changed_at', { ascending: false })
      for (const row of (history ?? []) as { deal_id: string; changed_at: string }[]) {
        if (!enteredAt.has(row.deal_id)) enteredAt.set(row.deal_id, row.changed_at)
      }
    }

    for (const d of dealRows) {
      const contact = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts
      const score = contact?.lead_score
      if (score !== 'hot' && score !== 'warm' && score !== 'cold') continue
      const stage = stageMeta.get(d.stage_id)
      const changedAt = enteredAt.get(d.id)
      const daysInStage = changedAt ? Math.max(0, Math.floor((now - new Date(changedAt).getTime()) / 86_400_000)) : 0
      summary[score].push({
        dealId: d.id,
        contactId: d.contact_id,
        contactName: contact?.name ?? null,
        phone: contact?.phone ?? null,
        conversationId: d.conversation_id,
        pipelineId: d.pipeline_id,
        pipelineName: pipelineMeta.get(d.pipeline_id)?.name ?? '',
        stageId: d.stage_id,
        stageName: stage?.name ?? '',
        daysInStage,
      })
    }
  }

  // --- Pipelines without the stage yet: compute "gone quiet" candidates. ---
  const candidatePipelineIds = pipelinesWithoutStage
    .map((p) => p.id)
    .filter((id) => (pipelineMeta.get(id)?.followupAfterHours ?? 0) > 0)
  if (candidatePipelineIds.length > 0) {
    const { data: candidates } = await db
      .from('deals')
      .select('id, contact_id, conversation_id, pipeline_id, stage_id, contacts!inner(name, phone, lead_score), pipeline_stages(name)')
      .in('pipeline_id', candidatePipelineIds)
      .eq('status', 'open')
      .not('contacts.lead_score', 'is', null)
      .limit(MAX_FOLLOWUP_CANDIDATES)

    type ContactJoin = { name: string | null; phone: string; lead_score: string | null } | { name: string | null; phone: string; lead_score: string | null }[] | null
    type StageJoin = { name: string } | { name: string }[] | null
    type CandidateRow = {
      id: string
      contact_id: string | null
      conversation_id: string | null
      pipeline_id: string
      stage_id: string
      contacts: ContactJoin
      pipeline_stages: StageJoin
    }

    await Promise.all(
      ((candidates ?? []) as CandidateRow[]).map(async (d) => {
        if (!d.conversation_id) return
        const contact = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts
        const score = contact?.lead_score
        if (score !== 'hot' && score !== 'warm' && score !== 'cold') return
        const thresholdHours = pipelineMeta.get(d.pipeline_id)?.followupAfterHours ?? 0
        if (thresholdHours <= 0) return

        const { data: lastMessage } = await db
          .from('messages')
          .select('sender_type, created_at')
          .eq('conversation_id', d.conversation_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!lastMessage || lastMessage.sender_type === 'customer') return
        const elapsedMs = now - new Date(lastMessage.created_at).getTime()
        if (elapsedMs < thresholdHours * 3_600_000) return

        const stage = Array.isArray(d.pipeline_stages) ? d.pipeline_stages[0] : d.pipeline_stages
        summary[score].push({
          dealId: d.id,
          contactId: d.contact_id,
          contactName: contact?.name ?? null,
          phone: contact?.phone ?? null,
          conversationId: d.conversation_id,
          pipelineId: d.pipeline_id,
          pipelineName: pipelineMeta.get(d.pipeline_id)?.name ?? '',
          stageId: d.stage_id,
          stageName: stage?.name ?? '',
          daysInStage: Math.max(0, Math.floor(elapsedMs / 86_400_000)),
          isCandidate: true,
        })
      }),
    )
  }

  // Longest-waiting first within each bucket — the most overdue retry.
  for (const bucket of [summary.hot, summary.warm, summary.cold]) {
    bucket.sort((a, b) => b.daysInStage - a.daysInStage)
  }
  return summary
}
