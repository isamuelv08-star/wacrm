import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/notifications/admin-client'
import { mineAdvisorExamples } from '@/lib/ai/learning'

const STATUSES = ['pending', 'approved', 'rejected'] as const
type Status = (typeof STATUSES)[number]

/**
 * GET /api/ai/learned-examples?status=pending
 *
 * The examples the AI learned from the advisors (migration 116), one
 * status at a time, plus per-status counts and the learning switch.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const raw = new URL(request.url).searchParams.get('status')
    const status: Status = STATUSES.includes(raw as Status) ? (raw as Status) : 'pending'

    const [list, cfg, ...counts] = await Promise.all([
      supabase
        .from('ai_learned_examples')
        .select('id, customer_text, advisor_reply, outcome, status, created_at')
        .eq('account_id', accountId)
        .eq('status', status)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('ai_configs').select('learning_enabled').eq('account_id', accountId).maybeSingle(),
      ...STATUSES.map((s) =>
        supabase
          .from('ai_learned_examples')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('status', s),
      ),
    ])
    if (list.error) {
      // Pre-116 database: the feature just isn't there yet.
      return NextResponse.json({ available: false, examples: [], counts: {}, learningEnabled: false })
    }
    return NextResponse.json({
      available: true,
      examples: list.data ?? [],
      counts: Object.fromEntries(STATUSES.map((s, i) => [s, counts[i].count ?? 0])),
      learningEnabled: cfg.data?.learning_enabled !== false,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/learned-examples  (admin+)
 *   { learningEnabled: boolean }  — turn learning on/off
 *   { approveAllPending: true }   — approve every pending example
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)

    if (typeof body?.learningEnabled === 'boolean') {
      const { error } = await supabase
        .from('ai_configs')
        .update({ learning_enabled: body.learningEnabled })
        .eq('account_id', accountId)
      if (error) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    if (body?.approveAllPending === true) {
      const { error } = await supabase
        .from('ai_learned_examples')
        .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: userId })
        .eq('account_id', accountId)
        .eq('status', 'pending')
      if (error) return NextResponse.json({ error: 'Failed to approve' }, { status: 500 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/learned-examples  (admin+)
 *
 * "Learn now": mine the last 30 days of this account's advisor replies
 * right away instead of waiting for the nightly job.
 */
export async function POST() {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-learn:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    // Service role: the miner reads messages across the account's
    // conversations and inserts (members have no INSERT policy).
    const result = await mineAdvisorExamples(supabaseAdmin(), { accountId, sinceHours: 30 * 24 })
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
