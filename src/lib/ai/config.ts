import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isMissingColumnError } from '@/lib/whatsapp/external-outbound'
import { AiError, type AiConfig, type AiProvider } from './types'
import { notifyProviderErrorIfNeeded } from './provider-alert'
import { serverNotificationText } from '@/lib/i18n/server-text'

interface AiConfigRow {
  provider: AiProvider
  model: string
  api_key: string
  system_prompt: string | null
  qualification_criteria: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  autoreply_channels: string[]
  sales_mode_enabled: boolean
  ai_scheduling_enabled: boolean
  google_calendar_sync_enabled: boolean
  media_sending_enabled: boolean
  auto_reply_max_per_conversation: number | null
  handoff_agent_id: string | null
  lead_auto_assign_enabled: boolean
  embeddings_api_key: string | null
  transcription_api_key: string | null
  ai_reply_when_assigned?: boolean | null
  ai_pause_on_agent_reply?: boolean | null
  observe_human_threads?: boolean | null
  deal_progress_enabled?: boolean | null
  deal_progress_min_confidence?: number | string | null
  ai_stage_human_hold_hours?: number | null
}

const CORE_CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, qualification_criteria, is_active, auto_reply_enabled, autoreply_channels, sales_mode_enabled, ai_scheduling_enabled, google_calendar_sync_enabled, media_sending_enabled, auto_reply_max_per_conversation, handoff_agent_id, lead_auto_assign_enabled, embeddings_api_key, transcription_api_key'

/** Columns added by migrations 101/102. Selected together with the core
 *  ones, but a database that hasn't had those migrations applied yet
 *  errors on the whole SELECT — hence the retry in `selectConfigRow`,
 *  which falls back to the core columns and lets the defaults below
 *  stand in. */
const OPTIONAL_CONFIG_COLUMNS =
  'ai_reply_when_assigned, ai_pause_on_agent_reply, observe_human_threads'

/** Migration 114 (turn analysis / deal progress). Its own tier so a
 *  database with 101/102 but not 114 keeps those settings. */
const PROGRESS_CONFIG_COLUMNS =
  'deal_progress_enabled, deal_progress_min_confidence, ai_stage_human_hold_hours'

/**
 * One SELECT with the optional (101/102) columns, retried without them
 * when the database says they don't exist. Deploying the code before
 * running the migration then degrades to "those settings sit at their
 * defaults" instead of taking auto-reply down account-wide.
 */
async function selectConfigRow(db: SupabaseClient, accountId: string) {
  const withProgress = await db
    .from('ai_configs')
    .select(`${CORE_CONFIG_COLUMNS}, ${OPTIONAL_CONFIG_COLUMNS}, ${PROGRESS_CONFIG_COLUMNS}`)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!withProgress.error || !isMissingColumnError(withProgress.error)) return withProgress

  const full = await db
    .from('ai_configs')
    .select(`${CORE_CONFIG_COLUMNS}, ${OPTIONAL_CONFIG_COLUMNS}`)
    .eq('account_id', accountId)
    .maybeSingle()

  if (!full.error || !isMissingColumnError(full.error)) return full

  console.warn(
    '[ai config] ai_configs is missing the columns from migrations 101/102 — apply them; using defaults meanwhile.',
  )
  return db
    .from('ai_configs')
    .select(CORE_CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
}

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await selectConfigRow(db, accountId)

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  // Same swallow-on-decrypt-failure posture as the embeddings key above:
  // a rotated/mismatched ENCRYPTION_KEY should degrade transcription to
  // "unavailable" for Anthropic accounts, not take down draft/auto-reply.
  let transcriptionApiKey: string | null = null
  if (row.transcription_api_key) {
    try {
      transcriptionApiKey = decrypt(row.transcription_api_key)
    } catch {
      console.error(
        `[ai config] transcription key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; voice-note transcription is disabled until it is re-entered.`,
      )
      transcriptionApiKey = null
    }
  }

  // A key that can't be decrypted (ENCRYPTION_KEY rotated, corrupted
  // row) made every AI job throw a plain Error here — no AiError, so no
  // alert, and the bot just went silent. Treat it as "AI unavailable"
  // and tell the owners to re-enter the key.
  let apiKey: string
  try {
    apiKey = decrypt(row.api_key)
  } catch {
    console.error(`[ai config] API key for account ${accountId} could not be decrypted`)
    await notifyProviderErrorIfNeeded(
      db,
      accountId,
      new AiError(serverNotificationText()('aiKeyUnreadable'), {
        code: 'invalid_key',
        status: 401,
      }),
    )
    return null
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey,
    systemPrompt: row.system_prompt,
    qualificationCriteria: row.qualification_criteria,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    // Defensive fallback: a row written before migration 082 (or a
    // manual DB edit) could have this null/empty — treat that the same
    // as the column default rather than silently disabling WhatsApp
    // auto-reply for an account that never touched this setting.
    autoreplyChannels: row.autoreply_channels?.length ? row.autoreply_channels : ['whatsapp'],
    salesModeEnabled: row.sales_mode_enabled,
    aiSchedulingEnabled: row.ai_scheduling_enabled,
    googleCalendarSyncEnabled: row.google_calendar_sync_enabled,
    mediaSendingEnabled: row.media_sending_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    leadAutoAssignEnabled: row.lead_auto_assign_enabled,
    // Migrations 101/102. `!== false` rather than `=== true`: when the
    // column is missing (migration not applied) or null, these read as
    // their intended defaults — the bot answers assigned threads and
    // yields to an agent who writes — while observing stays opt-in.
    replyWhenAssigned: row.ai_reply_when_assigned !== false,
    pauseOnAgentReply: row.ai_pause_on_agent_reply !== false,
    observeHumanThreads: row.observe_human_threads === true,
    // Migration 114 — on unless explicitly turned off (also before 114).
    dealProgressEnabled: row.deal_progress_enabled !== false,
    dealProgressMinConfidence: clampConfidence(row.deal_progress_min_confidence, 0.75),
    stageHumanHoldHours:
      typeof row.ai_stage_human_hold_hours === 'number' && row.ai_stage_human_hold_hours >= 0
        ? row.ai_stage_human_hold_hours
        : 24,
    // An OpenAI chat key can embed too — without this, OpenAI accounts
    // that never filled the separate embeddings field only ever got
    // keyword search over their knowledge base.
    embeddingsApiKey: embeddingsApiKey ?? (row.provider === 'openai' ? apiKey : null),
    transcriptionApiKey,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}

function clampConfidence(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback
}
