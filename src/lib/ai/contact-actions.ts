import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Applies the [[CONTACT_NAME:...]] sentinel the AI auto-reply bot
// emitted this turn (see defaults.ts / generate.ts). Same posture as
// scheduling-actions.ts / sales-actions.ts: best-effort, never throws
// — a failure here must never take down the customer-facing reply
// that already sent.
// ============================================================

const MAX_NAME_LENGTH = 100

/**
 * True when a contact has no real name yet: empty, a phone number, or a
 * Messenger PSID placeholder. The AI may capture a name only then —
 * and must, since a phone-number "name" is exactly what it should fix.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  return !n || /^\+?[\d\s()-]{6,}$/.test(n) || /^Messenger:\d+$/.test(n)
}

export async function applyContactName(
  db: SupabaseClient,
  args: { contactId: string; name: string },
): Promise<void> {
  const { contactId, name } = args

  try {
    const cleanName = name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH)
    if (!cleanName) return

    // Re-check the contact still has no name before writing — the
    // prompt is only taught this tag when that was true a moment ago
    // (see auto-reply.ts's `needsContactName`), but re-checking here
    // means this function is safe to call unconditionally and can
    // never clobber a name a human already set or corrected in the
    // meantime.
    const { data: contact, error: fetchErr } = await db
      .from('contacts')
      .select('name')
      .eq('id', contactId)
      .maybeSingle()
    if (fetchErr) {
      console.error('[ai contact-actions] contact lookup failed:', fetchErr.message)
      return
    }
    if (!isPlaceholderName(contact?.name)) return

    const { error: updateErr } = await db
      .from('contacts')
      .update({ name: cleanName })
      .eq('id', contactId)
    if (updateErr) {
      console.error('[ai contact-actions] failed to save contact name:', updateErr.message)
    }
  } catch (err) {
    console.error('[ai contact-actions] applyContactName failed:', err)
  }
}
