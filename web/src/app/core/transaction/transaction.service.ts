import { DOCUMENT } from '@angular/common'
import { computed, effect, inject, Service, signal, untracked } from '@angular/core'
import { CATEGORY_TABLE, followMerges, hasMergeLeftovers } from '@/core/category'
import type { CategoryType } from '@/core/category'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase, SqlValue } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import {
  DEBT_ENTRY_SIGN_SQL,
  DEBT_ENTRY_TABLE,
  DEBT_TABLE,
  WALLET_TABLE,
  WalletService,
} from '@/core/wallet'
import type { Wallet } from '@/core/wallet'
import { addDays, toDay } from '@/shared/utils'
import { PERIOD_UNITS, periodRange, periodTabs } from './period'
import {
  EVENT_TABLE,
  TRANSACTION_PREF_PREFIX,
  TRANSACTION_TABLE,
  TRANSFER_TABLE,
} from './transaction.type'
import type { PeriodTab, PeriodUnit } from './period'
import type {
  DayRange,
  DebtEntryItem,
  EntryItem,
  EventOption,
  ListFilter,
  MoneySummary,
  Transaction,
  TransactionItem,
  TransactionSheetState,
  TransactionValues,
  TransferItem,
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

  /** Transactions and transfers with an op still waiting to sync ("รอ sync"). */
  pendingIds = computed(
    () =>
      new Set(
        this.read(
          (db) =>
            db
              .selectObjects(
                `SELECT row_id FROM outbox WHERE tbl IN (?, ?, ?) AND status = 'pending'`,
                [TRANSACTION_TABLE, TRANSFER_TABLE, DEBT_ENTRY_TABLE]
              )
              .map((row) => String(row['row_id'])),
          []
        )
      )
  )

  /** The open transaction sheet (layout/transaction-sheet), if any. */
  sheet = signal<TransactionSheetState | null>(null)
  /**
   * Names behind `addedBy` (sharing rule 15), read online by `core/sharing` (the owner's members,
   * a shared profile's people); memory only.
   */
  people = signal<ReadonlyMap<string, string>>(new Map())

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
  /** The profile's oldest transaction or transfer day, where the period tabs start. */
  firstDay = computed<string | null>(() => {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      return null
    }
    return this.read((db) => {
      const value = db.selectValue(
        `SELECT min(day) FROM (
           SELECT min(occurred_on) AS day FROM ${TRANSACTION_TABLE}
           WHERE profile_id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT min(occurred_on) FROM ${TRANSFER_TABLE} WHERE profile_id = ? AND deleted_at IS NULL
           UNION ALL
           SELECT min(occurred_on) FROM ${DEBT_ENTRY_TABLE}
           WHERE profile_id = ? AND deleted_at IS NULL AND wallet_id IS NOT NULL
         )`,
        [profileId, profileId, profileId]
      )
      return typeof value === 'string' ? value : null
    }, null)
  })
  tabs = computed(() => periodTabs(this.unit(), this.today(), this.firstDay()))
  range = computed(() => periodRange(this.unit(), this.tab(), this.today(), this.custom()))
  items = computed(() => this.entries(this.range(), this.viewWalletIds()))
  summaryLines = computed(() => this.summary(this.range(), this.viewWalletIds()))

  constructor() {
    // Each profile has its own remembered wallet and unit; a new profile starts on "ทุกกระเป๋า".
    effect(() => {
      const profileId = this.profileService.currentId() ?? ''
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
        const db = this.offlineService.db()
        if (hasMergeLeftovers(db) || this.orphans(db).length > 0 || hasDebtOrphans(db)) {
          const now = Date.now()
          this.offlineService.write((tx) => {
            // A merged category's rows follow it instead (category rule 15).
            followMerges(tx, now)
            for (const row of this.orphans(tx)) {
              queueWrite(tx, TRANSACTION_TABLE, 'delete', {
                ...row,
                updatedAt: now,
                deletedAt: now,
              })
            }
            // Debt rule 10: the same for debts and their entries.
            tombstoneDebtOrphans(tx, now)
          })
        }
      })
    })
  }

  /**
   * The current profile's live transactions in `range` (in order, rule 13), with their category
   * and wallet; only `walletIds` when given.
   */
  list(
    range: DayRange,
    walletIds: readonly string[] | null = null,
    filter: ListFilter = {}
  ): TransactionItem[] {
    const where = this.where(range, walletIds, filter)
    if (!where) {
      return []
    }
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT t.*, c.type AS c_type, c.name AS c_name, c.icon AS c_icon, c.color AS c_color,
               w.name AS w_name, w.currency_code AS w_currency, ev.name AS ev_name
             FROM ${TRANSACTION_TABLE} t
             LEFT JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
             LEFT JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
             LEFT JOIN ${EVENT_TABLE} ev ON ev.id = t.event_id AND ev.deleted_at IS NULL
             WHERE ${where.sql} ${ORDER}`,
            where.params
          )
          .map((row) => ({
            ...toTransaction(fromSql(TRANSACTION_TABLE, row)),
            kind: 'transaction' as const,
            type: row['c_type'] === 'income' ? 'income' : 'expense',
            categoryName: String(row['c_name'] ?? ''),
            categoryIcon: String(row['c_icon'] ?? ''),
            categoryColor: String(row['c_color'] ?? ''),
            walletName: String(row['w_name'] ?? ''),
            currencyCode: String(row['w_currency'] ?? ''),
            eventName: typeof row['ev_name'] === 'string' ? row['ev_name'] : null,
          })),
      []
    )
  }

  /**
   * The list's rows (rule 13's order): `list` merged with the transfer sides in view, a
   * transfer's outgoing side first (transfer → Web screens, Q5).
   */
  entries(range: DayRange, walletIds: readonly string[] | null = null): EntryItem[] {
    const transactions = this.list(range, walletIds)
    const sides = mergeEntries(
      this.transferSides(range, walletIds),
      this.debtEntries(range, walletIds)
    )
    if (sides.length === 0) {
      return transactions
    }
    return mergeEntries(transactions, sides)
  }

  /**
   * The current profile's live debt entries with a wallet in `range` whose wallet is in
   * `walletIds` (all when null), in rule 13's order (debt → Web screens).
   */
  debtEntries(range: DayRange, walletIds: readonly string[] | null = null): DebtEntryItem[] {
    const profileId = this.profileService.current()?.id
    if (!profileId || walletIds?.length === 0) {
      return []
    }
    const parts = ['e.profile_id = ?', 'e.deleted_at IS NULL', 'e.wallet_id IS NOT NULL']
    const params: SqlValue[] = [profileId]
    if (range.from) {
      parts.push('e.occurred_on >= ?')
      params.push(range.from)
    }
    if (range.to) {
      parts.push('e.occurred_on <= ?')
      params.push(range.to)
    }
    if (walletIds) {
      parts.push(`e.wallet_id IN (${walletIds.map(() => '?').join(', ')})`)
      params.push(...walletIds)
    }
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT e.*, d.direction AS d_direction, d.person AS d_person,
               ${DEBT_ENTRY_SIGN_SQL} AS signed, w.name AS w_name, w.currency_code AS w_currency
             FROM ${DEBT_ENTRY_TABLE} e
             JOIN ${DEBT_TABLE} d ON d.id = e.debt_id
             LEFT JOIN ${WALLET_TABLE} w ON w.id = e.wallet_id
             WHERE ${parts.join(' AND ')}
             ORDER BY e.occurred_on DESC, e.created_at DESC, e.id DESC`,
            params
          )
          .map((row) => ({
            kind: 'debt' as const,
            id: String(row['id']),
            debtId: String(row['debt_id']),
            entryKind:
              row['kind'] === 'principal' ? ('principal' as const) : ('repayment' as const),
            direction: row['d_direction'] === 'lent' ? ('lent' as const) : ('borrowed' as const),
            person: String(row['d_person'] ?? ''),
            walletId: String(row['wallet_id']),
            walletName: String(row['w_name'] ?? ''),
            currencyCode: String(row['w_currency'] ?? ''),
            signed: Number(row['signed']),
            amount: Number(row['amount']),
            occurredOn: String(row['occurred_on']),
            note: typeof row['note'] === 'string' ? row['note'] : '',
            recurringId: typeof row['recurring_id'] === 'string' ? row['recurring_id'] : null,
            createdAt: Number(row['created_at']),
          })),
      []
    )
  }

  /**
   * The sides of the current profile's live transfers in `range` whose wallet is in
   * `walletIds` (all when null), in rule 13's order, the outgoing side first.
   */
  transferSides(range: DayRange, walletIds: readonly string[] | null = null): TransferItem[] {
    const profileId = this.profileService.current()?.id
    if (!profileId || walletIds?.length === 0) {
      return []
    }
    const side = (here: 'from' | 'to') => {
      const other = here === 'from' ? 'to' : 'from'
      const parts = ['r.profile_id = ?', 'r.deleted_at IS NULL']
      const params: SqlValue[] = [profileId]
      if (range.from) {
        parts.push('r.occurred_on >= ?')
        params.push(range.from)
      }
      if (range.to) {
        parts.push('r.occurred_on <= ?')
        params.push(range.to)
      }
      if (walletIds) {
        parts.push(`r.${here}_wallet_id IN (${walletIds.map(() => '?').join(', ')})`)
        params.push(...walletIds)
      }
      return {
        sql: `SELECT r.*, '${here === 'from' ? 'out' : 'in'}' AS side,
                r.${here}_wallet_id AS here_id, wh.name AS here_name,
                wh.currency_code AS here_currency,
                r.${other}_wallet_id AS other_id, wo.name AS other_name
              FROM ${TRANSFER_TABLE} r
              LEFT JOIN ${WALLET_TABLE} wh ON wh.id = r.${here}_wallet_id
              LEFT JOIN ${WALLET_TABLE} wo ON wo.id = r.${other}_wallet_id
              WHERE ${parts.join(' AND ')}`,
        params,
      }
    }
    const out = side('from')
    const into = side('to')
    return this.read(
      (db) =>
        db
          .selectObjects(
            `${out.sql} UNION ALL ${into.sql}
             ORDER BY occurred_on DESC, created_at DESC, id DESC, side DESC`,
            [...out.params, ...into.params]
          )
          .map((row) => ({
            ...toTransfer(fromSql(TRANSFER_TABLE, row)),
            kind: 'transfer' as const,
            side: row['side'] === 'in' ? ('in' as const) : ('out' as const),
            walletId: String(row['here_id']),
            walletName: String(row['here_name'] ?? ''),
            otherWalletId: String(row['other_id']),
            otherWalletName: String(row['other_name'] ?? ''),
            currencyCode: String(row['here_currency'] ?? ''),
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
    const sums = new Map<
      string,
      { income: number; expense: number; transfer: number; debt: number }
    >()
    const empty = () => ({ income: 0, expense: 0, transfer: 0, debt: 0 })
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
      const sum = sums.get(code) ?? empty()
      sum[row['type'] === 'income' ? 'income' : 'expense'] += Number(row['total'])
      sums.set(code, sum)
    }
    // Transfer rule 5: never income or expense; their net in view explains the balance.
    for (const item of this.transferSides(range, walletIds)) {
      const sum = sums.get(item.currencyCode) ?? empty()
      sum.transfer += walletIds ? (item.side === 'in' ? item.amount : -item.amount) : 0
      sums.set(item.currencyCode, sum)
    }
    // Debt rule 7: never income or expense either; their net in view is the "หนี้" line.
    for (const item of this.debtEntries(range, walletIds)) {
      const sum = sums.get(item.currencyCode) ?? empty()
      sum.debt += item.signed
      sums.set(item.currencyCode, sum)
    }
    const order = this.walletService.currencies().map((currency) => currency.code)
    return [...sums.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b))
      .map(([currencyCode, { income, expense, transfer, debt }]) => ({
        currencyCode,
        minorUnit: this.walletService.minorUnit(currencyCode),
        income,
        expense,
        net: income - expense,
        transfer,
        debt,
      }))
  }

  /** The person of a live debt (the form's "หนี้" row, debt rule 3), or null. */
  debtPerson(id: string | null): string | null {
    if (!id) {
      return null
    }
    return this.read((db) => {
      const value = db.selectValue(
        `SELECT person FROM ${DEBT_TABLE} WHERE id = ? AND deleted_at IS NULL`,
        [id]
      )
      return typeof value === 'string' ? value : null
    }, null)
  }

  /**
   * The profile's live events the form offers (event rule 3): open ones by `startOn` desc, then
   * the latest created; plus `keepId` when the row already has it (a closed one stays on edit).
   */
  eventOptions(profileId: string, keepId: string | null = null): EventOption[] {
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT * FROM ${EVENT_TABLE}
              WHERE profile_id = ? AND deleted_at IS NULL AND (is_closed = 0 OR id = ?)
              ORDER BY is_closed, start_on DESC, created_at DESC, id DESC`,
            [profileId, keepId ?? '']
          )
          .map((row) => toEventOption(fromSql(EVENT_TABLE, row))),
      []
    )
  }

  /** `id` when it names a live event, else null (a deleted event's rows keep its id, rule 7). */
  liveEventId(id: string | null | undefined): string | null {
    if (!id) {
      return null
    }
    return this.read(
      (db) =>
        db.selectValue(`SELECT 1 FROM ${EVENT_TABLE} WHERE id = ? AND deleted_at IS NULL`, [id]) ===
        1
          ? id
          : null,
      null
    )
  }

  /** Event rule 5: the open event whose dates hold `day` (the latest start), or null. */
  defaultEventId(profileId: string, day: string): string | null {
    return (
      this.eventOptions(profileId).find(
        (event) =>
          !event.isClosed && event.startOn <= day && (event.endOn === null || day <= event.endOn)
      )?.id ?? null
    )
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
        debtId: values.debtId === undefined ? (current?.debtId ?? null) : values.debtId,
        eventId: values.eventId === undefined ? (current?.eventId ?? null) : values.eventId,
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

  /** Adds names behind `addedBy` (sharing rule 15). */
  addPeople(people: readonly { id: string; displayName: string }[]): void {
    const next = new Map(this.people())
    for (const person of people) {
      next.set(person.id, person.displayName)
    }
    this.people.set(next)
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
        debtId: text('debtId') || null,
        eventId: text('eventId') || null,
      },
    })
  }

  /** The WHERE clause of `list` / `summary`, or null when no wallet is chosen. */
  private where(
    range: DayRange,
    walletIds: readonly string[] | null,
    filter: ListFilter = {}
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
    if (filter.categoryIds) {
      parts.push(`t.category_id IN (${filter.categoryIds.map(() => '?').join(', ') || 'NULL'})`)
      params.push(...filter.categoryIds)
    }
    if (filter.report) {
      parts.push(`t.exclude_from_report = ${filter.report === 'excluded' ? 1 : 0}`)
    }
    if (filter.eventId) {
      parts.push('t.event_id = ?')
      params.push(filter.eventId)
    }
    if (filter.currencyCode) {
      parts.push(`t.wallet_id IN (SELECT id FROM ${WALLET_TABLE} WHERE currency_code = ?)`)
      params.push(filter.currencyCode)
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
  recurringId: typeof row['recurringId'] === 'string' ? row['recurringId'] : null,
  debtId: typeof row['debtId'] === 'string' ? row['debtId'] : null,
  eventId: typeof row['eventId'] === 'string' ? row['eventId'] : null,
  addedBy: typeof row['addedBy'] === 'string' ? row['addedBy'] : null,
  createdAt: Number(row['createdAt']),
  updatedAt: Number(row['updatedAt']),
  deletedAt: typeof row['deletedAt'] === 'number' ? row['deletedAt'] : null,
  changeSeq: typeof row['changeSeq'] === 'number' ? row['changeSeq'] : null,
})

const toEventOption = (row: Record<string, unknown>): EventOption => ({
  id: String(row['id']),
  name: typeof row['name'] === 'string' ? row['name'] : '',
  icon: typeof row['icon'] === 'string' ? row['icon'] : '',
  color: typeof row['color'] === 'string' ? row['color'] : '',
  startOn: typeof row['startOn'] === 'string' ? row['startOn'] : '',
  endOn: typeof row['endOn'] === 'string' ? row['endOn'] : null,
  isClosed: row['isClosed'] === true,
})

/** The sign of an amount from its category's type (rule 11): income +, expense −. */
export const signedAmount = (amount: number, type: CategoryType): number =>
  type === 'income' ? amount : -amount

export const toTransfer = (row: Record<string, unknown>) => ({
  id: String(row['id']),
  profileId: String(row['profileId']),
  fromWalletId: String(row['fromWalletId']),
  toWalletId: String(row['toWalletId']),
  amount: Number(row['amount']),
  occurredOn: String(row['occurredOn']),
  note: typeof row['note'] === 'string' ? row['note'] : '',
  recurringId: typeof row['recurringId'] === 'string' ? row['recurringId'] : null,
  createdAt: Number(row['createdAt']),
  updatedAt: Number(row['updatedAt']),
  deletedAt: typeof row['deletedAt'] === 'number' ? row['deletedAt'] : null,
  changeSeq: typeof row['changeSeq'] === 'number' ? row['changeSeq'] : null,
})

/** Rule 13's order (negative: `a` shows first); a transfer's outgoing side before its incoming. */
const compareEntries = (a: EntryItem, b: EntryItem): number =>
  b.occurredOn.localeCompare(a.occurredOn) ||
  b.createdAt - a.createdAt ||
  b.id.localeCompare(a.id) ||
  (a.kind === 'transfer' && a.side === 'out' ? -1 : 0)

/** Two lists in rule 13's order merged into one (one pass). */
const mergeEntries = (a: readonly EntryItem[], b: readonly EntryItem[]): EntryItem[] => {
  if (b.length === 0) {
    return [...a]
  }
  const merged: EntryItem[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const x = a.at(i)
    const y = b.at(j)
    if (x && (!y || compareEntries(x, y) <= 0)) {
      merged.push(x)
      i++
    } else if (y) {
      merged.push(y)
      j++
    }
  }
  return merged
}

/** Debt rule 10: live debts and entries left pointing at a tombstone here. */
const DEBT_ORPHANS = {
  // A repaid debt whose category is a tombstone (a merged one followed it already), or whose
  // profile went (the profile sweep covers that).
  debts: `SELECT d.* FROM ${DEBT_TABLE} d JOIN categories c ON c.id = d.category_id
          WHERE d.deleted_at IS NULL AND c.deleted_at IS NOT NULL`,
  // An entry whose debt or wallet is a tombstone.
  entries: `SELECT e.* FROM ${DEBT_ENTRY_TABLE} e
            LEFT JOIN ${DEBT_TABLE} d ON d.id = e.debt_id
            LEFT JOIN ${WALLET_TABLE} w ON w.id = e.wallet_id
            WHERE e.deleted_at IS NULL AND (d.deleted_at IS NOT NULL OR w.deleted_at IS NOT NULL)`,
} as const

const hasDebtOrphans = (db: LocalDatabase): boolean =>
  db.selectObjects(`${DEBT_ORPHANS.debts} LIMIT 1`).length > 0 ||
  db.selectObjects(`${DEBT_ORPHANS.entries} LIMIT 1`).length > 0

/** Tombstones what `hasDebtOrphans` finds: the debts first, then every entry they leave. */
const tombstoneDebtOrphans = (db: LocalDatabase, now: number): void => {
  for (const [table, query] of [
    [DEBT_TABLE, DEBT_ORPHANS.debts],
    [DEBT_ENTRY_TABLE, DEBT_ORPHANS.entries],
  ] as const) {
    for (const row of db.selectObjects(query)) {
      queueWrite(db, table, 'delete', {
        ...fromSql(table, row),
        id: String(row['id']),
        updatedAt: now,
        deletedAt: now,
      })
    }
  }
}
