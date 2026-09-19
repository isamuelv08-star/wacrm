/**
 * Zernio credentials read from the environment, sanitised.
 *
 * Copying variables into a hosting panel (EasyPanel, Docker Compose,
 * a `.env` file) commonly leaves invisible damage — surrounding
 * quotes, a trailing newline, stray spaces — and Zernio answers every
 * such request with a bare `401 Unauthorized` that says nothing about
 * why. Trim that away here so those slips don't take the connection
 * down, and shout in the logs about the one mistake trimming can't fix:
 * the API key and the webhook secret holding the same value (they are
 * two unrelated secrets — the key authenticates OUR calls to Zernio,
 * the secret verifies Zernio's calls to US).
 */

function clean(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  let v = raw.trim()
  // A value pasted with its quotes: "abc" / 'abc'.
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    v = v.slice(1, -1).trim()
  }
  return v === '' ? undefined : v
}

let warnedSameValue = false

/** `ZERNIO_API_KEY`, trimmed; undefined when unset/blank. */
export function zernioApiKey(): string | undefined {
  const key = clean(process.env.ZERNIO_API_KEY)
  const secret = clean(process.env.ZERNIO_WEBHOOK_SECRET)
  if (key && secret && key === secret && !warnedSameValue) {
    warnedSameValue = true
    console.error(
      '[zernio] ZERNIO_API_KEY and ZERNIO_WEBHOOK_SECRET have the SAME value. ' +
        'They must be different: the API key comes from the Zernio dashboard, ' +
        'the webhook secret is a random string you generate. Zernio will reject ' +
        'the API key with 401 Unauthorized until this is fixed.',
    )
  }
  return key
}

/** `ZERNIO_WEBHOOK_SECRET`, trimmed; undefined when unset/blank. */
export function zernioWebhookSecret(): string | undefined {
  return clean(process.env.ZERNIO_WEBHOOK_SECRET)
}

/** Exposed for tests. */
export const __testing = {
  clean,
  reset: () => {
    warnedSameValue = false
  },
}
