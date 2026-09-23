export interface PeriodValue {
  current: number
  previous: number
}

export interface DecisionCenterKpis {
  sales: PeriodValue
  leads: PeriodValue
  /** Percent (0-100), not a PeriodValue — a period with zero closed
   *  deals has no rate to report at all, not a rate of 0. */
  conversion: { current: number | null; previous: number | null }
  avgTicket: PeriodValue
  opportunities: PeriodValue
}
