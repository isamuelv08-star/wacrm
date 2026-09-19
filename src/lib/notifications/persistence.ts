import type { Notification } from "@/types";

/**
 * Should this notification stay on screen until the agent acts on it?
 *
 * Only a lead the SYSTEM just assigned to you — the round-robin (or an
 * AI handoff / automation) picked you, `actor_user_id` is null because
 * the assignment ran through the service role — and only in an account
 * on the 'shared' WhatsApp number. In 'multiwhatsapp' accounts a
 * conversation goes straight to the owner of the number it arrived on;
 * that is not a "new lead for the pool" moment, so it keeps the regular
 * self-dismissing toast. A teammate assigning you a chat by hand
 * (`actor_user_id` set) is likewise a normal toast.
 */
export function isPersistentAssignment(
  row: Pick<Notification, "type" | "actor_user_id">,
  whatsappMode: "shared" | "multiwhatsapp" | null | undefined,
): boolean {
  return (
    row.type === "conversation_assigned" &&
    !row.actor_user_id &&
    whatsappMode === "shared"
  );
}

/** How far back to look for still-unread system assignments when the
 *  app loads — so a lead assigned while the tab was closed is waiting
 *  for the agent, without resurrecting week-old rows. */
export const PENDING_ASSIGNMENT_WINDOW_HOURS = 24;
/** Cap on how many pending assignments are re-surfaced at load. */
export const PENDING_ASSIGNMENT_LIMIT = 5;
