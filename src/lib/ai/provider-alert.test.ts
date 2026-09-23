import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AiError } from './types'
import { notifyProviderErrorIfNeeded } from './provider-alert'

// A minimal fake covering exactly the four calls this module makes:
// read ai_configs.provider_error_notified_at, read profiles for
// owners/admins (via the real resolveOwnersAndAdmins), insert
// notifications, write the cooldown back. Configurable per test via
// `state`.
function fakeDb(state: {
  notifiedAt: string | null
  notifiedAtError?: { code?: string; message: string }
  owners: string[]
  insertError?: { code?: string; message: string }
  updateError?: { code?: string; message: string }
}) {
  const inserted: unknown[] = []
  const updates: Record<string, unknown>[] = []

  const db = {
    from(table: string) {
      if (table === 'ai_configs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve(
                  state.notifiedAtError
                    ? { data: null, error: state.notifiedAtError }
                    : { data: { provider_error_notified_at: state.notifiedAt }, error: null },
                ),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push(payload)
            return { eq: () => Promise.resolve({ error: state.updateError ?? null }) }
          },
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: state.owners.map((user_id) => ({ user_id })), error: null }),
            }),
          }),
        }
      }
      if (table === 'notifications') {
        return {
          insert: (rows: unknown[]) => {
            inserted.push(...rows)
            return Promise.resolve({ error: state.insertError ?? null })
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  } as unknown as SupabaseClient

  return { db, inserted, updates }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('notifyProviderErrorIfNeeded', () => {
  it('notifies every owner/admin with the error message, and stamps the cooldown', async () => {
    const { db, inserted, updates } = fakeDb({ notifiedAt: null, owners: ['owner-1', 'admin-2'] })
    const err = new AiError('Anthropic rejected the API key', { code: 'invalid_key', status: 401 })

    await notifyProviderErrorIfNeeded(db, 'acct-1', err)

    expect(inserted).toHaveLength(2)
    expect(inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account_id: 'acct-1',
          user_id: 'owner-1',
          type: 'ai_provider_error',
        }),
        expect.objectContaining({ user_id: 'admin-2' }),
      ]),
    )
    expect((inserted[0] as { body: string }).body).toContain('Anthropic rejected the API key')
    expect(updates).toHaveLength(1)
    expect(typeof updates[0].provider_error_notified_at).toBe('string')
  })

  it('stays quiet within the cooldown window', async () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString() // 5 minutes ago
    const { db, inserted, updates } = fakeDb({ notifiedAt: recent, owners: ['owner-1'] })

    await notifyProviderErrorIfNeeded(db, 'acct-1', new AiError('boom'))

    expect(inserted).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('alerts again once the cooldown has elapsed', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60_000).toISOString() // 2 hours ago
    const { db, inserted } = fakeDb({ notifiedAt: old, owners: ['owner-1'] })

    await notifyProviderErrorIfNeeded(db, 'acct-1', new AiError('boom'))

    expect(inserted).toHaveLength(1)
  })

  it('does nothing when the account has no owners/admins', async () => {
    const { db, inserted } = fakeDb({ notifiedAt: null, owners: [] })
    await notifyProviderErrorIfNeeded(db, 'acct-1', new AiError('boom'))
    expect(inserted).toHaveLength(0)
  })

  // A database missing migration 103 must degrade to "alert anyway",
  // never to "never alert again".
  it('still alerts when the cooldown column is missing (migration not applied yet)', async () => {
    const { db, inserted } = fakeDb({
      notifiedAt: null,
      notifiedAtError: { code: '42703', message: 'column does not exist' },
      owners: ['owner-1'],
    })
    await notifyProviderErrorIfNeeded(db, 'acct-1', new AiError('boom'))
    expect(inserted).toHaveLength(1)
  })

  it('never throws, even when every write fails', async () => {
    const { db } = fakeDb({
      notifiedAt: null,
      owners: ['owner-1'],
      insertError: { message: 'db is down' },
      updateError: { message: 'db is down' },
    })
    await expect(notifyProviderErrorIfNeeded(db, 'acct-1', new AiError('boom'))).resolves.toBeUndefined()
  })
})
