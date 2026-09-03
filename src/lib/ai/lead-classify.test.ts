import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

const h = vi.hoisted(() => {
  const conversationRow = vi.fn(() => ({ assigned_agent_id: null as string | null }))
  const db = {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: conversationRow(), error: null }),
        }),
      }),
    }),
  }
  return {
    loadAiConfig: vi.fn(),
    buildConversationContext: vi.fn(),
    generateClassification: vi.fn(),
    applyLeadScore: vi.fn(),
    logAiUsage: vi.fn(),
    checkRateLimit: vi.fn(),
    conversationRow,
    db,
  }
})

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./generate', () => ({ generateClassification: h.generateClassification }))
vi.mock('./lead-scoring', () => ({ applyLeadScore: h.applyLeadScore }))
vi.mock('./usage', () => ({ logAiUsage: h.logAiUsage }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  RATE_LIMITS: { aiClassifyAccount: { limit: 30, windowMs: 60_000 } },
}))
vi.mock('./admin-client', () => ({ supabaseAdmin: () => h.db }))

import { classifyLeadIfNeeded } from './lead-classify'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    qualificationCriteria: 'Score HOT when the lead has budget and urgency.',
    isActive: true,
    autoReplyEnabled: false,
    salesModeEnabled: false,
    aiSchedulingEnabled: false,
    googleCalendarSyncEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    leadAutoAssignEnabled: false,
    embeddingsApiKey: null,
    transcriptionApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.loadAiConfig.mockReset().mockResolvedValue(aiConfig())
  h.buildConversationContext.mockReset().mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.generateClassification
    .mockReset()
    .mockResolvedValue({ score: null, reason: null, usage: null })
  h.applyLeadScore.mockReset()
  h.logAiUsage.mockReset()
  h.checkRateLimit.mockReset().mockReturnValue({ success: true })
  h.conversationRow.mockReset().mockReturnValue({ assigned_agent_id: null })
})

describe('classifyLeadIfNeeded', () => {
  it('no-ops when there is no AI config', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await classifyLeadIfNeeded(ARGS)
    expect(h.generateClassification).not.toHaveBeenCalled()
    expect(h.applyLeadScore).not.toHaveBeenCalled()
  })

  it('no-ops when qualification criteria is unset', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ qualificationCriteria: null }))
    await classifyLeadIfNeeded(ARGS)
    expect(h.generateClassification).not.toHaveBeenCalled()
  })

  it('no-ops when qualification criteria is blank', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ qualificationCriteria: '   ' }))
    await classifyLeadIfNeeded(ARGS)
    expect(h.generateClassification).not.toHaveBeenCalled()
  })

  it('bails when auto-reply is enabled — that path already scores this turn', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: true }))
    await classifyLeadIfNeeded(ARGS)
    expect(h.generateClassification).not.toHaveBeenCalled()
    expect(h.applyLeadScore).not.toHaveBeenCalled()
  })

  it('skips when the account rate limit is exceeded', async () => {
    h.checkRateLimit.mockReturnValue({ success: false })
    await classifyLeadIfNeeded(ARGS)
    expect(h.generateClassification).not.toHaveBeenCalled()
  })

  it('skips when there is no conversation context yet', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await classifyLeadIfNeeded(ARGS)
    expect(h.generateClassification).not.toHaveBeenCalled()
  })

  it('persists a HOT verdict via applyLeadScore, source ai', async () => {
    h.generateClassification.mockResolvedValue({
      score: 'hot',
      reason: 'Mentioned budget and wants to buy today.',
      usage: null,
    })
    await classifyLeadIfNeeded(ARGS)
    expect(h.applyLeadScore).toHaveBeenCalledWith(
      h.db,
      {
        accountId: 'acct-1',
        contactId: 'contact-1',
        configOwnerUserId: 'user-1',
        score: 'hot',
        reason: 'Mentioned budget and wants to buy today.',
        source: 'ai',
        preferredAgentUserId: null,
        leadAutoAssignEnabled: false,
      },
    )
  })

  it('passes the thread\'s existing handler through as preferredAgentUserId', async () => {
    h.conversationRow.mockReturnValue({ assigned_agent_id: 'agent-9' })
    h.generateClassification.mockResolvedValue({
      score: 'hot',
      reason: 'Ready to buy.',
      usage: null,
    })
    await classifyLeadIfNeeded(ARGS)
    expect(h.applyLeadScore).toHaveBeenCalledWith(
      h.db,
      expect.objectContaining({ preferredAgentUserId: 'agent-9' }),
    )
  })

  it('forwards the account\'s lead_auto_assign_enabled setting', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ leadAutoAssignEnabled: true }))
    h.generateClassification.mockResolvedValue({
      score: 'hot',
      reason: 'Ready to buy.',
      usage: null,
    })
    await classifyLeadIfNeeded(ARGS)
    expect(h.applyLeadScore).toHaveBeenCalledWith(
      h.db,
      expect.objectContaining({ leadAutoAssignEnabled: true }),
    )
  })

  it('does not persist anything when the model has no verdict yet', async () => {
    h.generateClassification.mockResolvedValue({ score: null, reason: null, usage: null })
    await classifyLeadIfNeeded(ARGS)
    expect(h.applyLeadScore).not.toHaveBeenCalled()
  })

  it('logs usage under mode "classify"', async () => {
    h.generateClassification.mockResolvedValue({
      score: 'warm',
      reason: 'Shows interest, no urgency.',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })
    await classifyLeadIfNeeded(ARGS)
    expect(h.logAiUsage).toHaveBeenCalledWith(
      h.db,
      expect.objectContaining({ mode: 'classify', accountId: 'acct-1', conversationId: 'conv-1' }),
    )
  })

  it('never throws when generateClassification rejects', async () => {
    h.generateClassification.mockRejectedValue(new Error('provider down'))
    await expect(classifyLeadIfNeeded(ARGS)).resolves.toBeUndefined()
    expect(h.applyLeadScore).not.toHaveBeenCalled()
  })
})
