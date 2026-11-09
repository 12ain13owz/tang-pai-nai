import { computed, effect, inject, Service, untracked } from '@angular/core'
import { Router } from '@angular/router'
import { TranslocoService } from '@jsverse/transloco'
import { toast } from '@spartan-ng/brain/sonner'
import { CATEGORY_TABLE, CategoryService, followMerges } from '@/core/category'
import { deleteOp, fromSql, OfflineService, queueWrite, SyncService, uuidv7 } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import {
  TRANSACTION_TABLE,
  TRANSFER_TABLE,
  TransactionService,
  TransferService,
} from '@/core/transaction'
import type { DayRange } from '@/core/transaction'
import {
  DEBT_ENTRY_TABLE,
  DEBT_LEFT_SQL,
  DEBT_TABLE,
  RECURRING_TABLE,
  WALLET_TABLE,
  WalletService,
} from '@/core/wallet'
import { addDays, addMonths } from '@/shared/utils'
import { occurrenceId } from './occurrence-id'
import { RECURRING_LIMITS } from './recurring.type'
import {
  indexOnOrAfter,
  isPastEnd,
  nextOnOrAfter,
  occurrenceOn,
  occurrencesBetween,
} from './schedule'
import type {
  Occurrence,
  RecurringKind,
  RecurringRule,
  RuleItem,
  RuleState,
  RuleValues,
} from './recurring.type'

/** Where the rules page lives (Account › รายการซ้ำ). */
export const RECURRING_ROUTE = '/account/recurring'

/**
 * Recurring rules on this device (docs/features/recurring.md). The device records each due
 * occurrence itself (Q1, rule 7) as an ordinary transaction or transfer with a deterministic id
 * (rule 9), writes nothing for an ask-first rule until the user confirms (rule 10), and shows
 * the occurrences to come without storing them (rule 17). The shell loads it lazily after the
 * app opens, so the recording pass runs whatever tab is showing.
 */
@Service()
export class RecurringService {
  private offlineService = inject(OfflineService)
  private syncService = inject(SyncService)
  private profileService = inject(ProfileService)
  private walletService = inject(WalletService)
  private categoryService = inject(CategoryService)
  private transactionService = inject(TransactionService)
  private transferService = inject(TransferService)
  private transloco = inject(TranslocoService)
  private router = inject(Router)

  canWrite = this.profileService.canWrite

  /** The current profile's live rules, as the rules page shows them (rule order: next first). */
  items = computed<RuleItem[]>(() => {
    const profileId = this.profileService.current()?.id
    if (!profileId) {
      return []
    }
    const today = this.transactionService.today()
    return this.read(
      (db) =>
        db
          .selectObjects(
            `SELECT * FROM ${RECURRING_TABLE} WHERE profile_id = ? AND deleted_at IS NULL
             ORDER BY next_on IS NULL, next_on, created_at`,
            [profileId]
          )
          .map((row) => this.toItem(toRule(fromSql(RECURRING_TABLE, row)), today)),
      []
    )
  })
  atLimit = computed(() => this.items().length >= RECURRING_LIMITS.PER_PROFILE)

  /** Due occurrences of ask-first rules (rule 10), oldest first. */
  due = computed<Occurrence[]>(() => {
    const today = this.transactionService.today()
    const due: Occurrence[] = []
    for (const item of this.items()) {
      if (item.state !== 'active' || !item.rule.confirm || item.rule.nextOn === null) {
        continue
      }
      for (const on of occurrencesBetween(item.rule, item.rule.nextOn, today, 50)) {
        const id = occurrenceId(item.rule.id, on)
        if (!this.exists(item.rule.kind, id)) {
          due.push({ item, on, id })
        }
      }
    }
    return due.sort((a, b) => a.on.localeCompare(b.on))
  })

  constructor() {
    // Rule 7: record what is due, once the first sync round of the open is over (so this device
    // usually sees what another one recorded first), or at once while offline. Re-run after
    // every write and pull: a pass that finds nothing writes nothing.
    effect(() => {
      this.offlineService.changes()
      this.transactionService.today()
      const settled = this.syncService.rounds() > 0 || !this.syncService.canSync()
      if (
        !this.offlineService.isOpen() ||
        !this.profileService.ready() ||
        !this.canWrite() ||
        this.syncService.isSyncing() ||
        !settled
      ) {
        return
      }
      untracked(() => this.recordDue())
    })
  }

  /** A live rule of any profile on this device. */
  byId(id: string): RecurringRule | null {
    return this.read((db) => {
      const rule = this.find(db, id)
      return rule?.deletedAt === null ? rule : null
    }, null)
  }

  /** The rule as the rules page shows it. */
  itemOf(rule: RecurringRule): RuleItem {
    return this.toItem(rule, this.transactionService.today())
  }

  /** Live occurrences recorded from a rule (the rule sheet's "บันทึกแล้ว n ครั้ง"). */
  recordedCount(rule: RecurringRule): number {
    return this.read(
      (db) =>
        Number(
          db.selectValue(
            `SELECT count(*) FROM ${tableOf(rule.kind)} WHERE recurring_id = ? AND deleted_at IS NULL`,
            [rule.id]
          )
        ),
      0
    )
  }

  /**
   * Rule 8: a new rule (from a form with "ทำซ้ำ"), and in the same write the occurrences from its
   * start up to today (the one typed is the first). Answers the rule's id.
   */
  create(values: RuleValues, profileId = this.profileService.current()?.id ?? ''): string {
    const now = Date.now()
    const id = uuidv7(now)
    const today = this.transactionService.today()
    this.offlineService.write((db) => {
      const rule: RecurringRule = {
        ...toTemplate(values, null),
        id,
        profileId,
        nextOn: nextOnOrAfter(values, values.startOn),
        isPaused: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        changeSeq: null,
      }
      queueWrite(db, RECURRING_TABLE, 'upsert', { ...rule })
      // The occurrence the user just typed is recorded even for an ask-first rule.
      this.recordRule(db, rule, today, now, true)
    })
    return id
  }

  /**
   * Rule 4: an edit changes what isn't recorded yet. A new schedule starts again from today
   * (nothing is recorded backwards); otherwise the next date stays. A fix of a refused rule
   * (`fixOpId`) drops the rejected op; a refused create comes back as a new rule with its id.
   */
  update(
    id: string,
    values: RuleValues,
    fixOpId: string | null = null,
    profileId = this.profileService.current()?.id ?? ''
  ): void {
    const now = Date.now()
    const today = this.transactionService.today()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      const template = toTemplate(values, current?.debtId ?? null)
      const from = today > template.startOn ? today : template.startOn
      let rule: RecurringRule
      if (!current || current.deletedAt !== null) {
        rule = {
          ...template,
          id,
          profileId: current?.profileId ?? profileId,
          nextOn: nextOnOrAfter(template, current ? from : template.startOn),
          isPaused: false,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
          changeSeq: current?.changeSeq ?? null,
        }
      } else {
        const rescheduled =
          current.startOn !== template.startOn ||
          current.frequency !== template.frequency ||
          current.interval !== template.interval ||
          current.endOn !== template.endOn ||
          current.endCount !== template.endCount
        const nextOn = rescheduled ? nextOnOrAfter(template, from) : current.nextOn
        rule = { ...current, ...template, nextOn, updatedAt: now }
      }
      queueWrite(db, RECURRING_TABLE, 'upsert', { ...rule })
      if (fixOpId) {
        deleteOp(db, fixOpId)
      }
      this.recordRule(db, rule, today, now, false)
    })
  }

  /** Rule 5: pause; resuming starts from today, the paused occurrences aren't caught up. */
  setPaused(id: string, paused: boolean): void {
    const now = Date.now()
    const today = this.transactionService.today()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (!current || current.deletedAt !== null || current.isPaused === paused) {
        return
      }
      const nextOn =
        paused || current.nextOn === null || current.nextOn >= today
          ? current.nextOn
          : nextOnOrAfter(current, today)
      const rule: RecurringRule = { ...current, isPaused: paused, nextOn, updatedAt: now }
      queueWrite(db, RECURRING_TABLE, 'upsert', { ...rule })
      this.recordRule(db, rule, today, now, false)
    })
  }

  /** Rule 6: a tombstone with undo; recorded occurrences stay. */
  remove(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current && current.deletedAt === null) {
        queueWrite(db, RECURRING_TABLE, 'delete', { ...current, updatedAt: now, deletedAt: now })
      }
    })
  }

  restore(id: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const current = this.find(db, id)
      if (current && current.deletedAt !== null) {
        queueWrite(db, RECURRING_TABLE, 'upsert', { ...current, updatedAt: now, deletedAt: null })
      }
    })
  }

  /**
   * Rule 10: records the due occurrence of `ruleId` on `on`, as the rule says or with `values`
   * (the form, e.g. this month's bill); the rule's next date moves past what is handled.
   */
  confirm(ruleId: string, on: string, values?: OccurrenceValues): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const rule = this.find(db, ruleId)
      if (!rule || rule.deletedAt !== null) {
        return
      }
      this.writeOccurrence(db, rule, on, now, values)
      this.moveNext(db, rule, now)
    })
  }

  /** Rule 10: "ข้าม": the occurrence is written as a tombstone, so it's never offered again. */
  skip(ruleId: string, on: string): void {
    const now = Date.now()
    this.offlineService.write((db) => {
      const rule = this.find(db, ruleId)
      if (!rule || rule.deletedAt !== null) {
        return
      }
      this.writeOccurrence(db, rule, on, now, undefined, true)
      this.moveNext(db, rule, now)
    })
  }

  /** "บันทึกทั้งหมด": every due occurrence as its rule says. */
  confirmAll(): number {
    const due = this.due()
    const now = Date.now()
    this.offlineService.write((db) => {
      for (const occurrence of due) {
        const rule = this.find(db, occurrence.item.rule.id)
        if (rule && rule.deletedAt === null) {
          this.writeOccurrence(db, rule, occurrence.on, now)
        }
      }
      for (const ruleId of new Set(due.map((occurrence) => occurrence.item.rule.id))) {
        const rule = this.find(db, ruleId)
        if (rule) {
          this.moveNext(db, rule, now)
        }
      }
    })
    return due.length
  }

  /**
   * Rule 17: the occurrences to come in `range` (from tomorrow, at most 3 months ahead) of the
   * current profile's active rules with a wallet in `walletIds` (all when null). Never stored.
   */
  upcoming(range: DayRange, walletIds: readonly string[] | null): Occurrence[] {
    const today = this.transactionService.today()
    const tomorrow = addDays(today, 1)
    const horizon = addMonths(today, RECURRING_LIMITS.UPCOMING_MONTHS)
    const from = range.from && range.from > tomorrow ? range.from : tomorrow
    const to = range.to && range.to < horizon ? range.to : horizon
    if (from > to) {
      return []
    }
    const inView = (id: string | null) =>
      id !== null && (walletIds === null || walletIds.includes(id))
    const list: Occurrence[] = []
    for (const item of this.items()) {
      const { rule } = item
      if (item.state !== 'active' || rule.nextOn === null) {
        continue
      }
      if (!inView(rule.walletId) && !inView(rule.toWalletId)) {
        continue
      }
      const start = rule.nextOn > from ? rule.nextOn : from
      for (const on of occurrencesBetween(rule, start, to, 100)) {
        const id = occurrenceId(rule.id, on)
        if (!this.exists(rule.kind, id)) {
          list.push({ item, on, id })
        }
      }
    }
    return list.sort((a, b) => b.on.localeCompare(a.on))
  }

  /** Opens the rule in its form: the transaction or the transfer sheet in rule mode. */
  open(id: string): void {
    const rule = this.byId(id)
    if (rule?.kind === 'debt') {
      // A repayment rule is edited on its debt's page (debt rule 13).
      void this.router.navigate(['/wallets/debts', rule.debtId], { queryParams: { rule: id } })
    } else if (rule?.kind === 'transfer') {
      this.transferService.open({ mode: 'rule', id })
    } else if (rule) {
      this.transactionService.open({ mode: 'rule', id })
    }
  }

  /** Rule 7 over every profile of the user; tells the user what it recorded. */
  private recordDue(): void {
    const db = this.offlineService.db()
    const today = this.transactionService.today()
    const rules = db
      .selectObjects(
        `SELECT * FROM ${RECURRING_TABLE}
         WHERE deleted_at IS NULL AND is_paused = 0 AND next_on IS NOT NULL AND next_on <= ?`,
        [today]
      )
      .map((row) => toRule(fromSql(RECURRING_TABLE, row)))
      // An ask-first rule waits for the user (rule 10): nothing to write, so no write at all
      // (a write would run this pass again).
      .filter((rule) => !rule.confirm || this.stoppedBy(db, rule) !== null)
    const orphans = this.orphans(db)
    if (rules.length === 0 && orphans.length === 0) {
      return
    }
    let recorded = 0
    const now = Date.now()
    this.offlineService.write((tx) => {
      // Rules 13–14: a merged category's rules follow it, the rest of a deleted one's go.
      if (orphans.length > 0) {
        followMerges(tx, now)
        for (const rule of this.orphans(tx)) {
          queueWrite(tx, RECURRING_TABLE, 'delete', { ...rule, updatedAt: now, deletedAt: now })
        }
      }
      for (const { id } of rules) {
        const rule = this.find(tx, id)
        if (rule && rule.deletedAt === null) {
          recorded += this.recordRule(tx, rule, today, now, false)
        }
      }
    })
    if (recorded > 0) {
      toast(this.transloco.translate('recurring.recorded', { count: recorded }), {
        action: {
          label: this.transloco.translate('recurring.view'),
          onClick: () => void this.router.navigateByUrl(RECURRING_ROUTE),
        },
      })
    }
  }

  /**
   * Rule 7 for one rule inside a write: records its occurrences from `nextOn` up to `today`
   * (an ask-first rule only when `firstToo` and only its first one, rule 8) and moves `nextOn`.
   * A rule stopped by an archived wallet or category records nothing and moves on (rule 12).
   * Answers how many it recorded.
   */
  private recordRule(
    db: LocalDatabase,
    rule: RecurringRule,
    today: string,
    now: number,
    firstToo: boolean
  ): number {
    if (rule.isPaused || rule.nextOn === null || rule.nextOn > today) {
      return 0
    }
    const stopped = this.stoppedBy(db, rule) !== null
    if (rule.confirm && !stopped) {
      if (firstToo && rule.nextOn === rule.startOn) {
        this.writeOccurrence(db, rule, rule.startOn, now)
        this.moveNext(db, rule, now)
        return 1
      }
      return 0
    }
    let recorded = 0
    let k = indexOnOrAfter(rule, rule.nextOn)
    for (
      let step = 0;
      step < RECURRING_LIMITS.PASS_MAX && !isPastEnd(rule, k) && occurrenceOn(rule, k) <= today;
      step++, k++
    ) {
      if (!stopped && this.writeOccurrence(db, rule, occurrenceOn(rule, k), now)) {
        recorded += 1
      }
    }
    const nextOn = isPastEnd(rule, k) ? null : occurrenceOn(rule, k)
    if (nextOn !== rule.nextOn) {
      queueWrite(db, RECURRING_TABLE, 'upsert', { ...rule, nextOn, updatedAt: now })
    }
    return recorded
  }

  /**
   * Writes the occurrence of `rule` on `on` (a tombstone when `skipped`) unless this device
   * already holds that id, live or not (rule 9). Answers whether it wrote.
   */
  private writeOccurrence(
    db: LocalDatabase,
    rule: RecurringRule,
    on: string,
    now: number,
    values?: OccurrenceValues,
    skipped = false
  ): boolean {
    const id = occurrenceId(rule.id, on)
    const table = tableOf(rule.kind)
    const existing = db.selectObjects(`SELECT id FROM ${table} WHERE id = ?`, [id]).at(0)
    if (existing) {
      return false
    }
    const common = {
      id,
      profileId: rule.profileId,
      amount: values?.amount ?? rule.amount,
      occurredOn: values?.occurredOn ?? on,
      note: values?.note ?? rule.note,
      recurringId: rule.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: skipped ? now : null,
    }
    const row =
      rule.kind === 'transfer'
        ? {
            ...common,
            fromWalletId: values?.walletId ?? rule.walletId,
            toWalletId: values?.toWalletId ?? rule.toWalletId,
          }
        : rule.kind === 'debt'
          ? {
              ...common,
              debtId: rule.debtId,
              kind: 'repayment',
              walletId: values?.walletId ?? rule.walletId,
            }
          : {
              ...common,
              walletId: values?.walletId ?? rule.walletId,
              categoryId: values?.categoryId ?? rule.categoryId,
              excludeFromReport: values?.excludeFromReport ?? rule.excludeFromReport,
              debtId: rule.debtId,
            }
    queueWrite(db, table, skipped ? 'delete' : 'upsert', row)
    return true
  }

  /** `nextOn` = the rule's first occurrence this device hasn't recorded or skipped (rule 10). */
  private moveNext(db: LocalDatabase, rule: RecurringRule, now: number): void {
    if (rule.nextOn === null) {
      return
    }
    const table = tableOf(rule.kind)
    let k = indexOnOrAfter(rule, rule.nextOn)
    for (let step = 0; step < 1000 && !isPastEnd(rule, k); step++, k++) {
      const id = occurrenceId(rule.id, occurrenceOn(rule, k))
      if (!db.selectObjects(`SELECT id FROM ${table} WHERE id = ?`, [id]).at(0)) {
        break
      }
    }
    const nextOn = isPastEnd(rule, k) ? null : occurrenceOn(rule, k)
    if (nextOn !== rule.nextOn) {
      queueWrite(db, RECURRING_TABLE, 'upsert', { ...rule, nextOn, updatedAt: now })
    }
  }

  /** Rule 12: the archived wallet or category a rule points at, if any. */
  private stoppedBy(
    db: LocalDatabase,
    rule: RecurringRule
  ): { kind: 'wallet' | 'category' | 'debt'; name: string } | null {
    // Debt rule 14: a closed debt's instalments stop by themselves.
    if (rule.debtId) {
      const debt = db
        .selectObjects(
          `SELECT d.person, ${DEBT_LEFT_SQL} AS debt_left FROM ${DEBT_TABLE} d WHERE d.id = ?`,
          [rule.debtId]
        )
        .at(0)
      if (debt && Number(debt['debt_left']) <= 0) {
        return { kind: 'debt', name: String(debt['person']) }
      }
    }
    const ids = [rule.walletId, rule.toWalletId].filter((id): id is string => id !== null)
    for (const id of ids) {
      const wallet = db
        .selectObjects(`SELECT name, is_archived FROM ${WALLET_TABLE} WHERE id = ?`, [id])
        .at(0)
      if (wallet?.['is_archived'] === 1) {
        return { kind: 'wallet', name: String(wallet['name']) }
      }
    }
    if (rule.categoryId) {
      const category = db
        .selectObjects(`SELECT name, is_archived FROM ${CATEGORY_TABLE} WHERE id = ?`, [
          rule.categoryId,
        ])
        .at(0)
      if (category?.['is_archived'] === 1) {
        return { kind: 'category', name: String(category['name']) }
      }
    }
    return null
  }

  /** Rule 14 (debt rule 5): live rules whose wallet, category or debt is a tombstone here. */
  private orphans(db: LocalDatabase): RecurringRule[] {
    return db
      .selectObjects(
        `SELECT r.* FROM ${RECURRING_TABLE} r
         LEFT JOIN ${WALLET_TABLE} w ON w.id = r.wallet_id
         LEFT JOIN ${WALLET_TABLE} t ON t.id = r.to_wallet_id
         LEFT JOIN ${CATEGORY_TABLE} c ON c.id = r.category_id
         LEFT JOIN ${DEBT_TABLE} d ON d.id = r.debt_id
         WHERE r.deleted_at IS NULL
           AND (w.deleted_at IS NOT NULL OR t.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL
             OR d.deleted_at IS NOT NULL)`
      )
      .map((row) => toRule(fromSql(RECURRING_TABLE, row)))
  }

  private toItem(rule: RecurringRule, today: string): RuleItem {
    const wallet = this.walletService.byId(rule.walletId)
    const toWallet = rule.toWalletId ? this.walletService.byId(rule.toWalletId) : null
    const category = rule.categoryId ? this.categoryService.byId(rule.categoryId) : null
    const stoppedBy = this.read((db) => this.stoppedBy(db, rule), null)
    const state: RuleState =
      rule.nextOn === null ? 'ended' : rule.isPaused ? 'paused' : stoppedBy ? 'stopped' : 'active'
    const transfer = rule.kind === 'transfer'
    const debt = rule.kind === 'debt' ? this.debtOf(rule.debtId) : null
    let dueOn: string | null = null
    if (state === 'active' && rule.confirm && rule.nextOn !== null && rule.nextOn <= today) {
      dueOn = rule.nextOn
    }
    return {
      rule,
      state,
      stoppedBy,
      sign: debt
        ? debt.direction === 'lent'
          ? 1
          : -1
        : !transfer && category?.type === 'income'
          ? 1
          : -1,
      debtDirection: debt ? (debt.direction === 'lent' ? 'lent' : 'borrowed') : null,
      title: debt ? debt.person : transfer ? '' : (category?.name ?? ''),
      icon: transfer ? '' : (category?.icon ?? ''),
      color: transfer ? '' : (category?.color ?? ''),
      walletIcon: wallet?.icon ?? '',
      walletColor: wallet?.color ?? '',
      walletName: wallet?.name ?? '',
      toWalletName: toWallet?.name ?? '',
      currencyCode: wallet?.currencyCode ?? '',
      dueOn,
    }
  }

  /** A debt rule's debt as the rules page shows it (its person, its direction). */
  private debtOf(id: string | null): { person: string; direction: string } | null {
    if (!id) {
      return null
    }
    return this.read((db) => {
      const row = db
        .selectObjects(`SELECT person, direction FROM ${DEBT_TABLE} WHERE id = ?`, [id])
        .at(0)
      return row ? { person: String(row['person']), direction: String(row['direction']) } : null
    }, null)
  }

  private exists(kind: RecurringKind, id: string): boolean {
    return this.read(
      (db) => db.selectObjects(`SELECT id FROM ${tableOf(kind)} WHERE id = ?`, [id]).length > 0,
      false
    )
  }

  private find(db: LocalDatabase, id: string): RecurringRule | null {
    const row = db.selectObjects(`SELECT * FROM ${RECURRING_TABLE} WHERE id = ?`, [id]).at(0)
    return row ? toRule(fromSql(RECURRING_TABLE, row)) : null
  }

  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    return this.offlineService.isOpen() ? work(this.offlineService.db()) : fallback
  }
}

/** What a due occurrence's form may change before it is recorded. */
export type OccurrenceValues = Partial<
  Pick<
    RuleValues,
    'walletId' | 'categoryId' | 'toWalletId' | 'amount' | 'note' | 'excludeFromReport'
  >
> & { occurredOn?: string }

const tableOf = (kind: RecurringKind) =>
  kind === 'transfer' ? TRANSFER_TABLE : kind === 'debt' ? DEBT_ENTRY_TABLE : TRANSACTION_TABLE

/** The stored fields a form decides (no state); `debtId` keeps the rule's when not given. */
const toTemplate = (values: RuleValues, debtId: string | null) => {
  const transaction = values.kind === 'transaction'
  return {
    kind: values.kind,
    walletId: values.walletId,
    categoryId: transaction ? values.categoryId : null,
    toWalletId: values.kind === 'transfer' ? values.toWalletId : null,
    debtId: values.kind === 'transfer' ? null : (values.debtId ?? debtId),
    amount: values.amount,
    note: values.note.trim(),
    excludeFromReport: transaction ? values.excludeFromReport : false,
    startOn: values.startOn,
    frequency: values.frequency,
    interval: values.interval,
    endOn: values.endOn,
    endCount: values.endCount,
    confirm: values.confirm,
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

export const toRule = (row: Record<string, unknown>): RecurringRule => ({
  id: String(row['id']),
  profileId: String(row['profileId']),
  kind: row['kind'] === 'transfer' || row['kind'] === 'debt' ? row['kind'] : 'transaction',
  walletId: String(row['walletId']),
  categoryId: text(row['categoryId']),
  toWalletId: text(row['toWalletId']),
  debtId: text(row['debtId']),
  amount: Number(row['amount']),
  note: text(row['note']) ?? '',
  excludeFromReport: row['excludeFromReport'] === true,
  startOn: String(row['startOn']),
  frequency:
    (['day', 'week', 'month', 'year'] as const).find((unit) => unit === row['frequency']) ??
    'month',
  interval: Number(row['interval']) || 1,
  endOn: text(row['endOn']),
  endCount: typeof row['endCount'] === 'number' ? row['endCount'] : null,
  confirm: row['confirm'] === true,
  nextOn: text(row['nextOn']),
  isPaused: row['isPaused'] === true,
  createdAt: Number(row['createdAt']),
  updatedAt: Number(row['updatedAt']),
  deletedAt: typeof row['deletedAt'] === 'number' ? row['deletedAt'] : null,
  changeSeq: typeof row['changeSeq'] === 'number' ? row['changeSeq'] : null,
})
