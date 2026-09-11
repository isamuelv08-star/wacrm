import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the public booking flow (listing
// open slots, filing a booking) — that flow is unauthenticated by
// definition (a stranger with a booking-page link has no account
// membership), so it can't go through the regular RLS-scoped client.
// Mirrors the same per-domain pattern as src/lib/notifications/admin-client.ts
// and every other admin-client.ts in this codebase.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
