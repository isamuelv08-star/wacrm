import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateOpenAi } from './openai'
import type { ProviderArgs } from './shared'

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function args(model: string): ProviderArgs {
  return {
    apiKey: 'sk-test',
    model,
    systemPrompt: 'system',
    messages: [{ role: 'user', content: 'hi' }],
    timeoutMs: 5000,
  }
}

/**
 * Regression for "worked on Anthropic, broke on OpenAI": the gpt-5.x /
 * o1 / o3 / o4 "reasoning" families spend hidden reasoning tokens out
 * of the same max_completion_tokens budget as the visible reply, and
 * at OpenAI's own default reasoning_effort a moderately long prompt
 * (e.g. the lead-classification prompt) can burn the whole budget
 * before emitting any visible text — silently dropping the reply/
 * classification one layer up. Explicitly requesting low effort keeps
 * that hidden budget small; a plain chat model has no such budget to
 * begin with and must NOT get a parameter it doesn't support.
 */
describe('generateOpenAi reasoning_effort', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends reasoning_effort=low for the gpt-5.x default model', async () => {
    await generateOpenAi(args('gpt-5.4-mini'))
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.reasoning_effort).toBe('low')
  })

  it.each(['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini', 'gpt-5', 'GPT-5-Turbo'])(
    'sends reasoning_effort=low for reasoning model %s',
    async (model) => {
      await generateOpenAi(args(model))
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body as string)
      expect(body.reasoning_effort).toBe('low')
    },
  )

  it.each(['gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-3.5-turbo'])(
    'omits reasoning_effort entirely for a plain chat model %s',
    async (model) => {
      await generateOpenAi(args(model))
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body as string)
      expect(body).not.toHaveProperty('reasoning_effort')
    },
  )
})
