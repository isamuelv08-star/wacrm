import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
  type LeadScore,
} from './types'
import {
  HANDOFF_SENTINEL_PATTERN,
  HANDOFF_SUMMARY_PATTERN,
  SCORE_SENTINEL_PATTERN,
  SCORE_REASON_PATTERN,
  STAGE_SENTINEL_PATTERN,
  DEAL_WON_SENTINEL_PATTERN,
  DEAL_LOST_SENTINEL_PATTERN,
  SUMMARY_SENTINEL_PATTERN,
  SCHEDULE_SENTINEL_PATTERN,
  SEND_MEDIA_SENTINEL_PATTERN,
  SEND_BOOKING_LINK_SENTINEL_PATTERN,
  CONTACT_NAME_SENTINEL_PATTERN,
  DEAL_VALUE_SENTINEL_PATTERN,
  aiRequestTimeoutMs,
} from './defaults'
import type { CalendarEventType } from '@/types'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateOpenRouter } from './providers/openrouter'

/** Any leftover `[[TAG]]` / `[[TAG:...]]` control sentinel. */
const LEFTOVER_SENTINEL_PATTERN = /\[\[[A-Z_]+(?::[^\]]*)?\]\]/g

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'openrouter':
      result = await generateOpenRouter(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

/**
 * Split the raw model output into `{ text, handoff, score, usage }`.
 * Both sentinels are stripped unconditionally — regardless of whether
 * qualification_criteria is configured for this account — so a model
 * that hallucinates the tag anyway can never leak it to the customer.
 * `usage` is passed straight through (null when the provider didn't
 * report it).
 */
export interface ClassificationArgs {
  config: AiConfig
  /** Built by `buildClassificationPrompt` (defaults.ts). */
  systemPrompt: string
  messages: ChatMessage[]
}

/**
 * Customer Memory (fase 7 of the Auditoría Saleslid roadmap) — structured
 * facts the classification call may have picked up on THIS turn, never
 * invented: every field is null unless the customer stated it plainly
 * in the conversation (see buildClassificationPrompt's explicit
 * instruction). Persisted to `contact_intelligence` by
 * classifyLeadIfNeeded, only when at least one field is non-null.
 */
export interface CustomerFacts {
  need: string | null
  budget: string | null
  objection: string | null
  productInterest: string | null
}

export interface ClassificationResult {
  score: LeadScore | null
  reason: string | null
  customerFacts: CustomerFacts | null
  usage: AiUsage | null
}

const VALID_SCORES: readonly LeadScore[] = ['hot', 'warm', 'cold']

/**
 * Generate a standalone lead-classification verdict (no customer-facing
 * text at all — see `buildClassificationPrompt`). Reuses the same
 * provider adapters as `generateReply` (they only ever return raw
 * `{text, usage}`, so nothing provider-side changes), but parses the
 * response as strict JSON instead of scanning free text for a sentinel:
 * this call's entire output IS the verdict, so there's nothing else to
 * interleave it with.
 *
 * Never throws on a malformed response — a model that ignores the
 * format is treated the same as "nothing to score yet" (`score: null`),
 * logged so it's visible without taking down the caller.
 */
export async function generateClassification(
  args: ClassificationArgs,
): Promise<ClassificationResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'openrouter':
      result = await generateOpenRouter(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return { ...parseClassification(result.text), usage: result.usage }
}

/** Strip a ```json ... ``` (or bare ```) fence if the model wrapped its
 *  JSON in one despite being asked not to — cheap to tolerate, since a
 *  fenced-but-otherwise-valid response is still an unambiguous verdict. */
export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function nullableTrimmedString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseCustomerFacts(v: unknown): CustomerFacts | null {
  if (typeof v !== 'object' || v === null) return null
  const { need, budget, objection, productInterest } = v as {
    need?: unknown
    budget?: unknown
    objection?: unknown
    productInterest?: unknown
  }
  const facts: CustomerFacts = {
    need: nullableTrimmedString(need),
    budget: nullableTrimmedString(budget),
    objection: nullableTrimmedString(objection),
    productInterest: nullableTrimmedString(productInterest),
  }
  // A well-formed but entirely-empty object is the same as "no facts
  // this turn" — don't persist a row with nothing in it.
  return facts.need || facts.budget || facts.objection || facts.productInterest ? facts : null
}

function parseClassification(raw: string): Omit<ClassificationResult, 'usage'> {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not an object')
    }
    const { score, reason, customerFacts } = parsed as {
      score?: unknown
      reason?: unknown
      customerFacts?: unknown
    }
    if (score !== null && !VALID_SCORES.includes(score as LeadScore)) {
      throw new Error(`invalid score: ${JSON.stringify(score)}`)
    }
    return {
      score: score === null ? null : (score as LeadScore),
      reason: nullableTrimmedString(reason),
      customerFacts: parseCustomerFacts(customerFacts),
    }
  } catch (err) {
    console.error('[ai lead-classify] failed to parse classification response:', err)
    return { score: null, reason: null, customerFacts: null }
  }
}

/**
 * Provider dispatch for one-off structured calls whose caller parses the
 * raw text itself (the lead summary, src/lib/ai/lead-summary.ts). The
 * same adapter switch as `generateReply` / `generateClassification`,
 * minus their response parsing.
 */
export async function runProvider(
  args: GenerateArgs,
): Promise<{ text: string; usage: AiUsage | null }> {
  const { config, systemPrompt, messages } = args
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs: aiRequestTimeoutMs(),
  }
  switch (config.provider) {
    case 'openai':
      return generateOpenAi(providerArgs)
    case 'anthropic':
      return generateAnthropic(providerArgs)
    case 'openrouter':
      return generateOpenRouter(providerArgs)
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }
}

export interface PromiseExtractionArgs {
  config: AiConfig
  /** Built by `buildPromiseExtractionPrompt` (defaults.ts). */
  systemPrompt: string
  messages: ChatMessage[]
}

export interface PromiseExtractionResult {
  isPromise: boolean
  promiseText: string | null
  dueInMinutes: number | null
  usage: AiUsage | null
}

/**
 * Generate a standalone promise-extraction verdict for one candidate
 * agent message (fase 4 — src/lib/sales-intelligence/promise-tracker.ts
 * only calls this for messages that already passed the cheap keyword
 * pre-filter, promise-detect.ts). Same shape as `generateClassification`
 * above: reuses the provider adapters, parses the response as strict
 * JSON since the whole output IS the verdict.
 *
 * Never throws on a malformed response — treated the same as "not a
 * promise", logged so it's visible without taking down the scan.
 */
export async function generatePromiseExtraction(
  args: PromiseExtractionArgs,
): Promise<PromiseExtractionResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'openrouter':
      result = await generateOpenRouter(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return { ...parsePromiseExtraction(result.text), usage: result.usage }
}

function parsePromiseExtraction(raw: string): Omit<PromiseExtractionResult, 'usage'> {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not an object')
    }
    const { isPromise, promiseText, dueInMinutes } = parsed as {
      isPromise?: unknown
      promiseText?: unknown
      dueInMinutes?: unknown
    }
    if (typeof isPromise !== 'boolean') {
      throw new Error(`invalid isPromise: ${JSON.stringify(isPromise)}`)
    }
    return {
      isPromise,
      promiseText: isPromise && typeof promiseText === 'string' && promiseText.trim() ? promiseText.trim() : null,
      dueInMinutes:
        typeof dueInMinutes === 'number' && Number.isFinite(dueInMinutes) && dueInMinutes >= 0
          ? dueInMinutes
          : null,
    }
  } catch (err) {
    console.error('[ai promise-extract] failed to parse extraction response:', err)
    return { isPromise: false, promiseText: null, dueInMinutes: null }
  }
}

export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = HANDOFF_SENTINEL_PATTERN.test(raw)
  const scoreMatch = raw.match(SCORE_SENTINEL_PATTERN)
  const score = scoreMatch
    ? (scoreMatch[1].toLowerCase() as LeadScore)
    : null
  const scoreReasonMatch = raw.match(SCORE_REASON_PATTERN)
  const scoreReason = score && scoreReasonMatch ? scoreReasonMatch[1].trim() || null : null
  const summaryMatch = raw.match(HANDOFF_SUMMARY_PATTERN)
  const handoffSummary =
    handoff && summaryMatch ? summaryMatch[1].trim() || null : null

  const stageMatch = raw.match(STAGE_SENTINEL_PATTERN)
  const stageMove = stageMatch ? stageMatch[1].trim() || null : null
  const dealWon = DEAL_WON_SENTINEL_PATTERN.test(raw)
  const dealLost = DEAL_LOST_SENTINEL_PATTERN.test(raw)
  const crmSummaryMatch = raw.match(SUMMARY_SENTINEL_PATTERN)
  const summary = crmSummaryMatch ? crmSummaryMatch[1].trim() || null : null

  const scheduleMatch = raw.match(SCHEDULE_SENTINEL_PATTERN)
  const schedule = scheduleMatch
    ? {
        localDateTime: scheduleMatch[1].trim(),
        type: scheduleMatch[2].toLowerCase() as CalendarEventType,
        title: scheduleMatch[3].trim(),
      }
    : null

  const sendMediaMatch = raw.match(SEND_MEDIA_SENTINEL_PATTERN)
  const sendMedia = sendMediaMatch ? sendMediaMatch[1].trim().toLowerCase() : null

  const sendBookingLink = SEND_BOOKING_LINK_SENTINEL_PATTERN.test(raw)

  const contactNameMatch = raw.match(CONTACT_NAME_SENTINEL_PATTERN)
  const contactName = contactNameMatch ? contactNameMatch[1].trim() || null : null

  const dealValueMatch = raw.match(DEAL_VALUE_SENTINEL_PATTERN)
  const dealValue = dealValueMatch ? Number(dealValueMatch[1]) : null

  const text = raw
    .replace(HANDOFF_SENTINEL_PATTERN, '')
    .replace(DEAL_WON_SENTINEL_PATTERN, '')
    .replace(DEAL_LOST_SENTINEL_PATTERN, '')
    .replace(SCORE_SENTINEL_PATTERN, '')
    .replace(SCORE_REASON_PATTERN, '')
    .replace(HANDOFF_SUMMARY_PATTERN, '')
    .replace(STAGE_SENTINEL_PATTERN, '')
    .replace(SUMMARY_SENTINEL_PATTERN, '')
    .replace(SCHEDULE_SENTINEL_PATTERN, '')
    .replace(SEND_MEDIA_SENTINEL_PATTERN, '')
    .replace(SEND_BOOKING_LINK_SENTINEL_PATTERN, '')
    .replace(CONTACT_NAME_SENTINEL_PATTERN, '')
    .replace(DEAL_VALUE_SENTINEL_PATTERN, '')
    // Belt-and-braces: the patterns above are non-global (first match
    // only) and format-strict, so a repeated sentinel or a malformed one
    // ("[[DEAL_VALUE:$1,500]]") used to reach the customer verbatim over
    // WhatsApp. Strip anything still shaped like a control tag.
    .replace(LEFTOVER_SENTINEL_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return {
    text,
    handoff,
    score,
    scoreReason,
    handoffSummary,
    stageMove,
    dealWon,
    dealLost,
    summary,
    schedule,
    sendMedia,
    sendBookingLink,
    contactName,
    dealValue,
    usage,
  }
}
