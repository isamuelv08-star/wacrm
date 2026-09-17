import type { AtRiskOpenDeal, StalledOpenDeal } from '../dashboard/ceo-queries'

// ============================================================
// Next Best Action (fase 3) — turns the same two per-deal signals
// Money at Risk (fase 2) already aggregates (stalled deals, at-risk
// silent customers) into a short, ranked, capped list of concrete
// things to do — "acción/motivo/evidencia/urgencia" per opportunity,
// per the Auditoría Saleslid, instead of a feed someone has to dig
// through.
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

export type NextBestActionType = 'follow_up_stalled' | 're_engage_silent'
export type NextBestActionUrgency = 'high' | 'medium' | 'low'

export interface NextBestAction {
  dealId: string
  contactId: string | null
  conversationId: string | null
  assignedTo: string | null
  type: NextBestActionType
  urgency: NextBestActionUrgency
  daysInactive: number
  value: number | null
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
 * `stalledDeals`/`atRiskDeals` are expected to already be filtered to
 * their respective thresholds (findStalledOpenDeals/findAtRiskOpenDeals
 * apply staleDays/silenceDays upstream) — the tiers below only decide
 * HOW urgent an already-qualifying item is, not whether it qualifies.
 */
export function buildNextBestActions(
  stalledDeals: StalledOpenDeal[],
  atRiskDeals: AtRiskOpenDeal[],
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
      dealId: d.id,
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
      dealId: d.id,
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

  return actions
    .sort((a, b) => {
      const urgencyDiff = URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency]
      if (urgencyDiff !== 0) return urgencyDiff
      return (b.value ?? 0) - (a.value ?? 0)
    })
    .slice(0, NEXT_BEST_ACTION_LIMIT)
}
