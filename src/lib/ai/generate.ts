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
  STAGE_SENTINEL_PATTERN,
  DEAL_WON_SENTINEL,
  DEAL_LOST_SENTINEL,
  SUMMARY_SENTINEL_PATTERN,
  aiRequestTimeoutMs,
} from './defaults'
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
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const scoreMatch = raw.match(SCORE_SENTINEL_PATTERN)
  const score = scoreMatch
    ? (scoreMatch[1].toLowerCase() as LeadScore)
    : null
  const summaryMatch = raw.match(HANDOFF_SUMMARY_PATTERN)
  const handoffSummary =
    handoff && summaryMatch ? summaryMatch[1].trim() || null : null

  const stageMatch = raw.match(STAGE_SENTINEL_PATTERN)
  const stageMove = stageMatch ? stageMatch[1].trim() || null : null
  const dealWon = raw.includes(DEAL_WON_SENTINEL)
  const dealLost = raw.includes(DEAL_LOST_SENTINEL)
  const crmSummaryMatch = raw.match(SUMMARY_SENTINEL_PATTERN)
  const summary = crmSummaryMatch ? crmSummaryMatch[1].trim() || null : null

  const text = raw
    .split(HANDOFF_SENTINEL)
    .join('')
    .split(DEAL_WON_SENTINEL)
    .join('')
    .split(DEAL_LOST_SENTINEL)
    .join('')
    .replace(SCORE_SENTINEL_PATTERN, '')
    .replace(HANDOFF_SUMMARY_PATTERN, '')
    .replace(STAGE_SENTINEL_PATTERN, '')
    .replace(SUMMARY_SENTINEL_PATTERN, '')
    .trim()
  return {
    text,
    handoff,
    score,
    handoffSummary,
    stageMove,
    dealWon,
    dealLost,
    summary,
    usage,
  }
}
