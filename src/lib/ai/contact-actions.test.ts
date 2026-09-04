import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyContactName } from './contact-actions'

function fakeDb(args: {
  existingName: string | null
  onUpdate?: (payload: unknown) => void
  fetchError?: unknown
  updateError?: unknown
}): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { name: args.existingName }, error: args.fetchError ?? null }),
        }),
      }),
      update: (payload: unknown) => ({
        eq: () => {
          args.onUpdate?.(payload)
          return Promise.resolve({ error: args.updateError ?? null })
        },
      }),
    }),
  } as unknown as SupabaseClient
}

describe('applyContactName', () => {
  it('sets the name when the contact has none yet', async () => {
    let updated: unknown = null
    const db = fakeDb({ existingName: null, onUpdate: (p) => (updated = p) })

    await applyContactName(db, { contactId: 'c1', name: 'Maria Lopez' })

    expect(updated).toEqual({ name: 'Maria Lopez' })
  })

  it('never overwrites a name that is already set', async () => {
    const onUpdate = vi.fn()
    const db = fakeDb({ existingName: 'Existing Name', onUpdate })

    await applyContactName(db, { contactId: 'c1', name: 'New Name' })

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('trims and collapses whitespace before saving', async () => {
    let updated: unknown = null
    const db = fakeDb({ existingName: null, onUpdate: (p) => (updated = p) })

    await applyContactName(db, { contactId: 'c1', name: '  Juan   Perez  ' })

    expect(updated).toEqual({ name: 'Juan Perez' })
  })

  it('does nothing when the name is empty after trimming', async () => {
    const onUpdate = vi.fn()
    const db = fakeDb({ existingName: null, onUpdate })

    await applyContactName(db, { contactId: 'c1', name: '   ' })

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('swallows a lookup error rather than throwing', async () => {
    const db = fakeDb({ existingName: null, fetchError: { message: 'boom' } })
    await expect(
      applyContactName(db, { contactId: 'c1', name: 'Maria' }),
    ).resolves.toBeUndefined()
  })

  it('swallows an update error rather than throwing', async () => {
    const db = fakeDb({ existingName: null, updateError: { message: 'boom' } })
    await expect(
      applyContactName(db, { contactId: 'c1', name: 'Maria' }),
    ).resolves.toBeUndefined()
  })
})
