import type { CategoryType } from '@/core/category'

/** "ดูตาม" on the Reports tab (report.md Q2): no day, week or "all". */
export type ReportUnit = 'month' | 'quarter' | 'year' | 'custom'

export const REPORT_UNITS: readonly ReportUnit[] = ['month', 'quarter', 'year', 'custom']

/** How the trend splits the chosen period (rule 7). */
export type TrendStep = 'month' | 'quarter' | 'year'

/** Months in one part of each step. */
export const TREND_STEP_MONTHS: Readonly<Record<TrendStep, number>> = {
  month: 1,
  quarter: 3,
  year: 12,
}

/** Per profile on the device, wiped with it (`tpn-profile:` keys). */
export const REPORT_PREF_PREFIX = 'tpn-profile:report:'

/** One currency's summary card (rules 1, 9–11). Amounts in minor units. */
export interface ReportSummary {
  currencyCode: string
  minorUnit: number
  income: number
  expense: number
  net: number
  /** Transfers in − out of the wallets in view (explains the balances, never income). */
  transfer: number
  /** Debt entries in − out of the wallets in view (debt rule 7: balances only, never income). */
  debt: number
  /** `excludeFromReport` rows of the period: how many and their signed sum (rule 11). */
  excludedCount: number
  excluded: number
  /** ยอดเริ่มต้น / ยอดสุดท้าย (rule 9). */
  start: number
  end: number
  /** Expense per day (rule 10), null for a one-day period. */
  perDay: number | null
}

/** A row of the by-category breakdown (rules 4–6). */
export interface CategoryShare {
  /** The category's id; for money on a parent itself, the parent's id with `direct`. */
  id: string
  name: string
  icon: string
  color: string
  type: CategoryType
  amount: number
  count: number
  isArchived: boolean
  /** Live sub-categories with money in the period (a top-level row). */
  childCount: number
  /** "ไม่ระบุหมวดย่อย": rows saved on the parent itself (Q4). */
  direct: boolean
}

/** One bar pair of the trend (rule 7): a part of the chosen period, cut to it. */
export interface TrendPoint {
  from: string
  to: string
  income: number
  expense: number
}

/** The chosen period split into parts (rule 7); null when it lies inside one month. */
export interface Trend {
  step: TrendStep
  points: TrendPoint[]
}
