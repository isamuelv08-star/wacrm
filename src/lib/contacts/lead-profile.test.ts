import { describe, expect, it } from 'vitest'
import { summaryNeedsRefresh, type LeadProfile, type StoredLeadSummary } from './lead-profile'

const summary = (over: Partial<StoredLeadSummary> = {}): StoredLeadSummary => ({
  contact_id: 'c1',
  summary: 'x',
  highlights: [],
  next_step: null,
  source_message_id: 'm2',
  source_message_at: '2026-09-19T10:00:00Z',
  language: 'es',
  generated_at: '2026-09-19T10:05:00Z',
  ...over,
})

const profile = (over: Partial<LeadProfile> = {}): LeadProfile => ({
  intelligence: null,
  scoreTrend: [],
  deals: [],
  promises: [],
  activity: {
    conversationCount: 1,
    channels: ['whatsapp'],
    inbound: 3,
    outbound: 2,
    firstMessageAt: null,
    lastMessageAt: null,
    lastCustomerMessageAt: null,
    assignedAgentName: null,
    adHeadline: null,
  },
  tags: [],
  summary: summary(),
  latestMessage: { id: 'm2', createdAt: '2026-09-19T10:00:00Z' },
  ...over,
})

describe('summaryNeedsRefresh', () => {
  it('does not refresh when the summary matches the newest message and language', () => {
    expect(summaryNeedsRefresh(profile(), 'es')).toBe(false)
  })

  it('refreshes when a newer message arrived', () => {
    expect(summaryNeedsRefresh(profile({ latestMessage: { id: 'm3', createdAt: 'x' } }), 'es')).toBe(true)
  })

  it('refreshes when no summary exists yet', () => {
    expect(summaryNeedsRefresh(profile({ summary: null }), 'es')).toBe(true)
  })

  it('refreshes when the UI language changed', () => {
    expect(summaryNeedsRefresh(profile(), 'en')).toBe(true)
  })

  it('never refreshes a lead with no messages (nothing to summarise)', () => {
    expect(summaryNeedsRefresh(profile({ latestMessage: null, summary: null }), 'es')).toBe(false)
  })
})
