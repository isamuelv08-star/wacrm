import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { buildAssistantSnapshot } from '@/lib/ai/assistant-snapshot'
import { buildAssistantSystemPrompt } from '@/lib/ai/assistant-prompt'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { DEFAULT_CURRENCY } from '@/lib/currency'

// Keep the transcript bounded, same posture as the playground route.
const MAX_TURNS = 12

/**
 * POST /api/ai/assistant  (viewer+)
 *
 * The sidebar "ask your CRM" widget — a logged-in team member asking
 * about their own account's live data (hot leads, sales vs goal,
 * alerts, ...), not a customer-facing conversation. Reuses the
 * account's own BYO provider key (same one Setup configures for
 * drafts/auto-reply) but builds its own permission-scoped data
 * snapshot and system prompt instead of the customer-facing one —
 * see `assistant-snapshot.ts` / `assistant-prompt.ts`.
 *
 * `requireActive:false` on purpose: the `is_active` master switch
 * gates the WhatsApp-facing bot going live, not this internal tool —
 * same reasoning the Playground route already uses.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('viewer')
    const { supabase, accountId, userId, role } = ctx

    const userLimit = checkRateLimit(`ai-assistant:${userId}`, RATE_LIMITS.aiAssistant)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(`ai-assistant-account:${accountId}`, RATE_LIMITS.aiAssistantAccount)
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json({ error: 'Send a message to ask the assistant.' }, { status: 400 })
    }

    const config = await loadAiConfig(supabase, accountId, { requireActive: false }).catch((err) => {
      console.error('[ai/assistant] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No AI provider configured yet. Add your API key in Settings.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const currencyRow = await supabase.from('accounts').select('default_currency').eq('id', accountId).maybeSingle()
    const currency = (currencyRow.data as { default_currency: string } | null)?.default_currency ?? DEFAULT_CURRENCY

    const snapshot = await buildAssistantSnapshot({ db: supabase, role, userId, currency })
    const systemPrompt = buildAssistantSystemPrompt({
      accountName: ctx.account.name,
      snapshot,
    })

    const { text } = await generateReply({ config, systemPrompt, messages })
    return NextResponse.json({ reply: text })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
