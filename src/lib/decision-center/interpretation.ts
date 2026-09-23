import type { AiConfig, AiUsage } from '@/lib/ai/types'
import { runProvider, stripCodeFence } from '@/lib/ai/generate'
import type { PeriodPreset } from '@/lib/period'
import type { DecisionCenterKpis } from './types'

/**
 * Section 2 of Centro de Decisiones — "Interpretación ejecutiva": a
 * 2-3 sentence narrative connecting the period's KPIs.
 *
 * Pipeline (mirrors the brief's DATOS → COMPARACIÓN → CAMBIOS →
 * EVIDENCIA → INTERPRETACIÓN): `buildInterpretationEvidence` and
 * `buildDeterministicInterpretation` below are pure, deterministic,
 * no I/O — DATOS/COMPARACIÓN/CAMBIOS/EVIDENCIA come straight from the
 * KPIs the route already computed (loadCeoMetrics /
 * loadPeriodCommercialTrend), and the deterministic narrative is a
 * plain template over those same numbers. AI, when the account has a
 * provider configured, is used ONLY for the last step — rephrasing
 * that already-correct narrative to read more naturally — never to
 * decide what happened or to compute a number. The deterministic
 * version is what ships whenever AI isn't configured, times out, or
 * returns something unusable, so the section always has real content.
 */

export interface InterpretationMetric {
  key: 'sales' | 'leads' | 'conversion' | 'avgTicket' | 'opportunities'
  label: string
  current: number | null
  previous: number | null
  /** Percent for sales/leads/avgTicket/opportunities, PERCENTAGE
   *  POINTS for conversion — matches the rest of the codebase's
   *  convention that win-rate changes are always expressed in points.
   *  Null when there's nothing to compare against. */
  delta: number | null
  deltaKind: 'percent' | 'points'
  direction: 'up' | 'down' | 'flat' | 'unknown'
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

function directionOf(delta: number | null): InterpretationMetric['direction'] {
  if (delta == null) return 'unknown'
  if (delta > 0.05) return 'up'
  if (delta < -0.05) return 'down'
  return 'flat'
}

/** DATOS + COMPARACIÓN + CAMBIOS. Pure — no AI, no I/O. */
export function buildInterpretationEvidence(kpis: DecisionCenterKpis): InterpretationMetric[] {
  const withoutDirection: Omit<InterpretationMetric, 'direction'>[] = [
    {
      key: 'sales',
      label: 'Ventas',
      current: kpis.sales.current,
      previous: kpis.sales.previous,
      delta: pctDelta(kpis.sales.current, kpis.sales.previous),
      deltaKind: 'percent',
    },
    {
      key: 'leads',
      label: 'Leads',
      current: kpis.leads.current,
      previous: kpis.leads.previous,
      delta: pctDelta(kpis.leads.current, kpis.leads.previous),
      deltaKind: 'percent',
    },
    {
      key: 'conversion',
      label: 'Conversión',
      current: kpis.conversion.current,
      previous: kpis.conversion.previous,
      delta:
        kpis.conversion.current != null && kpis.conversion.previous != null
          ? kpis.conversion.current - kpis.conversion.previous
          : null,
      deltaKind: 'points',
    },
    {
      key: 'avgTicket',
      label: 'Ticket promedio',
      current: kpis.avgTicket.current,
      previous: kpis.avgTicket.previous,
      delta: pctDelta(kpis.avgTicket.current, kpis.avgTicket.previous),
      deltaKind: 'percent',
    },
    {
      key: 'opportunities',
      label: 'Oportunidades',
      current: kpis.opportunities.current,
      previous: kpis.opportunities.previous,
      delta: pctDelta(kpis.opportunities.current, kpis.opportunities.previous),
      deltaKind: 'percent',
    },
  ]
  return withoutDirection.map((m) => ({ ...m, direction: directionOf(m.delta) }))
}

/** EVIDENCIA — the metrics most worth citing: largest absolute change,
 *  with a small tiebreak toward money metrics over count metrics.
 *  Metrics with no comparison or no real movement are never cited. */
export function pickHeadlineEvidence(
  metrics: InterpretationMetric[],
  max = 2,
): InterpretationMetric[] {
  const moved = metrics.filter((m) => m.delta != null && m.direction !== 'flat')
  const weight = (m: InterpretationMetric) => {
    const magnitude = Math.abs(m.delta ?? 0)
    const economicBonus = m.key === 'sales' || m.key === 'avgTicket' ? 1.15 : 1
    return magnitude * economicBonus
  }
  return [...moved].sort((a, b) => weight(b) - weight(a)).slice(0, max)
}

const RANGE_TEXT: Record<PeriodPreset, string> = {
  today: 'hoy',
  yesterday: 'ayer',
  last7Days: 'en los últimos 7 días',
  last15Days: 'en los últimos 15 días',
  last30Days: 'en los últimos 30 días',
  thisWeek: 'esta semana',
  lastWeek: 'la semana pasada',
  thisMonth: 'este mes',
  lastMonth: 'el mes pasado',
  thisQuarter: 'este trimestre',
  thisYear: 'este año',
  allTime: 'en todo el historial',
  custom: 'en el período seleccionado',
}

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function fmtDelta(m: InterpretationMetric): string {
  const d = m.delta ?? 0
  const verb = d > 0 ? 'subió' : 'bajó'
  const abs = Math.abs(d)
  const unit = m.deltaKind === 'points' ? ` ${abs === 1 ? 'punto' : 'puntos'}` : '%'
  return `${m.label.toLowerCase()} ${verb} ${abs.toFixed(1)}${unit}`
}

/** INTERPRETACIÓN — the deterministic (no-AI) narrative. Always
 *  correct because it's a plain template over the evidence above;
 *  this is what the route falls back to when AI wording isn't
 *  available or returns something unusable. */
export function buildDeterministicInterpretation(
  metrics: InterpretationMetric[],
  rangeLabel: PeriodPreset,
): string {
  const evidence = pickHeadlineEvidence(metrics, 2)
  const rangeText = RANGE_TEXT[rangeLabel] ?? RANGE_TEXT.custom
  if (evidence.length === 0) {
    return `No hay suficientes datos del período anterior para comparar ${rangeText}, así que todavía no hay una tendencia clara que reportar.`
  }
  if (evidence.length === 1) {
    return `${capitalize(rangeText)}, ${fmtDelta(evidence[0])} frente al período anterior.`
  }
  return `${capitalize(rangeText)}, ${fmtDelta(evidence[0])} y ${fmtDelta(evidence[1])} frente al período anterior. Conviene revisar si ambos cambios están relacionados antes de decidir una acción.`
}

export function buildInterpretationSystemPrompt(): string {
  return [
    'Eres un analista de negocio que redacta la interpretación ejecutiva de un panel de control para el dueño o gerente de una empresa.',
    'Recibes HECHOS ya calculados (números reales, ya comparados contra el período anterior) y una VERSIÓN BASE ya redactada con esos mismos hechos.',
    'Tu única tarea es reescribir la VERSIÓN BASE para que suene más natural y ejecutiva, EXACTAMENTE en 2 o 3 oraciones, en español.',
    '',
    'Reglas estrictas:',
    '- Usa ÚNICAMENTE los números que aparecen en los HECHOS. Nunca inventes, redondees de forma engañosa ni agregues cifras nuevas.',
    '- No hagas ningún cálculo nuevo: los porcentajes y puntos ya vienen calculados.',
    '- No agregues recomendaciones ni conclusiones que no se desprendan directamente de los HECHOS.',
    '- Tono profesional, directo, sin saludos ni relleno.',
    '',
    'Responde ÚNICAMENTE con un objeto JSON (sin bloques de código, sin comentarios) con esta forma exacta:',
    '{ "interpretation": string }',
  ].join('\n')
}

export function buildInterpretationUserMessage(
  metrics: InterpretationMetric[],
  deterministicVersion: string,
  rangeLabel: PeriodPreset,
): string {
  const factLines = metrics
    .filter((m): m is InterpretationMetric & { delta: number } => m.delta != null)
    .map((m) => {
      const unit = m.deltaKind === 'points' ? 'puntos' : '%'
      const sign = m.delta > 0 ? '+' : ''
      return `- ${m.label}: actual ${m.current}, anterior ${m.previous}, cambio ${sign}${m.delta.toFixed(1)} ${unit}`
    })
  return [
    `PERÍODO: ${RANGE_TEXT[rangeLabel] ?? RANGE_TEXT.custom}`,
    '',
    'HECHOS:',
    factLines.length ? factLines.join('\n') : '- (sin comparación disponible para este período)',
    '',
    'VERSIÓN BASE:',
    deterministicVersion,
  ].join('\n')
}

function cleanInterpretation(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.length > 500 ? `${trimmed.slice(0, 499)}…` : trimmed
}

/** Strict parse of the model's JSON. Null means "unusable" — the
 *  caller falls back to the deterministic version rather than show
 *  half an interpretation or raw model chatter. */
export function parseInterpretationResponse(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(raw))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { interpretation } = parsed as { interpretation?: unknown }
    return cleanInterpretation(interpretation)
  } catch {
    return null
  }
}

export async function generateExecutiveInterpretation(args: {
  config: AiConfig
  metrics: InterpretationMetric[]
  deterministicVersion: string
  rangeLabel: PeriodPreset
}): Promise<{ interpretation: string | null; usage: AiUsage | null }> {
  const { config, metrics, deterministicVersion, rangeLabel } = args
  const { text, usage } = await runProvider({
    config,
    systemPrompt: buildInterpretationSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: buildInterpretationUserMessage(metrics, deterministicVersion, rangeLabel),
      },
    ],
  })
  const interpretation = parseInterpretationResponse(text)
  if (!interpretation) console.error('[decision-center interpretation] unusable model response')
  return { interpretation, usage }
}
