/**
 * Pure helpers for learning from advisor replies (migration 116) — no
 * I/O, unit-tested in core.test.ts.
 */

export const MIN_REPLY_CHARS = 20
export const MAX_REPLY_CHARS = 900
export const MIN_CUSTOMER_CHARS = 4
export const MAX_CUSTOMER_CHARS = 600

export interface ThreadRow {
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  created_at: string
  ai_generated?: boolean | null
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g
// 7+ digits, optionally with spaces/dashes and a leading + (phones,
// IDs, bank accounts). Tyre sizes (205/55 R16) and prices don't match.
const LONG_NUMBER = /\+?\d(?:[\s-]?\d){6,}/g

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Remove the customer's personal data from a text before storing it. */
export function anonymize(text: string, customerName: string | null | undefined): string {
  let out = text.replace(EMAIL, '[email]').replace(LONG_NUMBER, '[número]')
  const tokens = (customerName ?? '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\+?\d+$/.test(t))
  for (const token of tokens) {
    out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRegExp(token)}(?![\\p{L}])`, 'giu'), '[cliente]')
  }
  return out.trim()
}

const GREETING_ONLY =
  /^(hola|buen[oa]s?( (d[ií]as|tardes|noches))?|saludos|gracias|ok|okay|listo|perfecto|de nada|con gusto|claro|s[ií]|dale|👍|🙏|😊)[\s!.,¡¿?]*$/i

/**
 * From the messages BEFORE an advisor message (newest first), the
 * customer turn it answered: the consecutive customer texts right
 * before it. Null when the advisor wasn't answering a customer (a
 * follow-up of their own, a second bubble after another advisor
 * message) or the customer turn is too old / too short.
 */
export function customerTurnBefore(
  before: ThreadRow[],
  replyAt: string,
  maxGapHours = 24,
): string | null {
  if (!before.length || before[0].sender_type !== 'customer') return null
  if (Date.parse(replyAt) - Date.parse(before[0].created_at) > maxGapHours * 3_600_000) return null
  const parts: string[] = []
  for (const row of before) {
    if (row.sender_type !== 'customer') break
    if (row.content_text?.trim()) parts.push(row.content_text.trim())
  }
  const text = parts.reverse().join('\n').slice(-MAX_CUSTOMER_CHARS).trim()
  return text.length >= MIN_CUSTOMER_CHARS ? text : null
}

/**
 * The advisor's full reply: this message plus the advisor bubbles sent
 * right after it (people split one answer across several texts).
 */
export function advisorReplyFrom(first: string, after: ThreadRow[], firstAt: string, windowMinutes = 5): string | null {
  const parts = [first.trim()]
  let lastAt = Date.parse(firstAt)
  for (const row of after) {
    if (row.sender_type !== 'agent' || row.ai_generated) break
    const at = Date.parse(row.created_at)
    if (at - lastAt > windowMinutes * 60_000) break
    if (row.content_text?.trim()) parts.push(row.content_text.trim())
    lastAt = at
  }
  const text = parts.join('\n').trim()
  if (text.length < MIN_REPLY_CHARS || text.length > MAX_REPLY_CHARS) return null
  if (GREETING_ONLY.test(text)) return null
  return text
}
