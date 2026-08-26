import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  applyLeadScore: vi.fn(),
  ensureDealInQualifiedStage: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    roundRobinAgentId: null as string | null,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./lead-scoring', () => ({
  applyLeadScore: h.applyLeadScore,
  ensureDealInQualifiedStage: h.ensureDealInQualifiedStage,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      if (name === 'next_round_robin_agent') {
        return Promise.resolve({ data: h.state.roundRobinAgentId, error: null })
      }
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

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
    qualificationCriteria: null,
    isActive: true,
    autoReplyEnabled: true,
    salesModeEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    transcriptionApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.roundRobinAgentId = null
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false, score: null })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.applyLeadScore.mockReset()
  h.ensureDealInQualifiedStage.mockReset()
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('never hits the cap when autoReplyMaxPerConversation is null (unlimited, migration 047)', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyMaxPerConversation: null }))
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 9_999,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: null },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No fixed handoff agent configured and no eligible round-robin
    // agent (mock defaults to null) → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff, without consulting round-robin', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
    expect(h.state.rpcCalls).not.toContainEqual(
      expect.objectContaining({ name: 'next_round_robin_agent' }),
    )
  })

  it('prefers the model-generated handoff summary over the deterministic note', async () => {
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: true,
      handoffSummary: 'Customer needs a refund for order #4521, already paid.',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload?.ai_handoff_summary).toBe(
      'Customer needs a refund for order #4521, already paid.',
    )
  })

  it('falls back to the deterministic note when the model handed off without one', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, handoffSummary: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('AI agent handed off')
  })

  it('falls back to round-robin on handoff when no fixed handoff agent is configured', async () => {
    h.state.roundRobinAgentId = 'agent-42'
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toContainEqual({
      name: 'next_round_robin_agent',
      args: { p_account_id: 'acct-1' },
    })
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-42',
    })
  })

  it('moves the deal to the qualified stage on an explicit handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.ensureDealInQualifiedStage).toHaveBeenCalledWith(
      expect.anything(),
      { accountId: 'acct-1', contactId: 'contact-1', configOwnerUserId: 'user-1' },
    )
  })

  it('moves the deal to the qualified stage on a silent bail-out (empty text, no handoff tag)', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: false })
    await dispatchInboundToAiReply(ARGS)
    expect(h.ensureDealInQualifiedStage).toHaveBeenCalled()
  })

  it('does not touch the deal on a normal successful reply', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.ensureDealInQualifiedStage).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — lead scoring', () => {
  it('passes qualification_criteria into the system prompt', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ qualificationCriteria: 'HOT if budget + urgency this week.' }),
    )
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('HOT if budget + urgency this week.')
    expect(systemPrompt).toContain('[[SCORE:HOT]]')
  })

  it('omits the scoring instruction when no criteria are configured', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ qualificationCriteria: null }))
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('[[SCORE:')
  })

  it('applies the score when the model emits one, alongside the reply', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Sounds great!',
      handoff: false,
      score: 'hot',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.applyLeadScore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        contactId: 'contact-1',
        configOwnerUserId: 'user-1',
        score: 'hot',
      }),
    )
    // Still sends the customer-facing reply — scoring never blocks it.
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('applies the score even when the same turn hands off', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true, score: 'warm' })
    await dispatchInboundToAiReply(ARGS)
    expect(h.applyLeadScore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ score: 'warm' }),
    )
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not call applyLeadScore when no score is emitted', async () => {
    h.generateReply.mockResolvedValue({ text: 'Hi', handoff: false, score: null })
    await dispatchInboundToAiReply(ARGS)
    expect(h.applyLeadScore).not.toHaveBeenCalled()
  })

  it('passes the model\'s score reason through, tagged as source "ai"', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Sounds great!',
      handoff: false,
      score: 'hot',
      scoreReason: 'Confirmed budget and wants to buy this week.',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.applyLeadScore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        score: 'hot',
        reason: 'Confirmed budget and wants to buy this week.',
        source: 'ai',
      }),
    )
  })
})
