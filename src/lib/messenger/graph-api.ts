/**
 * Facebook Messenger (Graph API "Send API") helpers — the Messenger
 * counterpart to src/lib/whatsapp/meta-api.ts. Same shape (named-params
 * functions, a shared error unwrapper) so the two are easy to read
 * side by side.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

export interface MetaPageInfo {
  id: string
  name?: string
}

/**
 * Verify a Page Access Token by fetching the Page's own metadata.
 * Also confirms the token actually belongs to `pageId` — a token for a
 * different Page the same user manages would otherwise pass a bare
 * "is this a valid token" check silently.
 */
export async function verifyPageToken(args: {
  pageId: string
  pageAccessToken: string
}): Promise<MetaPageInfo> {
  const { pageId, pageAccessToken } = args
  const url = `${META_API_BASE}/me?fields=id,name&access_token=${encodeURIComponent(pageAccessToken)}`
  const response = await fetch(url)
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const info = (await response.json()) as MetaPageInfo
  if (info.id !== pageId) {
    throw new Error(
      `This Page Access Token belongs to Page ${info.id} ("${info.name ?? 'unknown'}"), not ${pageId}.`,
    )
  }
  return info
}

/**
 * Subscribe the Page to this app's webhook fields. Idempotent on
 * Meta's side, same as WhatsApp's subscribeWabaToApp — safe to call on
 * every save.
 */
export async function subscribePageToApp(args: {
  pageId: string
  pageAccessToken: string
}): Promise<void> {
  const { pageId, pageAccessToken } = args
  const url = `${META_API_BASE}/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_deliveries,message_reads&access_token=${encodeURIComponent(pageAccessToken)}`
  const response = await fetch(url, { method: 'POST' })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

export interface MetaSendResult {
  messageId: string
}

/**
 * Send a plain text message. `messagingType` defaults to RESPONSE
 * (inside Meta's 24h standard messaging window, which is the only case
 * the inbox's composer allows sending from — mirrors the WhatsApp
 * session-timer gate in message-thread.tsx).
 */
export async function sendTextMessage(args: {
  pageAccessToken: string
  recipientPsid: string
  text: string
}): Promise<MetaSendResult> {
  const { pageAccessToken, recipientPsid, text } = args
  const url = `${META_API_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_type: 'RESPONSE',
      recipient: { id: recipientPsid },
      message: { text },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { message_id: string }
  return { messageId: data.message_id }
}

export type MessengerAttachmentKind = 'image' | 'video' | 'audio' | 'file'

/**
 * Send a media attachment by URL. Unlike WhatsApp (which needs a
 * two-step upload-then-reference for anything not already hosted by
 * Meta), the Send API accepts any publicly reachable HTTPS URL
 * directly — our Supabase Storage public bucket URL works as-is.
 */
export async function sendAttachmentMessage(args: {
  pageAccessToken: string
  recipientPsid: string
  kind: MessengerAttachmentKind
  url: string
}): Promise<MetaSendResult> {
  const { pageAccessToken, recipientPsid, kind, url: mediaUrl } = args
  const url = `${META_API_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_type: 'RESPONSE',
      recipient: { id: recipientPsid },
      message: {
        attachment: {
          type: kind,
          payload: { url: mediaUrl, is_reusable: true },
        },
      },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { message_id: string }
  return { messageId: data.message_id }
}

export interface MetaUserProfile {
  first_name?: string
  last_name?: string
}

/**
 * Best-effort display-name lookup for a PSID. Messenger's webhook
 * payload (unlike WhatsApp's, which includes `contacts[].profile.name`
 * on every message) carries no name at all — this is the only way to
 * get one. Requires the `pages_messaging` permission's implicit
 * profile access; returns null on any failure rather than throwing, so
 * a lookup hiccup never blocks receiving the message itself.
 */
export async function getUserProfile(args: {
  psid: string
  pageAccessToken: string
}): Promise<string | null> {
  const { psid, pageAccessToken } = args
  try {
    const url = `${META_API_BASE}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(pageAccessToken)}`
    const response = await fetch(url)
    if (!response.ok) return null
    const data = (await response.json()) as MetaUserProfile
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ')
    return name || null
  } catch {
    return null
  }
}
