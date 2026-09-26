/**
 * Pure pieces of the per-turn analysis (no I/O): the prompt, the parser
 * for the model's JSON, and the rules that decide whether a deal moves.
 * See ./index.ts for the orchestration and why this exists.
 */

export const FACT_KEYS = [
  'name',
  'email',
  'company',
  'city',
  'need',
  'budget',
  'objection',
  'productInterest',
  'timeline',
  'quantity',
] as const
export type FactKey = (typeof FACT_KEYS)[number]
export type Facts = Partial<Record<FactKey, string>>

export interface StageForAnalysis {
  id: string
  name: string
  position: number
  description: string | null
  isQualified: boolean
  isWon: boolean
  isLost: boolean
  isFollowup: boolean
}

export interface CustomFieldForAnalysis {
  name: string
  type: string
  options: string[]
  currentValue: string | null
}

export interface TurnAnalysis {
  score: 'hot' | 'warm' | 'cold' | null
  scoreReason: string | null
  facts: Facts
  factEvidence: Partial<Record<FactKey, string>>
  customFields: Record<string, string>
  tags: string[]
  stageKey: string | null
  stageConfidence: number
  stageEvidence: string | null
  outcome: 'won' | 'lost' | null
  outcomeConfidence: number
  outcomeEvidence: string | null
  dealValue: number | null
  valueEvidence: string | null
  summary: string | null
  reason: string | null
}

/** Stage key the model sees ("S1", "S2"…) — stable, never a raw id. */
export function stageKey(index: number): string {
  return `S${index + 1}`
}

/** Placeholder / filler values the model sometimes returns as facts. */
const EMPTY_FACT = /^(n\/?a|null|none|ninguno|ninguna|desconocido|unknown|no (especificado|indicado|mencionado)|m[aá]s informaci[oó]n|informaci[oó]n|info|-+|\?+)$/i

function str(v: unknown, max = 400): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\s+/g, ' ')
  if (!t || EMPTY_FACT.test(t)) return null
  return t.slice(0, max)
}

function conf(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

function stripFence(raw: string): string {
  const t = raw.trim()
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) return fenced[1].trim()
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  return first >= 0 && last > first ? t.slice(first, last + 1) : t
}

/** Parse the model's JSON leniently; anything malformed becomes "no signal". */
export function parseTurnAnalysis(raw: string): TurnAnalysis {
  let j: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(stripFence(raw))
    if (parsed && typeof parsed === 'object') j = parsed as Record<string, unknown>
  } catch {
    // leave empty
  }
  const factsIn = (j.facts && typeof j.facts === 'object' ? j.facts : {}) as Record<string, unknown>
  const evIn = (j.factEvidence && typeof j.factEvidence === 'object' ? j.factEvidence : {}) as Record<string, unknown>
  const facts: Facts = {}
  const factEvidence: Partial<Record<FactKey, string>> = {}
  for (const k of FACT_KEYS) {
    const v = str(factsIn[k])
    if (v) facts[k] = v
    const e = str(evIn[k], 300)
    if (e) factEvidence[k] = e
  }
  const cfIn = (j.customFields && typeof j.customFields === 'object' ? j.customFields : {}) as Record<string, unknown>
  const customFields: Record<string, string> = {}
  for (const [k, v] of Object.entries(cfIn)) {
    const val = str(v, 200)
    if (val) customFields[k] = val
  }
  const deal = (j.deal && typeof j.deal === 'object' ? j.deal : {}) as Record<string, unknown>
  const score = j.score === 'hot' || j.score === 'warm' || j.score === 'cold' ? j.score : null
  const outcome = deal.outcome === 'won' || deal.outcome === 'lost' ? deal.outcome : null
  const rawValue = typeof deal.value === 'number' ? deal.value : typeof deal.value === 'string' ? Number(deal.value) : NaN
  return {
    score,
    scoreReason: str(j.scoreReason, 300),
    facts,
    factEvidence,
    customFields,
    tags: Array.isArray(j.tags) ? j.tags.map((t) => str(t, 60)).filter((t): t is string => !!t).slice(0, 5) : [],
    stageKey: typeof deal.stage === 'string' && /^S\d+$/.test(deal.stage) ? deal.stage : null,
    stageConfidence: conf(deal.confidence),
    stageEvidence: str(deal.evidence, 300),
    outcome,
    outcomeConfidence: conf(deal.outcomeConfidence),
    outcomeEvidence: str(deal.outcomeEvidence, 300),
    dealValue: Number.isFinite(rawValue) && rawValue > 0 && rawValue < 1_000_000_000 ? rawValue : null,
    valueEvidence: str(deal.valueEvidence, 300),
    summary: str(j.summary, 500),
    reason: str(j.reason, 300),
  }
}

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$.,]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Is `quote` really in the conversation? The model must back every move
 * with a quote; a paraphrase or an invented one voids the move. Allows a
 * little slack: an exact (normalized) match, or — for longer quotes —
 * any 6-word run of it appearing verbatim.
 */
export function evidenceInTranscript(quote: string | null, normalizedTranscript: string): boolean {
  if (!quote) return false
  const q = normalizeForMatch(quote)
  if (q.length < 3) return false
  if (normalizedTranscript.includes(q)) return true
  const words = q.split(' ')
  if (words.length < 8) return false
  for (let i = 0; i + 6 <= words.length; i++) {
    if (normalizedTranscript.includes(words.slice(i, i + 6).join(' '))) return true
  }
  return false
}

export type DealDecision =
  | { action: 'none'; skipReason: string }
  | { action: 'move'; toStageId: string }
  | { action: 'won' | 'lost'; toStageId: string }

export const OUTCOME_MIN_CONFIDENCE = 0.85

/**
 * Whether (and where) the deal moves. Rules:
 *   - a human moved it recently → leave it (their call wins);
 *   - won/lost needs ≥ 0.85 confidence AND a real quote;
 *   - an open-stage move needs ≥ minConfidence AND a real quote, and
 *     only goes FORWARD (skipping steps is fine). From the follow-up
 *     stage, "forward" is measured from where the deal was before it
 *     was parked (or from the start).
 *   - never into follow-up (a parking spot, not a sales step) and never
 *     into won/lost as a plain stage.
 */
export function decideDealMove(input: {
  stages: StageForAnalysis[]
  currentStageId: string
  preFollowupStageId: string | null
  analysis: Pick<TurnAnalysis, 'stageKey' | 'stageConfidence' | 'outcome' | 'outcomeConfidence'>
  stageEvidenceOk: boolean
  outcomeEvidenceOk: boolean
  minConfidence: number
  humanHold: boolean
}): DealDecision {
  const { stages, analysis } = input
  if (input.humanHold) return { action: 'none', skipReason: 'human_hold' }

  if (analysis.outcome) {
    const target = stages.find((s) => (analysis.outcome === 'won' ? s.isWon : s.isLost))
    if (!target) return { action: 'none', skipReason: 'no_outcome_stage' }
    if (analysis.outcomeConfidence < OUTCOME_MIN_CONFIDENCE) return { action: 'none', skipReason: 'low_outcome_confidence' }
    if (!input.outcomeEvidenceOk) return { action: 'none', skipReason: 'outcome_evidence_not_found' }
    return { action: analysis.outcome, toStageId: target.id }
  }

  if (!analysis.stageKey) return { action: 'none', skipReason: 'no_recommendation' }
  const openStages = stages.filter((s) => !s.isWon && !s.isLost && !s.isFollowup)
  const idx = Number(analysis.stageKey.slice(1)) - 1
  const target = openStages[idx]
  if (!target) return { action: 'none', skipReason: 'unknown_stage' }
  if (target.id === input.currentStageId) return { action: 'none', skipReason: 'same_stage' }
  if (analysis.stageConfidence < input.minConfidence) return { action: 'none', skipReason: 'low_confidence' }
  if (!input.stageEvidenceOk) return { action: 'none', skipReason: 'evidence_not_found' }

  const current = stages.find((s) => s.id === input.currentStageId)
  const reference = current?.isFollowup
    ? stages.find((s) => s.id === input.preFollowupStageId) ?? null
    : current ?? null
  if (current && (current.isWon || current.isLost)) return { action: 'none', skipReason: 'closed' }
  if (reference && target.position <= reference.position && !(current?.isFollowup && target.id === reference.id)) {
    return { action: 'none', skipReason: 'not_forward' }
  }
  return { action: 'move', toStageId: target.id }
}

export function buildTurnAnalysisPrompt(ctx: {
  businessContext: string | null
  qualificationCriteria: string | null
  stages: StageForAnalysis[]
  currentStageId: string | null
  knownFacts: Facts
  previousScore: string | null
  previousScoreReason: string | null
  customFields: CustomFieldForAnalysis[]
  tags: string[]
  currency: string | null
  nowLabel: string
}): string {
  const openStages = ctx.stages.filter((s) => !s.isWon && !s.isLost && !s.isFollowup)
  const current = ctx.stages.find((s) => s.id === ctx.currentStageId)
  const stageLines = openStages.map(
    (s, i) =>
      `${stageKey(i)} "${s.name}"${s.id === ctx.currentStageId ? ' (CURRENT)' : ''}: ${s.description ?? 'no description'}`,
  )
  const known = Object.entries(ctx.knownFacts)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
  const fieldLines = ctx.customFields.map(
    (f) =>
      `- "${f.name}" (${f.type}${f.options.length ? `: one of ${f.options.map((o) => `"${o}"`).join(', ')}` : ''})${f.currentValue ? ` — already set to "${f.currentValue}"` : ''}`,
  )

  return [
    'You are the CRM analyst of a sales team that sells over WhatsApp. You read the conversation between a Customer and the business (Bot = the AI assistant, Advisor = a human salesperson) and update the CRM. You never write to the customer.',
    `Now: ${ctx.nowLabel}.`,
    ctx.businessContext ? `\nAbout the business (excerpt):\n${ctx.businessContext}` : '',
    '\nReturn ONLY one JSON object, no prose:',
    `{
  "score": "hot" | "warm" | "cold" | null,
  "scoreReason": string | null,
  "facts": { ${[...FACT_KEYS].map((k) => `"${k}": string|null`).join(', ')} },
  "factEvidence": { "<fact key>": "exact customer quote" },
  "customFields": { "<field name>": "value" },
  "tags": [ "<existing tag name>" ],
  "deal": {
    "stage": "S<n>" | null, "confidence": 0-1, "evidence": "exact quote" | null,
    "outcome": "won" | "lost" | null, "outcomeConfidence": 0-1, "outcomeEvidence": "exact quote" | null,
    "value": number | null, "valueEvidence": "exact quote" | null
  },
  "summary": string | null,
  "reason": string | null
}`,
    '\nPIPELINE — where does this deal stand NOW, judging by the whole conversation (customer AND advisor/bot messages)?',
    ...stageLines,
    current?.isFollowup ? `(The deal is currently parked in follow-up "${current.name}" because the customer went quiet — place it where the conversation really is.)` : '',
    `Rules for "deal":
- "stage": the stage the conversation has REACHED. Move forward as far as the evidence supports (skipping steps is fine). Use null if it's still where it is or unclear. Never move backwards.
- "evidence": copy the exact words from the transcript that prove the stage (a quote, not a paraphrase). No quote → stage null.
- "outcome": "won" ONLY when the purchase is actually confirmed: the customer paid / sent a payment receipt or transfer (an [Image] described as a receipt or transfer counts) / confirmed the order, or the Advisor confirms the payment was received or the order is placed. Interest, a quote, "I'll think about it" or asking for the account number is NOT a sale.
- "outcome": "lost" ONLY on a clear, final no (bought elsewhere, not interested, stop writing).
- "outcomeEvidence": exact quote proving it. Confidence ≥ 0.85 only when unambiguous.
- "value": the total the customer is buying for (numbers only, ${ctx.currency ?? 'the business currency'}), when a price was quoted or paid. Else null.`,
    `\nSCORE — ${
      ctx.qualificationCriteria
        ? `the business's own criteria:\n${ctx.qualificationCriteria}`
        : 'hot = ready to buy soon; warm = interested but undecided; cold = low interest.'
    }${ctx.previousScore ? `\nPrevious score: ${ctx.previousScore}${ctx.previousScoreReason ? ` (${ctx.previousScoreReason})` : ''}. Change it only if the conversation gives a reason.` : ''} Use null if there's too little to judge.`,
    `\nFACTS — only what the CUSTOMER actually said (or clearly confirmed). Never guess. "name" only if the customer tells their name. Keep values short and specific (e.g. "205/55R16 x4", not "more information"). null when unknown.${known.length ? `\nAlready known (keep unless the customer corrected it):\n${known.join('\n')}` : ''}`,
    fieldLines.length
      ? `\nCUSTOM FIELDS — fill only these, only with what the customer said:\n${fieldLines.join('\n')}`
      : '',
    ctx.tags.length
      ? `\nTAGS — you may add tags ONLY from this list, when clearly applicable: ${ctx.tags.map((t) => `"${t}"`).join(', ')}.`
      : '\nTAGS — none available, return [].',
    '\n"summary": 1–2 sentences, in the conversation\'s language: what the customer wants and where it stands. "reason": one short sentence explaining the deal decision.',
  ]
    .filter(Boolean)
    .join('\n')
}
