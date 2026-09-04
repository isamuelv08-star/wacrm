import { getMediaUrl, downloadMedia } from './meta-api'

// ============================================================
// Download the raw bytes (+ actual Content-Type) for an inbound media
// attachment, regardless of which provider delivered the message.
// Shared by voice transcription (src/lib/ai/transcribe.ts), image
// description (src/lib/ai/vision.ts), and the Zernio media proxy route
// (src/app/api/whatsapp/media/zernio/[token]/route.ts) — previously
// each of the first two only ever fetched from Meta directly, which is
// why voice transcription and image description silently never ran at
// all for Zernio-connected accounts (every inbound audio message's
// `content_text` stayed null, with nothing in the logs to explain why).
// ============================================================

export interface DownloadedMedia {
  buffer: Buffer
  mimeType: string
}

export interface DownloadInboundMediaArgs {
  provider: 'meta' | 'zernio'
  /** Meta media id (provider='meta'), or the base64url-encoded Zernio
   *  attachment URL (provider='zernio') — see webhook/zernio/route.ts's
   *  adaptZernioMessage, which stashes that encoded URL in the same
   *  `id` field a real Meta media id would occupy. */
  mediaId: string
  /** Required for provider='meta'; ignored for provider='zernio' (which
   *  authenticates with ZERNIO_API_KEY instead). */
  accessToken?: string
}

export class InboundMediaError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'InboundMediaError'
    this.status = status
  }
}

async function downloadZernioMedia(token: string): Promise<DownloadedMedia> {
  const apiKey = process.env.ZERNIO_API_KEY
  if (!apiKey) {
    throw new InboundMediaError('Zernio is not configured on this server.', 500)
  }

  let mediaUrl: string
  try {
    mediaUrl = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    throw new InboundMediaError('Invalid media token.', 400)
  }

  // Defense in depth: the token is server-generated (base64url of a URL
  // Zernio itself gave us in a signed webhook), but decoding arbitrary
  // base64 into a fetch target is exactly the shape of an SSRF bug if
  // that assumption is ever wrong — so only proceed when it actually
  // decodes to a Zernio host.
  let parsed: URL
  try {
    parsed = new URL(mediaUrl)
  } catch {
    throw new InboundMediaError('Invalid media token.', 400)
  }
  const isZernioHost =
    parsed.hostname === 'zernio.com' || parsed.hostname.endsWith('.zernio.com')
  if (!isZernioHost || parsed.protocol !== 'https:') {
    throw new InboundMediaError('Invalid media token.', 400)
  }

  const res = await fetch(parsed.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    throw new InboundMediaError(`Failed to fetch media (${res.status}).`, 502)
  }

  const mimeType = res.headers.get('content-type') || 'application/octet-stream'
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, mimeType }
}

async function downloadMetaMedia(mediaId: string, accessToken: string): Promise<DownloadedMedia> {
  const mediaInfo = await getMediaUrl({ mediaId, accessToken })
  const { buffer, contentType } = await downloadMedia({
    downloadUrl: mediaInfo.url,
    accessToken,
  })
  // The actual download response's Content-Type is authoritative; Meta's
  // media-metadata mime type (from getMediaUrl) is a fallback for the
  // rare case the CDN response omits it.
  return { buffer, mimeType: contentType || mediaInfo.mimeType }
}

export async function downloadInboundMedia(
  args: DownloadInboundMediaArgs,
): Promise<DownloadedMedia> {
  const { provider, mediaId, accessToken } = args
  if (provider === 'zernio') return downloadZernioMedia(mediaId)
  if (!accessToken) {
    throw new InboundMediaError('accessToken is required to download Meta media.', 500)
  }
  return downloadMetaMedia(mediaId, accessToken)
}
