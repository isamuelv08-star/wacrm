import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, generateClassification, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    qualificationCriteria: null,
    isActive: true,
    autoReplyEnabled: false,
    salesModeEnabled: false,
    aiSchedulingEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    leadAutoAssignEnabled: false,
    embeddingsApiKey: null,
    transcriptionApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: false,
      score: null,
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: true,
      score: null,
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage: null,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
      score: null,
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage: null,
    })
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: false,
      score: null,
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage,
    })
  })

  it('detects + strips the score sentinel, case-insensitively', () => {
    expect(parseGeneration('Sounds great! [[SCORE:HOT]]')).toEqual({
      text: 'Sounds great!',
      handoff: false,
      score: 'hot',
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage: null,
    })
    expect(parseGeneration('Ok, noted. [[score:warm]]')).toEqual({
      text: 'Ok, noted.',
      handoff: false,
      score: 'warm',
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage: null,
    })
  })

  it('never leaks the score tag into the customer-facing text', () => {
    const result = parseGeneration('Thanks for reaching out! [[SCORE:COLD]]')
    expect(result.text).not.toContain('SCORE')
    expect(result.text).not.toContain('[[')
  })

  it('handles both sentinels together, in either order', () => {
    expect(
      parseGeneration('Let me get someone. [[HANDOFF]] [[SCORE:WARM]]'),
    ).toEqual({
      text: 'Let me get someone.',
      handoff: true,
      score: 'warm',
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage: null,
    })
  })

  it('returns null score when the tag is absent', () => {
    expect(parseGeneration('Just a normal reply.').score).toBeNull()
  })

  it('detects + strips the score-reason sentinel alongside the score', () => {
    const result = parseGeneration(
      'Great, noted! [[SCORE:HOT]][[SCORE_REASON: Confirmed budget and wants to buy this week.]]',
    )
    expect(result.score).toBe('hot')
    expect(result.scoreReason).toBe('Confirmed budget and wants to buy this week.')
    expect(result.text).toBe('Great, noted!')
  })

  it('ignores a reason tag with no accompanying score', () => {
    const result = parseGeneration('Ok. [[SCORE_REASON: should not apply without a score]]')
    expect(result.score).toBeNull()
    expect(result.scoreReason).toBeNull()
  })

  it('never leaks the score-reason tag into the customer-facing text', () => {
    const result = parseGeneration('Thanks! [[SCORE:WARM]][[SCORE_REASON: interested, no urgency]]')
    expect(result.text).not.toContain('SCORE_REASON')
    expect(result.text).not.toContain('interested, no urgency')
  })

  it('detects + strips the handoff-summary sentinel, only when handoff is present', () => {
    const withHandoff = parseGeneration(
      '[[HANDOFF]][[HANDOFF_SUMMARY: Customer wants a refund for order #99.]]',
    )
    expect(withHandoff.handoff).toBe(true)
    expect(withHandoff.handoffSummary).toBe('Customer wants a refund for order #99.')
    expect(withHandoff.text).toBe('')

    // No [[HANDOFF]] in the output → the summary tag (if a model
    // hallucinated one anyway) is not trusted as a handoff summary.
    const withoutHandoff = parseGeneration(
      'All good! [[HANDOFF_SUMMARY: should not apply]]',
    )
    expect(withoutHandoff.handoff).toBe(false)
    expect(withoutHandoff.handoffSummary).toBeNull()
  })

  it('never leaks the handoff-summary tag into the customer-facing text', () => {
    const result = parseGeneration('[[HANDOFF]][[HANDOFF_SUMMARY: internal note]]')
    expect(result.text).not.toContain('HANDOFF_SUMMARY')
    expect(result.text).not.toContain('internal note')
  })

  it('detects + strips the schedule sentinel', () => {
    const result = parseGeneration(
      "Sure, I'll have someone call you then! [[SCHEDULE: 2026-08-29T10:00|call|Follow-up call about the order]]",
    )
    expect(result.text).toBe("Sure, I'll have someone call you then!")
    expect(result.schedule).toEqual({
      localDateTime: '2026-08-29T10:00',
      type: 'call',
      title: 'Follow-up call about the order',
    })
  })

  it('returns null schedule when the tag is absent', () => {
    expect(parseGeneration('Just a normal reply.').schedule).toBeNull()
  })

  it('lowercases the schedule type', () => {
    const result = parseGeneration(
      '[[SCHEDULE: 2026-08-29T10:00|MEETING|Demo call]]',
    )
    expect(result.schedule?.type).toBe('meeting')
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Sure — happy to help!',
      handoff: false,
      score: null,
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Anthropic reports input/output only — total is summed by normalizeUsage.
    expect(res).toEqual({
      text: 'Hi there!',
      handoff: false,
      score: null,
      scoreReason: null,
      handoffSummary: null,
      stageMove: null,
      dealWon: false,
      dealLost: false,
      summary: null,
      schedule: null,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: '[[HANDOFF]]' }] }),
      ),
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })
})

describe('generateClassification', () => {
  async function classify(content: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ choices: [{ message: { content } }] }),
      ),
    )
    return generateClassification({
      config: config(),
      systemPrompt: 'classify sys',
      messages: [{ role: 'user', content: 'I need this by Friday, budget is ready' }],
    })
  }

  it('parses a clean JSON verdict', async () => {
    const res = await classify('{"score":"hot","reason":"Budget and deadline confirmed."}')
    expect(res.score).toBe('hot')
    expect(res.reason).toBe('Budget and deadline confirmed.')
  })

  it('tolerates a ```json code fence around the JSON', async () => {
    const res = await classify('```json\n{"score":"warm","reason":"Interested, no urgency."}\n```')
    expect(res.score).toBe('warm')
    expect(res.reason).toBe('Interested, no urgency.')
  })

  it('returns null score + reason for an explicit null verdict', async () => {
    const res = await classify('{"score":null,"reason":null}')
    expect(res.score).toBeNull()
    expect(res.reason).toBeNull()
  })

  it('swallows malformed JSON as "nothing to score"', async () => {
    const res = await classify('Sure, this lead seems hot to me!')
    expect(res.score).toBeNull()
    expect(res.reason).toBeNull()
  })

  it('swallows an invalid score value as "nothing to score"', async () => {
    const res = await classify('{"score":"scorching","reason":"very interested"}')
    expect(res.score).toBeNull()
    expect(res.reason).toBeNull()
  })

  it('passes usage straight through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          choices: [{ message: { content: '{"score":"cold","reason":"Just browsing."}' } }],
          usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
        }),
      ),
    )
    const res = await generateClassification({
      config: config(),
      systemPrompt: 'classify sys',
      messages: [{ role: 'user', content: 'just curious about pricing' }],
    })
    expect(res.usage).toEqual({ promptTokens: 20, completionTokens: 4, totalTokens: 24 })
  })
})
