import type { AiConfig, AiUsage } from '@/lib/ai/types'
import { runProvider, stripCodeFence } from '@/lib/ai/generate'
import { formatCurrency } from '@/lib/currency'
import type { DecisionCenterPayload } from './payload'

/**
 * Section 8 — "Pregunta a Saleslid": a manager types a free-text
 * question and gets back Respuesta / Evidencia / Recomendación, built
 * ONLY from the exact same data Centro de Decisiones is already
 * showing (see payload.ts's own doc comment on why the Q&A route
 * shares its cache with the page). This deliberately doesn't reuse
 * the sidebar "ask your CRM" assistant's own snapshot
 * (assistant-snapshot.ts) — that one queries live and independently,
 * which is right for a free-roaming chat widget but wrong here: this
 * section's whole premise is that the answer matches what's on
 * screen, so the snapshot below is a plain-text rendering of the
 * SAME payload object the page renders, not a second data pull.
 */

export interface DecisionCenterAnswer {
  answer: string
  evidence: string[]
  recommendation: string | null
}

function money(n: number, currency: string): string {
  return formatCurrency(n, currency)
}

/** Pure — formats the already-computed payload into the plain-text
 *  block the model is told to answer ONLY from. No I/O, no new
 *  numbers computed here. */
export function buildDecisionCenterSnapshot(payload: DecisionCenterPayload, currency: string): string {
  const { kpis, breakdown, money: moneySection, decisions, todayPriorities } = payload
  const sections: string[] = []

  sections.push(
    [
      `PERÍODO SELECCIONADO: ${payload.range.label} (${payload.range.start} a ${payload.range.end})`,
      'KPIs DEL PERÍODO (actual vs. período anterior equivalente):',
      `- Ventas: ${money(kpis.sales.current, currency)} (anterior: ${money(kpis.sales.previous, currency)})`,
      `- Leads: ${kpis.leads.current} (anterior: ${kpis.leads.previous})`,
      kpis.conversion.current != null
        ? `- Conversión: ${kpis.conversion.current.toFixed(1)}% (anterior: ${kpis.conversion.previous != null ? `${kpis.conversion.previous.toFixed(1)}%` : 'sin datos'})`
        : '- Conversión: sin datos en este período.',
      `- Ticket promedio: ${money(kpis.avgTicket.current, currency)} (anterior: ${money(kpis.avgTicket.previous, currency)})`,
      `- Oportunidades creadas: ${kpis.opportunities.current} (anterior: ${kpis.opportunities.previous})`,
    ].join('\n'),
  )

  sections.push(
    [
      'INTERPRETACIÓN EJECUTIVA YA MOSTRADA EN PANTALLA:',
      payload.interpretation,
      payload.interpretationRecommendation
        ? `Recomendación asociada: ${payload.interpretationRecommendation.title} — ${payload.interpretationRecommendation.description}`
        : null,
    ]
      .filter((l): l is string => l != null)
      .join('\n'),
  )

  sections.push(
    decisions.length > 0
      ? [
          'DECISIONES PRIORITARIAS DETECTADAS (máximo 5, ya priorizadas):',
          ...decisions.map((d, i) => {
            const parts = [`${i + 1}. [${d.category}] tipo=${d.type}`]
            if (d.metricValue != null) parts.push(`valor métrico=${d.metricValue}`)
            if (d.valueAtRisk != null) parts.push(`valor en riesgo=${money(d.valueAtRisk, currency)}`)
            return parts.join(', ')
          }),
        ].join('\n')
      : 'DECISIONES PRIORITARIAS DETECTADAS: ninguna — nada urgente en este momento.',
  )

  sections.push(
    [
      'DÓNDE ESTÁ CAYENDO EL NEGOCIO:',
      breakdown.biggestLeakStage
        ? `- Mayor fuga del embudo: entre "${breakdown.biggestLeakStage.fromLabel}" y "${breakdown.biggestLeakStage.toLabel}", ${(breakdown.biggestLeakStage.dropPct ?? 0).toFixed(1)}% de los leads no avanza.`
        : '- Sin una fuga de embudo destacable en este momento.',
      breakdown.worstDecliningSeller
        ? `- Vendedor con mayor caída: ${breakdown.worstDecliningSeller.name}, tasa de cierre bajó ${Math.abs(breakdown.worstDecliningSeller.winRateDeltaPts).toFixed(1)} puntos.`
        : '- Sin un vendedor con caída destacable.',
      breakdown.bestImprovingSeller
        ? `- Vendedor con mayor mejora: ${breakdown.bestImprovingSeller.name}, tasa de cierre subió ${breakdown.bestImprovingSeller.winRateDeltaPts.toFixed(1)} puntos.`
        : '- Sin un vendedor con mejora destacable.',
      'Rendimiento por vendedor (período actual):',
      ...breakdown.bySeller.map(
        (s) =>
          `  - ${s.name}: ${s.dealsWonCurrent} ganados, ${s.dealsLostCurrent} perdidos, ticket promedio ${money(s.avgTicketCurrent, currency)}, tasa de cierre ${s.winRateCurrent != null ? `${s.winRateCurrent.toFixed(1)}%` : 'sin datos'}`,
      ),
    ].join('\n'),
  )

  sections.push(
    [
      'DINERO Y OPORTUNIDADES:',
      `- Valor en riesgo (tratos estancados): ${money(moneySection.atRisk.totalValue, currency)} en ${moneySection.atRisk.totalCount} trato(s).`,
      moneySection.recoveryOpportunities.length > 0
        ? `- Oportunidades de recuperación: ${moneySection.recoveryOpportunities.length} contacto(s) frío(s) con valor recuperable.`
        : '- Sin oportunidades de recuperación destacables.',
    ].join('\n'),
  )

  sections.push(
    todayPriorities.length > 0
      ? [
          'QUÉ DEBERÍA HACER HOY (acciones concretas ya priorizadas):',
          ...todayPriorities.map((a, i) => `${i + 1}. ${a.type} — ${a.contactName || a.contactPhone || 'contacto sin nombre'}`),
        ].join('\n')
      : 'QUÉ DEBERÍA HACER HOY: nada urgente pendiente.',
  )

  return sections.join('\n\n')
}

export function buildDecisionCenterQaSystemPrompt(args: { accountName: string; snapshot: string }): string {
  const { accountName, snapshot } = args
  return [
    `Eres el analista de negocio del Centro de Decisiones de "${accountName}", un CRM de WhatsApp. Hablas directamente con el gerente o dueño del negocio, que ya está viendo el panel del que viene este resumen.`,
    'Responde ÚNICAMENTE con los datos del bloque RESUMEN a continuación — es exactamente lo que el gerente ya tiene en pantalla. Nunca inventes números, nombres o tendencias que no estén ahí.',
    'Si preguntan algo que el resumen no cubre, dilo claramente en vez de adivinar — no te disculpes de más, solo indica qué sí y qué no tienes.',
    '',
    'Responde ÚNICAMENTE con un objeto JSON (sin bloques de código, sin comentarios) con esta forma exacta:',
    '{',
    '  "answer": string,          // Respuesta directa a la pregunta, 1-3 oraciones',
    '  "evidence": string[],      // 1 a 4 datos concretos del resumen que respaldan la respuesta (cifras reales, nunca inventadas)',
    '  "recommendation": string|null  // UNA recomendación concreta y accionable si se desprende claramente de los datos, o null si no aplica',
    '}',
    '',
    'Responde en el mismo idioma en que te preguntaron. Tono profesional y directo, sin saludos ni relleno.',
    '',
    '--- RESUMEN (Centro de Decisiones) ---',
    snapshot,
    '--- FIN DEL RESUMEN ---',
  ].join('\n')
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** Strict parse of the model's JSON. Null means "unusable" — the
 *  caller returns an error rather than show half an answer (unlike
 *  the interpretation section, there's no deterministic fallback for
 *  a free-text question). */
export function parseDecisionCenterAnswer(raw: string): DecisionCenterAnswer | null {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { answer, evidence, recommendation } = parsed as {
      answer?: unknown
      evidence?: unknown
      recommendation?: unknown
    }
    const cleanAnswer = cleanString(answer, 1000)
    if (!cleanAnswer) return null
    const cleanEvidence = Array.isArray(evidence)
      ? evidence.map((e) => cleanString(e, 200)).filter((e): e is string => e !== null).slice(0, 4)
      : []
    return {
      answer: cleanAnswer,
      evidence: cleanEvidence,
      recommendation: cleanString(recommendation, 300),
    }
  } catch {
    return null
  }
}

export async function generateDecisionCenterAnswer(args: {
  config: AiConfig
  accountName: string
  snapshot: string
  question: string
}): Promise<{ result: DecisionCenterAnswer | null; usage: AiUsage | null }> {
  const { config, accountName, snapshot, question } = args
  const { text, usage } = await runProvider({
    config,
    systemPrompt: buildDecisionCenterQaSystemPrompt({ accountName, snapshot }),
    messages: [{ role: 'user', content: question }],
  })
  const result = parseDecisionCenterAnswer(text)
  if (!result) console.error('[decision-center ask] unusable model response')
  return { result, usage }
}
