import type { SupabaseClient } from '@supabase/supabase-js'
import { canViewDashboardSection, type AccountRole, type DashboardPermissions } from '@/lib/auth/roles'
import { rangeForPreset } from '@/lib/period'
import { formatCurrency } from '@/lib/currency'
import {
  loadCeoMetrics,
  loadCommercialMetrics,
  loadTopSellers,
  loadLeadsByRep,
  loadCeoAlerts,
} from '@/lib/dashboard/ceo-queries'

type DB = SupabaseClient

/**
 * Everything the sidebar assistant is allowed to know about "right
 * now", flattened into a plain-English block the system prompt feeds
 * the model as reference context (same posture as the customer-facing
 * bot's `knowledge` param in `buildSystemPrompt` — untrusted data, not
 * instructions).
 *
 * Gating mirrors the CEO dashboard exactly (`canViewDashboardSection`,
 * migration 054): a viewer/agent who can't see e.g. Top Sellers on
 * `/dashboard` must not learn those numbers by asking the assistant
 * either. The two always-on blocks (contacts, conversations) aren't
 * behind a dashboard permission key because they're the same
 * operational counts every role already sees on the plain dashboard.
 */
export async function buildAssistantSnapshot(args: {
  db: DB
  role: AccountRole
  userId: string
  currency: string
}): Promise<string> {
  const { db, role, userId, currency } = args
  const isOwner = role === 'owner'

  const permsRow = await db
    .from('profiles')
    .select('dashboard_permissions')
    .eq('user_id', userId)
    .maybeSingle()
  const permissions = (permsRow.data?.dashboard_permissions ?? null) as DashboardPermissions | null

  const can = (key: Parameters<typeof canViewDashboardSection>[2]) =>
    isOwner || canViewDashboardSection(role, permissions, key)

  const sections: string[] = []

  // --- Always-on: contacts + conversations (same as the plain, non-CEO
  // part of /dashboard — visible to every role). ---
  const [hotRes, warmRes, coldRes, totalContactsRes, openConvRes] = await Promise.all([
    db.from('contacts').select('id', { count: 'exact', head: true }).eq('lead_score', 'hot'),
    db.from('contacts').select('id', { count: 'exact', head: true }).eq('lead_score', 'warm'),
    db.from('contacts').select('id', { count: 'exact', head: true }).eq('lead_score', 'cold'),
    db.from('contacts').select('id', { count: 'exact', head: true }),
    db.from('conversations').select('id', { count: 'exact', head: true }).neq('status', 'closed'),
  ])
  sections.push(
    [
      'CONTACTS & CONVERSATIONS (live counts):',
      `- Total contacts: ${totalContactsRes.count ?? 0}`,
      `- HOT leads: ${hotRes.count ?? 0}`,
      `- WARM leads: ${warmRes.count ?? 0}`,
      `- COLD leads: ${coldRes.count ?? 0}`,
      `- Open conversations: ${openConvRes.count ?? 0}`,
    ].join('\n'),
  )

  const hasAnySalesAccess =
    can('salesKpis') ||
    can('salesVsGoal') ||
    can('commercialMetrics') ||
    can('topSellers') ||
    can('leadsByRep') ||
    can('alerts')

  if (hasAnySalesAccess) {
    const range = rangeForPreset('thisMonth')
    const money = (n: number) => formatCurrency(n, currency)

    if (can('salesKpis') || can('salesVsGoal')) {
      const m = await loadCeoMetrics(db, range)
      sections.push(
        [
          'SALES & MONTHLY GOAL (this calendar month):',
          `- Revenue closed this month: ${money(m.salesThisMonth.current)} (previous month: ${money(m.salesThisMonth.previous)})`,
          m.goalThisMonth != null
            ? `- Configured monthly goal: ${money(m.goalThisMonth)}`
            : '- No monthly goal configured for this account.',
          m.goalAttainmentPct != null
            ? `- Goal attainment so far: ${m.goalAttainmentPct.toFixed(1)}%`
            : null,
          `- Open pipeline value: ${money(m.pipelineTotal)}`,
          m.pipelineCoverage != null ? `- Pipeline coverage: ${m.pipelineCoverage.toFixed(1)}x the goal` : null,
          `- Weighted forecast: ${money(m.forecast)}`,
          m.forecastPct != null ? `- Forecast vs goal: ${m.forecastPct.toFixed(0)}%` : null,
          `- New clients this month: ${m.newClients.current} (previous month: ${m.newClients.previous})`,
          `- Total clients (all time, with at least one deal): ${m.totalClients}`,
          '- Note: this account only tracks a MONTHLY goal, not a weekly one. If asked about "this week\'s goal", explain that and give the month-to-date pace instead.',
        ]
          .filter((l): l is string => l != null)
          .join('\n'),
      )
    }

    if (can('commercialMetrics')) {
      const c = await loadCommercialMetrics(db)
      sections.push(
        [
          'COMMERCIAL METRICS (trailing 90 days):',
          c.winRatePct != null ? `- Win rate: ${c.winRatePct.toFixed(0)}%` : '- Win rate: no closed deals yet.',
          `- Average deal (ticket) size: ${money(c.avgTicket)}`,
          c.avgSalesCycleDays != null
            ? `- Average sales cycle: ${Math.round(c.avgSalesCycleDays)} days`
            : null,
        ]
          .filter((l): l is string => l != null)
          .join('\n'),
      )
    }

    if (can('topSellers')) {
      const top = await loadTopSellers(db, range, 5)
      sections.push(
        top.length > 0
          ? [
              'TOP SELLERS (this month):',
              ...top.map(
                (s, i) =>
                  `${i + 1}. ${s.name}: ${money(s.soldThisMonth)}${
                    s.attainmentPct != null ? ` (${s.attainmentPct.toFixed(0)}% of their goal)` : ''
                  }`,
              ),
            ].join('\n')
          : 'TOP SELLERS: nobody has closed a deal yet this month.',
      )
    }

    if (can('leadsByRep')) {
      const byRep = await loadLeadsByRep(db)
      sections.push(
        byRep.length > 0
          ? [
              'LEAD LOAD PER REP (current, right now):',
              ...byRep.map(
                (r) => `- ${r.name}: ${r.assignedConversations} open conversations, ${r.assignedDeals} open deals`,
              ),
            ].join('\n')
          : 'LEAD LOAD PER REP: no leads currently assigned to anyone.',
      )
    }

    if (can('alerts')) {
      const metrics = await loadCeoMetrics(db, range)
      const a = await loadCeoAlerts(db, metrics)
      const alertLines = [
        a.stalledCount > 0 ? `- ${a.stalledCount} stalled open deal(s) worth ${money(a.stalledValue)}` : null,
        a.atRiskCustomerCount > 0 ? `- ${a.atRiskCustomerCount} at-risk customer(s) gone quiet` : null,
        a.forecastGapPct != null ? `- Forecast is ${Math.abs(a.forecastGapPct).toFixed(0)}% short of goal` : null,
        a.winRateDeclinePts != null ? `- Win rate down ${a.winRateDeclinePts.toFixed(0)} points vs the prior period` : null,
        a.salesCycleIncreasePct != null
          ? `- Sales cycle lengthened ${a.salesCycleIncreasePct.toFixed(0)}% vs the prior period`
          : null,
        a.lowPipelineCoverage != null
          ? `- Pipeline coverage is low (${a.lowPipelineCoverage.toFixed(1)}x the goal)`
          : null,
      ].filter((l): l is string => l != null)
      sections.push(
        alertLines.length > 0
          ? ['ACTIVE ALERTS:', ...alertLines].join('\n')
          : 'ACTIVE ALERTS: none — nothing currently flagged.',
      )
    }
  }

  return sections.join('\n\n')
}
