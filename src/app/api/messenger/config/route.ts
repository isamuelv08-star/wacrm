import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyPageToken, subscribePageToApp } from '@/lib/messenger/graph-api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

// Mirrors src/app/api/whatsapp/config/route.ts almost exactly — see
// that file's comments for the reasoning behind each shape decision
// (resolving account_id off the profile, service-role client only for
// the cross-account uniqueness check, encrypt-before-store, etc.).

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * GET /api/messenger/config
 *
 * Response shape (same 200-for-every-non-auth-case convention as the
 * WhatsApp route, so the settings panel can render a message instead
 * of a generic error):
 *   { connected: true,  page_info: {...} }
 *   { connected: false, reason: 'no_config' | 'token_corrupted' | 'meta_api_error', message: '...' }
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Your profile is not linked to an account.' },
        { status: 200 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('messenger_config')
      .select('page_id, page_access_token, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching messenger_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 },
      )
    }
    if (!config) {
      return NextResponse.json(
        { connected: false, reason: 'no_config', message: 'No Messenger configuration saved yet.' },
        { status: 200 },
      )
    }

    let pageAccessToken: string
    try {
      pageAccessToken = decrypt(config.page_access_token)
    } catch (err) {
      console.error('[messenger/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message: 'The stored Page Access Token cannot be decrypted with the current ENCRYPTION_KEY. Reset and re-save.',
        },
        { status: 200 },
      )
    }

    try {
      const pageInfo = await verifyPageToken({ pageId: config.page_id, pageAccessToken })
      return NextResponse.json({ connected: true, page_info: pageInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json(
        { connected: false, reason: 'meta_api_error', message: `Meta API rejected the credentials: ${message}` },
        { status: 200 },
      )
    }
  } catch (error) {
    console.error('Error in Messenger config GET:', error)
    return NextResponse.json({ connected: false, reason: 'unknown', message: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/messenger/config
 *
 * Saves or updates the Messenger config for the authenticated user's
 * account. Verifies the Page Access Token with Meta, subscribes the
 * Page to this app's webhook fields, then encrypts and stores.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const body = await request.json()
    const { page_id, page_access_token, verify_token } = body

    if (!page_id || !page_access_token) {
      return NextResponse.json({ error: 'page_id and page_access_token are required' }, { status: 400 })
    }

    // Reject if another account already claimed this Page — same
    // single-tenant-per-channel-identity rule whatsapp_config enforces
    // for phone_number_id (issue #136's Messenger equivalent).
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('messenger_config')
      .select('account_id')
      .eq('page_id', page_id)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('Error checking page_id ownership:', claimedError)
      return NextResponse.json({ error: 'Failed to validate configuration' }, { status: 500 })
    }
    if (claimed) {
      return NextResponse.json(
        { error: 'This Facebook Page is already linked to another account on this instance.' },
        { status: 409 },
      )
    }

    let pageInfo: Awaited<ReturnType<typeof verifyPageToken>>
    try {
      pageInfo = await verifyPageToken({ pageId: page_id, pageAccessToken: page_access_token })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
    }

    let subscribedAt: string | null = null
    let subscribeError: string | null = null
    try {
      await subscribePageToApp({ pageId: page_id, pageAccessToken: page_access_token })
      subscribedAt = new Date().toISOString()
    } catch (err) {
      subscribeError = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Page /subscribed_apps failed:', subscribeError)
    }

    let encryptedToken: string
    let encryptedVerifyToken: string | null
    try {
      encryptedToken = encrypt(page_access_token)
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        { error: 'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string.' },
        { status: 500 },
      )
    }

    const { data: existing } = await supabase
      .from('messenger_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    const baseRow = {
      page_id,
      page_name: pageInfo.name ?? null,
      page_access_token: encryptedToken,
      verify_token: encryptedVerifyToken,
      status: subscribeError ? 'disconnected' : 'connected',
      connected_at: subscribeError ? null : new Date().toISOString(),
      subscribed_at: subscribedAt,
      last_subscribe_error: subscribeError,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('messenger_config')
        .update(baseRow)
        .eq('account_id', accountId)
      if (updateError) {
        console.error('Error updating messenger_config:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('messenger_config')
        .insert({ account_id: accountId, user_id: user.id, ...baseRow })
      if (insertError) {
        console.error('Error inserting messenger_config:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
    }

    if (subscribeError) {
      return NextResponse.json({ success: false, saved: true, subscribed: false, subscribe_error: subscribeError, page_info: pageInfo })
    }

    return NextResponse.json({ success: true, saved: true, subscribed: true, page_info: pageInfo })
  } catch (error) {
    console.error('Error in Messenger config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/messenger/config — same "reset and re-save" recovery
 * path the WhatsApp config panel offers for a corrupted token.
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const { error: deleteError } = await supabase.from('messenger_config').delete().eq('account_id', accountId)
    if (deleteError) {
      console.error('Error deleting messenger_config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in Messenger config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
