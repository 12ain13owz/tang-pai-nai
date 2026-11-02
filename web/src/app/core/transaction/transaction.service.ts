import { DOCUMENT } from '@angular/common'
import { computed, effect, inject, Service, signal, untracked } from '@angular/core'
import { CATEGORY_TABLE } from '@/core/category'
import type { CategoryType } from '@/core/category'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase, SqlValue } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { WALLET_TABLE, WalletService } from '@/core/wallet'
import type { Wallet } from '@/core/wallet'
import { addDays, toDay } from '@/shared/utils'
import { PERIOD_UNITS, periodRange, periodTabs } from './period'
import { TRANSACTION_PREF_PREFIX, TRANSACTION_TABLE } from './transaction.type'
import type { PeriodTab, PeriodUnit } from './period'
import type {
  DayRange,
  MoneySummary,
  Transaction,
  TransactionItem,
  TransactionSheetState,
  TransactionValues,
} from './transaction.type'

/** Rule 13: newest day first, then the one recorded last. */
const ORDER = 'ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC'

/**
 * The current profile's transactions on this device (docs/features/transaction.md). Reads come
 * from the local database through its indexes (Volume); every write goes through the outbox.
 */
@Service()
export class TransactionService {
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)
  private walletService = inject(WalletService)
  private window = inject(DOCUMENT).defaultView

  canWrite = this.profileService.canWrite
  serverDown = this.profileService.serverDown

  /** Transactions with an op still waiting to sync ("รอ sync"). */
  pendingIds = computed(
    () =>
      new Set(
        this.read(
          (db) =>
            db
              .selectObjects(`SELECT row_id FROM outbox WHERE tbl = ? AND status = 'pending'`, [
                TRANSACTION_TABLE,
              ])
              .map((row) => String(row['row_id'])),
          []
        )
      )
  )

  /** The open transaction sheet (layout/transaction-sheet), if any. */
  sheet = signal<TransactionSheetState | null>(null)

  // The Transactions tab's view (transaction.md → Web screens), shared by the header (wallet
  // switcher, ⋮ "ดูตาม") and the page. The wallet and the unit are remembered per profile.
  /** The chosen wallet, or null for "ทุกกระเป๋า". */
  viewWalletId = signal<string | null>(null)
  unit = signal<PeriodUnit>('month')
  tab = signal<PeriodTab>(0)
  custom = signal<DayRange>({ from: null, to: null })
  /** The header's wallet switcher sheet and the custom range sheet. */
  walletSheet = signal(false)
  customSheet = signal(false)
  /** The device's date, refreshed when the app comes back and every minute. */
  today = signal(toDay())

  /** The chosen wallet while it's live, else null ("ทุกกระเป๋า"). */
  viewWallet = computed<Wallet | null>(() => {
    const id = this.viewWalletId()
    return this.walletService.wallets().find((wallet) => wallet.id === id) ?? null
  })
  /**
   * Rule 11's "all wallets": the profile's wallets without `excludeFromTotal`, archived ones
   * included (their history stays); or the one chosen.
   */
  viewWalletIds = computed<string[]>(() => {
    const wallet = this.viewWallet()
    if (wallet) {
      return [wallet.id]
    }
    return this.walletService
      .wallets()
      .filter((item) => !item.excludeFromTotal)
      .map((item) => item.id)
  })
  /** The profile's oldest transaction day, where the period tabs start. */
  firstDay = computed<string | null>(() => {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      return null
    }
    return this.read((db) => {
      const value = db.selectValue(
        `SELECT min(occurred_on) FROM ${TRANSACTION_TABLE} WHERE profile_id = ? AND deleted_at IS NULL`,
        [profileId]
      )
      return typeof value === 'string' ? value : null
    }, null)
  })
  tabs = computed(() => periodTabs(this.unit(), this.today(), this.firstDay()))
  range = computed(() => periodRange(this.unit(), this.tab(), this.today(), this.custom()))
  items = computed(() => this.list(this.range(), this.viewWalletIds()))
  summaryLines = computed(() => this.summary(this.range(), this.viewWalletIds()))

  constructor() {
    // Each profile has its own remembered wallet and unit; a new profile starts on "ทุกกระเป๋า".
    effect(() => {
      const profileId = this.profileService.current()?.id ?? ''
      untracked(() => {
        const saved = this.readView(profileId)
        this.viewWalletId.set(saved.walletId)
        this.unit.set(saved.unit)
        this.tab.set(0)
      })
    })
    const refresh = () => this.today.set(toDay())
    this.window?.document.addEventListener('visibilitychange', refresh)
    this.window?.setInterval(refresh, 60_000)
    // Rule 10: a wallet or category deleted on a device that didn't know all its transactions
    // leaves live ones behind; whichever device sees that tombstones the ones it holds.
    effect(() => {
      this.offlineService.changes()
      if (!this.canWrite()) {
        return
      }
      untracked(() => {
        if (this.orphans(this.offlineService.db()).length > 0) {
          const now = Date.now()
          this.offlineService.write((tx) => {
            for (const row of this.orphans(tx)) {
              queueWrite(tx, TRANSACTION_TABLE, 'delete', {
                ...row,
                updatedAt: now,
                deletedAt: now,
              })
            }
          })
        }
      })
    })
  }

  /**
   * The current profile's live transactions in `range` (in order, rule 13), with their category
   * and wallet; only `walletIds` when given.
   */
  list(range: DayRange, walletIds: readonly string[] | null = null): TransactionItem[] {
    const where = this.where(range, walletIds)
    if (!where) {
      return []
    }
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT t.*, c.type AS c_type, c.name AS c_name, c.icon AS c_icon, c.color AS c_color,
               w.name AS w_name, w.currency_code AS w_currency
             FROM ${TRANSACTION_TABLE} t
             LEFT JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
             LEFT JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
             WHERE ${where.sql} ${ORDER}`,
            where.params
          )
          .map((row) => ({
            ...toTransaction(fromSql(TRANSACTION_TABLE, row)),
            type: row['c_type'] === 'income' ? 'income' : 'expense',
            categoryName: String(row['c_name'] ?? ''),
            categoryIcon: String(row['c_icon'] ?? ''),
            categoryColor: String(row['c_color'] ?? ''),
            walletName: String(row['w_name'] ?? ''),
            currencyCode: String(row['w_currency'] ?? ''),
          })),
      []
    )
  }

  /** Rule 11: income, expense and net per currency, leaving out `excludeFromReport` rows. */
  summary(range: DayRange, walletIds: readonly string[] | null = null): MoneySummary[] {
    const where = this.where(range, walletIds)
    if (!where) {
      return []
    }
    const sums = new Map<string, { income: number; expense: number }>()
    const rows = this.read(
      (db) =>
        db.selectObjects(
          `SELECT w.currency_code AS currency, c.type AS type, sum(t.amount) AS total
           FROM ${TRANSACTION_TABLE} t
           JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
           JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
           WHERE ${where.sql} AND t.exclude_from_report = 0
           GROUP BY w.currency_code, c.type`,
          where.params
        ),
      []
    )
    for (const row of rows) {
      const code = String(row['currency'])
      const sum = sums.get(code) ?? { income: 0, expense: 0 }
      sum[row['type'] === 'income' ? 'income' : 'expense'] += Number(row['total'])
      sums.set(code, sum)
    }
    const order = this.walletService.currencies().map((currency) => currency.code)
    return [...sums.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b))
      .map(([currencyCode, { income, expense }]) => ({
        currencyCode,
        minorUnit: this.walletService.minorUnit(currencyCode),
        income,
        expense,
        net: income - expense,
      }))
  }

  /** A live transaction of any profile on this device. */
  byId(id: string): Transaction | null {
    return this.read((db) => {
      const row = this.find(db, id)
      return row?.deletedAt === null ? row : null
    }, null)
  }

  /**
   * Creates (`id` null) or updates a transaction in the current profile (a fix: the op's
   * profile); a fix also drops the rejected op. Remembers the wallet for the next add.
   */
  save(
    id: string | null,
    values: TransactionValues,
    fixOpId: string | null = null,
    profileId = this.profileService.current()?.id ?? ''
  ): string {
    const now = Date.now()
    const rowId = id ?? uuidv7(now)
    this.offlineService.write((db) => {
      const current = this.find(db, rowId)
      queueWrite(db, TRANSACTION_TABLE, 'upsert', {
        ...current,
        id: rowId,
        profileId: current?.profileId ?? profileId,
        walletId: values.walletId,
        categoryId: values.categoryId,
        amount: values.amount,
        occurredOn: values.occurredOn,
        note: values.note.trim(),
        excludeFromReport: values.excludeFromReport,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      })
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
    this.rememberWallet(profileId, values.walletId)
    return rowId
  }

  /** Rule 7: a tombstone at once; `restore` is the toast's undo. */
  remove(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current) {
        queueWrite(db, TRANSACTION_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      }
    })
  }

  /** Undo of `remove`: the tombstone becomes live again (offline-sync rule 12). */
  restore(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current && current.deletedAt !== null) {
        queueWrite(db, TRANSACTION_TABLE, 'upsert', { ...current, updatedAt: now, deletedAt: null })
      }
    })
  }

  /** Chooses the wallet the tab shows (null: "ทุกกระเป๋า"); remembered for the profile. */
  selectWallet(id: string | null): void {
    this.viewWalletId.set(id)
    this.writeView()
  }

  /** Chooses "ดูตาม"; the tabs start again on the current period. */
  selectUnit(unit: PeriodUnit): void {
    this.unit.set(unit)
    this.tab.set(0)
    this.writeView()
  }

  /** A custom range (from ≤ to). */
  selectCustom(range: DayRange): void {
    this.custom.set(range)
    this.selectUnit('custom')
  }

  /** The wallet a new transaction starts on: the last one used here, if still open. */
  defaultWalletId(profileId = this.profileService.current()?.id ?? ''): string | null {
    const open = this.walletService.openWallets()
    const last = this.storage()?.getItem(`${TRANSACTION_PREF_PREFIX}${profileId}`)
    return open.find((wallet) => wallet.id === last)?.id ?? open.at(0)?.id ?? null
  }

  /**
   * "ใช้บ่อย" (8.2): ids of the profile's `type` categories with the most live transactions dated
   * in the last `days` days, ties to the one recorded last. Through the (`profile_id`,
   * `occurred_on`) index; the picker keeps those it offers.
   */
  frequentCategoryIds(profileId: string, type: CategoryType, days = 90, limit = 12): string[] {
    if (!profileId) {
      return []
    }
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT t.category_id AS id, count(*) AS uses, max(t.created_at) AS last
             FROM ${TRANSACTION_TABLE} t
             JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
             WHERE t.profile_id = ? AND t.deleted_at IS NULL AND t.occurred_on >= ? AND c.type = ?
             GROUP BY t.category_id
             ORDER BY uses DESC, last DESC
             LIMIT ?`,
            [profileId, addDays(this.today(), -days), type, limit]
          )
          .map((row) => String(row['id'])),
      []
    )
  }

  /** The type a new transaction starts on: the last one added in the profile here (8.2). */
  lastType(profileId = this.profileService.current()?.id ?? ''): CategoryType {
    try {
      return this.storage()?.getItem(`${TRANSACTION_PREF_PREFIX}type:${profileId}`) === 'income'
        ? 'income'
        : 'expense'
    } catch {
      return 'expense'
    }
  }

  rememberType(type: CategoryType, profileId = this.profileService.current()?.id ?? ''): void {
    try {
      this.storage()?.setItem(`${TRANSACTION_PREF_PREFIX}type:${profileId}`, type)
    } catch {
      // A full or blocked storage only loses the convenience.
    }
  }

  open(state: TransactionSheetState): void {
    this.sheet.set(state)
  }

  /** "Fix" from the sync sheet: the refused values of a rejected transaction op. */
  openFix(opId: string): void {
    const op = this.syncService.rejectedOp(opId)
    if (!op || op.table !== TRANSACTION_TABLE) {
      return
    }
    const row = op.row
    const text = (key: string) => (typeof row[key] === 'string' ? row[key] : '')
    const profileId = text('profileId')
    this.open({
      mode: 'fix',
      opId,
      id: op.rowId,
      profileId: this.profileService.byId(profileId)
        ? profileId
        : (this.profileService.current()?.id ?? profileId),
      values: {
        walletId: text('walletId'),
        categoryId: text('categoryId'),
        amount: typeof row['amount'] === 'number' ? row['amount'] : 0,
        occurredOn: text('occurredOn'),
        note: text('note'),
        excludeFromReport: row['excludeFromReport'] === true,
      },
    })
  }

  /** The WHERE clause of `list` / `summary`, or null when no wallet is chosen. */
  private where(
    range: DayRange,
    walletIds: readonly string[] | null
  ): { sql: string; params: SqlValue[] } | null {
    const profileId = this.profileService.current()?.id
    if (!profileId || walletIds?.length === 0) {
      return null
    }
    const parts = ['t.profile_id = ?', 't.deleted_at IS NULL']
    const params: SqlValue[] = [profileId]
    if (range.from) {
      parts.push('t.occurred_on >= ?')
      params.push(range.from)
    }
    if (range.to) {
      parts.push('t.occurred_on <= ?')
      params.push(range.to)
    }
    if (walletIds) {
      parts.push(`t.wallet_id IN (${walletIds.map(() => '?').join(', ')})`)
      params.push(...walletIds)
    }
    return { sql: parts.join(' AND '), params }
  }

  private readView(profileId: string): { walletId: string | null; unit: PeriodUnit } {
    try {
      const raw = this.storage()?.getItem(`${TRANSACTION_PREF_PREFIX}view:${profileId}`)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object') {
        const { walletId, unit } = parsed as Record<string, unknown>
        return {
          walletId: typeof walletId === 'string' ? walletId : null,
          // A custom range isn't kept, so it comes back as a month.
          unit:
            PERIOD_UNITS.includes(unit as PeriodUnit) && unit !== 'custom'
              ? (unit as PeriodUnit)
              : 'month',
        }
      }
    } catch {
      // A blocked or broken storage only loses the convenience.
    }
    return { walletId: null, unit: 'month' }
  }

  private writeView(): void {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      return
    }
    try {
      this.storage()?.setItem(
        `${TRANSACTION_PREF_PREFIX}view:${profileId}`,
        JSON.stringify({ walletId: this.viewWalletId(), unit: this.unit() })
      )
    } catch {
      // As above.
    }
  }

  private rememberWallet(profileId: string, walletId: string): void {
    try {
      this.storage()?.setItem(`${TRANSACTION_PREF_PREFIX}${profileId}`, walletId)
    } catch {
      // A full or blocked storage only loses the convenience.
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

  /** Live transactions whose wallet or category is a tombstone here (rule 10). */
  private orphans(db: LocalDatabase): Transaction[] {
    return db
      .selectObjects(
        `SELECT t.* FROM ${TRANSACTION_TABLE} t
         LEFT JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
         LEFT JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
         WHERE t.deleted_at IS NULL AND (w.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL)`
      )
      .map((row) => toTransaction(fromSql(TRANSACTION_TABLE, row)))
  }

  private find(db: LocalDatabase, id: string): Transaction | null {
    const row = db.selectObjects(`SELECT * FROM ${TRANSACTION_TABLE} WHERE id = ?`, [id]).at(0)
    return row ? toTransaction(fromSql(TRANSACTION_TABLE, row)) : null
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }
}

const toTransaction = (row: Record<string, unknown>): Transaction => ({
  id: String(row['id']),
  profileId: String(row['profileId']),
  walletId: String(row['walletId']),
  categoryId: String(row['categoryId']),
  amount: Number(row['amount']),
  occurredOn: String(row['occurredOn']),
  note: typeof row['note'] === 'string' ? row['note'] : '',
  excludeFromReport: row['excludeFromReport'] === true,
  createdAt: Number(row['createdAt']),
  updatedAt: Number(row['updatedAt']),
  deletedAt: typeof row['deletedAt'] === 'number' ? row['deletedAt'] : null,
  changeSeq: typeof row['changeSeq'] === 'number' ? row['changeSeq'] : null,
})

/** The sign of an amount from its category's type (rule 11): income +, expense −. */
export const signedAmount = (amount: number, type: CategoryType): number =>
  type === 'income' ? amount : -amount
