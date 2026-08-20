import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomField } from '@/types'

// ============================================================
// Generic per-contact custom field values — the same `custom_fields` +
// `contact_custom_values` tables Settings → Custom Fields manages,
// read/written from wherever a contact's info needs to surface (Inbox
// contact panel, the Pipeline deal sheet, ...). Centralised here so
// every surface renders the account's full field catalogue instead of
// each hand-rolling its own subset (lead-source.ts is the one field
// that gets auto-created/filled by the webhook; this covers everything
// else an account defines, e.g. "RUC", "Ciudad").
// ============================================================

export interface CustomFieldWithValue {
  field: CustomField
  value: string
}

/**
 * Every custom field the account has defined, paired with this
 * contact's value (empty string when unset). Two queries, joined
 * client-side — cheap, and keeps the "field catalogue" and "this
 * contact's values" concerns independent like the rest of the app's
 * custom-fields code (contact-detail-view.tsx's Custom Fields tab).
 */
export async function fetchContactCustomFields(
  db: SupabaseClient,
  contactId: string,
): Promise<CustomFieldWithValue[]> {
  const [fieldsRes, valuesRes] = await Promise.all([
    db.from('custom_fields').select('*').order('field_name'),
    db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contactId),
  ])

  const fields = (fieldsRes.data ?? []) as CustomField[]
  const valueByFieldId = new Map<string, string>(
    (valuesRes.data ?? []).map((v: { custom_field_id: string; value: string | null }) => [
      v.custom_field_id,
      v.value ?? '',
    ]),
  )

  return fields.map((field) => ({
    field,
    value: valueByFieldId.get(field.id) ?? '',
  }))
}

/** Upserts a single field's value for a contact — same shape every
 *  custom-field editor (Lead Source, Contacts detail, Inbox panel) uses. */
export async function saveContactCustomFieldValue(
  db: SupabaseClient,
  contactId: string,
  fieldId: string,
  value: string,
): Promise<{ error: string | null }> {
  const { error } = await db.from('contact_custom_values').upsert(
    { contact_id: contactId, custom_field_id: fieldId, value },
    { onConflict: 'contact_id,custom_field_id' },
  )
  return { error: error?.message ?? null }
}
