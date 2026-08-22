import Zernio from '@zernio/node'

// ============================================================
// Shared Zernio SDK client for the send/receive bridge. Lazily
// constructed (same pattern as supabaseAdmin() in webhook-processor.ts)
// so importing this module never crashes a build that hasn't set
// ZERNIO_API_KEY — the error only surfaces when a Zernio-connected
// account actually tries to send or receive.
//
// baseURL must include the `/api` prefix: the SDK's generated
// endpoints are relative paths like `/v1/inbox/conversations`, and
// Zernio serves its API under https://zernio.com/api/v1/... — this
// mirrors the raw fetch() base used by /api/zernio/connect/[platform]
// (`new URL('/api/v1/profiles', zernioBase)`).
// ============================================================

let _client: Zernio | null = null

export function zernioClient(): Zernio {
  if (!_client) {
    const apiKey = process.env.ZERNIO_API_KEY
    if (!apiKey) {
      throw new Error('ZERNIO_API_KEY is not configured')
    }
    const zernioBase = process.env.ZERNIO_API_BASE_URL || 'https://zernio.com'
    _client = new Zernio({ apiKey, baseURL: `${zernioBase}/api` })
  }
  return _client
}
