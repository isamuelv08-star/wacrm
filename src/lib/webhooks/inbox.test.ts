import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: unknown[] = []
let failWith: string | null = null
vi.mock('@/lib/whatsapp/webhook-processor', () => ({
  processWebhookPayload: async (payload: unknown) => {
    calls.push(payload)
    if (failWith) throw new Error(failWith)
  },
}))
vi.mock('@/lib/messenger/webhook-processor', () => ({ processMessengerWebhookPayload: vi.fn() }))
vi.mock('@/lib/whatsapp/zernio-webhook-processor', () => ({ processZernioEvent: vi.fn() }))

const { runQueuedWebhook } = await import('./inbox')

interface Row {
  id: string
  source: string
  payload: unknown
  attempts: number
  status: string
  last_error?: string | null
}

/** Minimal in-memory webhook_inbox honoring the eq() filters runQueuedWebhook uses. */
function makeDb(row: Row) {
  function builder() {
    const filters: [string, unknown][] = []
    let patch: Record<string, unknown> | null = null
    const matches = () => filters.every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      update: (p: Record<string, unknown>) => ((patch = p), b),
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      maybeSingle: async () => {
        if (!matches()) return { data: null, error: null }
        if (patch) Object.assign(row, patch)
        return { data: { ...row }, error: null }
      },
      then: (onF: (v: unknown) => unknown) => {
        if (patch && matches()) Object.assign(row, patch)
        return Promise.resolve({ data: null, error: null }).then(onF)
      },
    }
    return b
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => builder() } as any
}

beforeEach(() => {
  calls.length = 0
  failWith = null
})

describe('runQueuedWebhook', () => {
  it('claims, processes and marks the event done', async () => {
    const row: Row = { id: 'w1', source: 'meta', payload: { entry: [] }, attempts: 0, status: 'pending' }
    await runQueuedWebhook(makeDb(row), 'w1')
    expect(calls).toEqual([{ entry: [] }])
    expect(row).toMatchObject({ status: 'done', attempts: 1 })
  })

  it('does nothing for an event that is already done', async () => {
    const row: Row = { id: 'w1', source: 'meta', payload: {}, attempts: 1, status: 'done' }
    await runQueuedWebhook(makeDb(row), 'w1')
    expect(calls).toEqual([])
  })

  it('puts a failed event back to pending, and gives up after 5 attempts', async () => {
    failWith = 'db down'
    const row: Row = { id: 'w1', source: 'dualhook', payload: {}, attempts: 0, status: 'pending' }
    await runQueuedWebhook(makeDb(row), 'w1')
    expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'db down' })

    row.attempts = 4
    await runQueuedWebhook(makeDb(row), 'w1')
    expect(row).toMatchObject({ status: 'failed', attempts: 5 })
  })
})
