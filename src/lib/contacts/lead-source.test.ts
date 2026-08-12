import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ensureLeadSourceField,
  captureLeadSourceFromReferral,
  LEAD_SOURCE_FIELD_NAME,
  LEAD_SOURCE_DEFAULT_OPTIONS,
} from './lead-source'

interface FakeDbOpts {
  customFieldsSelect?: { data: unknown; error?: unknown }
  customFieldsInsert?: { data: unknown; error?: unknown }
  valuesSelect?: { data: unknown; error?: unknown }
  valuesInsert?: { error?: unknown }
}

function makeDb(opts: FakeDbOpts = {}) {
  const insertCustomField = vi.fn().mockReturnValue({
    select: () => ({
      single: () =>
        Promise.resolve(opts.customFieldsInsert ?? { data: { id: 'new-field' }, error: null }),
    }),
  })
  const insertValue = vi.fn().mockResolvedValue(opts.valuesInsert ?? { error: null })

  const db = {
    from(table: string) {
      if (table === 'custom_fields') {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                ({
                  maybeSingle: () =>
                    Promise.resolve(opts.customFieldsSelect ?? { data: null, error: null }),
                }),
            }),
          }),
          insert: insertCustomField,
        }
      }
      if (table === 'contact_custom_values') {
        return {
          select: () => ({
            eq: () => ({
              eq: () =>
                ({
                  maybeSingle: () =>
                    Promise.resolve(opts.valuesSelect ?? { data: null, error: null }),
                }),
            }),
          }),
          insert: insertValue,
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
  return { db: db as unknown as SupabaseClient, insertCustomField, insertValue }
}

describe('ensureLeadSourceField', () => {
  it('returns the existing field id without creating one', async () => {
    const { db, insertCustomField } = makeDb({
      customFieldsSelect: { data: { id: 'existing-field' }, error: null },
    })
    const id = await ensureLeadSourceField(db, 'acct-1', 'user-1')
    expect(id).toBe('existing-field')
    expect(insertCustomField).not.toHaveBeenCalled()
  })

  it('creates the field with default select options when missing', async () => {
    const { db, insertCustomField } = makeDb({
      customFieldsSelect: { data: null, error: null },
      customFieldsInsert: { data: { id: 'new-field' }, error: null },
    })
    const id = await ensureLeadSourceField(db, 'acct-1', 'user-1')
    expect(id).toBe('new-field')
    expect(insertCustomField).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acct-1',
        user_id: 'user-1',
        field_name: LEAD_SOURCE_FIELD_NAME,
        field_type: 'select',
        field_options: { options: LEAD_SOURCE_DEFAULT_OPTIONS },
      }),
    )
  })

  it('returns null when the lookup errors', async () => {
    const { db } = makeDb({ customFieldsSelect: { data: null, error: { message: 'boom' } } })
    expect(await ensureLeadSourceField(db, 'acct-1', 'user-1')).toBeNull()
  })

  it('returns null when creation fails', async () => {
    const { db } = makeDb({
      customFieldsSelect: { data: null, error: null },
      customFieldsInsert: { data: null, error: { message: 'boom' } },
    })
    expect(await ensureLeadSourceField(db, 'acct-1', 'user-1')).toBeNull()
  })
})

describe('captureLeadSourceFromReferral', () => {
  it('no-ops when there is no referral', async () => {
    const { db, insertValue } = makeDb()
    await captureLeadSourceFromReferral(db, 'acct-1', 'user-1', 'contact-1', undefined)
    expect(insertValue).not.toHaveBeenCalled()
  })

  it('sets "Meta Ads" when the field exists and the contact has no value yet', async () => {
    const { db, insertValue } = makeDb({
      customFieldsSelect: { data: { id: 'field-1' }, error: null },
      valuesSelect: { data: null, error: null },
    })
    await captureLeadSourceFromReferral(db, 'acct-1', 'user-1', 'contact-1', {
      source_type: 'ad',
      ctwa_clid: 'clid-123',
    })
    expect(insertValue).toHaveBeenCalledWith({
      contact_id: 'contact-1',
      custom_field_id: 'field-1',
      value: 'Meta Ads',
    })
  })

  it('never overwrites an existing value', async () => {
    const { db, insertValue } = makeDb({
      customFieldsSelect: { data: { id: 'field-1' }, error: null },
      valuesSelect: { data: { id: 'existing-value' }, error: null },
    })
    await captureLeadSourceFromReferral(db, 'acct-1', 'user-1', 'contact-1', {
      source_type: 'ad',
    })
    expect(insertValue).not.toHaveBeenCalled()
  })

  it('lazily creates the field when missing, then sets the value', async () => {
    const { db, insertCustomField, insertValue } = makeDb({
      customFieldsSelect: { data: null, error: null },
      customFieldsInsert: { data: { id: 'brand-new-field' }, error: null },
      valuesSelect: { data: null, error: null },
    })
    await captureLeadSourceFromReferral(db, 'acct-1', 'user-1', 'contact-1', {
      source_type: 'ad',
    })
    expect(insertCustomField).toHaveBeenCalled()
    expect(insertValue).toHaveBeenCalledWith({
      contact_id: 'contact-1',
      custom_field_id: 'brand-new-field',
      value: 'Meta Ads',
    })
  })
})
