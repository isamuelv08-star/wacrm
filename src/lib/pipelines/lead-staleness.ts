// ============================================================
// Escalating "how long has this lead been waiting on us" read on a
// pipeline deal card. Shared between:
//   - the client-side badge (src/components/pipelines/lead-staleness-badge.tsx),
//     which recomputes this live off `conversations.last_message_at`
//   - the server-side notification sweep (src/lib/notifications/lead-staleness-alerts.ts),
//     which needs the exact same tier boundaries so "what the badge
//     shows" and "when we notify about it" can never disagree.
//
// Only meaningful when the conversation's last message came from the
// customer (`last_message_sender_type === 'customer'`) — a reply,
// however recent, always resets this to "not stale" regardless of
// tier, since the whole point is flagging silence on OUR side.
// ============================================================

/** Just enough of a deal's contact's conversation to drive the
 *  staleness badge. Keyed by contact_id wherever it's collected into
 *  a board-wide map (pipeline-board.tsx). */
export interface ConversationStaleness {
  last_message_at: string | null;
  last_message_sender_type: string | null;
}

export interface StalenessTier {
  /** 1-4, increasing severity. 0 (not exported) means "not stale yet". */
  tier: number
  /** Minimum unanswered minutes to reach this tier. */
  minMinutes: number
  /** i18n key under Pipelines.card.staleness.<key> */
  labelKey: string
}

export const STALENESS_TIERS: StalenessTier[] = [
  { tier: 1, minMinutes: 5, labelKey: 'tier1' },
  { tier: 2, minMinutes: 15, labelKey: 'tier2' },
  { tier: 3, minMinutes: 30, labelKey: 'tier3' },
  { tier: 4, minMinutes: 60, labelKey: 'tier4' },
]

/** Highest tier reached for the given unanswered duration; 0 = not stale. */
export function computeStalenessTier(minutesUnanswered: number): number {
  let tier = 0
  for (const t of STALENESS_TIERS) {
    if (minutesUnanswered >= t.minMinutes) tier = t.tier
  }
  return tier
}

export function stalenessTierLabelKey(tier: number): string | null {
  return STALENESS_TIERS.find((t) => t.tier === tier)?.labelKey ?? null
}

/**
 * Minutes since `lastMessageAt`, or null when the conversation isn't
 * actually "waiting on us" — no message yet, or the last word was
 * already ours (human, bot, or automation).
 */
export function minutesUnanswered(
  lastMessageAt: string | null | undefined,
  lastMessageSenderType: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!lastMessageAt || lastMessageSenderType !== 'customer') return null
  return (now.getTime() - new Date(lastMessageAt).getTime()) / 60000
}
