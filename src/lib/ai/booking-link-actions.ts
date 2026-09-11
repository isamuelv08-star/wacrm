import type { SupabaseClient } from '@supabase/supabase-js'
import { engineSendText } from '@/lib/flows/meta-send'

// ============================================================
// Applies the [[SEND_BOOKING_LINK]] sentinel the AI auto-reply bot
// emitted this turn (see defaults.ts / generate.ts) by sending the
// account's public self-service booking link (migration 079) as a
// follow-up WhatsApp message. Same posture as media-actions.ts /
// scheduling-actions.ts: best-effort, never throws — a failure here
// must never take down the customer-facing text reply that already
// sent.
// ============================================================

export interface ApplySentBookingLinkArgs {
  accountId: string
  conversationId: string
  contactId: string
  /** auth.users.id of the AI config's owner — audit column on the
   *  send, mirrors applySentMedia's configOwnerUserId. */
  configOwnerUserId: string
}

function resolvePublicBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  return explicit ? explicit.replace(/\/+$/, '') : null
}

/**
 * Look up the account's active booking page and, if one exists, send
 * its public link as a follow-up WhatsApp message. An account can only
 * have one link taught to the model today (see the "pick the oldest
 * active page" note below); multi-page routing (e.g. per service) is
 * future work. Silently no-ops when the account has no active page or
 * the server has no public base URL configured — either means a link
 * literally cannot be built right now.
 */
export async function applySentBookingLink(
  db: SupabaseClient,
  args: ApplySentBookingLinkArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    // An account with several booking pages (e.g. one per service) has
    // no way yet to tell the model which one fits this conversation —
    // the oldest active page is the closest thing to "the business's
    // main booking link" until per-service routing exists.
    const { data: page, error } = await db
      .from('booking_pages')
      .select('slug')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('[ai booking-link] lookup failed:', error.message)
      return
    }
    if (!page) {
      console.warn(
        '[ai booking-link] model emitted SEND_BOOKING_LINK but the account has no active booking page — skipping.',
      )
      return
    }

    const baseUrl = resolvePublicBaseUrl()
    if (!baseUrl) {
      console.warn(
        '[ai booking-link] NEXT_PUBLIC_SITE_URL is not set — cannot build a public booking link, skipping.',
      )
      return
    }

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: `${baseUrl}/agendar/${page.slug}`,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai booking-link] applySentBookingLink failed:', err)
  }
}
