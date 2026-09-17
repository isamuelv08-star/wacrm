import type { AtRiskOpenDeal, StalledOpenDeal } from '../dashboard/ceo-queries'

// ============================================================
// Next Best Action (fase 3, extended in fase 5 with a third action
// type) — turns the per-deal signals Money at Risk (fase 2) already
// aggregates (stalled deals, at-risk silent customers) plus overdue
// promises (fase 4) into a short, ranked, capped list of concrete
// things to do — "acción/motivo/evidencia/urgencia" per opportunity,
// per the Auditoría Saleslid, instead of a feed someone has to dig
// through. This IS the Sales Leak Detector's seller-facing half — see
// risk-engine.ts's `broken_promises` signal for the manager-facing
// aggregate of the same underlying data.
//
// Account-wide, not per-seller — same visibility model as the
// existing FollowupCard/HotUnansweredCard (RLS-scoped, no personal
// filter): at this product's current scale (small sales teams) a
// shared, prioritized "do these first" list serves the whole team
// better than inventing a new "assigned to me" visibility mode with
// no precedent elsewhere on the dashboard. Each item still names its
// assignee, so a multi-seller account can tell whose it is.
//
// Pure function: no I/O, tested with plain objects — same split as
// rules.ts (fase 1) and aggregate.ts (fase 2).
// ============================================================

export type NextBestActionType = 'follow_up_stalled' | 're_engage_silent' | 'fulfill_broken_promise'
export type NextBestActionUrgency = 'high' | 'medium' | 'low'

export interface NextBestAction {
  /** Unique key across every action type — `dealId` for the first two
   *  types, `promiseId` for the third (a broken promise has no deal
   *  of its own). Use this for React keys / dedup, never `dealId`
   *  directly, since it's null for promise-based actions. */
  id: string
  dealId: string | null
  promiseId: string | null
  contactId: string | null
  conversationId: string | null
  /** profiles.id, uniformly — see OverduePromise's doc comment for
   *  why that conversion matters here. */
  assignedTo: string | null
  type: NextBestActionType
  urgency: NextBestActionUrgency
  daysInactive: number
  value: number | null
}

/**
 * A promise (fase 4) past its due date, pre-resolved to display-ready
 * fields. `assignedTo` MUST already be profiles.id by the time it
 * reaches this module — `promises.promised_by` is auth.users.id (it
 * snapshots conversations.assigned_agent_id, which uses that
 * convention), a different id space than deals.assigned_to's
 * profiles.id. The query layer (queries.ts::findOverduePromises)
 * converts it before calling `buildNextBestActions`, so this pure
 * function never has to know about that distinction — exactly the
 * profiles.id-vs-auth.users.id bug class this codebase has hit before
 * (see loadTopSellers's own doc comment) if the two id spaces get
 * mixed without conversion.
 */
export interface OverduePromise {
  id: string
  conversationId: string
  contactId: string | null
  assignedTo: string | null
  dueAt: string
}

const DAY_MS = 86_400_000
// Hard cap — the explicit "no quiero 100 alertas" requirement. A
// manager or seller sees the top handful, not a scroll.
export const NEXT_BEST_ACTION_LIMIT = 6

const URGENCY_RANK: Record<NextBestActionUrgency, number> = { high: 3, medium: 2, low: 1 }

function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS))
}

/**
 * `stalledDeals`/`atRiskDeals`/`overduePromises` are expected to
 * already be filtered to their respective thresholds upstream
 * (findStalledOpenDeals/findAtRiskOpenDeals apply staleDays/
 * silenceDays; overduePromises only ever contains status='overdue'
 * rows) — the tiers below only decide HOW urgent an already-qualifying
 * item is, not whether it qualifies.
 */
export function buildNextBestActions(
  stalledDeals: StalledOpenDeal[],
  atRiskDeals: AtRiskOpenDeal[],
  overduePromises: OverduePromise[] = [],
  now: number = Date.now(),
): NextBestAction[] {
  const actions: NextBestAction[] = []
  const seenDealIds = new Set<string>()

  // At-risk (the customer itself has gone silent) takes priority over
  // a deal merely sitting in the same stage — when a deal trips both,
  // one action is enough, and re-engaging the actual person is the
  // more urgent framing of the two.
  for (const d of atRiskDeals) {
    if (!d.lastMessageAt) continue
    const days = daysSince(d.lastMessageAt, now)
    actions.push({
      id: d.id,
      dealId: d.id,
      promiseId: null,
      contactId: d.contactId,
      conversationId: d.conversationId,
      assignedTo: d.assignedTo,
      type: 're_engage_silent',
      urgency: days >= 30 ? 'high' : days >= 21 ? 'medium' : 'low',
      daysInactive: days,
      value: d.value,
    })
    seenDealIds.add(d.id)
  }

  for (const d of stalledDeals) {
    if (seenDealIds.has(d.id)) continue
    const days = daysSince(d.lastStageChangeAt, now)
    actions.push({
      id: d.id,
      dealId: d.id,
      promiseId: null,
      contactId: d.contactId,
      conversationId: d.conversationId,
      assignedTo: d.assignedTo,
      type: 'follow_up_stalled',
      urgency: days >= 21 ? 'high' : days >= 14 ? 'medium' : 'low',
      daysInactive: days,
      value: d.value,
    })
    seenDealIds.add(d.id)
  }

  // Broken promises live in their own id space (no deal to dedupe
  // against) — a conversation can legitimately have both a stalled
  // deal AND a broken promise, and both are real, distinct reasons to
  // act, so no cross-type dedup here, only defending against the same
  // promise appearing twice within its own list.
  const seenPromiseIds = new Set<string>()
  for (const p of overduePromises) {
    if (seenPromiseIds.has(p.id)) continue
    seenPromiseIds.add(p.id)
    const days = daysSince(p.dueAt, now)
    actions.push({
      id: p.id,
      dealId: null,
      promiseId: p.id,
      contactId: p.contactId,
      conversationId: p.conversationId,
      assignedTo: p.assignedTo,
      type: 'fulfill_broken_promise',
      urgency: days >= 2 ? 'high' : days >= 1 ? 'medium' : 'low',
      daysInactive: days,
      value: null,
    })
  }

  return actions
    .sort((a, b) => {
      const urgencyDiff = URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]
      if (urgencyDiff !== 0) return urgencyDiff
      return (b.value ?? 0) - (a.value ?? 0)
    })
    .slice(0, NEXT_BEST_ACTION_LIMIT)
}
