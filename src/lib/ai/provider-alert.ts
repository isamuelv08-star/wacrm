import type { SupabaseClient } from '@supabase/supabase-js'
import { AiError } from './types'
import { resolveOwnersAndAdmins } from '@/lib/notifications/recipients'
import { isMissingColumnError } from '@/lib/whatsapp/external-outbound'
import { serverNotificationText } from '@/lib/i18n/server-text'

/**
 * How long to stay quiet after alerting once, before a still-failing
 * account is alerted again. One hour means an account whose key died
 * mid-day gets exactly one notification per hour, not one per inbound
 * message — a busy WhatsApp number can get dozens of messages an hour,
 * and every one of them would otherwise fail the same way.
 */
const COOLDOWN_MS = 60 * 60_000

/**
 * Every background job that spends the account's own AI provider key —
 * auto-reply (auto-reply.ts), observer mode (observer.ts), lead
 * classification (lead-classify.ts) — funnels a failed call through
 * this. All three already own a try/catch that swallows the failure
 * (a bad turn must never break the webhook), so without this a dead
 * key just failed silently forever: the bot goes quiet, classification
 * stops, and nothing in the product says why. Indistinguishable, from
 * the account owner's side, from the round-robin assignment bug this
 * shipped alongside (migration 102) — just a different root cause.
 * Provider-agnostic by construction: OpenAI, Anthropic and OpenRouter
 * all throw the same `AiError` shape (see providers/shared.ts), so a
 * dead key fails the same way and gets the same alert regardless of
 * which one the account chose.
 *
 * One notification per account per `COOLDOWN_MS`, to owners/admins
 * (the same fallback recipient list every other lead-lifecycle alert
 * uses — see resolveOwnersAndAdmins's doc comment). Best-effort and
 * never throws — an alerting failure must not turn into a bigger
 * outage than the one it's trying to report.
 *
 * Deliberately typed to only take an `AiError`: a bug in our own code
 * (a thrown TypeError, a Postgres error) must never be misreported to
 * the account as "check your AI provider key".
 */
export async function notifyProviderErrorIfNeeded(
  db: SupabaseClient,
  accountId: string,
  err: AiError,
): Promise<void> {
  // A one-off timeout / network blip / momentary rate limit fixes
  // itself on the next message — alerting "the assistant stopped
  // answering" for it cried wolf. Out-of-credits/quota (often a 429 at
  // OpenAI) is persistent, so it still alerts.
  if (isTransientAiError(err)) return

  try {
    const { data: cfg, error: cfgErr } = await db
      .from('ai_configs')
      .select('provider_error_notified_at')
      .eq('account_id', accountId)
      .maybeSingle()
    // A database missing migration 103 just means "no cooldown on
    // file yet" — alert anyway rather than staying silent because of
    // an unrelated deploy-ordering gap.
    if (cfgErr && !isMissingColumnError(cfgErr)) {
      console.error('[ai] provider-alert: reading the cooldown failed:', cfgErr.message)
    }
    const lastNotifiedAt = (
      cfg as { provider_error_notified_at?: string | null } | null
    )?.provider_error_notified_at
    if (lastNotifiedAt && Date.now() - new Date(lastNotifiedAt).getTime() < COOLDOWN_MS) {
      return
    }

    const recipients = await resolveOwnersAndAdmins(db, accountId)
    if (recipients.length === 0) return
    const t = serverNotificationText()

    const { error: insertErr } = await db.from('notifications').insert(
      recipients.map((userId) => ({
        account_id: accountId,
        user_id: userId,
        type: 'ai_provider_error' as const,
        title: t('aiStoppedTitle'),
        body: t('aiStoppedBody', { error: err.message }),
      })),
    )
    if (insertErr) {
      if (!isMissingColumnError(insertErr)) {
        console.error('[ai] provider-alert: notification insert failed:', insertErr.message)
      }
      return
    }

    const { error: updErr } = await db
      .from('ai_configs')
      .update({ provider_error_notified_at: new Date().toISOString() })
      .eq('account_id', accountId)
    if (updErr && !isMissingColumnError(updErr)) {
      console.error('[ai] provider-alert: writing the cooldown failed:', updErr.message)
    }
  } catch (e) {
    console.error('[ai] provider-alert threw:', e instanceof Error ? e.message : e)
  }
}

/** Failures that clear up on their own — see notifyProviderErrorIfNeeded. */
export function isTransientAiError(err: AiError): boolean {
  if (/quota|credit|billing|insufficient/i.test(err.message)) return false
  return err.code === 'timeout' || err.code === 'network_error' || err.code === 'rate_limited'
}

/** Type guard so call sites can narrow before calling the above without
 *  importing `AiError` themselves at every site. */
export function isAiError(err: unknown): err is AiError {
  return err instanceof AiError
}
