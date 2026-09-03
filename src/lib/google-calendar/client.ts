import type { SupabaseClient } from '@supabase/supabase-js'
import { getConnection, updateAccessToken } from './connection'
import { refreshAccessToken } from './oauth'

// ============================================================
// Google Calendar API v3 (REST, no SDK — see oauth.ts's header note).
// Always operates on the connected account's "primary" calendar —
// picking a specific calendar is a possible future refinement, not
// needed for v1 (one connection per account already keeps this
// simple: whichever Google Calendar is "primary" for the Google
// account that connected).
// ============================================================

const EVENTS_URL = (id?: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/primary/events${id ? `/${encodeURIComponent(id)}` : ''}`

/** A 60s cushion before the stored expiry — avoids a token that's
 *  technically still valid when read but expires mid-flight on the
 *  actual Calendar API call a moment later. */
const EXPIRY_CUSHION_MS = 60_000

/**
 * Resolve a currently-valid access token for the account's Google
 * Calendar connection, refreshing it first if needed. Returns `null`
 * when there's no connection at all (never throws for that case —
 * every caller treats "not connected" as "skip this, best-effort").
 */
export async function getValidAccessToken(db: SupabaseClient, accountId: string): Promise<string | null> {
  const connection = await getConnection(db, accountId)
  if (!connection) return null

  const expiresAt = new Date(connection.tokenExpiresAt).getTime()
  if (Number.isFinite(expiresAt) && expiresAt - EXPIRY_CUSHION_MS > Date.now()) {
    return connection.accessToken
  }

  try {
    const refreshed = await refreshAccessToken(connection.refreshToken)
    await updateAccessToken(db, accountId, refreshed.accessToken, refreshed.expiresInSeconds)
    return refreshed.accessToken
  } catch (err) {
    // A revoked/expired refresh_token (user removed access from their
    // Google account directly) surfaces here. Nothing to recover
    // automatically — the connection needs to be redone from
    // Settings — so just log and report "unavailable" like "not
    // connected", rather than throwing into a best-effort caller.
    console.error(`[google-calendar/client] refresh failed for account ${accountId}:`, err)
    return null
  }
}

export interface GoogleEventInput {
  summary: string
  description?: string | null
  /** ISO timestamp. */
  start: string
  /** ISO timestamp. */
  end: string
}

export interface GoogleEvent {
  id: string
  summary?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
}

async function calendarFetch(
  url: string,
  accessToken: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    console.error(`[google-calendar/client] ${init?.method ?? 'GET'} ${url} failed (${res.status}):`, data)
    throw new Error(`Google Calendar request failed (${res.status})`)
  }
  return data
}

/**
 * Upcoming events in `[timeMin, timeMax]`, formatted for direct
 * inclusion in the AI system prompt as context (see
 * `buildSystemPrompt`'s `calendarContext` param) — never as
 * instructions the model should follow.
 */
export async function listUpcomingEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
): Promise<GoogleEvent[]> {
  const url = new URL(EVENTS_URL())
  url.searchParams.set('timeMin', timeMin.toISOString())
  url.searchParams.set('timeMax', timeMax.toISOString())
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('maxResults', '50')
  const data = (await calendarFetch(url.toString(), accessToken)) as { items?: GoogleEvent[] }
  return data.items ?? []
}

export async function createGoogleEvent(accessToken: string, input: GoogleEventInput): Promise<GoogleEvent> {
  return (await calendarFetch(EVENTS_URL(), accessToken, {
    method: 'POST',
    body: {
      summary: input.summary,
      description: input.description ?? undefined,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
    },
  })) as GoogleEvent
}

export async function updateGoogleEvent(
  accessToken: string,
  googleEventId: string,
  input: GoogleEventInput,
): Promise<GoogleEvent> {
  return (await calendarFetch(EVENTS_URL(googleEventId), accessToken, {
    method: 'PATCH',
    body: {
      summary: input.summary,
      description: input.description ?? undefined,
      start: { dateTime: input.start },
      end: { dateTime: input.end },
    },
  })) as GoogleEvent
}

export async function deleteGoogleEvent(accessToken: string, googleEventId: string): Promise<void> {
  try {
    await calendarFetch(EVENTS_URL(googleEventId), accessToken, { method: 'DELETE' })
  } catch (err) {
    // A 404/410 (already deleted on Google's side, e.g. the user
    // removed it by hand) shouldn't be treated as a hard failure by
    // best-effort callers — log and move on either way.
    console.error('[google-calendar/client] delete failed:', err)
  }
}
