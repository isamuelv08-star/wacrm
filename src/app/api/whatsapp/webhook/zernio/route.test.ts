import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- What the mocked Supabase admin client returns -------------------------
let existingMessage: { id: string } | null = null

const recordExternalOutboundMessage = vi.fn()
const processMessage = vi.fn()
const applyMessageStatusUpdate = vi.fn()
const applyMessageDeletedUpdate = vi.fn()

function query(result: unknown) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'limit', 'update']) q[m] = () => q
  q.maybeSingle = async () => ({ data: result, error: null })
  return q
}

vi.mock('@/lib/whatsapp/webhook-processor', () => ({
  processMessage: (...a: unknown[]) => processMessage(...a),
  applyMessageStatusUpdate: (...a: unknown[]) => applyMessageStatusUpdate(...a),
  applyMessageDeletedUpdate: (...a: unknown[]) => applyMessageDeletedUpdate(...a),
  recordExternalOutboundMessage: (...a: unknown[]) => recordExternalOutboundMessage(...a),
  supabaseAdmin: () => ({
    from: (table: string) =>
      table === 'client_zernio_accounts'
        ? query({ account_id: 'acc-1', connected_by_user_id: 'user-1' })
        : query(existingMessage),
  }),
}))
vi.mock('@/lib/messenger/webhook-processor', () => ({ ingestMessengerMessage: vi.fn() }))

// `after()` only works inside a request scope — run its callback and let the
// test await it.
const pending: Promise<unknown>[] = []
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => Promise<unknown>) => void pending.push(fn()) }
})

const SECRET = 'test-webhook-secret'
const { POST } = await import('./route')

async function deliver(payload: unknown) {
  const raw = JSON.stringify(payload)
  const signature = crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  const res = await POST(
    new Request('https://app.test/api/whatsapp/webhook/zernio', {
      method: 'POST',
      headers: { 'x-zernio-signature': signature },
      body: raw,
    }),
  )
  await Promise.all(pending.splice(0))
  return res
}

const phoneSent = (over: Record<string, unknown> = {}, source: unknown = 'whatsapp_business_app') => ({
  event: 'message.sent',
  account: { id: 'zacc-1', platform: 'whatsapp' },
  message: {
    platform: 'whatsapp',
    platformMessageId: 'wamid.PHONE1',
    direction: 'outgoing',
    source,
    text: 'Hola, te escribo desde el celular',
    sentAt: '2026-09-19T12:00:00.000Z',
    ...over,
  },
  conversation: { id: 'zconv-1', participantId: '+593999111222', participantName: 'María' },
})

beforeEach(() => {
  process.env.ZERNIO_WEBHOOK_SECRET = SECRET
  existingMessage = null
  vi.clearAllMocks()
  pending.length = 0
})

describe('Zernio webhook — messages typed in the WhatsApp Business phone app', () => {
  it('records a message.sent from the phone app against the CUSTOMER, flagged as phone, with its real time', async () => {
    const res = await deliver(phoneSent())
    expect(res.status).toBe(200)

    expect(recordExternalOutboundMessage).toHaveBeenCalledTimes(1)
    const [msg, customerPhone, customerName, accountId, ownerUserId, zernioConv, sentFromPhone] =
      recordExternalOutboundMessage.mock.calls[0]
    expect(msg.id).toBe('wamid.PHONE1')
    expect(msg.text.body).toBe('Hola, te escribo desde el celular')
    expect(msg.timestamp).toBe(String(Math.floor(Date.parse('2026-09-19T12:00:00.000Z') / 1000)))
    // The thread is the customer's — never our own business number.
    expect(customerPhone).toBe('593999111222')
    expect(customerName).toBe('María')
    expect(accountId).toBe('acc-1')
    expect(ownerUserId).toBe('user-1')
    expect(zernioConv).toBe('zconv-1')
    expect(sentFromPhone).toBe(true)
    // It is not an inbound customer message: no AI / automations / assignment.
    expect(processMessage).not.toHaveBeenCalled()
  })

  it('does not record a message.sent that went out through the Cloud API (the CRM already saved it)', async () => {
    await deliver(phoneSent({}, 'cloud_api'))
    expect(recordExternalOutboundMessage).not.toHaveBeenCalled()
    expect(processMessage).not.toHaveBeenCalled()
  })

  it('does not duplicate a phone message it has already stored', async () => {
    existingMessage = { id: 'row-1' }
    await deliver(phoneSent())
    expect(recordExternalOutboundMessage).not.toHaveBeenCalled()
  })

  it('skips an event whose conversation has no participant to attach it to', async () => {
    const payload = phoneSent()
    payload.conversation = { id: 'zconv-1', participantId: undefined, participantName: 'x' } as never
    await deliver(payload)
    expect(recordExternalOutboundMessage).not.toHaveBeenCalled()
  })

  it('rejects an unsigned request', async () => {
    const res = await POST(
      new Request('https://app.test/api/whatsapp/webhook/zernio', {
        method: 'POST',
        body: JSON.stringify(phoneSent()),
      }),
    )
    expect(res.status).toBe(401)
    expect(recordExternalOutboundMessage).not.toHaveBeenCalled()
  })
})

describe('Zernio webhook — existing behaviour is unchanged', () => {
  it('still sends an incoming customer message through processMessage', async () => {
    await deliver({
      event: 'message.received',
      account: { id: 'zacc-1' },
      message: {
        platform: 'whatsapp',
        platformMessageId: 'wamid.IN1',
        direction: 'incoming',
        text: 'Hola',
        sender: { id: '593999111222', name: 'María' },
        sentAt: '2026-09-19T12:00:00.000Z',
      },
      conversation: { id: 'zconv-1', participantId: '+593999111222' },
    })
    expect(processMessage).toHaveBeenCalledTimes(1)
    expect(recordExternalOutboundMessage).not.toHaveBeenCalled()
  })

  // Regression test for the "not every phone message gets the badge" bug:
  // Zernio doesn't always report an outgoing WhatsApp message via
  // `message.sent` (the only event carrying `source`) — this legacy
  // `message.received` + direction "outgoing" shape still arrives too,
  // and it has no `source` field at all. It used to hard-code
  // `sentFromPhone = false` here for exactly that reason, silently
  // recording the message without the "Phone" badge. But by the time
  // this branch runs, the message has already been deduped against
  // everything this CRM itself sent (message_id match, checked just
  // above) — so anything left is external by construction, the phone
  // app in every real case for this account.
  it('records a legacy outgoing message.received AND flags it as phone (it is external either way)', async () => {
    await deliver({
      event: 'message.received',
      account: { id: 'zacc-1' },
      message: {
        platform: 'whatsapp',
        platformMessageId: 'wamid.OUT1',
        direction: 'outgoing',
        text: 'Respuesta',
        sentAt: '2026-09-19T12:00:00.000Z',
      },
      conversation: { id: 'zconv-1', participantId: '+593999111222', participantName: 'María' },
    })
    expect(recordExternalOutboundMessage).toHaveBeenCalledTimes(1)
    expect(recordExternalOutboundMessage.mock.calls[0][6]).toBe(true)
  })

  it('still routes delivery ticks to the status handler', async () => {
    await deliver({
      event: 'message.read',
      account: { id: 'zacc-1' },
      message: { platform: 'whatsapp', platformMessageId: 'wamid.X', sentAt: '2026-09-19T12:00:00.000Z' },
      conversation: { id: 'zconv-1' },
    })
    expect(applyMessageStatusUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('Zernio webhook — message.deleted', () => {
  it('marks a message deleted by its platformMessageId', async () => {
    await deliver({
      event: 'message.deleted',
      account: { id: 'zacc-1' },
      message: { platform: 'whatsapp', platformMessageId: 'wamid.DEL1', direction: 'outgoing' },
      deletedAt: '2026-09-19T12:05:00.000Z',
      conversation: { id: 'zconv-1' },
    })
    expect(applyMessageDeletedUpdate).toHaveBeenCalledTimes(1)
    expect(applyMessageDeletedUpdate).toHaveBeenCalledWith(
      'wamid.DEL1',
      '2026-09-19T12:05:00.000Z',
      '[webhook/zernio]',
    )
    expect(recordExternalOutboundMessage).not.toHaveBeenCalled()
    expect(processMessage).not.toHaveBeenCalled()
  })

  it('falls back to now() when Zernio sends no deletedAt', async () => {
    await deliver({
      event: 'message.deleted',
      account: { id: 'zacc-1' },
      message: { platform: 'whatsapp', platformMessageId: 'wamid.DEL2' },
      conversation: { id: 'zconv-1' },
    })
    expect(applyMessageDeletedUpdate).toHaveBeenCalledTimes(1)
    expect(applyMessageDeletedUpdate.mock.calls[0][0]).toBe('wamid.DEL2')
    expect(typeof applyMessageDeletedUpdate.mock.calls[0][1]).toBe('string')
  })

  it('does nothing when the event carries no platformMessageId', async () => {
    await deliver({
      event: 'message.deleted',
      account: { id: 'zacc-1' },
      message: { platform: 'whatsapp' },
      deletedAt: '2026-09-19T12:05:00.000Z',
      conversation: { id: 'zconv-1' },
    })
    expect(applyMessageDeletedUpdate).not.toHaveBeenCalled()
  })
})
