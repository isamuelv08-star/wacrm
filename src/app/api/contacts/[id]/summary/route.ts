import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { logAiUsage } from '@/lib/ai/usage'
import { AiError } from '@/lib/ai/types'
import {
  buildTranscript,
  generateLeadSummary,
  isSummaryFresh,
  type LeadSummaryFacts,
  type TranscriptRow,
} from '@/lib/ai/lead-summary'

/**
 * POST /api/contacts/[id]/summary  (agent+)
 *
 * Body: { force?: boolean, locale?: string }
 * Returns: { summary: <contact_ai_summaries row>, cached: boolean }
 *
 * Generates (or returns the cached) AI executive summary of one lead.
 * A provider call happens ONLY when a newer message exists than the one
 * the cached summary was written from, the UI language changed, or the
 * caller passes `force` (the "refresh" button) — opening a lead whose
 * chat hasn't moved never spends tokens, no matter how many teammates
 * open it.
 *
 * Reads go through the caller's RLS-scoped client, so a seller in a
 * multi-WhatsApp account can't summarise a chat on someone else's
 * number. The cache row is written with the service role (the table has
 * no `authenticated` write policy).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contactId } = await params
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-lead-summary:${userId}`, RATE_LIMITS.aiLeadSummary)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `ai-lead-summary-acct:${accountId}`,
      RATE_LIMITS.aiLeadSummaryAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const force = body?.force === true
    const language = typeof body?.locale === 'string' && body.locale ? body.locale : 'en'

    const { data: contact, error: contactErr } = await supabase
      .from('contacts')
      .select('id, name, phone, lead_score, lead_score_reason')
      .eq('id', contactId)
      .maybeSingle()
    if (contactErr) {
      console.error('[contacts/summary] contact lookup error:', contactErr)
      return NextResponse.json({ error: 'Failed to load contact' }, { status: 500 })
    }
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const { data: conversations } = await supabase
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
    const conversationIds = (conversations ?? []).map((c: { id: string }) => c.id)

    const { data: recent, error: msgErr } = conversationIds.length
      ? await supabase
          .from('messages')
          .select('id, sender_type, content_type, content_text, ai_image_description, created_at')
          .in('conversation_id', conversationIds)
          .in('content_type', ['text', 'audio', 'image', 'video'])
          .order('created_at', { ascending: false })
          .limit(80)
      : { data: [], error: null }
    if (msgErr) {
      console.error('[contacts/summary] messages error:', msgErr)
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
    }
    const rows = (recent ?? []) as (TranscriptRow & { id: string })[]
    const latest = rows[0]
    if (!latest) {
      return NextResponse.json(
        { error: 'No messages to summarise yet.', code: 'no_messages' },
        { status: 400 },
      )
    }

    const { data: cached } = await supabase
      .from('contact_ai_summaries')
      .select('*')
      .eq('contact_id', contactId)
      .maybeSingle()

    if (!force && isSummaryFresh(cached, latest.id, language)) {
      return NextResponse.json({ summary: cached, cached: true })
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[contacts/summary] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'AI assistant is not set up. Enable it in Settings → AI Assistant.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const [intelRes, dealsRes, tagsRes, promisesRes] = await Promise.all([
      supabase
        .from('contact_intelligence')
        .select('need, budget, objection, product_interest')
        .eq('contact_id', contactId)
        .maybeSingle(),
      supabase
        .from('deals')
        .select('title, value, currency, status, stage:pipeline_stages(name)')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.from('contact_tags').select('tag:tags(name)').eq('contact_id', contactId),
      supabase
        .from('promises')
        .select('promise_text')
        .eq('contact_id', contactId)
        .in('status', ['pending', 'overdue'])
        .limit(3),
    ])

    const intel = intelRes.data as {
      need: string | null
      budget: string | null
      objection: string | null
      product_interest: string | null
    } | null
    const facts: LeadSummaryFacts = {
      name: contact.name ?? null,
      score: contact.lead_score ?? null,
      scoreReason: contact.lead_score_reason ?? null,
      need: intel?.need ?? null,
      budget: intel?.budget ?? null,
      objection: intel?.objection ?? null,
      productInterest: intel?.product_interest ?? null,
      deals: ((dealsRes.data ?? []) as unknown as {
        title: string
        value: number | null
        currency: string | null
        status: string | null
        stage: { name: string } | { name: string }[] | null
      }[]).map((d) => ({
        title: d.title,
        value: d.value,
        currency: d.currency,
        status: d.status,
        stage: (Array.isArray(d.stage) ? d.stage[0]?.name : d.stage?.name) ?? null,
      })),
      tags: ((tagsRes.data ?? []) as unknown as { tag: { name: string } | { name: string }[] | null }[])
        .map((t) => (Array.isArray(t.tag) ? t.tag[0]?.name : t.tag?.name))
        .filter((n): n is string => !!n),
      pendingPromises: ((promisesRes.data ?? []) as { promise_text: string }[]).map(
        (p) => p.promise_text,
      ),
    }

    const { summary, usage } = await generateLeadSummary({
      config,
      facts,
      transcript: buildTranscript(rows),
      language,
    })
    if (!summary) {
      return NextResponse.json(
        { error: 'The AI returned an unusable summary. Try again.', code: 'bad_response' },
        { status: 502 },
      )
    }

    const admin = supabaseAdmin()
    const { data: saved, error: saveErr } = await admin
      .from('contact_ai_summaries')
      .upsert({
        contact_id: contactId,
        account_id: accountId,
        summary: summary.summary,
        highlights: summary.highlights,
        next_step: summary.nextStep,
        source_message_id: latest.id,
        source_message_at: latest.created_at,
        language,
        generated_at: new Date().toISOString(),
      })
      .select()
      .single()
    if (saveErr) {
      console.error('[contacts/summary] save error:', saveErr)
      return NextResponse.json({ error: 'Failed to save summary' }, { status: 500 })
    }

    // Fire-and-forget usage accounting, same posture as /api/ai/draft.
    void logAiUsage(admin, {
      accountId,
      conversationId: null,
      mode: 'lead_summary',
      provider: config.provider,
      model: config.model,
      usage,
    })

    return NextResponse.json({ summary: saved, cached: false })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
