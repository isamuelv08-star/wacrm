import type { SupabaseClient } from '@supabase/supabase-js'
import { isPlaceholderName } from './contact-actions'

const LABELS: [column: string, label: string][] = [
  ['city', 'City'],
  ['product_interest', 'Interested in'],
  ['quantity', 'Quantity'],
  ['need', 'Need'],
  ['budget', 'Budget'],
  ['timeline', 'Timeline'],
  ['objection', 'Objection raised'],
]

/**
 * What the CRM already knows about this customer, as short
 * "Label: value" lines for the reply prompt — so the bot doesn't ask
 * again for a name, city or tyre size the customer gave long ago
 * (beyond the reply's context window) or that an advisor typed into the
 * contact record. Filled by the turn analysis (contact_intelligence)
 * and by people. Best-effort: any failure is just an empty profile.
 */
export async function loadCustomerProfile(
  db: SupabaseClient,
  args: { contactId: string; dealSummary?: string | null },
): Promise<string[]> {
  try {
    const [contactRes, intelRes] = await Promise.all([
      db.from('contacts').select('name, email, company').eq('id', args.contactId).maybeSingle(),
      db.from('contact_intelligence').select('*').eq('contact_id', args.contactId).maybeSingle(),
    ])
    const lines: string[] = []
    const c = contactRes.data as { name: string | null; email: string | null; company: string | null } | null
    if (c && !isPlaceholderName(c.name)) lines.push(`Name: ${c.name}`)
    if (c?.company) lines.push(`Company: ${c.company}`)
    if (c?.email) lines.push(`Email: ${c.email}`)
    const intel = (intelRes.data ?? {}) as Record<string, unknown>
    for (const [column, label] of LABELS) {
      const v = intel[column]
      if (typeof v === 'string' && v.trim()) lines.push(`${label}: ${v.trim().slice(0, 200)}`)
    }
    if (args.dealSummary?.trim()) lines.push(`Where the sale stands: ${args.dealSummary.trim().slice(0, 300)}`)
    return lines
  } catch (err) {
    console.error('[ai] loading the customer profile failed:', err)
    return []
  }
}
