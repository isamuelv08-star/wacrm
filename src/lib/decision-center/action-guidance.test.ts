import { describe, expect, it } from 'vitest'
import { buildActionGuidance } from './action-guidance'
import type { Insight } from '@/lib/sales-intelligence/insights'

const insight = (over: Partial<Insight> = {}): Insight => ({
  type: 'stalled_deals',
  category: 'attention',
  severity: 'high',
  titleKey: 'x',
  descriptionKey: 'y',
  params: {},
  metricValue: null,
  valueAtRisk: null,
  entityIds: [],
  evidence: { count: null, value: null, entityIds: [], facts: {} },
  action: { kind: 'goToPipeline' },
  detectedAt: '2026-09-23T00:00:00.000Z',
  ...over,
})

describe('buildActionGuidance', () => {
  it('gives a specific instruction for every known insight type', () => {
    const types: Insight['type'][] = [
      'forecast_gap',
      'low_pipeline_coverage',
      'stalled_deals',
      'win_rate_decline',
      'sales_cycle_increase',
      'at_risk_customers',
      'broken_promises',
      'hot_leads_unanswered',
    ]
    for (const type of types) {
      const guidance = buildActionGuidance(insight({ type }))
      expect(guidance).not.toBeNull()
      expect(guidance!.length).toBeGreaterThan(10)
    }
  })

  it('cites the real contact name and days for a follow-up-stalled insight, never a generic message', () => {
    const guidance = buildActionGuidance(
      insight({ type: 'follow_up_stalled', params: { contactName: 'María', days: 10 } }),
    )
    expect(guidance).toContain('María')
    expect(guidance).toContain('10')
  })

  it('falls back to a generic contact reference when no contact name was captured', () => {
    const guidance = buildActionGuidance(insight({ type: 're_engage_silent', params: { days: 5 } }))
    expect(guidance).toContain('este contacto')
    expect(guidance).toContain('5')
  })

  it('cites the real contact name for a recovery opportunity', () => {
    const guidance = buildActionGuidance(insight({ type: 'recovery_opportunity', params: { contactName: 'Pedro' } }))
    expect(guidance).toContain('Pedro')
  })
})
