import { describe, it, expect } from 'vitest'
import type { AtRiskOpenDeal, StalledOpenDeal } from '../dashboard/ceo-queries'
import { buildNextBestActions, NEXT_BEST_ACTION_LIMIT } from './next-best-action'

const NOW = new Date('2026-02-01T00:00:00.000Z').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

function stalled(overrides: Partial<StalledOpenDeal> = {}): StalledOpenDeal {
  return {
    id: 'deal-1',
    value: 1000,
    stageId: 'stage-1',
    assignedTo: 'seller-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    lastStageChangeAt: daysAgo(10),
    ...overrides,
  }
}

function atRisk(overrides: Partial<AtRiskOpenDeal> = {}): AtRiskOpenDeal {
  return {
    id: 'deal-2',
    value: 2000,
    stageId: 'stage-1',
    assignedTo: 'seller-1',
    contactId: 'contact-2',
    conversationId: 'conv-2',
    lastMessageAt: daysAgo(20),
    ...overrides,
  }
}

describe('buildNextBestActions', () => {
  it('returns nothing for two empty inputs', () => {
    expect(buildNextBestActions([], [], NOW)).toEqual([])
  })

  it('turns an at-risk deal into a re_engage_silent action with the right day count', () => {
    const [action] = buildNextBestActions([], [atRisk({ lastMessageAt: daysAgo(25) })], NOW)
    expect(action.type).toBe('re_engage_silent')
    expect(action.daysInactive).toBe(25)
  })

  it('turns a stalled deal into a follow_up_stalled action with the right day count', () => {
    const [action] = buildNextBestActions([stalled({ lastStageChangeAt: daysAgo(15) })], [], NOW)
    expect(action.type).toBe('follow_up_stalled')
    expect(action.daysInactive).toBe(15)
  })

  it('never produces two actions for the same deal — at-risk wins when a deal trips both', () => {
    const actions = buildNextBestActions(
      [stalled({ id: 'deal-x' })],
      [atRisk({ id: 'deal-x' })],
      NOW,
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('re_engage_silent')
  })

  it('escalates urgency with how many days inactive', () => {
    const low = buildNextBestActions([], [atRisk({ id: 'd1', lastMessageAt: daysAgo(15) })], NOW)[0]
    const medium = buildNextBestActions([], [atRisk({ id: 'd2', lastMessageAt: daysAgo(22) })], NOW)[0]
    const high = buildNextBestActions([], [atRisk({ id: 'd3', lastMessageAt: daysAgo(35) })], NOW)[0]
    expect(low.urgency).toBe('low')
    expect(medium.urgency).toBe('medium')
    expect(high.urgency).toBe('high')
  })

  it('sorts by urgency first, then by value within the same urgency', () => {
    const actions = buildNextBestActions(
      [],
      [
        atRisk({ id: 'small-high', value: 100, lastMessageAt: daysAgo(31) }),
        atRisk({ id: 'big-high', value: 9000, lastMessageAt: daysAgo(32) }),
        atRisk({ id: 'big-low', value: 50000, lastMessageAt: daysAgo(15) }),
      ],
      NOW,
    )
    expect(actions.map((a) => a.dealId)).toEqual(['big-high', 'small-high', 'big-low'])
  })

  it('caps the result at NEXT_BEST_ACTION_LIMIT even with many qualifying deals', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      atRisk({ id: `deal-${i}`, lastMessageAt: daysAgo(20 + i) }),
    )
    const actions = buildNextBestActions([], many, NOW)
    expect(actions).toHaveLength(NEXT_BEST_ACTION_LIMIT)
  })

  it('skips an at-risk deal with no lastMessageAt rather than crashing', () => {
    const actions = buildNextBestActions([], [atRisk({ lastMessageAt: null })], NOW)
    expect(actions).toEqual([])
  })
})
