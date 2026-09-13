import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

/**
 * OpenAI's "reasoning" model families (o1/o3/o4, the gpt-5.x line —
 * this codebase's own OpenAI default, see AI_PROVIDER_DEFAULT_MODEL)
 * spend an internal, invisible "thinking" budget that comes out of the
 * SAME `max_completion_tokens` pool as the visible reply — unlike a
 * plain chat model (gpt-4o/gpt-4.1/...) or Anthropic's non-extended-
 * thinking calls (see providers/anthropic.ts), where every token of
 * that budget is visible output.
 *
 * Left at its own default (OpenAI defaults reasoning_effort to
 * "medium" server-side when omitted), a moderately long system prompt
 * — the lead-classification prompt in particular: business rules +
 * the full conversation history + several paragraphs of instructions —
 * can burn through MAX_OUTPUT_TOKENS on hidden reasoning alone before
 * the model ever emits its actual JSON verdict, which surfaces as an
 * empty/truncated response (see the finish_reason=="length" check
 * below) and, one layer up, a silently-dropped classification or
 * reply. This is the concrete difference behind "it worked with
 * Anthropic but broke on OpenAI" for accounts on a reasoning model:
 * explicitly asking for LOW reasoning effort keeps that hidden budget
 * small, since none of this app's prompts need deep multi-step
 * reasoning — classification and replies are both single-turn,
 * instruction-following tasks.
 */
function isReasoningModel(model: string): boolean {
  return /^(o1|o3|o4|gpt-5)/i.test(model.trim())
}

interface OpenAiResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        ...(isReasoningModel(model) ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI', res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('OpenAI returned an empty response.', {
      code: 'empty_response',
    })
  }
  // `finish_reason: "length"` means generation was cut off before the
  // model was done — for a reasoning model (the gpt-5.x family this
  // codebase defaults to), reasoning tokens share the same
  // max_completion_tokens budget as visible output, so a long system
  // prompt can burn through it before the model ever reaches a tag
  // meant to come after the customer-facing reply. Not fatal (the
  // visible text we did get is still usable), but worth a loud log —
  // this is exactly the failure mode that silently dropped lead scores
  // before scoring moved to its own dedicated call (lead-classify.ts).
  if (data?.choices?.[0]?.finish_reason === 'length') {
    console.warn('[ai openai] response was truncated (finish_reason=length) — consider raising MAX_OUTPUT_TOKENS or lowering reasoning_effort for this model.')
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}
