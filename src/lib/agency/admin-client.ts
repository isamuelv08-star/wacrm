import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the agency super-admin panel.
// Mirrors the same per-domain pattern as src/lib/automations/admin-client.ts,
// src/lib/flows/admin-client.ts, and src/lib/notifications/admin-client.ts —
// bypasses RLS entirely, so every call site MUST go through
// requireSuperAdmin() (src/lib/auth/agency.ts) first. Never import this
// from a client component.
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
