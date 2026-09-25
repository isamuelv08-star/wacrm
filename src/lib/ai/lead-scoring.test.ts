import { describe, it, expect } from 'vitest'
import { applyLeadScore, ensureDealInQualifiedStage } from './lead-scoring'

interface Op {
  table: string
  type: 'select' | 'update' | 'insert' | 'delete' | 'rpc'
  payload?: unknown
  filters: [string, string, unknown][]
}

type Handler = (op: Op) => { data: unknown; error: unknown }

function makeDb(handlers: Record<string, Handler>) {
  const calls: Op[] = []

  function builder(table: string) {
    const ops: Op = { table, type: 'select', payload: undefined, filters: [] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      update: (p: unknown) => ((ops.type = 'update'), (ops.payload = p), b),
      insert: (p: unknown) => ((ops.type = 'insert'), (ops.payload = p), b),
      delete: () => ((ops.type = 'delete'), b),
      eq: (k: string, v: unknown) => (ops.filters.push(['eq', k, v]), b),
      in: (k: string, v: unknown) => (ops.filters.push(['in', k, v]), b),
      gte: (k: string, v: unknown) => (ops.filters.push(['gte', k, v]), b),
      order: () => b,
      limit: () => b,
      maybeSingle: () => Promise.resolve(resolve()),
      single: () => Promise.resolve(resolve()),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    }
    function resolve() {
      calls.push({ ...ops, filters: [...ops.filters] })
      const handler = handlers[table]
      return handler ? handler({ ...ops }) : { data: null, error: null }
    }
    return b
  }

  const db = {
    from: (t: string) => builder(t),
    rpc: (fn: string, payload: unknown) => {
      const op: Op = { table: fn, type: 'rpc', payload, filters: [] }
      calls.push(op)
      const handler = handlers[`rpc:${fn}`]
      return Promise.resolve(handler ? handler(op) : { data: null, error: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  return { db, calls }
}

const ARGS = { accountId: 'acct-1', contactId: 'contact-1', configOwnerUserId: 'user-1' }

// A 5-stage pipeline: new(0) → qualified(1) → proposal(2) → won(3),
// plus the follow-up stage appended at the end (4).
const STAGES = [
  { id: 'stage-new', position: 0, is_qualified_stage: false, is_followup_stage: false, is_won_stage: false, is_lost_stage: false },
  { id: 'stage-qualified', position: 1, is_qualified_stage: true, is_followup_stage: false, is_won_stage: false, is_lost_stage: false },
  { id: 'stage-proposal', position: 2, is_qualified_stage: false, is_followup_stage: false, is_won_stage: false, is_lost_stage: false },
  { id: 'stage-won', position: 3, is_qualified_stage: false, is_followup_stage: false, is_won_stage: true, is_lost_stage: false },
  { id: 'stage-followup', position: 4, is_qualified_stage: false, is_followup_stage: true, is_won_stage: false, is_lost_stage: false },
]

const stagesHandler: Handler = (op) =>
  op.filters.some(([, k]) => k === 'is_qualified_stage')
    ? { data: { id: 'stage-qualified' }, error: null }
    : { data: STAGES, error: null }

const isOpenLookup = (op: Op) =>
  op.type === 'select' && op.filters.some(([f, k, v]) => f === 'eq' && k === 'status' && v === 'open')
const isClosedLookup = (op: Op) =>
  op.type === 'select' && op.filters.some(([f, k]) => f === 'in' && k === 'status')

function openDealDb(stageId: string, extra: Record<string, Handler> = {}) {
  return makeDb({
    deals: (op) =>
      isOpenLookup(op)
        ? { data: { id: 'deal-1', pipeline_id: 'pl-1', stage_id: stageId, assigned_to: 'p-1' }, error: null }
        : { data: null, error: null },
    pipeline_stages: stagesHandler,
    ...extra,
  })
}

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
    const { db, calls } = openDealDb('stage-new')
    await applyLeadScore(db, { ...ARGS, score: 'hot' })
    const dealUpdate = calls.find((c) => c.table === 'deals' && c.type === 'update')
    expect(dealUpdate?.payload).toMatchObject({ stage_id: 'stage-qualified' })
  })

  it('does not let the AI overwrite a recent manual score', async () => {
    const { db, calls } = makeDb({
      contacts: (op) =>
        op.type === 'select'
          ? {
              data: {
                lead_score: 'cold',
                lead_score_source: 'manual',
                lead_score_updated_at: new Date().toISOString(),
              },
              error: null,
            }
          : { data: null, error: null },
    })
    await applyLeadScore(db, { ...ARGS, score: 'hot' })
    expect(calls.some((c) => c.table === 'contacts' && c.type === 'update')).toBe(false)
    expect(calls.some((c) => c.table === 'deals')).toBe(false)
  })

  it('lets the AI re-score once the manual hold has expired', async () => {
    const { db, calls } = makeDb({
      contacts: (op) =>
        op.type === 'select'
          ? {
              data: {
                lead_score: 'cold',
                lead_score_source: 'manual',
                lead_score_updated_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
              },
              error: null,
            }
          : { data: null, error: null },
    })
    await applyLeadScore(db, { ...ARGS, score: 'warm' })
    expect(calls.some((c) => c.table === 'contacts' && c.type === 'update')).toBe(true)
  })

  it('routes deal effects through dealDb when given', async () => {
    const scoreDb = makeDb({})
    const dealDb = openDealDb('stage-new')
    await applyLeadScore(scoreDb.db, { ...ARGS, score: 'hot', dealDb: dealDb.db })
    expect(scoreDb.calls.some((c) => c.table === 'deals')).toBe(false)
    expect(dealDb.calls.some((c) => c.table === 'deals' && c.type === 'update')).toBe(true)
  })
})

describe('ensureDealInQualifiedStage', () => {
  it('is a no-op when the deal is already in the qualified stage', async () => {
    const { db, calls } = openDealDb('stage-qualified')
    await ensureDealInQualifiedStage(db, ARGS)
    expect(calls.some((c) => c.table === 'deals' && c.type === 'update')).toBe(false)
  })

  it('never moves a deal that is already past the qualified stage backwards', async () => {
    const { db, calls } = openDealDb('stage-proposal')
    await ensureDealInQualifiedStage(db, ARGS)
    expect(calls.some((c) => c.table === 'deals' && c.type === 'update')).toBe(false)
  })

  it('brings a deal back from the follow-up stage', async () => {
    const { db, calls } = openDealDb('stage-followup')
    await ensureDealInQualifiedStage(db, ARGS)
    const dealUpdate = calls.find((c) => c.table === 'deals' && c.type === 'update')
    expect(dealUpdate?.payload).toMatchObject({ stage_id: 'stage-qualified' })
  })

  it('creates a deal in the qualified stage through ensure_open_deal when none is open', async () => {
    const { db, calls } = makeDb({
      deals: () => ({ data: null, error: null }),
      pipelines: () => ({ data: { id: 'pl-1' }, error: null }),
      pipeline_stages: stagesHandler,
      contacts: () => ({ data: { name: 'Jane Doe', phone: '+15551234' }, error: null }),
      accounts: () => ({ data: { default_currency: 'EUR' }, error: null }),
      'rpc:ensure_open_deal': () => ({ data: [{ deal_id: 'deal-new', created: true }], error: null }),
    })
    await ensureDealInQualifiedStage(db, { ...ARGS, conversationId: 'conv-1' })
    const rpc = calls.find((c) => c.type === 'rpc' && c.table === 'ensure_open_deal')
    expect(rpc?.payload).toMatchObject({
      p_account_id: 'acct-1',
      p_contact_id: 'contact-1',
      p_pipeline_id: 'pl-1',
      p_stage_id: 'stage-qualified',
      p_title: 'Jane Doe',
      p_currency: 'EUR',
      p_conversation_id: 'conv-1',
    })
    expect(calls.some((c) => c.table === 'deals' && c.type === 'insert')).toBe(false)
  })

  it('advances the deal that won a creation race instead of creating another', async () => {
    const { db, calls } = makeDb({
      deals: (op) =>
        op.type === 'select' && op.filters.some(([, k, v]) => k === 'id' && v === 'deal-raced')
          ? { data: { id: 'deal-raced', pipeline_id: 'pl-1', stage_id: 'stage-new', assigned_to: 'p-1' }, error: null }
          : { data: null, error: null },
      pipelines: () => ({ data: { id: 'pl-1' }, error: null }),
      pipeline_stages: stagesHandler,
      contacts: () => ({ data: { name: 'Jane Doe', phone: '+15551234' }, error: null }),
      accounts: () => ({ data: { default_currency: 'EUR' }, error: null }),
      'rpc:ensure_open_deal': () => ({ data: [{ deal_id: 'deal-raced', created: false }], error: null }),
    })
    await ensureDealInQualifiedStage(db, ARGS)
    const update = calls.find((c) => c.table === 'deals' && c.type === 'update')
    expect(update?.payload).toMatchObject({ stage_id: 'stage-qualified' })
    expect(update?.filters).toContainEqual(['eq', 'id', 'deal-raced'])
  })

  it('falls back to a plain insert when ensure_open_deal is not deployed yet', async () => {
    const { db, calls } = makeDb({
      deals: (op) => {
        if (op.type === 'insert') return { data: { id: 'deal-new' }, error: null }
        // keepOnlyOldestOpenDeal's check (after insert) sees only ours.
        if (calls.some((c) => c.type === 'insert') && isOpenLookup(op)) {
          return { data: [{ id: 'deal-new' }], error: null }
        }
        return { data: null, error: null }
      },
      pipelines: () => ({ data: { id: 'pl-1' }, error: null }),
      pipeline_stages: stagesHandler,
      contacts: () => ({ data: { name: 'Jane Doe', phone: '+15551234' }, error: null }),
      accounts: () => ({ data: { default_currency: 'EUR' }, error: null }),
      'rpc:ensure_open_deal': () => ({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.ensure_open_deal' },
      }),
    })
    await ensureDealInQualifiedStage(db, ARGS)
    const insert = calls.find((c) => c.table === 'deals' && c.type === 'insert')
    expect(insert?.payload).toMatchObject({ stage_id: 'stage-qualified', status: 'open' })
    expect(calls.some((c) => c.table === 'deals' && c.type === 'delete')).toBe(false)
  })

  it('does not create a phantom deal right after the previous one closed', async () => {
    const { db, calls } = makeDb({
      deals: (op) =>
        isClosedLookup(op) ? { data: { id: 'deal-won' }, error: null } : { data: null, error: null },
      pipelines: () => ({ data: { id: 'pl-1' }, error: null }),
      pipeline_stages: stagesHandler,
    })
    await ensureDealInQualifiedStage(db, ARGS)
    expect(calls.some((c) => c.type === 'rpc')).toBe(false)
    expect(calls.some((c) => c.table === 'deals' && c.type === 'insert')).toBe(false)
  })

  it('skips deal creation when the account has no pipeline yet', async () => {
    const { db, calls } = makeDb({
      deals: () => ({ data: null, error: null }),
      pipelines: () => ({ data: null, error: null }),
    })
    await ensureDealInQualifiedStage(db, ARGS)
    expect(calls.some((c) => c.type === 'rpc')).toBe(false)
    expect(calls.some((c) => c.table === 'deals' && c.type === 'insert')).toBe(false)
  })

  it('leaves the deal in place when the pipeline has no qualified stage configured', async () => {
    const { db, calls } = openDealDb('stage-new', {
      pipeline_stages: () => ({ data: STAGES.map((s) => ({ ...s, is_qualified_stage: false })), error: null }),
    })
    await ensureDealInQualifiedStage(db, ARGS)
    expect(calls.some((c) => c.table === 'deals' && c.type === 'update')).toBe(false)
  })

  it('never throws even when a write fails', async () => {
    const { db } = makeDb({
      deals: (op) =>
        isOpenLookup(op)
          ? { data: { id: 'deal-1', pipeline_id: 'pl-1', stage_id: 'stage-new', assigned_to: 'p-1' }, error: null }
          : { data: null, error: { message: 'db down' } },
      pipeline_stages: stagesHandler,
    })
    await expect(ensureDealInQualifiedStage(db, ARGS)).resolves.toBeUndefined()
  })
})
