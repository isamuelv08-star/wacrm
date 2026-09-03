import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for Google Calendar sync triggered
// from an agent-role request (src/app/api/calendar/events/*). Mirrors
// src/lib/ai/admin-client.ts and friends.
//
// Why this needs service role rather than the caller's RLS-scoped
// client: refreshing an expired access token writes
// `google_calendar_connections`, whose UPDATE policy is admin-only
// (migration 071, same bar as whatsapp_config) — connecting/managing
// the integration is settings-class, but *using* an already-connected
// calendar to sync one event is not, and shouldn't require every
// agent creating a calendar event to also be an account admin.
let _adminClient: SupabaseClient | null = null

export function googleCalendarAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
