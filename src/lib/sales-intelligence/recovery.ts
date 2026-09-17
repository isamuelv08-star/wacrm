import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Recovery Center (fase 7, second half) — cold-scored leads that went
// quiet but carry a REAL signal worth reactivating: a lost deal with
// actual value behind it, or a captured need (fase 7's Customer
// Memory). Deliberately excludes a lead that just went cold with
// nothing else known about it — "worth reactivating" has to be earned
// by a real fact, never inferred from the cold score alone (Auditoría
// Saleslid's "no inventar datos").
// ============================================================

const SILENCE_DAYS = 30
const MAX_CANDIDATES_SCANNED = 200

export interface RecoveryCandidate {
  contactId: string
  contactName: string | null
  contactPhone: string
  conversationId: string | null
  lostDealValue: number | null
  need: string | null
}

export async function loadRecoveryCandidates(db: SupabaseClient, limit = 8): Promise<RecoveryCandidate[]> {
  const silenceCutoff = Date.now() - SILENCE_DAYS * 86_400_000

  const { data, error } = await db
    .from('contacts')
    .select('id, name, phone, conversations(id, last_message_at)')
    .eq('lead_score', 'cold')
    .limit(MAX_CANDIDATES_SCANNED)
  if (error) throw error

  type ContactRow = {
    id: string
    name: string | null
    phone: string
    conversations: { id: string; last_message_at: string | null }[] | null
  }
  const silentContacts = ((data ?? []) as ContactRow[])
    .map((c) => {
      // Most recently active conversation, if this contact has more
      // than one (e.g. a re-opened thread) — the one worth linking to.
      const convs = c.conversations ?? []
      const latest = [...convs].sort((a, b) => {
        const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
        const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
        return bt - at
      })[0]
      return { id: c.id, name: c.name, phone: c.phone, conversationId: latest?.id ?? null, lastMessageAt: latest?.last_message_at ?? null }
    })
    .filter((c) => !c.lastMessageAt || new Date(c.lastMessageAt).getTime() < silenceCutoff)

  if (silentContacts.length === 0) return []

  const contactIds = silentContacts.map((c) => c.id)

  const [lostDealsRes, intelligenceRes] = await Promise.all([
    db.from('deals').select('contact_id, value').eq('status', 'lost').in('contact_id', contactIds),
    db.from('contact_intelligence').select('contact_id, need').in('contact_id', contactIds),
  ])
  if (lostDealsRes.error) throw lostDealsRes.error
  if (intelligenceRes.error) throw intelligenceRes.error

  const lostValueByContact = new Map<string, number>()
  for (const d of (lostDealsRes.data ?? []) as { contact_id: string | null; value: number | null }[]) {
    if (!d.contact_id) continue
    lostValueByContact.set(d.contact_id, (lostValueByContact.get(d.contact_id) ?? 0) + (d.value ?? 0))
  }
  const needByContact = new Map<string, string>()
  for (const ci of (intelligenceRes.data ?? []) as { contact_id: string; need: string | null }[]) {
    if (ci.need) needByContact.set(ci.contact_id, ci.need)
  }

  return silentContacts
    .map((c) => ({
      contactId: c.id,
      contactName: c.name,
      contactPhone: c.phone,
      conversationId: c.conversationId,
      lostDealValue: lostValueByContact.get(c.id) ?? null,
      need: needByContact.get(c.id) ?? null,
    }))
    // Worth reactivating requires a real reason — a lost deal with
    // actual value, or a captured need. A cold contact with neither
    // (never got far enough to have either) isn't a recovery
    // candidate, it's just a lead that never went anywhere.
    .filter((c) => (c.lostDealValue != null && c.lostDealValue > 0) || c.need != null)
    .sort((a, b) => (b.lostDealValue ?? 0) - (a.lostDealValue ?? 0))
    .slice(0, limit)
}
