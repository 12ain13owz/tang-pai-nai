import { DOCUMENT } from '@angular/common'
import { computed, effect, inject, Service, signal, untracked } from '@angular/core'
import { CATEGORY_TABLE } from '@/core/category'
import type { CategoryType } from '@/core/category'
import { OfflineService } from '@/core/offline'
import type { LocalDatabase, SqlValue } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import {
  FUTURE,
  periodRange,
  periodTabs,
  TRANSACTION_TABLE,
  TransactionService,
  TRANSFER_TABLE,
} from '@/core/transaction'
import type { DayRange, PeriodTab } from '@/core/transaction'
import {
  DEBT_ENTRY_SIGN_SQL,
  DEBT_ENTRY_TABLE,
  DEBT_TABLE,
  WALLET_TABLE,
  WalletService,
} from '@/core/wallet'
import { addDays, addMonths, fromDay } from '@/shared/utils'
import { REPORT_PREF_PREFIX, REPORT_UNITS, TREND_STEP_MONTHS } from './report.type'
import type {
  CategoryShare,
  ReportSummary,
  ReportUnit,
  Trend,
  TrendPoint,
  TrendStep,
} from './report.type'

/** A period with both ends (every report unit has them). */
interface FullRange {
  from: string
  to: string
}

/** Days from `from` to `to`, both counted. */
const dayCount = (from: string, to: string): number =>
  Math.round((fromDay(to).getTime() - fromDay(from).getTime()) / 86_400_000) + 1

/** Calendar months `from` to `to` touch, both counted. */
const monthCount = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1
}

/** The first day of the month, quarter or year holding `day`. */
const stepStart = (day: string, step: TrendStep): string => {
  const [year, month] = day.split('-').map(Number)
  const size = TREND_STEP_MONTHS[step]
  const first = Math.floor((month - 1) / size) * size + 1
  return `${String(year).padStart(4, '0')}-${String(first).padStart(2, '0')}-01`
}

/**
 * The Reports tab (docs/features/report.md): its own period (remembered per profile), the
 * Transactions tab's chosen wallet (Q3), and every figure as one aggregate over the local
 * database (Volume). Nothing here writes.
 */
@Service()
export class ReportService {
  private offlineService = inject(OfflineService)
  private profileService = inject(ProfileService)
  private walletService = inject(WalletService)
  private transactionService = inject(TransactionService)
  private window = inject(DOCUMENT).defaultView

  unit = signal<ReportUnit>('month')
  /** The chosen period: 0 = the current one, −1 = the one before, … (never "อนาคต"). */
  tab = signal(0)
  custom = signal<DayRange>({ from: null, to: null })
  /** The custom range sheet of this tab. */
  customSheet = signal(false)
  /** The breakdown's type tab (รายจ่าย / รายรับ). */
  type = signal<CategoryType>('expense')
  /** The currency chosen for the trend and breakdown (Q6); null = the first in view. */
  chosenCurrency = signal<string | null>(null)

  today = this.transactionService.today
  /** "ทุกกระเป๋า" or the wallet chosen on either tab (Q3). */
  walletIds = this.transactionService.viewWalletIds

  /** Oldest first back to the profile's oldest row; never the month view's "อนาคต". */
  tabs = computed(() =>
    periodTabs(this.unit(), this.today(), this.transactionService.firstDay()).filter(
      (tab) => tab !== FUTURE
    )
  )
  range = computed<FullRange>(() => this.full(this.rangeOf(this.tab())))
  /** The period before the chosen one, same length (E4). */
  previousRange = computed<FullRange>(() => {
    const tab = this.tab()
    if (this.unit() !== 'custom' && typeof tab === 'number') {
      return this.full(this.rangeOf(tab - 1))
    }
    const { from, to } = this.range()
    const days = dayCount(from, to)
    return { from: addDays(from, -days), to: addDays(from, -1) }
  })

  /** One card per currency, in currency order (rules 1, 9–11). */
  summaries = computed<ReportSummary[]>(() => this.summarize(this.range(), this.walletIds()))
  /**
   * Whether the period has anything to show (else the empty state): money in or out, rows left
   * out, or transfers that moved the balances (a savings wallet).
   */
  hasData = computed(() =>
    this.summaries().some(
      (line) =>
        line.income > 0 ||
        line.expense > 0 ||
        line.excludedCount > 0 ||
        line.transfer !== 0 ||
        line.debt !== 0
    )
  )
  currencies = computed(() => this.summaries().map((line) => line.currencyCode))
  currencyCode = computed(() => {
    const codes = this.currencies()
    const chosen = this.chosenCurrency()
    return chosen && codes.includes(chosen) ? chosen : (codes.at(0) ?? null)
  })
  minorUnit = computed(() => this.walletService.minorUnit(this.currencyCode() ?? ''))
  breakdown = computed(() => {
    const code = this.currencyCode()
    return code ? this.byCategory(this.range(), this.walletIds(), this.type(), code) : []
  })
  /** Rule 7: the chosen period split into its months (quarters, years for a long range). */
  trend = computed<Trend | null>(() => {
    const code = this.currencyCode()
    const { from, to } = this.range()
    const months = monthCount(from, to)
    if (!code || months <= 1) {
      return null
    }
    const step: TrendStep = months <= 12 ? 'month' : months <= 36 ? 'quarter' : 'year'
    const points: TrendPoint[] = []
    for (let start = stepStart(from, step); start <= to;) {
      const next = addMonths(start, TREND_STEP_MONTHS[step])
      const end = addDays(next, -1)
      points.push({
        from: start < from ? from : start,
        to: end > to ? to : end,
        income: 0,
        expense: 0,
      })
      start = next
    }
    return { step, points: this.bucket(points, this.walletIds(), code) }
  })

  constructor() {
    // Each profile has its own remembered unit; a new profile starts on the month.
    effect(() => {
      const profileId = this.profileService.currentId() ?? ''
      untracked(() => {
        this.unit.set(this.readUnit(profileId))
        this.tab.set(0)
      })
    })
  }

  selectUnit(unit: ReportUnit): void {
    this.unit.set(unit)
    this.tab.set(0)
    if (unit !== 'custom') {
      this.writeUnit(unit)
    }
  }

  selectCustom(range: DayRange): void {
    this.custom.set(range)
    this.selectUnit('custom')
  }

  /**
   * The breakdown (rules 4–6): top-level categories of `type` with their sub-categories' money
   * folded in, largest first; with `parentId`, that parent's sub-categories plus the money on
   * the parent itself as a `direct` row (Q4).
   */
  byCategory(
    range: FullRange,
    walletIds: readonly string[],
    type: CategoryType,
    currencyCode: string,
    parentId: string | null = null
  ): CategoryShare[] {
    const where = this.where(range, walletIds)
    if (!where) {
      return []
    }
    const key = parentId ? 'c.id' : 'coalesce(c.parent_id, c.id)'
    const params: SqlValue[] = [...where.params, type, currencyCode]
    let scope = ''
    if (parentId) {
      scope = 'AND (c.id = ? OR c.parent_id = ?)'
      params.push(parentId, parentId)
    }
    const rows = this.read(
      (db) =>
        db.selectObjects(
          `SELECT s.id, s.total, s.n, s.children, k.name, k.icon, k.color, k.is_archived
           FROM (
             SELECT ${key} AS id, sum(t.amount) AS total, count(*) AS n,
               count(DISTINCT CASE WHEN c.parent_id IS NOT NULL THEN c.id END) AS children
             FROM ${TRANSACTION_TABLE} t
             JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
             JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
             WHERE ${where.sql} AND t.exclude_from_report = 0 AND c.type = ?
               AND w.currency_code = ? ${scope}
             GROUP BY 1
           ) s
           LEFT JOIN ${CATEGORY_TABLE} k ON k.id = s.id
           ORDER BY s.total DESC, k.sort_order, k.name`,
          params
        ),
      []
    )
    return rows.map((row) => {
      const id = String(row['id'])
      return {
        id,
        name: String(row['name'] ?? ''),
        icon: String(row['icon'] ?? ''),
        color: String(row['color'] ?? ''),
        type,
        amount: Number(row['total']),
        count: Number(row['n']),
        isArchived: row['is_archived'] === 1,
        childCount: parentId ? 0 : Number(row['children']),
        direct: id === parentId,
      }
    })
  }

  /** Σ amount of counted rows on `categoryIds` (a category page's total and E4). */
  categoryTotal(
    range: FullRange,
    walletIds: readonly string[],
    categoryIds: readonly string[],
    currencyCode: string
  ): number {
    const where = this.where(range, walletIds)
    if (!where || categoryIds.length === 0) {
      return 0
    }
    return this.read(
      (db) =>
        Number(
          db.selectValue(
            `SELECT coalesce(sum(t.amount), 0)
             FROM ${TRANSACTION_TABLE} t JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
             WHERE ${where.sql} AND t.exclude_from_report = 0 AND w.currency_code = ?
               AND t.category_id IN (${categoryIds.map(() => '?').join(', ')})`,
            [...where.params, currencyCode, ...categoryIds]
          ) ?? 0
        ),
      0
    )
  }

  /** The type total of the breakdown (the base of every share). */
  typeTotal(
    range: FullRange,
    walletIds: readonly string[],
    type: CategoryType,
    currencyCode: string
  ): number {
    const line = this.summarize(range, walletIds).find((item) => item.currencyCode === currencyCode)
    return line ? (type === 'income' ? line.income : line.expense) : 0
  }

  /** The days the tab covers; `custom` is the range the user chose. */
  rangeOf(tab: PeriodTab): DayRange {
    return periodRange(this.unit(), tab, this.today(), this.custom())
  }

  private summarize(range: FullRange, walletIds: readonly string[]): ReportSummary[] {
    const base = this.transactionService.summary(range, walletIds)
    const where = this.where(range, walletIds)
    if (!where) {
      return []
    }
    const excluded = new Map<string, { count: number; sum: number }>()
    for (const row of this.read(
      (db) =>
        db.selectObjects(
          `SELECT w.currency_code AS currency, count(*) AS n,
             sum(CASE WHEN c.type = 'income' THEN t.amount ELSE -t.amount END) AS total
           FROM ${TRANSACTION_TABLE} t
           JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
           JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
           WHERE ${where.sql} AND t.exclude_from_report = 1
           GROUP BY w.currency_code`,
          where.params
        ),
      []
    )) {
      excluded.set(String(row['currency']), { count: Number(row['n']), sum: Number(row['total']) })
    }
    const lines = new Map(base.map((line) => [line.currencyCode, line]))
    for (const code of excluded.keys()) {
      if (!lines.has(code)) {
        lines.set(code, {
          currencyCode: code,
          minorUnit: this.walletService.minorUnit(code),
          income: 0,
          expense: 0,
          net: 0,
          transfer: 0,
          debt: 0,
        })
      }
    }
    const start = this.balancesAt(addDays(range.from, -1), walletIds)
    const end = this.balancesAt(range.to, walletIds)
    // Rule 10: up to today in the current period.
    const today = this.today()
    const last = range.from <= today && today < range.to ? today : range.to
    const days = dayCount(range.from, last)
    const order = this.walletService.currencies().map((currency) => currency.code)
    return [...lines.values()]
      .sort(
        (a, b) =>
          order.indexOf(a.currencyCode) - order.indexOf(b.currencyCode) ||
          a.currencyCode.localeCompare(b.currencyCode)
      )
      .map((line) => {
        const left = excluded.get(line.currencyCode) ?? { count: 0, sum: 0 }
        return {
          currencyCode: line.currencyCode,
          minorUnit: line.minorUnit,
          income: line.income,
          expense: line.expense,
          net: line.net,
          transfer: line.transfer,
          debt: line.debt,
          excludedCount: left.count,
          excluded: left.sum,
          start: start.get(line.currencyCode) ?? 0,
          end: end.get(line.currencyCode) ?? 0,
          // Rounded half up to the minor unit, in integers.
          perDay:
            dayCount(range.from, range.to) > 1
              ? Math.floor((2 * line.expense + days) / (2 * days))
              : null,
        }
      })
  }

  /**
   * Rule 9: the wallets' balance per currency at the end of `day` (transaction rule 12:
   * `initialBalance`, every live transaction, transfers in − out), one aggregate.
   */
  private balancesAt(day: string, walletIds: readonly string[]): Map<string, number> {
    const sums = new Map<string, number>()
    const profileId = this.profileService.current()?.id
    if (!profileId || walletIds.length === 0) {
      return sums
    }
    const inWallets = walletIds.map(() => '?').join(', ')
    const ids = new Set(walletIds)
    for (const wallet of this.walletService.wallets()) {
      if (ids.has(wallet.id)) {
        sums.set(wallet.currencyCode, (sums.get(wallet.currencyCode) ?? 0) + wallet.initialBalance)
      }
    }
    const rows = this.read(
      (db) =>
        db.selectObjects(
          `SELECT w.currency_code AS currency, sum(x.amount) AS total
           FROM (
             SELECT t.wallet_id AS wallet_id,
               CASE WHEN c.type = 'income' THEN t.amount ELSE -t.amount END AS amount
             FROM ${TRANSACTION_TABLE} t JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
             WHERE t.profile_id = ? AND t.deleted_at IS NULL AND t.occurred_on <= ?
               AND t.wallet_id IN (${inWallets})
             UNION ALL
             SELECT from_wallet_id, -amount FROM ${TRANSFER_TABLE}
             WHERE profile_id = ? AND deleted_at IS NULL AND occurred_on <= ?
               AND from_wallet_id IN (${inWallets})
             UNION ALL
             SELECT to_wallet_id, amount FROM ${TRANSFER_TABLE}
             WHERE profile_id = ? AND deleted_at IS NULL AND occurred_on <= ?
               AND to_wallet_id IN (${inWallets})
             UNION ALL
             SELECT e.wallet_id, ${DEBT_ENTRY_SIGN_SQL}
             FROM ${DEBT_ENTRY_TABLE} e JOIN ${DEBT_TABLE} d ON d.id = e.debt_id
             WHERE e.profile_id = ? AND e.deleted_at IS NULL AND e.occurred_on <= ?
               AND e.wallet_id IN (${inWallets})
           ) x
           JOIN ${WALLET_TABLE} w ON w.id = x.wallet_id
           GROUP BY w.currency_code`,
          [
            ...[profileId, day, ...walletIds],
            ...[profileId, day, ...walletIds],
            ...[profileId, day, ...walletIds],
            ...[profileId, day, ...walletIds],
          ]
        ),
      []
    )
    for (const row of rows) {
      const code = String(row['currency'])
      sums.set(code, (sums.get(code) ?? 0) + Number(row['total']))
    }
    return sums
  }

  /** Rule 7: income and expense of each point's days, in one aggregate. */
  private bucket(
    points: TrendPoint[],
    walletIds: readonly string[],
    currencyCode: string
  ): TrendPoint[] {
    const first = points.at(0)
    const last = points.at(-1)
    const where = first && last ? this.where({ from: first.from, to: last.to }, walletIds) : null
    if (!where) {
      return points
    }
    const cases = points.map((_, i) => `WHEN t.occurred_on <= ? THEN ${i}`).join(' ')
    const rows = this.read(
      (db) =>
        db.selectObjects(
          `SELECT CASE ${cases} END AS bucket, c.type AS type, sum(t.amount) AS total
           FROM ${TRANSACTION_TABLE} t
           JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
           JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
           WHERE ${where.sql} AND t.exclude_from_report = 0 AND w.currency_code = ?
           GROUP BY 1, 2`,
          [...points.map((point) => point.to), ...where.params, currencyCode]
        ),
      []
    )
    const result = points.map((point) => ({ ...point }))
    for (const row of rows) {
      const point = result.at(Number(row['bucket']))
      if (point) {
        point[row['type'] === 'income' ? 'income' : 'expense'] += Number(row['total'])
      }
    }
    return result
  }

  /** The current profile's live rows in `range` of `walletIds` (null: no profile / wallet). */
  private where(
    range: FullRange,
    walletIds: readonly string[]
  ): { sql: string; params: SqlValue[] } | null {
    const profileId = this.profileService.current()?.id
    if (!profileId || walletIds.length === 0) {
      return null
    }
    return {
      sql: `t.profile_id = ? AND t.deleted_at IS NULL AND t.occurred_on >= ? AND t.occurred_on <= ?
        AND t.wallet_id IN (${walletIds.map(() => '?').join(', ')})`,
      params: [profileId, range.from, range.to, ...walletIds],
    }
  }

  /** Every report unit has both ends; a custom range not chosen yet falls back to today. */
  private full(range: DayRange): FullRange {
    const today = this.today()
    return { from: range.from ?? range.to ?? today, to: range.to ?? range.from ?? today }
  }

  private readUnit(profileId: string): ReportUnit {
    try {
      const saved = this.storage()?.getItem(`${REPORT_PREF_PREFIX}unit:${profileId}`)
      // A custom range isn't kept, so it comes back as a month.
      return REPORT_UNITS.includes(saved as ReportUnit) && saved !== 'custom'
        ? (saved as ReportUnit)
        : 'month'
    } catch {
      return 'month'
    }
  }

  private writeUnit(unit: ReportUnit): void {
    const profileId = this.profileService.current()?.id
    try {
      if (profileId) {
        this.storage()?.setItem(`${REPORT_PREF_PREFIX}unit:${profileId}`, unit)
      }
    } catch {
      // A blocked storage only loses the convenience.
    }
  }

  /** Lasting on a trusted device, for the tab's life on an untrusted one (like the profile). */
  private storage(): Storage | null {
    try {
      return this.offlineService.isTrusted()
        ? (this.window?.localStorage ?? null)
        : (this.window?.sessionStorage ?? null)
    } catch {
      return null
    }
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }
}
