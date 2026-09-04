import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
  type LeadScore,
} from './types'
import {
  HANDOFF_SENTINEL,
  HANDOFF_SUMMARY_PATTERN,
  SCORE_SENTINEL_PATTERN,
  SCORE_REASON_PATTERN,
  STAGE_SENTINEL_PATTERN,
  DEAL_WON_SENTINEL,
  DEAL_LOST_SENTINEL,
  SUMMARY_SENTINEL_PATTERN,
  SCHEDULE_SENTINEL_PATTERN,
  SEND_MEDIA_SENTINEL_PATTERN,
  CONTACT_NAME_SENTINEL_PATTERN,
  DEAL_VALUE_SENTINEL_PATTERN,
  aiRequestTimeoutMs,
} from './defaults'
import type { CalendarEventType } from '@/types'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateOpenRouter } from './providers/openrouter'

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

export interface ClassificationResult {
  score: LeadScore | null
  reason: string | null
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
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseClassification(raw: string): Omit<ClassificationResult, 'usage'> {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('not an object')
    }
    const { score, reason } = parsed as { score?: unknown; reason?: unknown }
    if (score !== null && !VALID_SCORES.includes(score as LeadScore)) {
      throw new Error(`invalid score: ${JSON.stringify(score)}`)
    }
    return {
      score: score === null ? null : (score as LeadScore),
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
    }
  } catch (err) {
    console.error('[ai lead-classify] failed to parse classification response:', err)
    return { score: null, reason: null }
  }
}

export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
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
  const dealWon = raw.includes(DEAL_WON_SENTINEL)
  const dealLost = raw.includes(DEAL_LOST_SENTINEL)
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

  const contactNameMatch = raw.match(CONTACT_NAME_SENTINEL_PATTERN)
  const contactName = contactNameMatch ? contactNameMatch[1].trim() || null : null

  const dealValueMatch = raw.match(DEAL_VALUE_SENTINEL_PATTERN)
  const dealValue = dealValueMatch ? Number(dealValueMatch[1]) : null

  const text = raw
    .split(HANDOFF_SENTINEL)
    .join('')
    .split(DEAL_WON_SENTINEL)
    .join('')
    .split(DEAL_LOST_SENTINEL)
    .join('')
    .replace(SCORE_SENTINEL_PATTERN, '')
    .replace(SCORE_REASON_PATTERN, '')
    .replace(HANDOFF_SUMMARY_PATTERN, '')
    .replace(STAGE_SENTINEL_PATTERN, '')
    .replace(SUMMARY_SENTINEL_PATTERN, '')
    .replace(SCHEDULE_SENTINEL_PATTERN, '')
    .replace(SEND_MEDIA_SENTINEL_PATTERN, '')
    .replace(CONTACT_NAME_SENTINEL_PATTERN, '')
    .replace(DEAL_VALUE_SENTINEL_PATTERN, '')
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
    contactName,
    dealValue,
    usage,
  }
}
