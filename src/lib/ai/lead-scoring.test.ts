import { describe, it, expect } from 'vitest'
import { applyLeadScore, ensureDealInQualifiedStage } from './lead-scoring'

interface Op {
  table: string
  type: 'select' | 'update' | 'insert'
  payload?: unknown
  filters: [string, string, unknown][]
}

function makeDb(handlers: Record<string, (op: Op) => { data: unknown; error: unknown }>) {
  const calls: Op[] = []

  function builder(table: string) {
    const ops: Op = { table, type: 'select', payload: undefined, filters: [] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(['eq', k, v]), b),
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    }
    function resolve() {
      calls.push({ ...ops })
      const handler = handlers[table]
      return handler ? handler({ ...ops }) : { data: null, error: null }
    }
    return b
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = { from: (t: string) => builder(t) } as any
  return { db, calls }
}

const ARGS = { accountId: 'acct-1', contactId: 'contact-1', configOwnerUserId: 'user-1' }

describe('applyLeadScore', () => {
  it('persists the score for any value', async () => {
    const { db, calls } = makeDb({})
    await applyLeadScore(db, { ...ARGS, score: 'warm' })
    const contactUpdate = calls.find((c) => c.table === 'contacts' && c.type === 'update')
    expect(contactUpdate?.payload).toMatchObject({ lead_score: 'warm' })
  })

  it('defaults reason to null and source to "ai" when omitted', async () => {
    const { db, calls } = makeDb({})
    await applyLeadScore(db, { ...ARGS, score: 'warm' })
    const contactUpdate = calls.find((c) => c.table === 'contacts' && c.type === 'update')
    expect(contactUpdate?.payload).toMatchObject({ lead_score_reason: null, lead_score_source: 'ai' })
  })

  it('persists an explicit reason and a manual source', async () => {
    const { db, calls } = makeDb({})
    await applyLeadScore(db, {
      ...ARGS,
      score: 'hot',
      reason: 'Corrected by agent after reviewing the call.',
      source: 'manual',
    })
    const contactUpdate = calls.find((c) => c.table === 'contacts' && c.type === 'update')
    expect(contactUpdate?.payload).toMatchObject({
      lead_score_reason: 'Corrected by agent after reviewing the call.',
      lead_score_source: 'manual',
    })
  })

  it('does not touch deals for a non-hot score', async () => {
    const { db, calls } = makeDb({})
    await applyLeadScore(db, { ...ARGS, score: 'cold' })
    expect(calls.some((c) => c.table === 'deals')).toBe(false)
  })

  it('advances the open deal to the qualified stage for a hot score', async () => {
    const { db, calls } = makeDb({
      deals: (op) => {
        if (op.type === 'select') {
          return { data: { id: 'deal-1', pipeline_id: 'pl-1', stage_id: 'stage-open' }, error: null }
        }
        return { data: null, error: null }
      },
      pipeline_stages: () => ({ data: { id: 'stage-qualified' }, error: null }),
    })
    await applyLeadScore(db, { ...ARGS, score: 'hot' })
    const dealUpdate = calls.find((c) => c.table === 'deals' && c.type === 'update')
    expect(dealUpdate?.payload).toMatchObject({ stage_id: 'stage-qualified' })
  })

  it('is a no-op when the deal is already in the qualified stage', async () => {
    const { db, calls } = makeDb({
      deals: (op) => {
        if (op.type === 'select') {
          return {
            data: { id: 'deal-1', pipeline_id: 'pl-1', stage_id: 'stage-qualified' },
            error: null,
          }
        }
        return { data: null, error: null }
      },
      pipeline_stages: () => ({ data: { id: 'stage-qualified' }, error: null }),
    })
    await applyLeadScore(db, { ...ARGS, score: 'hot' })
    expect(calls.some((c) => c.table === 'deals' && c.type === 'update')).toBe(false)
  })
})

describe('ensureDealInQualifiedStage', () => {
  it('creates a deal directly in the qualified stage when the contact has none open', async () => {
    const { db, calls } = makeDb({
      deals: (op) => (op.type === 'select' ? { data: null, error: null } : { data: null, error: null }),
      pipelines: () => ({ data: { id: 'pl-1' }, error: null }),
      pipeline_stages: () => ({ data: { id: 'stage-qualified' }, error: null }),
      contacts: () => ({ data: { name: 'Jane Doe', phone: '+15551234' }, error: null }),
      accounts: () => ({ data: { default_currency: 'EUR' }, error: null }),
    })
    await ensureDealInQualifiedStage(db, ARGS)
    const dealInsert = calls.find((c) => c.table === 'deals' && c.type === 'insert')
    expect(dealInsert?.payload).toMatchObject({
      pipeline_id: 'pl-1',
      stage_id: 'stage-qualified',
      contact_id: 'contact-1',
      title: 'Jane Doe',
      currency: 'EUR',
      status: 'open',
    })
  })

  it('skips deal creation when the account has no pipeline yet', async () => {
    const { db, calls } = makeDb({
      deals: () => ({ data: null, error: null }),
      pipelines: () => ({ data: null, error: null }),
    })
    await ensureDealInQualifiedStage(db, ARGS)
    expect(calls.some((c) => c.table === 'deals' && c.type === 'insert')).toBe(false)
  })

  it('leaves the deal in place when the pipeline has no qualified stage configured', async () => {
    const { db, calls } = makeDb({
      deals: (op) =>
        op.type === 'select'
          ? { data: { id: 'deal-1', pipeline_id: 'pl-1', stage_id: 'stage-open' }, error: null }
          : { data: null, error: null },
      pipeline_stages: () => ({ data: null, error: null }),
    })
    await ensureDealInQualifiedStage(db, ARGS)
    expect(calls.some((c) => c.table === 'deals' && c.type === 'update')).toBe(false)
  })

  it('never throws even when a write fails', async () => {
    const { db } = makeDb({
      deals: (op) =>
        op.type === 'select'
          ? { data: { id: 'deal-1', pipeline_id: 'pl-1', stage_id: 'stage-open' }, error: null }
          : { data: null, error: { message: 'db down' } },
      pipeline_stages: () => ({ data: { id: 'stage-qualified' }, error: null }),
    })
    await expect(ensureDealInQualifiedStage(db, ARGS)).resolves.toBeUndefined()
  })
})
