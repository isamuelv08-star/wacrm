import type { AiConfig, AiUsage } from './types'
import { resolveContent, type DbMessage } from './context'
import { runProvider, stripCodeFence } from './generate'

/**
 * AI executive summary of one lead (Contacts → "Resumen" tab).
 *
 * The structured half of that tab (score, need/budget/objection, deals,
 * promises, activity) is assembled from data the CRM already stores and
 * costs nothing. This module is only the narrative half: a short
 * briefing + highlights + a suggested next step, written from the
 * conversation transcript plus those confirmed facts.
 *
 * Cost discipline (same as lead-classify): one provider call, made only
 * when a newer message exists than the one the cached summary was
 * written from — see `isSummaryFresh` and POST /api/contacts/[id]/summary.
 */

export interface LeadSummaryFacts {
  name: string | null
  score: 'hot' | 'warm' | 'cold' | null
  scoreReason: string | null
  need: string | null
  budget: string | null
  objection: string | null
  productInterest: string | null
  deals: {
    title: string
    stage: string | null
    value: number | null
    currency: string | null
    status: string | null
  }[]
  tags: string[]
  pendingPromises: string[]
}

export interface TranscriptRow extends DbMessage {
  created_at: string
}

export interface LeadSummary {
  summary: string
  highlights: string[]
  nextStep: string | null
}

const LANGUAGE_NAMES: Record<string, string> = {
  es: 'Spanish',
  en: 'English',
  pt: 'Portuguese',
  ko: 'Korean',
}

/** The model is told the language by name — "es" alone is ambiguous
 *  enough that weaker models answer in English. Unknown → English. */
export function languageName(locale: string): string {
  return LANGUAGE_NAMES[locale] ?? 'English'
}

const MAX_TRANSCRIPT_LINES = 60
const MAX_LINE_CHARS = 500
const SPEAKER: Record<DbMessage['sender_type'], string> = {
  customer: 'Customer',
  agent: 'Seller',
  bot: 'Assistant',
}

export function buildLeadSummarySystemPrompt(language: string): string {
  return [
    "You are a sales analyst writing an internal briefing about ONE lead for a business's sales team.",
    "A salesperson opens this lead's card and must understand the situation in ten seconds.",
    'You are NOT talking to the customer.',
    '',
    'You receive CONFIRMED FACTS from the CRM and a TRANSCRIPT of the conversation, oldest first.',
    'Use only what they contain. Never invent prices, products, quantities, dates, names or intentions.',
    'If something is not stated, leave it out.',
    '',
    'Respond with ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:',
    '{',
    '  "summary": string,      // 2 to 4 sentences: who the lead is, what they want, where the conversation stands now',
    '  "highlights": string[], // 0 to 4 short bullets (max 90 chars each): concrete facts worth remembering — what they asked for, budget, deadline, objections, commitments the business made',
    '  "nextStep": string|null // ONE concrete recommended next action for the salesperson, or null if nothing is clear',
    '}',
    '',
    `Write every string in ${language}. Be specific and professional: no greetings, no emojis, no filler.`,
  ].join('\n')
}

function line(label: string, value: string | null | undefined): string | null {
  return value && value.trim() ? `- ${label}: ${value.trim()}` : null
}

/** Trim to the last `MAX_TRANSCRIPT_LINES` usable rows, oldest first.
 *  Rows with no text (a bare document, an unknown media type) are
 *  dropped — same rule the reply/classify context builder applies. */
export function buildTranscript(rowsNewestFirst: TranscriptRow[]): string {
  const lines = rowsNewestFirst
    .map((row) => ({ speaker: SPEAKER[row.sender_type], text: resolveContent(row) }))
    .filter((r): r is { speaker: string; text: string } => !!r.text && !!r.text.trim())
    .slice(0, MAX_TRANSCRIPT_LINES)
    .reverse()
  return lines
    .map((r) => {
      const text = r.text.replace(/\s+/g, ' ').trim()
      return `${r.speaker}: ${text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text}`
    })
    .join('\n')
}

export function buildLeadSummaryUserMessage(
  facts: LeadSummaryFacts,
  transcript: string,
): string {
  const dealLines = facts.deals.map((d) => {
    const value = d.value != null ? ` — ${d.value}${d.currency ? ` ${d.currency}` : ''}` : ''
    return `- Deal: ${d.title}${d.stage ? ` (stage: ${d.stage})` : ''}${d.status ? ` [${d.status}]` : ''}${value}`
  })
  const factLines = [
    line('Name', facts.name),
    line('Lead score', facts.score),
    line('Score reason', facts.scoreReason),
    line('Stated need', facts.need),
    line('Stated budget', facts.budget),
    line('Stated objection', facts.objection),
    line('Product of interest', facts.productInterest),
    facts.tags.length ? `- Tags: ${facts.tags.join(', ')}` : null,
    ...facts.pendingPromises.map((p) => `- Pending commitment by the business: ${p}`),
    ...dealLines,
  ].filter((l): l is string => l !== null)

  return [
    'CONFIRMED FACTS:',
    factLines.length ? factLines.join('\n') : '- (none recorded yet)',
    '',
    'TRANSCRIPT (oldest first):',
    transcript || '(no text messages)',
  ].join('\n')
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Strict parse of the model's JSON. Returns null for anything that
 *  isn't a usable summary — the caller treats that as a failed
 *  generation rather than showing half a briefing. */
export function parseLeadSummary(raw: string): LeadSummary | null {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { summary, highlights, nextStep } = parsed as {
      summary?: unknown
      highlights?: unknown
      nextStep?: unknown
    }
    const cleanSummary = cleanString(summary, 1200)
    if (!cleanSummary) return null
    const cleanHighlights = Array.isArray(highlights)
      ? highlights
          .map((h) => cleanString(h, 160))
          .filter((h): h is string => h !== null)
          .slice(0, 4)
      : []
    return {
      summary: cleanSummary,
      highlights: cleanHighlights,
      nextStep: cleanString(nextStep, 300),
    }
  } catch {
    return null
  }
}

/** A cached summary is reusable only if it was written from the newest
 *  message and in the language being asked for now. */
export function isSummaryFresh(
  cached: { source_message_id: string | null; language: string | null } | null,
  latestMessageId: string,
  language: string,
): boolean {
  return (
    !!cached && cached.source_message_id === latestMessageId && cached.language === language
  )
}

export async function generateLeadSummary(args: {
  config: AiConfig
  facts: LeadSummaryFacts
  transcript: string
  language: string
}): Promise<{ summary: LeadSummary | null; usage: AiUsage | null }> {
  const { config, facts, transcript, language } = args
  const { text, usage } = await runProvider({
    config,
    systemPrompt: buildLeadSummarySystemPrompt(languageName(language)),
    messages: [{ role: 'user', content: buildLeadSummaryUserMessage(facts, transcript) }],
  })
  const summary = parseLeadSummary(text)
  if (!summary) console.error('[ai lead-summary] unusable model response')
  return { summary, usage }
}
