import type { SupabaseClient } from '@supabase/supabase-js'
import { parseQuoteRequest, type CatalogHit } from './catalog'
import { createQuote, sendQuoteAsBot } from '@/lib/quotes/service'

/**
 * Applies [[SEND_QUOTE: P1 x 4; …]] (migration 121): builds a quote from
 * the catalog products the prompt listed this turn — catalog prices
 * only, no discounts — and sends the PDF as a bot message. Best-effort,
 * never throws: the text reply has already gone out.
 */

/** AI quotes per conversation per rolling day. */
const MAX_AI_QUOTES_PER_DAY = 3

export async function applyAiQuote(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    contactId: string
    configOwnerUserId: string
    request: string
    catalog: CatalogHit[]
  },
): Promise<void> {
  try {
    const byCode = new Map(args.catalog.map((p) => [p.code, p]))
    const items = parseQuoteRequest(args.request)
      .map((i) => ({ product: byCode.get(i.code), quantity: i.quantity }))
      .filter((i): i is { product: CatalogHit; quantity: number } => !!i.product)
    if (!items.length) {
      console.warn(`[ai quote] "${args.request}" named no product from this turn's catalog — not sending.`)
      return
    }

    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { data: recent } = await db
      .from('quotes')
      .select('id, items:quote_items(product_id, quantity)')
      .eq('conversation_id', args.conversationId)
      .eq('created_by_ai', true)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
    const recentQuotes = (recent ?? []) as { id: string; items: { product_id: string | null; quantity: number }[] }[]
    if (recentQuotes.length >= MAX_AI_QUOTES_PER_DAY) {
      console.warn(`[ai quote] conversation ${args.conversationId} hit the daily AI quote limit.`)
      return
    }
    const signature = (list: { id: string | null; qty: number }[]) =>
      list
        .map((i) => `${i.id}:${Number(i.qty)}`)
        .sort()
        .join('|')
    const wanted = signature(items.map((i) => ({ id: i.product.id, qty: i.quantity })))
    if (recentQuotes.some((q) => signature(q.items.map((i) => ({ id: i.product_id, qty: i.quantity }))) === wanted)) {
      return // same quote already sent today
    }

    const quote = await createQuote(db, db, {
      accountId: args.accountId,
      userId: null,
      contactId: args.contactId,
      conversationId: args.conversationId,
      createdByAi: true,
      lines: items.map((i) => ({
        productId: i.product.id,
        description: i.product.name,
        quantity: i.quantity,
        unitPrice: i.product.unitPrice,
        discountPct: 0,
      })),
    })
    await sendQuoteAsBot(db, {
      accountId: args.accountId,
      quoteId: quote.id,
      contactId: args.contactId,
      configOwnerUserId: args.configOwnerUserId,
    })
  } catch (err) {
    console.error('[ai quote] creating/sending the quote failed:', err)
  }
}
