import type { Insight } from '@/lib/sales-intelligence/insights'

/**
 * "Qué hacer" per insight TYPE — the third line of the Problema →
 * Impacto → Acción card format (spec section 17). Deliberately
 * separate from `interpretation.ts`'s buildInterpretationRecommendation
 * (which is tied to a KPI trend, one per page) — this is tied to an
 * individual detected insight, one per card, reusing the exact
 * `type`/`params` buildInsights already computed. Pure, deterministic,
 * hardcoded Spanish — same convention as rules.ts and interpretation.ts
 * (this module has no i18n context; the titleKey/descriptionKey next
 * to it ARE translated, via next-intl, by whatever component renders
 * the card — only this guidance line stays Spanish-only, matching
 * every other auto-generated "what to do" text in this product).
 *
 * Never invents a step beyond what the insight's own evidence
 * supports — no new calculation, no causal claim not already implied
 * by the insight itself.
 */
export function buildActionGuidance(insight: Insight): string | null {
  switch (insight.type) {
    case 'stalled_deals':
      return 'Contacta primero las oportunidades de mayor valor que llevan más tiempo sin avanzar.'
    case 'hot_leads_unanswered':
      return 'Responde primero a los leads HOT con más tiempo esperando respuesta.'
    case 'low_pipeline_coverage':
      return 'Con el ritmo actual no hay pipeline suficiente para sostener la meta — revisa la generación de nuevas oportunidades y la recuperación de las existentes.'
    case 'forecast_gap':
      return 'Revisa qué oportunidades del pipeline pueden avanzar antes de que cierre el período.'
    case 'win_rate_decline':
      return 'Revisa las conversaciones recientes que no cerraron para identificar objeciones repetidas.'
    case 'sales_cycle_increase':
      return 'Revisa en qué etapa se están demorando más los tratos actuales.'
    case 'at_risk_customers':
      return 'Contacta primero a los clientes con trato abierto de mayor valor que llevan más tiempo en silencio.'
    case 'broken_promises':
      return 'Cumple primero los compromisos vencidos con más tiempo de atraso.'
    case 'recovery_opportunity': {
      const name = typeof insight.params.contactName === 'string' && insight.params.contactName ? insight.params.contactName : 'este contacto'
      return `Contacta de nuevo a ${name} — tiene un trato perdido con valor real.`
    }
    case 'follow_up_stalled':
    case 're_engage_silent':
    case 'fulfill_broken_promise': {
      const name = typeof insight.params.contactName === 'string' && insight.params.contactName ? insight.params.contactName : 'este contacto'
      const days = insight.params.days
      return days != null ? `Contacta a ${name} — lleva ${days} día(s) sin actividad.` : `Contacta a ${name}.`
    }
    default:
      return null
  }
}
