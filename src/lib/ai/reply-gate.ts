/**
 * The single answer to "is the AI going to reply to this inbound?".
 *
 * It lives on its own, as a pure function, because two call sites have
 * to agree on it exactly: `dispatchInboundToAiReply` (auto-reply.ts),
 * which stands down when it returns a reason, and
 * `observeConversationIfNeeded` (observer.ts), which runs *because* it
 * returned one. When those two drifted apart, an account could end up
 * with both a reply and an observation for the same message (paying the
 * provider twice), or with neither.
 */

export type AiSilenceReason =
  /** The account's master auto-reply switch is off. */
  | 'auto_reply_off'
  /** The bot isn't allowed to answer on the channel this arrived from. */
  | 'channel_not_allowed'
  /** A user-built automation answers every message; the LLM stands down
   *  so the customer isn't double-texted. */
  | 'automation_responder'
  /** A seller owns this thread and the account asked the bot to stay out
   *  of assigned conversations (`ai_reply_when_assigned = false`). */
  | 'agent_owns_thread'
  /** Auto-reply was switched off on this conversation — "Take over", an
   *  AI handoff, or a seller writing in the thread. */
  | 'paused_here'
  /** The per-conversation reply budget is used up. */
  | 'reply_cap_reached'

export interface AiReplyGateInput {
  /** `ai_configs.auto_reply_enabled`. */
  autoReplyEnabled: boolean
  /** Whether the inbound's channel is in `ai_configs.autoreply_channels`. */
  channelAllowed: boolean
  /** The account has at least one active `new_message_received` /
   *  `keyword_match` automation. */
  hasMessageAutomations: boolean
  /** `conversations.assigned_agent_id`. */
  assignedAgentId: string | null
  /** `ai_configs.ai_reply_when_assigned` (migration 102). True — the
   *  default — means a nominal assignee doesn't silence the bot: every
   *  new conversation gets one from round-robin (migration 042) before
   *  anybody has even opened it, which used to mute the bot on every
   *  single new lead. */
  replyWhenAssigned: boolean
  /** `conversations.ai_autoreply_disabled`. */
  aiAutoreplyDisabled: boolean
  /** `conversations.ai_reply_count`. */
  replyCount: number
  /** `ai_configs.auto_reply_max_per_conversation`; null = unbounded. */
  maxRepliesPerConversation: number | null
}

/**
 * Returns why the AI will stay silent on this inbound, or null when it
 * is going to answer. Ordered cheapest/most decisive first, and kept
 * free of I/O so both call sites can unit-test the same rules.
 */
export function aiSilenceReason(g: AiReplyGateInput): AiSilenceReason | null {
  if (!g.autoReplyEnabled) return 'auto_reply_off'
  if (!g.channelAllowed) return 'channel_not_allowed'
  if (g.hasMessageAutomations) return 'automation_responder'
  if (g.aiAutoreplyDisabled) return 'paused_here'
  if (g.assignedAgentId !== null && !g.replyWhenAssigned) return 'agent_owns_thread'
  if (
    g.maxRepliesPerConversation !== null &&
    g.replyCount >= g.maxRepliesPerConversation
  ) {
    return 'reply_cap_reached'
  }
  return null
}
