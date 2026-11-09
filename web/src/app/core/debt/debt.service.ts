import { DOCUMENT } from '@angular/common'
import { computed, inject, Service, signal } from '@angular/core'
import { CATEGORY_TABLE } from '@/core/category'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import { RecurringService } from '@/core/recurring'
import { TRANSACTION_TABLE, TransactionService } from '@/core/transaction'
import {
  DEBT_ENTRY_SIGN_SQL,
  DEBT_ENTRY_TABLE,
  DEBT_FORGIVES_SQL,
  DEBT_SETTLES_SQL,
  DEBT_TABLE,
  RECURRING_TABLE,
  WALLET_TABLE,
  WalletService,
} from '@/core/wallet'
import { DEBT_LIMITS, DEBT_PREF_PREFIX } from './debt.type'
import type {
  Debt,
  DebtEdit,
  DebtEntry,
  DebtHistoryItem,
  DebtItem,
  DebtSheetState,
  DebtValues,
  EntrySheetState,
  EntryValues,
  InterestValues,
  PlanValues,
} from './debt.type'

/**
 * Debts and loans on this device (docs/features/debt.md). What is left of a debt, and whether it
 * is closed, is computed from its entries and linked transactions; every write goes through the
 * outbox. Only the debts pages and the Wallets tab inject it (not the shell).
 */
@Service()
export class DebtService {
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)
  private walletService = inject(WalletService)
  private transactionService = inject(TransactionService)
  private recurringService = inject(RecurringService)
  private window = inject(DOCUMENT).defaultView

  canWrite = this.profileService.canWrite
  serverDown = this.profileService.serverDown

  /** The open sheets (the debts pages render them). */
  sheet = signal<DebtSheetState | null>(null)
  entrySheet = signal<EntrySheetState | null>(null)
  closeSheet = signal<string | null>(null)

  /** The current profile's live debts with their sums, open ones by due date (none last). */
  items = computed<DebtItem[]>(() => {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      return []
    }
    const today = this.transactionService.today()
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT d.*,
               coalesce((SELECT sum(e.amount) FROM ${DEBT_ENTRY_TABLE} e
                 WHERE e.debt_id = d.id AND e.deleted_at IS NULL AND e.kind = 'principal'), 0) AS total,
               coalesce((SELECT sum(e.amount) FROM ${DEBT_ENTRY_TABLE} e
                 WHERE e.debt_id = d.id AND e.deleted_at IS NULL AND e.kind = 'repayment'), 0) AS repaid,
               coalesce((SELECT sum(e.amount) FROM ${DEBT_ENTRY_TABLE} e
                 WHERE e.debt_id = d.id AND e.deleted_at IS NULL AND e.kind = 'repayment'
                   AND e.wallet_id IS NULL), 0) AS forgiven_entries,
               coalesce((SELECT sum(t.amount) FROM ${TRANSACTION_TABLE} t
                 JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
                 WHERE t.debt_id = d.id AND t.deleted_at IS NULL AND ${DEBT_SETTLES_SQL}), 0) AS settled,
               coalesce((SELECT count(*) FROM ${TRANSACTION_TABLE} t
                 JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
                 WHERE t.debt_id = d.id AND t.deleted_at IS NULL AND ${DEBT_SETTLES_SQL}), 0)
                 AS instalments,
               coalesce((SELECT sum(t.amount) FROM ${TRANSACTION_TABLE} t
                 JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
                 WHERE t.debt_id = d.id AND t.deleted_at IS NULL AND ${DEBT_FORGIVES_SQL}), 0)
                 AS forgiven_tx,
               coalesce((SELECT sum(t.amount) FROM ${TRANSACTION_TABLE} t
                 JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
                 WHERE t.debt_id = d.id AND t.deleted_at IS NULL
                   AND NOT ${DEBT_SETTLES_SQL} AND NOT ${DEBT_FORGIVES_SQL}), 0) AS interest,
               (SELECT max(day) FROM (
                 SELECT max(e.occurred_on) AS day FROM ${DEBT_ENTRY_TABLE} e
                 WHERE e.debt_id = d.id AND e.deleted_at IS NULL
                 UNION ALL
                 SELECT max(t.occurred_on) FROM ${TRANSACTION_TABLE} t
                 WHERE t.debt_id = d.id AND t.deleted_at IS NULL)) AS last_on
             FROM ${DEBT_TABLE} d
             WHERE d.profile_id = ? AND d.deleted_at IS NULL
             ORDER BY d.due_on IS NULL, d.due_on, d.created_at`,
            [profileId]
          )
          .map((row) => {
            const debt = toDebt(fromSql(DEBT_TABLE, row))
            const total = Number(row['total'])
            const paid = Number(row['repaid']) + Number(row['settled'])
            const left = total - paid
            const closed = left === 0 && total > 0
            return {
              debt,
              minorUnit: this.walletService.minorUnit(debt.currencyCode),
              total,
              paid,
              left,
              interest: Number(row['interest']),
              instalments: Number(row['instalments']),
              lastOn: typeof row['last_on'] === 'string' ? row['last_on'] : null,
              closed,
              forgiven: Number(row['forgiven_entries']) + Number(row['forgiven_tx']) > 0,
              overdue: !closed && left > 0 && debt.dueOn !== null && debt.dueOn < today,
            } satisfies DebtItem
          }),
      []
    )
  })
  openItems = computed(() => this.items().filter((item) => !item.closed))
  atLimit = computed(() => this.openItems().length >= DEBT_LIMITS.OPEN_PER_PROFILE)

  /** Debts with an op still waiting to sync. */
  pendingIds = computed(
    () =>
      new Set(
        this.read(
          (db) =>
            db
              .selectObjects(
                `SELECT row_id FROM outbox WHERE tbl IN (?, ?) AND status = 'pending'`,
                [DEBT_TABLE, DEBT_ENTRY_TABLE]
              )
              .map((row) => String(row['row_id'])),
          []
        )
      )
  )

  /** Names used before in the profile (the person field's suggestions, Q3). */
  people = computed<string[]>(() => {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      return []
    }
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT person FROM ${DEBT_TABLE} WHERE profile_id = ? AND deleted_at IS NULL
             GROUP BY person ORDER BY max(updated_at) DESC LIMIT 30`,
            [profileId]
          )
          .map((row) => String(row['person'])),
      []
    )
  })

  item(id: string): DebtItem | null {
    return this.items().find((item) => item.debt.id === id) ?? null
  }

  /** A live debt of any profile on this device. */
  byId(id: string): Debt | null {
    return this.read((db) => {
      const debt = findDebt(db, id)
      return debt?.deletedAt === null ? debt : null
    }, null)
  }

  entryById(id: string): DebtEntry | null {
    return this.read((db) => {
      const entry = findEntry(db, id)
      return entry?.deletedAt === null ? entry : null
    }, null)
  }

  /** A debt's entries and linked transactions, newest first (debt → Web screens). */
  history(debtId: string): DebtHistoryItem[] {
    return this.read((db) => {
      const entries = db
        .selectObjects(
          `SELECT e.*, ${DEBT_ENTRY_SIGN_SQL} AS signed,
             w.name AS w_name, w.icon AS w_icon, w.color AS w_color
           FROM ${DEBT_ENTRY_TABLE} e
           JOIN ${DEBT_TABLE} d ON d.id = e.debt_id
           LEFT JOIN ${WALLET_TABLE} w ON w.id = e.wallet_id
           WHERE e.debt_id = ? AND e.deleted_at IS NULL`,
          [debtId]
        )
        .map((row): DebtHistoryItem => ({
          kind: 'entry',
          id: String(row['id']),
          entry: toEntry(fromSql(DEBT_ENTRY_TABLE, row)),
          walletName: String(row['w_name'] ?? ''),
          walletIcon: String(row['w_icon'] ?? ''),
          walletColor: String(row['w_color'] ?? ''),
          signed: Number(row['signed']),
        }))
      const transactions = db
        .selectObjects(
          `SELECT t.*, c.type AS c_type, c.name AS c_name, c.icon AS c_icon, c.color AS c_color,
             w.name AS w_name, w.icon AS w_icon, w.color AS w_color,
             ${DEBT_SETTLES_SQL} AS settles
           FROM ${TRANSACTION_TABLE} t
           JOIN ${DEBT_TABLE} d ON d.id = t.debt_id
           JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
           LEFT JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
           WHERE t.debt_id = ? AND t.deleted_at IS NULL`,
          [debtId]
        )
        .map((row): DebtHistoryItem => ({
          kind: 'transaction',
          id: String(row['id']),
          occurredOn: String(row['occurred_on']),
          createdAt: Number(row['created_at']),
          amount: Number(row['amount']),
          note: typeof row['note'] === 'string' ? row['note'] : '',
          type: row['c_type'] === 'income' ? 'income' : 'expense',
          categoryName: String(row['c_name'] ?? ''),
          categoryIcon: String(row['c_icon'] ?? ''),
          categoryColor: String(row['c_color'] ?? ''),
          walletName: String(row['w_name'] ?? ''),
          walletIcon: String(row['w_icon'] ?? ''),
          walletColor: String(row['w_color'] ?? ''),
          settles: row['settles'] === 1,
        }))
      const day = (item: DebtHistoryItem) =>
        item.kind === 'entry' ? item.entry.occurredOn : item.occurredOn
      const created = (item: DebtHistoryItem) =>
        item.kind === 'entry' ? item.entry.createdAt : item.createdAt
      return [...entries, ...transactions].sort(
        (a, b) =>
          day(b).localeCompare(day(a)) || created(b) - created(a) || b.id.localeCompare(a.id)
      )
    }, [])
  }

  /** The live recurring rules of a debt (its instalments, debt rule 13). */
  rules(debtId: string): string[] {
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT id FROM ${RECURRING_TABLE} WHERE debt_id = ? AND deleted_at IS NULL
             ORDER BY created_at`,
            [debtId]
          )
          .map((row) => String(row['id'])),
      []
    )
  }

  /**
   * A new debt and its principal (debt rule 3) in one write; with `plan`, its instalments as a
   * recurring rule (debt rule 13), which records what is due up to today. Answers the id.
   */
  create(values: DebtValues, plan: PlanValues | null = null): string {
    const profileId = this.profileService.current()?.id ?? ''
    const now = Date.now()
    const id = uuidv7(now)
    const repaid = values.direction === 'borrowed' && values.countAs === 'repaid'
    this.offlineService.write((db) => {
      queueWrite(db, DEBT_TABLE, 'upsert', {
        id,
        profileId,
        direction: values.direction,
        person: values.person.trim(),
        note: values.note.trim(),
        currencyCode: values.currencyCode,
        countAs: repaid ? 'repaid' : 'spent',
        categoryId: repaid ? values.categoryId : null,
        dueOn: values.dueOn,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      queueWrite(db, DEBT_ENTRY_TABLE, 'upsert', {
        id: uuidv7(now),
        profileId,
        debtId: id,
        kind: 'principal',
        walletId: repaid ? null : values.walletId,
        amount: values.amount,
        occurredOn: values.occurredOn,
        note: '',
        recurringId: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
    })
    if (plan) {
      this.recurringService.create(
        {
          ...plan.repeat,
          kind: repaid ? 'transaction' : 'debt',
          walletId: plan.walletId,
          categoryId: repaid ? values.categoryId : null,
          toWalletId: null,
          debtId: id,
          amount: plan.amount,
          note: '',
          excludeFromReport: false,
          startOn: plan.startOn,
        },
        profileId
      )
    }
    return id
  }

  /** An edit changes who, the note, the due date and the instalments' category (debt rule 2). */
  update(id: string, values: DebtEdit, fixOpId: string | null = null): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = findDebt(db, id)
      if (!current) {
        return
      }
      queueWrite(db, DEBT_TABLE, 'upsert', {
        ...current,
        person: values.person.trim(),
        note: values.note.trim(),
        dueOn: values.dueOn,
        categoryId: current.countAs === 'repaid' ? values.categoryId : null,
        updatedAt: now,
        deletedAt: null,
      })
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
  }

  /** "Fix" of a refused debt op: its refused row with the edit, sent again (offline-sync 10). */
  fix(opId: string, values: DebtEdit): void {
    const row = this.refused(opId, DEBT_TABLE)
    if (!row) {
      return
    }
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = findDebt(db, String(row['id']))
      queueWrite(db, DEBT_TABLE, 'upsert', {
        ...row,
        ...current,
        id: String(row['id']),
        person: values.person.trim(),
        note: values.note.trim(),
        dueOn: values.dueOn,
        categoryId: row['countAs'] === 'repaid' ? values.categoryId : null,
        createdAt:
          current?.createdAt ?? (typeof row['createdAt'] === 'number' ? row['createdAt'] : now),
        updatedAt: now,
        deletedAt: null,
      })
      deleteOp(db, opId)
    })
  }

  /**
   * Debt rule 5: the debt, its entries and its rules go in one write (no undo); its counted
   * transactions stay as ordinary rows.
   */
  remove(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = findDebt(db, id)
      if (!current) {
        return
      }
      queueWrite(db, DEBT_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      for (const table of [DEBT_ENTRY_TABLE, RECURRING_TABLE]) {
        for (const row of db.selectObjects(
          `SELECT * FROM ${table} WHERE debt_id = ? AND deleted_at IS NULL`,
          [id]
        )) {
          queueWrite(db, table, 'delete', {
            ...fromSql(table, row),
            id: String(row['id']),
            updatedAt: now,
            deletedAt: now,
          })
        }
      }
    })
  }

  /**
   * Creates (`id` null) or updates an entry of `debtId`; `interest` adds a counted transaction
   * linked to the debt in the same write (debt rule 5, Q5).
   */
  saveEntry(
    id: string | null,
    debtId: string,
    values: EntryValues,
    interest: InterestValues | null = null,
    fixOpId: string | null = null
  ): string {
    const now = Date.now()
    const rowId = id ?? uuidv7(now)
    this.offlineService.write((db) => {
      const debt = findDebt(db, debtId)
      const current = findEntry(db, rowId)
      if (!debt) {
        return
      }
      queueWrite(db, DEBT_ENTRY_TABLE, 'upsert', {
        ...current,
        id: rowId,
        profileId: debt.profileId,
        debtId,
        kind: values.kind,
        walletId: values.walletId,
        amount: values.amount,
        occurredOn: values.occurredOn,
        note: values.note.trim(),
        recurringId: current?.recurringId ?? null,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      })
      if (interest && interest.amount > 0 && values.walletId) {
        this.writeTransaction(db, debt, {
          walletId: values.walletId,
          categoryId: interest.categoryId,
          amount: interest.amount,
          occurredOn: values.occurredOn,
          now: now + 1,
        })
        this.rememberInterest(debtId, interest.categoryId)
      }
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
    })
    return rowId
  }

  /** An entry's tombstone at once; `restoreEntry` is the toast's undo. */
  removeEntry(id: string): void {
    this.setEntryDeleted(id, true)
  }

  restoreEntry(id: string): void {
    this.setEntryDeleted(id, false)
  }

  /**
   * Debt rule 4: "ปิดหนี้" with something left: the rest repaid into `walletId`, or forgiven
   * (counted once now in `categoryId`; a `repaid` debt's rest goes uncounted, without a wallet).
   */
  close(
    debtId: string,
    how: { kind: 'rest'; walletId: string } | { kind: 'forgive'; categoryId: string | null },
    on: string,
    note = ''
  ): void {
    const item = this.item(debtId)
    if (!item || item.left <= 0) {
      return
    }
    const now = Date.now()
    this.offlineService.write((db) => {
      const debt = findDebt(db, debtId)
      if (!debt) {
        return
      }
      const entry = (walletId: string | null, entryNote = '') =>
        queueWrite(db, DEBT_ENTRY_TABLE, 'upsert', {
          id: uuidv7(now),
          profileId: debt.profileId,
          debtId,
          kind: 'repayment',
          walletId,
          amount: item.left,
          occurredOn: on,
          note: entryNote,
          recurringId: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
      if (how.kind === 'rest') {
        entry(how.walletId)
      } else if (debt.countAs === 'repaid' || !how.categoryId) {
        entry(null, note)
      } else {
        // The rest as if paid back (uncounted) and, in the same wallet, the counted transaction:
        // the wallet doesn't move, the money counts once (debt rule 4).
        const walletId = this.forgiveWallet(db, debt)
        entry(walletId, note)
        this.writeTransaction(db, debt, {
          walletId,
          categoryId: how.categoryId,
          amount: item.left,
          occurredOn: on,
          now: now + 1,
          note,
        })
      }
    })
  }

  /** The category last used for a debt's interest on this device. */
  interestCategory(debtId: string): string | null {
    try {
      return this.storage()?.getItem(`${DEBT_PREF_PREFIX}interest:${debtId}`) ?? null
    } catch {
      return null
    }
  }

  open(state: DebtSheetState): void {
    this.sheet.set(state)
  }

  openEntry(state: EntrySheetState): void {
    this.entrySheet.set(state)
  }

  /** "Fix" from the sync sheet: a rejected debt or entry op opens its sheet. */
  openFix(opId: string): boolean {
    const op = this.syncService.rejectedOp(opId)
    if (op?.table === DEBT_TABLE) {
      this.open({ mode: 'fix', opId })
      return true
    }
    if (op?.table === DEBT_ENTRY_TABLE) {
      this.openEntry({ mode: 'fix', opId })
      return true
    }
    return false
  }

  /** The refused values of a rejected op of `table`. */
  refused(opId: string, table: string): Record<string, unknown> | null {
    const op = this.syncService.rejectedOp(opId)
    return op?.table === table ? { ...op.row, id: op.rowId } : null
  }

  private writeTransaction(
    db: LocalDatabase,
    debt: Debt,
    values: {
      walletId: string
      categoryId: string
      amount: number
      occurredOn: string
      now: number
      note?: string
    }
  ): void {
    queueWrite(db, TRANSACTION_TABLE, 'upsert', {
      id: uuidv7(values.now),
      profileId: debt.profileId,
      walletId: values.walletId,
      categoryId: values.categoryId,
      amount: values.amount,
      occurredOn: values.occurredOn,
      note: values.note ?? '',
      excludeFromReport: false,
      recurringId: null,
      debtId: debt.id,
      createdAt: values.now,
      updatedAt: values.now,
      deletedAt: null,
    })
  }

  /** A forgiven rest is recorded in the wallet the debt last used (it moves no money there). */
  private forgiveWallet(db: LocalDatabase, debt: Debt): string {
    const row = db
      .selectObjects(
        `SELECT wallet_id FROM ${DEBT_ENTRY_TABLE}
         WHERE debt_id = ? AND deleted_at IS NULL AND wallet_id IS NOT NULL
         ORDER BY occurred_on DESC, created_at DESC LIMIT 1`,
        [debt.id]
      )
      .at(0)
    const id = typeof row?.['wallet_id'] === 'string' ? row['wallet_id'] : null
    return id ?? this.walletService.openOf(debt.profileId).at(0)?.id ?? ''
  }

  private setEntryDeleted(id: string, deleted: boolean): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = findEntry(db, id)
      if (!current || (current.deletedAt !== null) === deleted) {
        return
      }
      queueWrite(db, DEBT_ENTRY_TABLE, deleted ? 'delete' : 'upsert', {
        ...current,
        updatedAt: now,
        deletedAt: deleted ? now : null,
      })
    })
  }

  private rememberInterest(debtId: string, categoryId: string): void {
    try {
      this.storage()?.setItem(`${DEBT_PREF_PREFIX}interest:${debtId}`, categoryId)
    } catch {
      // A full or blocked storage only loses the convenience.
    }
  }

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

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export const toDebt = (row: Record<string, unknown>): Debt => ({
  id: String(row['id']),
  profileId: String(row['profileId']),
  direction: row['direction'] === 'lent' ? 'lent' : 'borrowed',
  person: text(row['person']) ?? '',
  note: text(row['note']) ?? '',
  currencyCode: String(row['currencyCode']),
  countAs: row['countAs'] === 'repaid' ? 'repaid' : 'spent',
  categoryId: text(row['categoryId']),
  dueOn: text(row['dueOn']),
  createdAt: Number(row['createdAt']),
  updatedAt: Number(row['updatedAt']),
  deletedAt: typeof row['deletedAt'] === 'number' ? row['deletedAt'] : null,
  changeSeq: typeof row['changeSeq'] === 'number' ? row['changeSeq'] : null,
})

export const toEntry = (row: Record<string, unknown>): DebtEntry => ({
  id: String(row['id']),
  profileId: String(row['profileId']),
  debtId: String(row['debtId']),
  kind: row['kind'] === 'principal' ? 'principal' : 'repayment',
  walletId: text(row['walletId']),
  amount: Number(row['amount']),
  occurredOn: String(row['occurredOn']),
  note: text(row['note']) ?? '',
  recurringId: text(row['recurringId']),
  createdAt: Number(row['createdAt']),
  updatedAt: Number(row['updatedAt']),
  deletedAt: typeof row['deletedAt'] === 'number' ? row['deletedAt'] : null,
  changeSeq: typeof row['changeSeq'] === 'number' ? row['changeSeq'] : null,
})

const findDebt = (db: LocalDatabase, id: string): Debt | null => {
  const row = db.selectObjects(`SELECT * FROM ${DEBT_TABLE} WHERE id = ?`, [id]).at(0)
  return row ? toDebt(fromSql(DEBT_TABLE, row)) : null
}

const findEntry = (db: LocalDatabase, id: string): DebtEntry | null => {
  const row = db.selectObjects(`SELECT * FROM ${DEBT_ENTRY_TABLE} WHERE id = ?`, [id]).at(0)
  return row ? toEntry(fromSql(DEBT_ENTRY_TABLE, row)) : null
}
