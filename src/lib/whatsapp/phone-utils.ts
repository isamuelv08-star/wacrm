/**
 * Sanitize phone number for Meta WhatsApp API.
 * Meta requires digits only — no + prefix, no spaces, no dashes.
 * e.g. "+370 63949836" → "37063949836"
 */
export function sanitizePhoneForMeta(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Normalize phone number by removing all non-digit characters.
 * Used for comparing phone numbers in different formats.
 */
export function normalizePhone(phone: string): string {
  if (!phone) return ''
  return phone.replace(/\D/g, '')
}

/**
 * Compare two phone numbers, tolerating the formatting variants the
 * same subscriber actually shows up with — but NOT two different
 * subscribers who merely share their last digits.
 *
 * The old rule ("last 8 digits equal") merged distinct customers:
 * +58 414 1234567 and +58 424 1234567 share `41234567`, so the second
 * customer landed in the first one's contact and thread, and replies
 * went to the wrong person. Now accepted:
 *   - identical digits;
 *   - a local number vs the same number with its country code
 *     ("0987654321" / "987654321" vs "593987654321" — the whole
 *     national number must match, ≥ 8 digits, prefix ≤ 3 digits);
 *   - one inserted digit near the front, i.e. a trunk / mobile marker
 *     after the country code: "370063949836" vs "37063949836" (trunk
 *     0), "5215512345678" vs "525512345678" (Mexico's 1),
 *     "5491112345678" vs "541112345678" (Argentina's 9).
 */
export function phonesMatch(phone1: string, phone2: string): boolean {
  const n1 = normalizePhone(phone1)
  const n2 = normalizePhone(phone2)
  if (!n1 || !n2) return false
  if (n1 === n2) return true

  const a = n1.replace(/^0+/, '')
  const b = n2.replace(/^0+/, '')
  if (a === b) return a.length >= 8
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]

  // Local number vs the same number with a country code in front.
  if (short.length >= 8 && long.length - short.length <= 3 && long.endsWith(short)) return true

  // One extra digit right after the country code (trunk 0, MX 1, AR 9).
  if (long.length - short.length === 1 && short.length >= 10) {
    for (let i = 1; i <= 4; i++) {
      if (long.slice(0, i) + long.slice(i + 1) === short) return true
    }
  }
  return false
}

/**
 * Validate phone number is E.164-like format (7-15 digits starting with non-zero).
 * Accepts with or without + prefix.
 */
export function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{6,14}$/.test(phone)
}

/**
 * Generate plausible phone number variants for retry when Meta's
 * sandbox rejects a number with error #131030 ("not in allowed list").
 *
 * Many countries use a "trunk prefix" 0 for domestic dialing that is
 * meant to be dropped in international format (e.g. Lithuanian
 * "+370 063 949 836" domestically → "+370 63 949 836" international).
 * But some sandboxes register the number with the trunk 0 included,
 * causing sends to the correct international format to fail.
 *
 * This helper yields up to 3 variants:
 *   1. The original sanitized number (first attempt)
 *   2. With a trunk 0 inserted after the country code
 *   3. With a trunk 0 removed after the country code
 *
 * Country-code lengths of 1, 2, and 3 digits are tried because we
 * don't know the user's country ahead of time.
 *
 * @param sanitized - digits-only phone number (from sanitizePhoneForMeta)
 * @returns deduplicated list of variants, original first
 */
export function phoneVariants(sanitized: string): string[] {
  if (!sanitized) return []
  const seen = new Set<string>()
  const push = (v: string) => {
    if (v && !seen.has(v)) seen.add(v)
  }

  // 1. Original
  push(sanitized)

  // 2. Insert a 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (!rest.startsWith('0')) {
      push(cc + '0' + rest)
    }
  }

  // 3. Remove a leading 0 after each plausible country-code length
  for (const ccLen of [1, 2, 3]) {
    if (sanitized.length <= ccLen + 1) continue
    const cc = sanitized.slice(0, ccLen)
    const rest = sanitized.slice(ccLen)
    if (rest.startsWith('0')) {
      push(cc + rest.slice(1))
    }
  }

  return [...seen]
}

/**
 * Returns true when the Meta API error indicates the recipient
 * phone number isn't in the allowed list (sandbox restriction).
 * Detected via error code 131030 or the standard error text.
 */
export function isRecipientNotAllowedError(message: string): boolean {
  return /131030|not in allowed list|not in the allowed list/i.test(message)
}
