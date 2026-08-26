import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { applyLeadScore } from '@/lib/ai/lead-scoring';
import type { LeadScore } from '@/lib/ai/types';

const VALID_SCORES: readonly LeadScore[] = ['hot', 'warm', 'cold'];

function isLeadScore(value: unknown): value is LeadScore {
  return typeof value === 'string' && (VALID_SCORES as readonly string[]).includes(value);
}

/**
 * Last 20 lead_score_history rows for this contact (migration 061) —
 * powers the "score history" timeline in the contact detail view.
 * Scoped by RLS (`lead_score_history_select`, any account member) plus
 * an explicit account_id filter as defense in depth, same posture as
 * every other account-scoped query in this codebase.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const { data, error } = await ctx.supabase
      .from('lead_score_history')
      .select('id, old_score, new_score, reason, source, changed_by, created_at')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[lead-score history] fetch failed:', error);
      return NextResponse.json({ error: 'Failed to load score history' }, { status: 500 });
    }

    // `lead_score_history.changed_by` references auth.users, not
    // profiles, so there's no FK PostgREST can embed directly — resolve
    // display names with a second, tiny lookup instead.
    const agentIds = [...new Set((data ?? []).map((h) => h.changed_by).filter((id): id is string => !!id))];
    const namesById = new Map<string, string>();
    if (agentIds.length > 0) {
      const { data: profiles } = await ctx.supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', agentIds);
      for (const p of profiles ?? []) {
        if (p.full_name) namesById.set(p.user_id, p.full_name);
      }
    }

    const history = (data ?? []).map((h) => ({
      ...h,
      changed_by_name: h.changed_by ? (namesById.get(h.changed_by) ?? null) : null,
    }));

    return NextResponse.json({ history });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Manual override — an agent correcting a wrong (or stale) AI verdict.
 * Reuses `applyLeadScore` (the same function the AI paths call) so
 * there's a single place that ever writes `contacts.lead_score` and its
 * side effects (qualified-stage deal advance for HOT). Runs on the
 * request-scoped (RLS) Supabase client rather than the service-role
 * admin client so `auth.uid()` resolves inside the `on_lead_score_change`
 * DB trigger, correctly attributing `lead_score_history.changed_by` to
 * this agent.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;

    const body = (await request.json().catch(() => null)) as {
      score?: unknown;
      reason?: unknown;
    } | null;

    if (!isLeadScore(body?.score)) {
      return NextResponse.json(
        { error: 'score must be one of "hot", "warm", "cold"' },
        { status: 400 },
      );
    }
    const reason =
      typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

    await applyLeadScore(ctx.supabase, {
      accountId: ctx.accountId,
      contactId,
      configOwnerUserId: ctx.userId,
      score: body.score,
      reason,
      source: 'manual',
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
