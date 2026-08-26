// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic' | 'openrouter'

/** Mirrors the `contacts.lead_score` CHECK constraint (migration 038). */
export type LeadScore = 'hot' | 'warm' | 'cold'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  /**
   * Account-specific free-text rules for what makes a lead HOT/WARM/
   * COLD (migration 038). When set, auto-reply teaches the model the
   * `[[SCORE:...]]` output protocol; when null, scoring is off for
   * this account entirely — no prompt or output change.
   */
  qualificationCriteria: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  /**
   * Opt-in extension of auto-reply: when true, the bot is taught the
   * sales-mode sentinel protocol ([[STAGE:...]] / [[DEAL_WON]] /
   * [[DEAL_LOST]]) and actively drives a lead's open deal through its
   * pipeline as the conversation progresses, rather than only
   * qualifying it. See `buildSystemPrompt`'s `salesMode` param.
   */
  salesModeEnabled: boolean
  /** Caps how many times the bot answers one thread before going quiet.
   *  `null` means no cap — the bot keeps answering (migration 047); the
   *  account-wide rate limiter in `lib/rate-limit.ts` is the separate
   *  safety net that still bounds runaway spend in that case. */
  autoReplyMaxPerConversation: number | null
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
  /**
   * Optional OpenRouter key (migration 041) used to transcribe inbound
   * voice notes when `provider` isn't 'openai' — Anthropic has no native
   * transcription API, so this is the fallback path for those accounts.
   * OpenAI accounts transcribe directly with `apiKey` and never need
   * this. See src/lib/ai/transcribe.ts.
   */
  transcriptionApiKey: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /**
   * The lead score the model emitted this turn via `[[SCORE:...]]`, or
   * null when it didn't emit one (no qualification_criteria configured,
   * or the model had nothing new to assess). Never present in `text`.
   */
  score: LeadScore | null
  /**
   * The short explanation the model emitted via `[[SCORE_REASON:...]]`
   * alongside `score`, or null when it scored with no reason (or didn't
   * score at all this turn). Never present in `text`.
   */
  scoreReason: string | null
  /**
   * The internal handoff note the model emitted via
   * `[[HANDOFF_SUMMARY:...]]` when it handed off, or null when it
   * didn't hand off, or handed off without complying with the format
   * (callers fall back to a deterministic summary in that case). Never
   * present in `text`, never shown to the customer.
   */
  handoffSummary: string | null
  /**
   * The exact pipeline stage name the model asked to move this deal
   * to via [[STAGE:...]] (sales mode only), or null when it didn't
   * emit one this turn. Matching against the deal's actual stage list
   * (case-insensitive, exact-name) happens in `sales-actions.ts` —
   * this is just the raw string the model wrote.
   */
  stageMove: string | null
  /** True when the model emitted [[DEAL_WON]] this turn (sales mode). */
  dealWon: boolean
  /** True when the model emitted [[DEAL_LOST]] this turn (sales mode). */
  dealLost: boolean
  /**
   * The running one-line CRM summary from [[SUMMARY:...]], or null
   * when the model didn't emit one (no open deal, or it didn't
   * comply). Shown on the lead's pipeline deal card.
   */
  summary: string | null
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
