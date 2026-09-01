import { supabaseAdmin } from './admin-client'
import type { WhatsAppConnectionMethod } from './overview'

export interface AgencyAccountMember {
  userId: string
  fullName: string | null
  email: string | null
  role: 'owner' | 'admin' | 'agent' | 'viewer'
  createdAt: string
  /** From member_presence — null when the member has never opened the
   *  app (no heartbeat row yet), not necessarily "never logged in". */
  lastSeenAt: string | null
}

export interface AgencyWhatsAppConnection {
  method: WhatsAppConnectionMethod
  phoneNumberId: string | null
  wabaId: string | null
  status: string | null
  sendApiBase: string | null
  registeredAt: string | null
  connectedAt: string | null
  lastRegistrationError: string | null
}

export interface AgencyAiUsageSummary {
  windowDays: number
  totalCalls: number
  totalTokens: number
  byModel: { provider: string; model: string; calls: number; tokens: number }[]
}

export interface AgencyAccountDetail {
  accountId: string
  accountName: string
  ownerUserId: string
  members: AgencyAccountMember[]
  connection: AgencyWhatsAppConnection | null
  aiUsage: AgencyAiUsageSummary
}

const AI_USAGE_WINDOW_DAYS = 30

/**
 * Full detail for one account — members (with presence), the WhatsApp
 * connection (whichever path it uses), and a 30-day AI usage summary.
 * Callers MUST have already called requireSuperAdmin() — same trust
 * contract as loadAgencyOverview().
 *
 * Returns null when the account doesn't exist (already deleted, or a
 * stale id from a client that hasn't refreshed).
 */
export async function loadAgencyAccountDetail(
  accountId: string,
): Promise<AgencyAccountDetail | null> {
  const db = supabaseAdmin()

  const { data: account, error: accountErr } = await db
    .from('accounts')
    .select('id, name, owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if (accountErr) {
    console.error('[agency] account fetch failed:', accountErr.message)
    throw new Error('Failed to load account')
  }
  if (!account) return null

  const [{ data: profiles }, { data: presenceRows }, { data: config }, { data: zernio }, { data: usageRows }] =
    await Promise.all([
      db
        .from('profiles')
        .select('user_id, full_name, email, account_role, created_at')
        .eq('account_id', accountId)
        .order('account_role', { ascending: true })
        .order('created_at', { ascending: true }),
      db
        .from('member_presence')
        .select('user_id, last_seen_at')
        .eq('account_id', accountId),
      db
        .from('whatsapp_config')
        .select(
          'status, phone_number_id, waba_id, send_api_base, registered_at, last_registration_error',
        )
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('client_zernio_accounts')
        .select('whatsapp_account_id, connected_at')
        .eq('account_id', accountId)
        .maybeSingle(),
      db
        .from('ai_usage_log')
        .select('provider, model, total_tokens')
        .eq('account_id', accountId)
        .gte(
          'created_at',
          new Date(Date.now() - AI_USAGE_WINDOW_DAYS * 86_400_000).toISOString(),
        ),
    ])

  const presenceByUser = new Map(
    (presenceRows ?? []).map((p) => [p.user_id as string, p.last_seen_at as string]),
  )

  const members: AgencyAccountMember[] = (profiles ?? []).map((p) => ({
    userId: p.user_id,
    fullName: p.full_name,
    email: p.email,
    role: p.account_role,
    createdAt: p.created_at,
    lastSeenAt: presenceByUser.get(p.user_id) ?? null,
  }))

  let connection: AgencyWhatsAppConnection | null = null
  if (config?.status === 'connected') {
    connection = {
      method: config.send_api_base ? 'coexistence' : 'meta',
      phoneNumberId: config.phone_number_id,
      wabaId: config.waba_id,
      status: config.status,
      sendApiBase: config.send_api_base,
      registeredAt: config.registered_at,
      connectedAt: null,
      lastRegistrationError: config.last_registration_error,
    }
  } else if (zernio?.whatsapp_account_id) {
    connection = {
      method: 'zernio',
      phoneNumberId: zernio.whatsapp_account_id,
      wabaId: null,
      status: 'connected',
      sendApiBase: null,
      registeredAt: null,
      connectedAt: zernio.connected_at,
      lastRegistrationError: null,
    }
  } else if (config) {
    // A whatsapp_config row exists but isn't 'connected' — surface it
    // (with whatever error is on file) rather than showing nothing.
    connection = {
      method: null,
      phoneNumberId: config.phone_number_id,
      wabaId: config.waba_id,
      status: config.status,
      sendApiBase: config.send_api_base,
      registeredAt: config.registered_at,
      connectedAt: null,
      lastRegistrationError: config.last_registration_error,
    }
  }

  const modelMap = new Map<
    string,
    { provider: string; model: string; calls: number; tokens: number }
  >()
  let totalTokens = 0
  for (const row of usageRows ?? []) {
    totalTokens += row.total_tokens
    const key = `${row.provider}:${row.model}`
    const entry = modelMap.get(key) ?? {
      provider: row.provider,
      model: row.model,
      calls: 0,
      tokens: 0,
    }
    entry.calls += 1
    entry.tokens += row.total_tokens
    modelMap.set(key, entry)
  }

  return {
    accountId: account.id,
    accountName: account.name,
    ownerUserId: account.owner_user_id,
    members,
    connection,
    aiUsage: {
      windowDays: AI_USAGE_WINDOW_DAYS,
      totalCalls: (usageRows ?? []).length,
      totalTokens,
      byModel: [...modelMap.values()].sort((a, b) => b.tokens - a.tokens),
    },
  }
}

/**
 * Permanently deletes one non-owner member: removes their Supabase Auth
 * user entirely (cascades their `profiles` row — see migration 001's
 * `ON DELETE CASCADE` on `profiles.user_id`), unlike the in-app "remove
 * member" flow (`remove_account_member`), which relocates them to a
 * fresh personal account so they keep their login. The agency panel's
 * version is a harder, final cut — appropriate here since the caller is
 * the instance owner cutting off a client's ex-employee, not a
 * teammate who might come back.
 *
 * Throws a plain Error with a user-facing message on failure (target
 * not found, wrong account, or is the owner) — callers map it to a 400.
 */
export async function deleteAgencyAccountMember(
  accountId: string,
  userId: string,
): Promise<void> {
  const db = supabaseAdmin()

  const { data: profile, error: profileErr } = await db
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle()
  if (profileErr) throw new Error('Failed to look up member')
  if (!profile || profile.account_id !== accountId) {
    throw new Error('Member not found in this account')
  }
  if (profile.account_role === 'owner') {
    throw new Error(
      'Cannot delete the account owner individually — delete the whole account instead, or transfer ownership first',
    )
  }

  const { error } = await db.auth.admin.deleteUser(userId)
  if (error) throw new Error(error.message)
}

/**
 * Permanently deletes an entire client account: every row that
 * references `accounts.id` cascades (contacts, conversations, deals,
 * automations, ai_usage_log, ...) — see the `ON DELETE CASCADE` FKs
 * added in migration 017 and every domain migration since. `profiles`
 * rows cascade too, so every member loses their account link; this
 * function then also deletes each member's Supabase Auth user so their
 * login stops working entirely, matching what an agency owner means by
 * "delete this client" (data AND access, not just data).
 *
 * Order matters: `accounts.owner_user_id` is `ON DELETE RESTRICT`
 * (migration 017), so the owner's auth user can't be deleted while the
 * account row still references them — the account must go first.
 */
export async function deleteAgencyAccount(accountId: string): Promise<void> {
  const db = supabaseAdmin()

  const { data: profiles, error: profilesErr } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
  if (profilesErr) throw new Error('Failed to load account members')
  const memberIds = (profiles ?? []).map((p) => p.user_id as string)

  const { error: deleteErr } = await db.from('accounts').delete().eq('id', accountId)
  if (deleteErr) throw new Error(deleteErr.message)

  // Best-effort from here — the account and all its data are already
  // gone; a failed auth-user delete just leaves an orphaned login with
  // no account (harmless, and recoverable by retrying this action —
  // the account is gone so member lookup is skipped, but re-running
  // delete on each leftover id would still work if ever exposed).
  for (const userId of memberIds) {
    const { error } = await db.auth.admin.deleteUser(userId)
    if (error) {
      console.error(`[agency] failed to delete auth user ${userId} after account delete:`, error.message)
    }
  }
}
