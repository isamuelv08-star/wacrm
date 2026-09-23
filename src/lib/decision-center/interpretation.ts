import type { AiConfig, AiUsage } from '@/lib/ai/types'
import { runProvider, stripCodeFence } from '@/lib/ai/generate'
import { formatCurrency } from '@/lib/currency'
import type { PeriodPreset } from '@/lib/period'
import type { DecisionCenterKpis } from './types'

/**
 * Section 2 of Centro de Decisiones — "¿Qué está pasando?": a
 * narrative that connects the period's KPIs to the REAL evidence
 * behind them (where the leak is, how much money is stuck) and ends
 * in a specific, evidence-based recommendation — not a restatement of
 * the KPI cards above it.
 *
 * Pipeline (DATO → CAMBIO → INTERPRETACIÓN → EVIDENCIA → IMPACTO →
 * ACCIÓN): everything below this comment except the two AI-facing
 * functions near the bottom is pure, deterministic, no I/O. DATOS/
 * CAMBIOS come from the KPIs the route already computed
 * (loadCeoMetrics / loadPeriodCommercialTrend); EVIDENCIA/IMPACTO come
 * from the funnel breakdown and Money at Risk the route ALSO already
 * computed (see payload.ts — the interpretation is built after those
 * resolve, specifically so it can cite real numbers instead of only
 * the 5 KPIs). AI, when the account has a provider configured, is
 * used ONLY to reword the already-correct narrative — never to decide
 * what happened, connect facts, or compute a number. The
 * deterministic version ships whenever AI isn't configured, times
 * out, or returns something unusable.
 *
 * Deliberately never claims causality the data doesn't demonstrate —
 * see `buildDeterministicInterpretation`'s own comment on "coincide
 * con" framing vs. a "porque" claim.
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

/** The real-world evidence the narrative and recommendation draw on
 *  beyond the 5 KPIs — the same numbers Sections 4/5 already show,
 *  passed in rather than recomputed (see payload.ts). */
export interface InterpretationContext {
  moneyAtRiskValue: number
  moneyAtRiskCount: number
  /** The window `loadMoneyAtRisk`/`loadCeoAlerts` used to call a deal
   *  "stalled" — folded into the recommendation's wording ("llevan
   *  más de N días sin avanzar"). */
  staleDays: number
  biggestLeakStage: { fromLabel: string; toLabel: string; dropPct: number | null } | null
  currency: string
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

/**
 * A metric whose CURRENT value is a structural zero (no sales, no
 * leads, no deal won...) rather than a small dip — "bajó 100.0%"
 * reads as a rounding artifact when the real story is "nothing
 * happened this period." Conversion is deliberately excluded: its 0%
 * is a legitimate rate when the denominator is real (see
 * buildInterpretationEvidence — conversion is null, not 0, whenever
 * there's no denominator to compute a rate from at all).
 */
function isStructuralZero(m: InterpretationMetric): boolean {
  return m.key !== 'conversion' && m.current === 0 && (m.previous ?? 0) > 0
}

function structuralZeroSentence(m: InterpretationMetric, currency: string): string {
  const prevText = m.key === 'sales' || m.key === 'avgTicket' ? formatCurrency(m.previous ?? 0, currency) : String(m.previous ?? 0)
  switch (m.key) {
    case 'sales':
      return `No hubo ventas en el período. El período anterior registró ${prevText}.`
    case 'leads':
      return `No llegaron leads nuevos en el período. El período anterior llegaron ${prevText}.`
    case 'avgTicket':
      return `Sin ventas en el período, así que no hay ticket promedio que calcular — el período anterior fue ${prevText}.`
    case 'opportunities':
      return `No se crearon oportunidades nuevas en el período. El período anterior se crearon ${prevText}.`
    case 'conversion':
      return ''
  }
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

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

/**
 * INTERPRETACIÓN — the deterministic (no-AI) narrative. Always
 * correct because it's a plain template over real evidence; this is
 * what the route falls back to when AI wording isn't available or
 * returns something unusable.
 *
 * Never claims causality the data doesn't demonstrate: when a KPI
 * decline and stalled-deal money coexist, the sentence says the
 * decline "coincide con" (coincides with) the stalled value — a
 * correlational, evidence-backed statement — never "porque" (because)
 * of it, which would assert a causal link this data alone can't
 * prove. See the brief's own HECHO → EVIDENCIA → INTERPRETACIÓN
 * CONTROLADA vs. DATO → CONCLUSIÓN INVENTADA distinction.
 */
export function buildDeterministicInterpretation(
  metrics: InterpretationMetric[],
  rangeLabel: PeriodPreset,
  ctx: InterpretationContext,
): string {
  const rangeText = RANGE_TEXT[rangeLabel] ?? RANGE_TEXT.custom
  const declining = pickHeadlineEvidence(metrics.filter((m) => m.direction === 'down'), 1)[0]
  const improving = pickHeadlineEvidence(metrics.filter((m) => m.direction === 'up'), 1)[0]

  if (!declining && !improving) {
    return `No hay suficientes datos del período anterior para comparar ${rangeText}, así que todavía no hay una tendencia clara que reportar.`
  }

  const sentences: string[] = []

  if (declining) {
    sentences.push(
      isStructuralZero(declining)
        ? structuralZeroSentence(declining, ctx.currency)
        : `${capitalize(rangeText)}, ${fmtDelta(declining)} frente al período anterior.`,
    )

    if (ctx.biggestLeakStage && (ctx.biggestLeakStage.dropPct ?? 0) >= 30) {
      sentences.push(
        `La mayor caída del embudo está entre "${ctx.biggestLeakStage.fromLabel}" y "${ctx.biggestLeakStage.toLabel}" — ahí es donde más oportunidades se detienen.`,
      )
    }

    if (ctx.moneyAtRiskCount > 0) {
      const oportunidad = pluralize(ctx.moneyAtRiskCount, 'oportunidad', 'oportunidades')
      const estancada = pluralize(ctx.moneyAtRiskCount, 'estancada', 'estancadas')
      sentences.push(
        `La caída coincide con ${formatCurrency(ctx.moneyAtRiskValue, ctx.currency)} en ${ctx.moneyAtRiskCount} ${oportunidad} ${estancada} — la señal más fuerte asociada a este período.`,
      )
    }
  } else if (improving) {
    sentences.push(`${capitalize(rangeText)}, ${fmtDelta(improving)} frente al período anterior.`)
  }

  return sentences.join(' ')
}

const RECOMMENDATION_BY_METRIC: Record<InterpretationMetric['key'], InterpretationRecommendation> = {
  sales: {
    title: 'Revisa por qué no se está cerrando',
    description:
      'Las ventas cayeron frente al período anterior. Revisa las oportunidades abiertas más antiguas y confirma si hay tratos atascados que deberían cerrarse.',
  },
  leads: {
    title: 'Revisa la entrada de leads nuevos',
    description:
      'Llegaron menos leads que en el período anterior. Revisa si las fuentes habituales (anuncios, referidos, WhatsApp orgánico) siguen generando tráfico igual que antes.',
  },
  conversion: {
    title: 'Revisa el manejo de las conversaciones',
    description:
      'La tasa de cierre bajó frente al período anterior. Revisa las conversaciones recientes que no cerraron para identificar objeciones repetidas o seguimientos que se quedaron sin respuesta.',
  },
  avgTicket: {
    title: 'Revisa el valor de los tratos que se están cerrando',
    description:
      'El ticket promedio bajó frente al período anterior. Revisa si se están cerrando tratos de menor tamaño de lo habitual, o si conviene ajustar la oferta.',
  },
  opportunities: {
    title: 'Revisa la generación de nuevas oportunidades',
    description:
      'Se crearon menos oportunidades que en el período anterior. Revisa si el equipo está calificando y avanzando leads hacia el pipeline al mismo ritmo.',
  },
}

export interface InterpretationRecommendation {
  title: string
  description: string
}

/**
 * "Qué hacer ahora" — a single, deterministic recommendation tied
 * DIRECTLY to real evidence: when there's stalled money behind the
 * decline, it names the exact count/value/window instead of a
 * generic "revisa tu pipeline". Distinct from Section 7 "Qué
 * deberías hacer hoy" (individual lead/deal-level next-best-actions,
 * sourced from open deals/conversations): this is the ONE structural
 * read on the period's overall trend. Deterministic only (no AI
 * rewording) — it's already a short, specific instruction, not
 * narrative prose that benefits from polish the way the
 * interpretation paragraph does.
 */
export function buildInterpretationRecommendation(
  metrics: InterpretationMetric[],
  ctx: InterpretationContext,
): InterpretationRecommendation | null {
  const worst = pickHeadlineEvidence(metrics.filter((m) => m.direction === 'down'), 1)[0]
  if (worst) {
    if (ctx.moneyAtRiskCount > 0) {
      const oportunidad = pluralize(ctx.moneyAtRiskCount, 'oportunidad', 'oportunidades')
      return {
        title: 'Revisa las oportunidades estancadas primero',
        description: `${ctx.moneyAtRiskCount} ${oportunidad} llevan más de ${ctx.staleDays} días sin avanzar y representan ${formatCurrency(ctx.moneyAtRiskValue, ctx.currency)}. Empieza por las de mayor valor.`,
      }
    }
    return RECOMMENDATION_BY_METRIC[worst.key]
  }

  const best = pickHeadlineEvidence(
    metrics.filter((m) => m.direction === 'up'),
    1,
  )[0]
  if (best) {
    return {
      title: 'Sigue con el enfoque actual',
      description: `${best.label} mejoró frente al período anterior — vale la pena identificar qué se hizo distinto para repetirlo.`,
    }
  }

  return null
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
    '- No afirmes una causa que los HECHOS no demuestren. Si la VERSIÓN BASE dice que una caída "coincide con" algo, mantén ese lenguaje de correlación — nunca lo conviertas en "porque" o "debido a".',
    '- No agregues recomendaciones ni conclusiones que no se desprendan directamente de los HECHOS.',
    '- Tono profesional, directo, sin saludos ni relleno, sin frases genéricas como "hay oportunidades de mejora" o "es importante hacer seguimiento".',
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
