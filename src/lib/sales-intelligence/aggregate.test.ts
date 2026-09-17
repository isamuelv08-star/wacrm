import { describe, it, expect } from 'vitest'
import type { StalledOpenDeal } from '../dashboard/ceo-queries'
import { aggregateMoneyAtRisk } from './aggregate'

function deal(overrides: Partial<StalledOpenDeal> = {}): StalledOpenDeal {
  return {
    id: 'deal-1',
    value: 1000,
    stageId: 'stage-1',
    assignedTo: 'seller-1',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    lastStageChangeAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('aggregateMoneyAtRisk', () => {
  it('returns all zeros/empty for no stalled deals', () => {
    const result = aggregateMoneyAtRisk([], new Map(), new Map())
    expect(result).toEqual({ totalValue: 0, totalCount: 0, bySeller: [], byStage: [] })
  })

  it('sums totalValue/totalCount across every stalled deal, null value as zero', () => {
    const result = aggregateMoneyAtRisk(
      [deal({ id: 'd1', value: 1000 }), deal({ id: 'd2', value: null }), deal({ id: 'd3', value: 500 })],
      new Map(),
      new Map(),
    )
    expect(result.totalValue).toBe(1500)
    expect(result.totalCount).toBe(3)
  })

  it('groups by seller and by stage independently, resolving names from the lookup maps', () => {
    const sellerNameById = new Map([['seller-1', 'Ana']])
    const stageNameById = new Map([['stage-1', 'Negociación']])
    const result = aggregateMoneyAtRisk(
      [deal({ id: 'd1', value: 1000, assignedTo: 'seller-1', stageId: 'stage-1' })],
      sellerNameById,
      stageNameById,
    )
    expect(result.bySeller).toEqual([{ key: 'seller-1', label: 'Ana', value: 1000, count: 1 }])
    expect(result.byStage).toEqual([{ key: 'stage-1', label: 'Negociación', value: 1000, count: 1 }])
  })

  it('buckets deals with no assignee/stage under a null-label group instead of dropping them', () => {
    const result = aggregateMoneyAtRisk(
      [deal({ id: 'd1', value: 800, assignedTo: null, stageId: null })],
      new Map(),
      new Map(),
    )
    expect(result.bySeller).toHaveLength(1)
    expect(result.bySeller[0].label).toBeNull()
    expect(result.bySeller[0].value).toBe(800)
    expect(result.byStage[0].label).toBeNull()
  })

  it('sorts each breakdown by value descending', () => {
    const result = aggregateMoneyAtRisk(
      [
        deal({ id: 'd1', value: 100, assignedTo: 'seller-a' }),
        deal({ id: 'd2', value: 5000, assignedTo: 'seller-b' }),
        deal({ id: 'd3', value: 900, assignedTo: 'seller-c' }),
      ],
      new Map(),
      new Map(),
    )
    expect(result.bySeller.map((r) => r.key)).toEqual(['seller-b', 'seller-c', 'seller-a'])
  })

  it('accumulates multiple deals for the same seller into one row', () => {
    const result = aggregateMoneyAtRisk(
      [
        deal({ id: 'd1', value: 300, assignedTo: 'seller-1' }),
        deal({ id: 'd2', value: 700, assignedTo: 'seller-1' }),
      ],
      new Map([['seller-1', 'Ana']]),
      new Map(),
    )
    expect(result.bySeller).toEqual([{ key: 'seller-1', label: 'Ana', value: 1000, count: 2 }])
  })
})
