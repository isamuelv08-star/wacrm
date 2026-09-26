import type { SupabaseClient } from '@supabase/supabase-js'
import { computeQuoteTotals, round2, type QuoteLineInput } from './totals'
import { renderQuotePdf, type QuotePdfLabels } from './pdf'
import { quotePdfText } from '@/lib/i18n/server-text'
import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { engineSendMedia } from '@/lib/flows/meta-send'

/**
 * Quotes (migration 120). Numbering and PDF upload use the service-role
 * client (`admin`); everything a user reads or writes goes through their
 * own RLS client (`db`), so a quote can only ever touch the caller's
 * own account.
 */

export interface QuoteSettings {
  taxLabel: string
  taxRate: number
  pricesIncludeTax: boolean
  validityDays: number
  terms: string | null
  prefix: string
  currency: string
  businessName: string
}

export async function loadQuoteSettings(db: SupabaseClient, accountId: string): Promise<QuoteSettings> {
  const { data, error } = await db
    .from('accounts')
    .select('name, default_currency, quote_tax_label, quote_tax_rate, quote_prices_include_tax, quote_validity_days, quote_terms, quote_prefix')
    .eq('id', accountId)
    .single()
  if (error) throw error
  return {
    taxLabel: (data.quote_tax_label as string) || 'IVA',
    taxRate: Number(data.quote_tax_rate ?? 0),
    pricesIncludeTax: data.quote_prices_include_tax === true,
    validityDays: Number(data.quote_validity_days ?? 15),
    terms: (data.quote_terms as string | null) ?? null,
    prefix: (data.quote_prefix as string) || 'COT',
    currency: ((data.default_currency as string | null) || 'USD').toUpperCase(),
    businessName: (data.name as string) || '',
  }
}

function itemRows(quoteId: string, lines: QuoteLineInput[], lineTotals: number[]) {
  return lines.map((l, i) => ({
    quote_id: quoteId,
    product_id: l.productId ?? null,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    discount_pct: l.discountPct ?? 0,
    line_total: lineTotals[i],
    position: i,
  }))
}

function totalsPatch(lines: QuoteLineInput[], s: Pick<QuoteSettings, 'taxRate' | 'pricesIncludeTax'>) {
  const t = computeQuoteTotals(lines, s.taxRate, s.pricesIncludeTax)
  return {
    totals: t,
    patch: { subtotal: t.subtotal, discount_amount: t.discount, tax_amount: t.tax, total: t.total },
  }
}

export async function createQuote(
  db: SupabaseClient,
  admin: SupabaseClient,
  args: {
    accountId: string
    /** Null when the AI made it. */
    userId: string | null
    contactId: string
    conversationId?: string | null
    lines: QuoteLineInput[]
    notes?: string | null
    createdByAi?: boolean
  },
): Promise<{ id: string; number: string }> {
  const settings = await loadQuoteSettings(db, args.accountId)
  const { data: contact } = await db.from('contacts').select('id').eq('id', args.contactId).maybeSingle()
  if (!contact) throw new QuoteError('contact_not_found', 404)

  const { data: deal } = await db
    .from('deals')
    .select('id')
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: number, error: numErr } = await admin.rpc('next_quote_number', { p_account_id: args.accountId })
  if (numErr || typeof number !== 'string') throw numErr ?? new Error('numbering failed')

  const { patch, totals } = totalsPatch(args.lines, settings)
  const validUntil = new Date(Date.now() + settings.validityDays * 86_400_000).toISOString().slice(0, 10)
  const { data: quote, error } = await db
    .from('quotes')
    .insert({
      account_id: args.accountId,
      number,
      contact_id: args.contactId,
      deal_id: deal?.id ?? null,
      conversation_id: args.conversationId ?? null,
      currency: settings.currency,
      tax_label: settings.taxLabel,
      tax_rate: settings.taxRate,
      prices_include_tax: settings.pricesIncludeTax,
      notes: args.notes?.trim() || null,
      terms: settings.terms,
      valid_until: validUntil,
      created_by: args.userId,
      ...(args.createdByAi ? { created_by_ai: true } : {}),
      ...patch,
    })
    .select('id, number')
    .single()
  if (error) throw error

  const { error: itemsErr } = await db.from('quote_items').insert(itemRows(quote.id, args.lines, totals.lineTotals))
  if (itemsErr) {
    await db.from('quotes').delete().eq('id', quote.id)
    throw itemsErr
  }
  return { id: quote.id as string, number: quote.number as string }
}

/** Replace a draft's lines / notes and recompute its totals. */
export async function updateDraftQuote(
  db: SupabaseClient,
  quoteId: string,
  args: { lines: QuoteLineInput[]; notes?: string | null },
): Promise<void> {
  const { data: q, error } = await db
    .from('quotes')
    .select('id, status, tax_rate, prices_include_tax')
    .eq('id', quoteId)
    .maybeSingle()
  if (error) throw error
  if (!q) throw new QuoteError('not_found', 404)
  if (q.status !== 'draft') throw new QuoteError('not_draft', 409)
  const { patch, totals } = totalsPatch(args.lines, {
    taxRate: Number(q.tax_rate),
    pricesIncludeTax: q.prices_include_tax === true,
  })
  const { error: delErr } = await db.from('quote_items').delete().eq('quote_id', quoteId)
  if (delErr) throw delErr
  const { error: insErr } = await db.from('quote_items').insert(itemRows(quoteId, args.lines, totals.lineTotals))
  if (insErr) throw insErr
  const { error: upErr } = await db
    .from('quotes')
    .update({ ...patch, notes: args.notes?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', quoteId)
  if (upErr) throw upErr
}

export interface LoadedQuote {
  id: string
  account_id: string
  number: string
  status: string
  contact_id: string | null
  deal_id: string | null
  conversation_id: string | null
  currency: string
  tax_label: string
  tax_rate: number
  prices_include_tax: boolean
  subtotal: number
  discount_amount: number
  tax_amount: number
  total: number
  notes: string | null
  terms: string | null
  valid_until: string | null
  created_at: string
  contact: { name: string | null; phone: string | null } | null
  items: { description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number }[]
}

export async function loadQuote(db: SupabaseClient, quoteId: string): Promise<LoadedQuote | null> {
  const { data, error } = await db
    .from('quotes')
    .select(
      '*, contact:contacts(name, phone), items:quote_items(description, quantity, unit_price, discount_pct, line_total, position)',
    )
    .eq('id', quoteId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const items = ((data.items ?? []) as (LoadedQuote['items'][number] & { position: number })[]).sort(
    (a, b) => a.position - b.position,
  )
  const contact = Array.isArray(data.contact) ? data.contact[0] : data.contact
  return { ...(data as LoadedQuote), contact: contact ?? null, items }
}

export async function renderQuote(db: SupabaseClient, quote: LoadedQuote): Promise<Uint8Array> {
  const { data: acct } = await db.from('accounts').select('name').eq('id', quote.account_id).maybeSingle()
  const t = quotePdfText()
  const labels = Object.fromEntries(
    (
      [
        'title', 'date', 'validUntil', 'customer', 'phone', 'description', 'quantity', 'unitPrice',
        'discount', 'amount', 'subtotal', 'discounts', 'total', 'taxIncluded', 'notes', 'terms',
      ] as const
    ).map((k) => [k, t(k)]),
  ) as unknown as QuotePdfLabels
  return renderQuotePdf({
    businessName: (acct?.name as string) || '',
    number: quote.number,
    issuedAt: new Date(quote.created_at),
    validUntil: quote.valid_until,
    customerName: quote.contact?.name || quote.contact?.phone || '-',
    customerPhone: quote.contact?.phone ?? null,
    currency: quote.currency,
    items: quote.items.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      discountPct: Number(i.discount_pct),
      lineTotal: Number(i.line_total),
    })),
    subtotal: Number(quote.subtotal),
    discount: Number(quote.discount_amount),
    taxLabel: quote.tax_label,
    taxRate: Number(quote.tax_rate),
    tax: Number(quote.tax_amount),
    total: Number(quote.total),
    pricesIncludeTax: quote.prices_include_tax,
    notes: quote.notes,
    terms: quote.terms,
    labels,
  })
}

/**
 * Render the PDF, put it next to the chat's other attachments, send it
 * to the customer on WhatsApp with a short caption, mark the quote sent
 * and set the open deal's value to the quote total.
 */
async function resolveConversation(db: SupabaseClient, quote: LoadedQuote): Promise<string> {
  if (quote.conversation_id) return quote.conversation_id
  if (quote.contact_id) {
    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('contact_id', quote.contact_id)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    if (conv?.id) return conv.id as string
  }
  throw new QuoteError('no_conversation', 400)
}

/** Render the PDF and put it next to the chat's other attachments. */
async function publishQuotePdf(
  db: SupabaseClient,
  admin: SupabaseClient,
  accountId: string,
  quote: LoadedQuote,
): Promise<{ url: string; caption: string; filename: string }> {
  const bytes = await renderQuote(db, quote)
  const path = `account-${accountId}/quotes/${quote.number}-${quote.id.slice(0, 8)}.pdf`
  const { error: upErr } = await admin.storage
    .from('chat-media')
    .upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) throw upErr
  const { data: pub } = admin.storage.from('chat-media').getPublicUrl(path)
  const totalLabel = new Intl.NumberFormat('es', { style: 'currency', currency: quote.currency }).format(
    Number(quote.total),
  )
  return {
    url: pub.publicUrl,
    caption: quotePdfText()('caption', { number: quote.number, total: totalLabel }),
    filename: `${quote.number}.pdf`,
  }
}

/** Mark sent and make the open deal worth what was quoted (the AI turn
 *  analysis then sees the quote in the chat and moves the stage). */
async function markQuoteSent(db: SupabaseClient, quote: LoadedQuote, pdfUrl: string, conversationId: string) {
  const now = new Date().toISOString()
  await db
    .from('quotes')
    .update({
      status: quote.status === 'draft' ? 'sent' : quote.status,
      sent_at: now,
      pdf_url: pdfUrl,
      conversation_id: conversationId,
      updated_at: now,
    })
    .eq('id', quote.id)
  if (quote.deal_id) {
    await db
      .from('deals')
      .update({ value: round2(Number(quote.total)), currency: quote.currency, updated_at: now })
      .eq('id', quote.deal_id)
      .eq('status', 'open')
  }
}

/**
 * An advisor sends the quote: PDF to the customer on WhatsApp with a
 * short caption, as their own message.
 */
export async function sendQuote(
  db: SupabaseClient,
  admin: SupabaseClient,
  args: { accountId: string; userId: string; quoteId: string },
): Promise<{ messageId: string | null }> {
  const quote = await loadQuote(db, args.quoteId)
  if (!quote) throw new QuoteError('not_found', 404)
  if (!quote.items.length) throw new QuoteError('empty', 400)
  const conversationId = await resolveConversation(db, quote)
  const pdf = await publishQuotePdf(db, admin, args.accountId, quote)
  const result = await sendMessageToConversation(db, args.accountId, {
    conversationId,
    messageType: 'document',
    mediaUrl: pdf.url,
    filename: pdf.filename,
    contentText: pdf.caption,
    claimForUserId: args.userId,
  })
  await markQuoteSent(db, quote, pdf.url, conversationId)
  return { messageId: result.messageId }
}

/**
 * The AI sends the quote (src/lib/ai/quote-actions.ts): same PDF, sent
 * as a bot message (ai_generated) on whichever channel the conversation
 * uses, so it's never mistaken for an advisor reply. `db` is the
 * service-role client.
 */
export async function sendQuoteAsBot(
  db: SupabaseClient,
  args: { accountId: string; quoteId: string; contactId: string; configOwnerUserId: string },
): Promise<void> {
  const quote = await loadQuote(db, args.quoteId)
  if (!quote) throw new QuoteError('not_found', 404)
  const conversationId = await resolveConversation(db, quote)
  const pdf = await publishQuotePdf(db, db, args.accountId, quote)
  await engineSendMedia({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    conversationId,
    contactId: args.contactId,
    kind: 'document',
    link: pdf.url,
    caption: pdf.caption,
    filename: pdf.filename,
    aiGenerated: true,
  })
  await markQuoteSent(db, quote, pdf.url, conversationId)
}

export class QuoteError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}
