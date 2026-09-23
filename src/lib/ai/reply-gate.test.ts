import { describe, expect, it } from 'vitest'
import { aiSilenceReason, type AiReplyGateInput } from './reply-gate'

function gate(overrides: Partial<AiReplyGateInput> = {}): AiReplyGateInput {
  return {
    autoReplyEnabled: true,
    channelAllowed: true,
    hasMessageAutomations: false,
    assignedAgentId: null,
    replyWhenAssigned: true,
    aiAutoreplyDisabled: false,
    replyCount: 0,
    maxRepliesPerConversation: 3,
    ...overrides,
  }
}

describe('aiSilenceReason', () => {
  it('answers when nothing is in the way', () => {
    expect(aiSilenceReason(gate())).toBeNull()
  })

  it('stays quiet when auto-reply is off for the account', () => {
    expect(aiSilenceReason(gate({ autoReplyEnabled: false }))).toBe('auto_reply_off')
  })

  it('stays quiet on a channel the account did not enable', () => {
    expect(aiSilenceReason(gate({ channelAllowed: false }))).toBe('channel_not_allowed')
  })

  it('yields to a user-built auto-responder', () => {
    expect(aiSilenceReason(gate({ hasMessageAutomations: true }))).toBe('automation_responder')
  })

  it('stays quiet on a conversation that was paused or handed off', () => {
    expect(aiSilenceReason(gate({ aiAutoreplyDisabled: true }))).toBe('paused_here')
  })

  // The bug this replaced: every new conversation is auto-assigned by
  // round-robin the moment the webhook creates it, so treating an
  // assignee as "a human owns this" silenced the bot on every new lead.
  it('answers an assigned conversation by default', () => {
    expect(aiSilenceReason(gate({ assignedAgentId: 'agent-1' }))).toBeNull()
  })

  it('honours an account that kept the old "assigned means hands off" rule', () => {
    expect(
      aiSilenceReason(gate({ assignedAgentId: 'agent-1', replyWhenAssigned: false })),
    ).toBe('agent_owns_thread')
  })

  it('stops once the per-conversation cap is used up', () => {
    expect(aiSilenceReason(gate({ replyCount: 3 }))).toBe('reply_cap_reached')
    expect(aiSilenceReason(gate({ replyCount: 4 }))).toBe('reply_cap_reached')
  })

  it('never stops on the cap when the account set none', () => {
    expect(
      aiSilenceReason(gate({ replyCount: 999, maxRepliesPerConversation: null })),
    ).toBeNull()
  })

  // An explicit pause is the stronger signal: a paused thread reads as
  // "a person is on it", not "the budget ran out", which is what the
  // observer's logging and any future UI wording lean on.
  it('reports the pause, not the cap, when both apply', () => {
    expect(
      aiSilenceReason(gate({ aiAutoreplyDisabled: true, replyCount: 99 })),
    ).toBe('paused_here')
  })
})
