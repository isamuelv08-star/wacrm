import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runHotLeadAlertScan } from './hot-lead-alerts'

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    account_id: 'acct-1',
    assigned_agent_id: null,
    hot_lead_last_alerted_message_at: null,
    contact_id: 'contact-1',
    contacts: { lead_score: 'hot', name: 'Jane Lead', phone: '+15551234567' },
    accounts: { hot_lead_alert_minutes: 15 },
    ...overrides,
  }
}

function makeDb(opts: {
  candidates?: unknown[]
  messagesByConv?: Record<string, { sender_type: string; created_at: string } | null>
  profiles?: { user_id: string }[]
}) {
  const inserted: Record<string, unknown>[] = []
  const updated: { id: string; payload: Record<string, unknown> }[] = []

  const db = {
    from(table: string) {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: opts.candidates ?? [], error: null }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              updated.push({ id, payload })
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: (_col: string, convId: string) => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: opts.messagesByConv?.[convId] ?? null,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'notifications') {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            inserted.push(...rows)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: opts.profiles ?? [], error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
  return { db: db as unknown as SupabaseClient, inserted, updated }
}

describe('runHotLeadAlertScan', () => {
  it('alerts the assigned agent when the customer has waited past the threshold', async () => {
    const { db, inserted, updated } = makeDb({
      candidates: [baseCandidate({ assigned_agent_id: 'agent-1' })],
      messagesByConv: {
        'conv-1': { sender_type: 'customer', created_at: minutesAgo(20) },
      },
    })
    const result = await runHotLeadAlertScan(db)
    expect(result).toEqual({ scanned: 1, alerted: 1 })
    expect(inserted).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        user_id: 'agent-1',
        type: 'hot_lead_unanswered',
        conversation_id: 'conv-1',
        contact_id: 'contact-1',
      }),
    ])
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('conv-1')
  })

  it('alerts every owner/admin when unassigned', async () => {
    const { db, inserted } = makeDb({
      candidates: [baseCandidate({ assigned_agent_id: null })],
      messagesByConv: {
        'conv-1': { sender_type: 'customer', created_at: minutesAgo(20) },
      },
      profiles: [{ user_id: 'owner-1' }, { user_id: 'admin-1' }],
    })
    await runHotLeadAlertScan(db)
    expect(inserted.map((n) => n.user_id)).toEqual(['owner-1', 'admin-1'])
  })

  it('skips when the account disabled the feature (0 minutes)', async () => {
    const { db, inserted } = makeDb({
      candidates: [baseCandidate({ accounts: { hot_lead_alert_minutes: 0 } })],
      messagesByConv: {
        'conv-1': { sender_type: 'customer', created_at: minutesAgo(999) },
      },
    })
    const result = await runHotLeadAlertScan(db)
    expect(result.alerted).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  it('skips when the last message is not from the customer', async () => {
    const { db, inserted } = makeDb({
      candidates: [baseCandidate({ assigned_agent_id: 'agent-1' })],
      messagesByConv: {
        'conv-1': { sender_type: 'agent', created_at: minutesAgo(999) },
      },
    })
    await runHotLeadAlertScan(db)
    expect(inserted).toHaveLength(0)
  })

  it('skips when the wait is still under the threshold', async () => {
    const { db, inserted } = makeDb({
      candidates: [baseCandidate({ assigned_agent_id: 'agent-1' })],
      messagesByConv: {
        'conv-1': { sender_type: 'customer', created_at: minutesAgo(5) },
      },
    })
    await runHotLeadAlertScan(db)
    expect(inserted).toHaveLength(0)
  })

  it('does not re-alert the same unanswered message twice', async () => {
    const lastMessageAt = minutesAgo(20)
    const { db, inserted } = makeDb({
      candidates: [
        baseCandidate({
          assigned_agent_id: 'agent-1',
          hot_lead_last_alerted_message_at: lastMessageAt,
        }),
      ],
      messagesByConv: {
        'conv-1': { sender_type: 'customer', created_at: lastMessageAt },
      },
    })
    await runHotLeadAlertScan(db)
    expect(inserted).toHaveLength(0)
  })

  it('re-alerts once a newer unanswered customer message arrives', async () => {
    const { db, inserted } = makeDb({
      candidates: [
        baseCandidate({
          assigned_agent_id: 'agent-1',
          hot_lead_last_alerted_message_at: minutesAgo(60),
        }),
      ],
      messagesByConv: {
        'conv-1': { sender_type: 'customer', created_at: minutesAgo(20) },
      },
    })
    await runHotLeadAlertScan(db)
    expect(inserted).toHaveLength(1)
  })

  it('skips a conversation with no messages at all', async () => {
    const { db, inserted } = makeDb({
      candidates: [baseCandidate()],
      messagesByConv: {},
    })
    await runHotLeadAlertScan(db)
    expect(inserted).toHaveLength(0)
  })

  it('returns zero counts when there are no HOT candidates', async () => {
    const { db } = makeDb({ candidates: [] })
    expect(await runHotLeadAlertScan(db)).toEqual({ scanned: 0, alerted: 0 })
  })
})
