// ============================================================
// Cheap, deterministic pre-filter for the Promise Tracker (fase 4).
// Decides which agent-sent messages are worth a real AI call to
// confirm — never call the model per message, per the Auditoría
// Saleslid's cost discipline ("no LLM call por evento"). Deliberately
// biased toward over-matching: a false positive costs one extraction
// call the AI itself will dismiss (isPromise: false); a false
// negative silently loses a real commitment, which is the worse
// failure mode for a feature whose entire point is not missing one.
//
// Spanish-first (the primary language of this product's real usage),
// with a handful of English equivalents since the app also serves
// en-locale accounts. Pure string matching — no I/O — so it's
// unit-tested directly.
// ============================================================

const PROMISE_PATTERNS: RegExp[] = [
  /\bte\s+confirmo\b/i,
  /\bconfirmo\s+en\b/i,
  /\bte\s+aviso\b/i,
  /\baviso\s+en\b/i,
  /\bte\s+escribo\b/i,
  /\bte\s+mando\b/i,
  /\bte\s+paso\b/i,
  /\bte\s+llamo\b/i,
  /\ben\s+un\s+momento\b/i,
  /\ben\s+unos?\s+minutos?\b/i,
  /\ben\s+\d+\s*(min(uto)?s?|hrs?|horas?)\b/i,
  /\bm[áa]s\s+tarde\b/i,
  /\bahorita\b/i,
  /\benseguida\b/i,
  /\bdame\s+un(os)?\s+moment/i,
  /\bma[ñn]ana\s+te\b/i,
  /\bya\s+te\s+(mando|paso|escribo|confirmo|aviso|llamo)\b/i,
  /\bi'?ll\s+(confirm|send|check|let you know|call you)\b/i,
  /\bgive me a (moment|minute|sec)\b/i,
  /\bin \d+\s*(min(ute)?s?|hours?)\b/i,
]

export function looksLikePromise(text: string): boolean {
  if (!text || !text.trim()) return false
  return PROMISE_PATTERNS.some((re) => re.test(text))
}
