// ============================================================
// GET /api/zernio/connect/[platform] — start a Zernio OAuth connect
//
// The <ConnectPlatformButton> does a full-page `window.location.href`
// navigation here (never a fetch from the client — the ZERNIO_API_KEY
// must stay server-side). We:
//   1. Resolve the caller's account (admin+ only — connecting a
//      channel is a settings-class action, mirrors whatsapp_config).
//   2. Resolve a real Zernio profileId for this account — reusing the
//      one already stored on `client_zernio_accounts`, or lazily
//      creating one via POST /v1/profiles on first use (see
//      resolveZernioProfileId below; Zernio rejects
//      `/v1/connect/{platform}?profileId=` unless that id was
//      actually minted by POST /v1/profiles first — our own account
//      UUID doesn't count, which is what caused the
//      "Invalid profileId format" 400).
//   3. Ask Zernio for an `authUrl` and redirect the browser there.
//
// Every failure path redirects back to Settings with `zernio_error`
// set (rather than returning raw JSON) so the button never spins
// forever — the page reload itself ends the "connecting" state, and
// IntegrationsPanel surfaces the reason as a toast.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/auth/account'
import { getPublicOrigin } from '@/lib/http/request-origin'

const PLATFORMS = ['whatsapp', 'instagram'] as const
type Platform = (typeof PLATFORMS)[number]

function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value)
}

// Every outbound call to Zernio gets a hard timeout so a hung upstream
// can never leave the browser navigation (and therefore the button)
// stuck.
const ZERNIO_TIMEOUT_MS = 10_000

function settingsRedirect(
  origin: string,
  platform: string,
  outcome: { connected: false; error: string },
) {
  const url = new URL('/settings', origin)
  url.searchParams.set('tab', 'integrations')
  url.searchParams.set('zernio_platform', platform)
  url.searchParams.set('zernio_connected', '0')
  url.searchParams.set('zernio_error', outcome.error)
  return NextResponse.redirect(url)
}

class ZernioRequestError extends Error {
  /** HTTP status Zernio responded with, when the error came from a response (not a network failure). */
  status?: number
  /** Parsed JSON body when Zernio's response was valid JSON, else the raw text. */
  body?: unknown
  constructor(message: string, opts?: { status?: number; body?: unknown }) {
    super(message)
    this.name = 'ZernioRequestError'
    this.status = opts?.status
    this.body = opts?.body
  }
}

/**
 * fetch() against Zernio with a shared timeout + full request/response
 * logging (TEMP — see the 400-diagnostics note below). Throws
 * ZernioRequestError with a user-safe message on any failure; callers
 * catch once and redirect.
 */
async function zernioFetch(
  url: URL,
  init: { method: 'GET' | 'POST'; apiKey: string; body?: unknown },
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ZERNIO_TIMEOUT_MS)
  console.log(`[zernio] ${init.method} ${url.toString()}`, init.body ?? '')

  try {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${init.apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    })

    // TEMP diagnostic — full response, not just the status, while
    // we're root-causing Zernio integration errors. The body usually
    // carries the actual reason (bad key, unknown profileId, a field
    // validation error, etc.) that the status code alone hides.
    const rawBody = await res.text()
    console.log(`[zernio] ${res.status} ${url.pathname}`, {
      headers: Object.fromEntries(res.headers.entries()),
      body: rawBody,
    })

    let parsed: unknown
    let validJson = true
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      validJson = false
    }

    if (!res.ok) {
      throw new ZernioRequestError(
        `Zernio request to ${url.pathname} failed (${res.status}): ${rawBody.slice(0, 300)}`,
        { status: res.status, body: validJson ? parsed : rawBody },
      )
    }

    if (!validJson) {
      console.error(`[zernio] ${url.pathname} response was not valid JSON:`, rawBody)
      throw new ZernioRequestError('Zernio returned an unexpected response.')
    }
    return parsed
  } catch (err) {
    if (err instanceof ZernioRequestError) throw err
    const timedOut = err instanceof Error && err.name === 'AbortError'
    console.error(`[zernio] request to ${url.pathname} failed:`, err)
    throw new ZernioRequestError(
      timedOut
        ? 'Zernio took too long to respond. Please try again.'
        : 'Could not reach Zernio. Please try again.',
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function persistProfileId(
  admin: SupabaseClient,
  accountId: string,
  accountName: string,
  profileId: string,
): Promise<void> {
  const { error: upsertError } = await admin.from('client_zernio_accounts').upsert(
    {
      account_id: accountId,
      client_name: accountName,
      zernio_profile_id: profileId,
    },
    { onConflict: 'account_id' },
  )
  if (upsertError) {
    console.error('[zernio/connect] persisting profile id failed:', upsertError)
    throw new ZernioRequestError('Could not save the new connection. Please try again.')
  }
}

/** Shape of Zernio's 409 body when POST /v1/profiles rejects a duplicate name. */
function existingProfileIdFromConflict(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { code?: unknown; details?: { existingProfileId?: unknown } }
  if (b.code !== 'profile_name_conflict') return null
  const id = b.details?.existingProfileId
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Resolve a real Zernio profileId for this account: reuse the one
 * already on `client_zernio_accounts` if present, otherwise mint one
 * via POST /v1/profiles and persist it.
 *
 * IMPORTANT: rows written before this fix stored the account's own
 * Supabase UUID as a stand-in profileId — Zernio never actually
 * issued that id, so `/v1/connect` rejects it with "Invalid
 * profileId format". Treat a stored value equal to `accountId` the
 * same as "no profile yet" so those accounts get a real one minted
 * here instead of replaying the bad id forever.
 *
 * That self-heal itself can hit a second failure mode: an earlier,
 * pre-fix attempt may have already created a Zernio profile under
 * this account's name and then failed *before* we saved the id it
 * got back (e.g. the old code crashed on the next step). Re-creating
 * then 409s with `profile_name_conflict` — Zernio hands back the
 * existing profile's id in `details.existingProfileId`, which we
 * adopt as if we'd created it ourselves rather than treating it as a
 * hard failure.
 */
async function resolveZernioProfileId(
  admin: SupabaseClient,
  zernioBase: string,
  apiKey: string,
  accountId: string,
  accountName: string,
): Promise<string> {
  const { data: existing, error: fetchError } = await admin
    .from('client_zernio_accounts')
    .select('zernio_profile_id')
    .eq('account_id', accountId)
    .maybeSingle()

  if (fetchError) {
    console.error('[zernio/connect] lookup failed:', fetchError)
    throw new ZernioRequestError('Could not look up the existing connection. Please try again.')
  }

  const stored = existing?.zernio_profile_id ?? null
  if (stored && stored !== accountId) {
    return stored
  }

  const profilesUrl = new URL('/api/v1/profiles', zernioBase)
  let data: { profileId?: string; id?: string }
  try {
    data = (await zernioFetch(profilesUrl, {
      method: 'POST',
      apiKey,
      body: { name: accountName },
    })) as { profileId?: string; id?: string }
  } catch (err) {
    if (err instanceof ZernioRequestError && err.status === 409) {
      const existingProfileId = existingProfileIdFromConflict(err.body)
      if (existingProfileId) {
        console.warn(
          '[zernio/connect] profile name conflict — adopting existing Zernio profile',
          existingProfileId,
        )
        await persistProfileId(admin, accountId, accountName, existingProfileId)
        return existingProfileId
      }
    }
    throw err
  }

  const profileId = data.profileId || data.id
  if (!profileId) {
    console.error('[zernio/connect] profile creation response missing an id:', data)
    throw new ZernioRequestError("Zernio didn't return a profile id.")
  }

  await persistProfileId(admin, accountId, accountName, profileId)
  return profileId
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform: rawPlatform } = await params
  // NOT request.nextUrl.origin — behind a reverse proxy that doesn't
  // rewrite Host (e.g. EasyPanel), that resolves to the container's
  // internal bind address (0.0.0.0:80) instead of the public domain,
  // and every redirect built from it below would be unreachable.
  const origin = getPublicOrigin(request)

  if (!isPlatform(rawPlatform)) {
    return settingsRedirect(origin, rawPlatform, {
      connected: false,
      error: `Unsupported platform "${rawPlatform}".`,
    })
  }
  const platform = rawPlatform

  let accountId: string
  let accountName: string
  try {
    // Connecting/disconnecting a channel is settings-class — same bar
    // as whatsapp_config, api keys, etc.
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
    accountName = ctx.account.name
  } catch (err) {
    // No session / insufficient role. This route is only ever reached
    // via a click inside the (already auth-gated) settings page, so
    // this is a defensive fallback, not the primary UX path.
    const message = err instanceof Error ? err.message : 'Not authorized to connect a channel.'
    return settingsRedirect(origin, platform, { connected: false, error: message })
  }

  const apiKey = process.env.ZERNIO_API_KEY
  if (!apiKey) {
    console.error('[zernio/connect] ZERNIO_API_KEY is not set')
    return settingsRedirect(origin, platform, {
      connected: false,
      error: 'Zernio is not configured on this server.',
    })
  }

  // Zernio's own base URL, e.g. https://zernio.com. Kept overridable
  // for staging/sandbox environments; falls back to the documented
  // production host.
  const zernioBase = process.env.ZERNIO_API_BASE_URL || 'https://zernio.com'

  // Where Zernio should send the browser back to once the Meta OAuth
  // flow finishes. `?platform=` rides along on our own callback URL —
  // Zernio appends its own params (connected/profileId/accountId) to
  // whatever we hand it, so this is how the callback route learns
  // which column to write without needing a session at that point.
  const callbackBase =
    process.env.ZERNIO_REDIRECT_URL || `${origin}/api/zernio/callback`
  const redirectUrl = new URL(callbackBase)
  redirectUrl.searchParams.set('platform', platform)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const zernioProfileId = await resolveZernioProfileId(
      admin,
      zernioBase,
      apiKey,
      accountId,
      accountName,
    )

    const zernioUrl = new URL(`/api/v1/connect/${platform}`, zernioBase)
    zernioUrl.searchParams.set('profileId', zernioProfileId)
    zernioUrl.searchParams.set('redirect_url', redirectUrl.toString())

    const data = (await zernioFetch(zernioUrl, { method: 'GET', apiKey })) as {
      authUrl?: string
    }

    if (!data.authUrl) {
      console.error('[zernio/connect] Zernio response missing authUrl:', data)
      return settingsRedirect(origin, platform, {
        connected: false,
        error: "Zernio didn't return a connection link.",
      })
    }

    return NextResponse.redirect(data.authUrl)
  } catch (err) {
    const message =
      err instanceof ZernioRequestError
        ? err.message
        : 'Could not start the connection. Please try again.'
    return settingsRedirect(origin, platform, { connected: false, error: message })
  }
}
