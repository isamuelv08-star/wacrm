import { describe, it, expect, vi } from 'vitest'

vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({}) }))

const { hasMatchingAutoResponder } = await import('./responders')

interface Fixture {
  automations: { id: string; trigger_type: string; trigger_config: unknown }[]
  latestText: string
  sendingStepFor: string[]
}

function makeDb(f: Fixture) {
  function builder(table: string) {
    const filters: [string, unknown][] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      eq: (k: string, v: unknown) => (filters.push([k, v]), b),
      in: (k: string, v: unknown) => (filters.push([k, v]), b),
      order: () => b,
      limit: () => b,
      maybeSingle: async () => resolve(true),
      then: (onF: (v: unknown) => unknown) => Promise.resolve(resolve(false)).then(onF),
    }
    function resolve(single: boolean) {
      if (table === 'automations') return { data: f.automations, error: null }
      if (table === 'messages') return { data: { content_text: f.latestText }, error: null }
      if (table === 'automation_steps') {
        const ids = (filters.find(([k]) => k === 'automation_id')?.[1] as string[]) ?? []
        const hit = ids.find((id) => f.sendingStepFor.includes(id))
        return { data: hit ? (single ? { id: 'step' } : [{ id: 'step' }]) : null, error: null }
      }
      return { data: null, error: null }
    }
    return b
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => builder(t) } as any
}

const ARGS = { accountId: 'a', conversationId: 'c', platform: 'whatsapp' }
const keyword = (id: string, kw: string) => ({
  id,
  trigger_type: 'keyword_match',
  trigger_config: { keywords: [kw], match_type: 'contains' },
})

describe('hasMatchingAutoResponder', () => {
  it('is false with no automations', async () => {
    const db = makeDb({ automations: [], latestText: 'hola', sendingStepFor: [] })
    expect(await hasMatchingAutoResponder(db, ARGS)).toBe(false)
  })

  it('is false when the keyword does not match this message', async () => {
    const db = makeDb({
      automations: [keyword('k1', 'catálogo')],
      latestText: 'precio de la 205/55R16',
      sendingStepFor: ['k1'],
    })
    expect(await hasMatchingAutoResponder(db, ARGS)).toBe(false)
  })

  it('is true when a matching keyword automation sends a reply', async () => {
    const db = makeDb({
      automations: [keyword('k1', 'catálogo')],
      latestText: 'me pasas el catálogo?',
      sendingStepFor: ['k1'],
    })
    expect(await hasMatchingAutoResponder(db, ARGS)).toBe(true)
  })

  it('is false when the matching automation only tags (no send step)', async () => {
    const db = makeDb({
      automations: [{ id: 'n1', trigger_type: 'new_message_received', trigger_config: {} }],
      latestText: 'hola',
      sendingStepFor: [],
    })
    expect(await hasMatchingAutoResponder(db, ARGS)).toBe(false)
  })

  it('is always false outside WhatsApp, where automations never run', async () => {
    const db = makeDb({
      automations: [{ id: 'n1', trigger_type: 'new_message_received', trigger_config: {} }],
      latestText: 'hola',
      sendingStepFor: ['n1'],
    })
    expect(await hasMatchingAutoResponder(db, { ...ARGS, platform: 'messenger' })).toBe(false)
  })
})
