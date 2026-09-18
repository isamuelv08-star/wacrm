import { supabaseAdmin } from './admin-client'

export type SupportRequestStatus = 'open' | 'resolved'

export interface AgencySupportRequest {
  id: string
  accountId: string
  accountName: string
  createdByUserId: string
  createdByName: string | null
  createdByEmail: string | null
  subject: string
  message: string
  status: SupportRequestStatus
  createdAt: string
  resolvedAt: string | null
}

/**
 * Every support request across every client account (migration 098),
 * newest-first — the agency owner's cross-account support inbox.
 * Callers MUST have already called requireSuperAdmin() — same trust
 * contract as every other function in this directory.
 */
export async function loadAgencySupportRequests(): Promise<AgencySupportRequest[]> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('support_requests')
    .select('id, account_id, created_by_user_id, subject, message, status, created_at, resolved_at, accounts(name)')
    .order('status', { ascending: true }) // 'open' sorts before 'resolved'
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[agency] support requests load failed:', error.message)
    throw new Error('Failed to load support requests')
  }
  const rows = data ?? []
  if (rows.length === 0) return []

  // support_requests.created_by_user_id references auth.users, not
  // profiles, directly (same convention as team_chat_messages,
  // migration 090) — no FK PostgREST can embed a profiles join
  // through, so the name/email lookup is a second query keyed on the
  // distinct author ids, same "batch lookup, build a map" shape
  // account-detail.ts's lastSignInByUser uses.
  const authorIds = [...new Set(rows.map((r) => r.created_by_user_id as string))]
  const { data: authorRows } = await db
    .from('profiles')
    .select('user_id, full_name, email')
    .in('user_id', authorIds)
  const authorsById = new Map(
    (authorRows ?? []).map((p) => [p.user_id as string, p]),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => {
    const author = authorsById.get(row.created_by_user_id)
    return {
      id: row.id,
      accountId: row.account_id,
      accountName: row.accounts?.name ?? '—',
      createdByUserId: row.created_by_user_id,
      createdByName: author?.full_name ?? null,
      createdByEmail: author?.email ?? null,
      subject: row.subject,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    }
  })
}

/**
 * Marks one support request resolved (or reopens it) — the only write
 * a regular account member can never do themselves (support_requests
 * has no UPDATE policy for them, migration 098's whole point).
 */
export async function setAgencySupportRequestStatus(
  requestId: string,
  status: SupportRequestStatus,
): Promise<void> {
  const db = supabaseAdmin()
  const { error, count } = await db
    .from('support_requests')
    .update(
      { status, resolved_at: status === 'resolved' ? new Date().toISOString() : null },
      { count: 'exact' },
    )
    .eq('id', requestId)
  if (error) throw new Error(error.message)
  if (!count) throw new Error('Support request not found')
}
