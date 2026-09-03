import type { SupabaseClient } from '@supabase/supabase-js'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import type { GoogleTokens } from './oauth'

// ============================================================
// CRUD over `google_calendar_connections` (migration 071). One row
// per account (shared by the whole team, same posture as
// `client_zernio_accounts`). Tokens are stored AES-256-GCM-encrypted
// — see src/lib/whatsapp/encryption.ts, a generic helper despite the
// path (reused here rather than duplicated).
// ============================================================

export interface GoogleCalendarConnection {
  accessToken: string
  refreshToken: string
  tokenExpiresAt: string
  googleEmail: string | null
}

export interface ConnectionStatus {
  connected: boolean
  googleEmail: string | null
}

export async function getConnectionStatus(
  db: SupabaseClient,
  accountId: string,
): Promise<ConnectionStatus> {
  const { data, error } = await db
    .from('google_calendar_connections')
    .select('google_email')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[google-calendar/connection] status lookup failed:', error)
    return { connected: false, googleEmail: null }
  }
  return { connected: !!data, googleEmail: data?.google_email ?? null }
}

/** Loads the decrypted connection for actual API use. Returns `null`
 *  when there's no connection, or throws if the stored tokens can't
 *  be decrypted (mismatched ENCRYPTION_KEY) — that's a distinct
 *  failure from "not connected" and callers shouldn't confuse the two. */
export async function getConnection(
  db: SupabaseClient,
  accountId: string,
): Promise<GoogleCalendarConnection | null> {
  const { data, error } = await db
    .from('google_calendar_connections')
    .select('access_token, refresh_token, token_expires_at, google_email')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[google-calendar/connection] load failed:', error)
    return null
  }
  if (!data) return null
  return {
    accessToken: decrypt(data.access_token),
    refreshToken: decrypt(data.refresh_token),
    tokenExpiresAt: data.token_expires_at,
    googleEmail: data.google_email,
  }
}

export async function upsertConnection(
  db: SupabaseClient,
  accountId: string,
  connectedByUserId: string,
  googleEmail: string | null,
  tokens: GoogleTokens,
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString()
  const { error } = await db.from('google_calendar_connections').upsert(
    {
      account_id: accountId,
      connected_by_user_id: connectedByUserId,
      google_email: googleEmail,
      access_token: encrypt(tokens.accessToken),
      // Google only returns a refresh_token on the very first consent
      // grant per account+scope combo; upsert with a missing one would
      // otherwise null out a perfectly good existing refresh_token, so
      // this only overwrites it when Google actually sent a new one.
      // The connect flow always forces `prompt=consent` specifically
      // so a fresh refresh_token is the common case regardless.
      ...(tokens.refreshToken ? { refresh_token: encrypt(tokens.refreshToken) } : {}),
      token_expires_at: expiresAt,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' },
  )
  if (error) throw error
}

/** Updates just the access token after a refresh — never touches
 *  refresh_token, which stays valid across many access-token refreshes. */
export async function updateAccessToken(
  db: SupabaseClient,
  accountId: string,
  accessToken: string,
  expiresInSeconds: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString()
  const { error } = await db
    .from('google_calendar_connections')
    .update({ access_token: encrypt(accessToken), token_expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
  if (error) console.error('[google-calendar/connection] access token refresh save failed:', error)
}

export async function deleteConnection(db: SupabaseClient, accountId: string): Promise<void> {
  const { error } = await db.from('google_calendar_connections').delete().eq('account_id', accountId)
  if (error) throw error
}

/** Whether the account has opted its AI agent / manual calendar sync
 *  into actually using an existing Google Calendar connection
 *  (`ai_configs.google_calendar_sync_enabled`, migration 071).
 *  Independent of whether a connection exists at all. */
export async function isSyncEnabled(db: SupabaseClient, accountId: string): Promise<boolean> {
  const { data, error } = await db
    .from('ai_configs')
    .select('google_calendar_sync_enabled')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[google-calendar/connection] sync-enabled lookup failed:', error)
    return false
  }
  return Boolean(data?.google_calendar_sync_enabled)
}
