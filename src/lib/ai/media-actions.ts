import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendMedia } from '@/lib/flows/meta-send'

// ============================================================
// Applies the [[SEND_MEDIA:...]] sentinel the AI auto-reply bot emitted
// this turn (see defaults.ts / generate.ts) by sending the matching
// file from the account's curated media catalog (migration 072). Same
// posture as scheduling-actions.ts / sales-actions.ts: best-effort,
// never throws — a failure here must never take down the customer-
// facing text reply that already sent.
// ============================================================

export interface ApplySentMediaArgs {
  accountId: string
  conversationId: string
  contactId: string
  /** auth.users.id of the AI config's owner — audit column on the
   *  send, mirrors applyScheduledEvent's configOwnerUserId. */
  configOwnerUserId: string
  /** The catalog key the model echoed back in [[SEND_MEDIA: <key>]],
   *  lowercased by the sentinel parser. */
  key: string
}

/**
 * Look up `key` in the account's media catalog and, if found, send it
 * as a follow-up WhatsApp message. Silently no-ops (with a warning
 * log) when the model named a key that doesn't exist in the catalog —
 * a model that hallucinates a key despite being told the exact list
 * shouldn't crash the turn, just skip the send.
 */
export async function applySentMedia(
  db: SupabaseClient,
  args: ApplySentMediaArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId, key } = args

  try {
    const { data: item, error } = await db
      .from('ai_media_library')
      .select('media_kind, media_url')
      .eq('account_id', accountId)
      .eq('key', key)
      .maybeSingle()

    if (error) {
      console.error('[ai media-actions] catalog lookup failed:', error.message)
      return
    }
    if (!item) {
      console.warn(
        `[ai media-actions] model referenced unknown media key "${key}" — skipping.`,
      )
      return
    }

    await engineSendMedia({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      kind: item.media_kind as 'image' | 'video' | 'document',
      link: item.media_url,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai media-actions] applySentMedia failed:', err)
  }
}
