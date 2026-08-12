import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Lead source capture — "where did this contact come from".
//
// Reuses the generic custom_fields system (not a bespoke column) so
// accounts can rename/reorder the options the same way they manage
// any other custom field. This module owns the ONE well-known field
// ("Lead Source") that the webhook auto-fills when Meta hands us
// click-to-WhatsApp referral data; humans edit the same field for
// every other case (word of mouth, referral, ...) from the contact
// panel, same as any custom field.
// ============================================================

export const LEAD_SOURCE_FIELD_NAME = 'Lead Source'

export const LEAD_SOURCE_DEFAULT_OPTIONS = [
  'Meta Ads',
  'Referral',
  'Word of mouth',
  'Organic WhatsApp',
  'Other',
]

const META_ADS_OPTION = 'Meta Ads'

/**
 * Meta Cloud API's `messages[].referral` — present when the customer
 * tapped a Click-to-WhatsApp ad (or a post/story with a WhatsApp CTA)
 * to start the conversation. Fields beyond `source_type`/`ctwa_clid`
 * aren't used yet; kept here for when full ad-attribution is wanted.
 */
export interface MetaReferral {
  source_type?: string
  source_id?: string
  source_url?: string
  headline?: string
  body?: string
  media_type?: string
  image_url?: string
  video_url?: string
  thumbnail_url?: string
  ctwa_clid?: string
}

/**
 * Find (or lazily create) the account's "Lead Source" custom field.
 * Created on demand — mirrors webhook-processor.ts's ensureLeadDeal
 * self-healing posture — so an account that never visited Settings →
 * Custom Fields still gets referral-sourced leads tagged correctly.
 */
export async function ensureLeadSourceField(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
): Promise<string | null> {
  const { data: existing, error: findErr } = await db
    .from('custom_fields')
    .select('id')
    .eq('account_id', accountId)
    .eq('field_name', LEAD_SOURCE_FIELD_NAME)
    .maybeSingle()
  if (findErr) {
    console.error('[lead-source] field lookup failed:', findErr.message)
    return null
  }
  if (existing) return existing.id

  const { data: created, error: createErr } = await db
    .from('custom_fields')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      field_name: LEAD_SOURCE_FIELD_NAME,
      field_type: 'select',
      field_options: { options: LEAD_SOURCE_DEFAULT_OPTIONS },
    })
    .select('id')
    .single()
  if (createErr || !created) {
    console.error('[lead-source] field creation failed:', createErr?.message)
    return null
  }
  return created.id
}

/**
 * Best-effort: when Meta hands us click-to-WhatsApp referral data on
 * an inbound message, tag the contact's "Lead Source" as "Meta Ads" —
 * but only if it doesn't already have a value, so this never clobbers
 * a human's manual edit (e.g. a contact who later says "actually a
 * friend referred me").
 */
export async function captureLeadSourceFromReferral(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  referral: MetaReferral | undefined,
): Promise<void> {
  if (!referral) return
  try {
    const fieldId = await ensureLeadSourceField(db, accountId, configOwnerUserId)
    if (!fieldId) return

    const { data: existingValue, error: valErr } = await db
      .from('contact_custom_values')
      .select('id')
      .eq('contact_id', contactId)
      .eq('custom_field_id', fieldId)
      .maybeSingle()
    if (valErr) {
      console.error('[lead-source] value lookup failed:', valErr.message)
      return
    }
    if (existingValue) return // never overwrite an existing value

    const { error: insertErr } = await db.from('contact_custom_values').insert({
      contact_id: contactId,
      custom_field_id: fieldId,
      value: META_ADS_OPTION,
    })
    if (insertErr) {
      console.error('[lead-source] value insert failed:', insertErr.message)
    }
  } catch (err) {
    console.error('[lead-source] captureLeadSourceFromReferral failed:', err)
  }
}
