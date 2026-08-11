// ------------------------------------------------------------
// Shared client-side helpers for the AI auto-reply pause/resume
// control. Used by both the chat-footer banner (ai-thread-banner.tsx)
// and the contact-sidebar switch — both mutate the exact same
// `conversations.ai_autoreply_disabled` state via the same endpoint,
// so there is only one implementation of "how do we toggle it" for
// the two UIs to drift out of sync on.
// ------------------------------------------------------------

// Account AI status is the same for every conversation, so cache it per
// account and reuse it across thread switches / components instead of
// hitting /api/ai/config every time a control mounts.
//
// Keyed by accountId (a multi-account user switching workspaces must not
// see the previous account's status), and only *successful* fetches are
// cached — a transient failure returns a default without poisoning the
// cache, so it retries next time rather than hiding the control for the
// whole session.
export interface AiAccountStatus {
  autoReplyOn: boolean;
}
const statusCache = new Map<string, AiAccountStatus>();

export async function fetchAiAccountStatus(accountId: string): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;
  try {
    const res = await fetch("/api/ai/config", { cache: "no-store" });
    if (!res.ok) return { autoReplyOn: false }; // don't cache a transient failure
    const j = await res.json();
    const status = {
      // AI auto-reply is "live" only when configured, the master switch
      // is on, and the inbound bot is enabled.
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false }; // don't cache
  }
}

export interface ToggleAiAutoReplyResult {
  ok: boolean;
  error?: string;
}

/**
 * POST the pause/resume toggle for one conversation. Pausing also
 * assigns the thread to the acting agent ("Take over"); resuming
 * releases only the caller's own assignment — mirrors the semantics
 * documented on AiThreadBanner's `onChange` prop.
 */
export async function toggleAiAutoReply(
  conversationId: string,
  paused: boolean,
): Promise<ToggleAiAutoReplyResult> {
  try {
    const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused, assign_to_me: paused }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: j?.error };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
