import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, getRow, listOps, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { TransactionService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { occurrenceId } from './occurrence-id'
import { RecurringService } from './recurring.service'
import type { RuleValues } from './recurring.type'

describe('RecurringService', () => {
  let db: LocalDatabase
  let service: RecurringService
  const changes = signal(0)
  const canSync = signal(false)
  const rounds = signal(0)
  const isSyncing = signal(false)

  const offline = {
    isOpen: signal(true),
    sharedActive: signal(false),
    leaveShared: () => undefined,
    isTrusted: signal(true),
    meta: signal(null),
    changes,
    db: () => db,
    write: <T>(work: (database: LocalDatabase) => T): T => {
      const result = db.transaction(work)
      changes.update((n) => n + 1)
      return result
    },
  }
  const sync = {
    canSync,
    isSyncing,
    rounds,
    lastSyncedAt: signal<number | null>(1),
    rejectedOp: (opId: string) => findOp(db, opId),
  }
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null, changeSeq: 1, updatedBy: 'u1' }
  const pulled = (table: string, row: object) => {
    putRow(db, table, { ...base, ...row })
    changes.update((n) => n + 1)
  }
  const wallet = (id: string, extra: object = {}) =>
    pulled('wallets', {
      id,
      profileId: 'p1',
      name: id,
      currencyCode: 'THB',
      initialBalance: 0,
      icon: 'lucideWallet',
      color: '#16a34a',
      excludeFromTotal: false,
      isArchived: false,
      sortOrder: 0,
      ...extra,
    })
  const category = (id: string, type: string, extra: object = {}) =>
    pulled('categories', {
      id,
      profileId: 'p1',
      type,
      parentId: null,
      name: id,
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 0,
      ...extra,
    })
  const rule = (id: string, extra: object = {}) =>
    pulled('recurring_rules', {
      id,
      profileId: 'p1',
      kind: 'transaction',
      walletId: 'bank',
      categoryId: 'rent',
      toWalletId: null,
      amount: 850000,
      note: 'ห้อง',
      excludeFromReport: false,
      startOn: '2026-10-01',
      frequency: 'month',
      interval: 1,
      endOn: null,
      endCount: null,
      confirm: false,
      nextOn: '2026-10-01',
      isPaused: false,
      ...extra,
    })
  const values = (extra: Partial<RuleValues> = {}): RuleValues => ({
    kind: 'transaction',
    walletId: 'bank',
    categoryId: 'rent',
    toWalletId: null,
    amount: 850000,
    note: ' ห้อง ',
    excludeFromReport: false,
    startOn: '2026-10-01',
    frequency: 'month',
    interval: 1,
    endOn: null,
    endCount: null,
    confirm: false,
    ...extra,
  })
  const rows = (table: string, ruleId: string) =>
    db
      .selectObjects(
        `SELECT occurred_on, amount, deleted_at FROM ${table} WHERE recurring_id = ? ORDER BY occurred_on`,
        [ruleId]
      )
      .map((row) => `${String(row['occurred_on'])}${row['deleted_at'] === null ? '' : ' skipped'}`)
  const nextOn = (id: string) => getRow(db, 'recurring_rules', id)?.['nextOn']
  /** The recording pass (rule 7) runs from an effect. */
  const pass = () => {
    changes.update((n) => n + 1)
    TestBed.tick()
  }

  beforeEach(async () => {
    toastState.dismiss()
    db = await openTestDatabase()
    localStorage.clear()
    canSync.set(false)
    rounds.set(0)
    isSyncing.set(false)
    for (const id of ['p1', 'p2']) {
      putRow(db, 'profiles', {
        ...base,
        id,
        name: id,
        icon: 'lucideHouse',
        color: '#16a34a',
        sortOrder: id === 'p1' ? 0 : 1,
      })
    }
    putRow(db, 'currencies', {
      code: 'THB',
      minorUnit: 2,
      isActive: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      changeSeq: 1,
    })
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideRouter([]),
        { provide: OfflineService, useValue: offline },
        { provide: SyncService, useValue: sync },
        {
          provide: NetworkStatusService,
          useValue: { isOnline: signal(true), serverReachable: signal(true) },
        },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    TestBed.inject(TransactionService).today.set('2026-11-08')
    wallet('bank')
    wallet('cash', { sortOrder: 1 })
    wallet('save', { sortOrder: 2, excludeFromTotal: true })
    category('rent', 'expense')
    category('salary', 'income')
    service = TestBed.inject(RecurringService)
  })

  afterEach(() => {
    toastState.dismiss()
    db.close()
  })

  it('creates a rule and records its occurrences up to today in the same write (rule 8)', () => {
    const id = service.create(values())
    expect(rows('transactions', id)).toEqual(['2026-10-01', '2026-11-01'])
    expect(nextOn(id)).toBe('2026-12-01')
    const first = getRow(db, 'transactions', occurrenceId(id, '2026-10-01'))
    expect(first).toMatchObject({ note: 'ห้อง', recurringId: id, walletId: 'bank', amount: 850000 })
    // The rule is pushed before its occurrences.
    expect(listOps(db, 'pending').map((op) => op.table)).toEqual([
      'recurring_rules',
      'transactions',
      'transactions',
    ])
  })

  it('records only the typed one of an ask-first rule, and nothing for a future start', () => {
    const asked = service.create(values({ confirm: true }))
    expect(rows('transactions', asked)).toEqual(['2026-10-01'])
    expect(nextOn(asked)).toBe('2026-11-01')
    const later = service.create(values({ startOn: '2026-12-25' }))
    expect(rows('transactions', later)).toEqual([])
    expect(nextOn(later)).toBe('2026-12-25')
  })

  it('records what is due when the app opens, in every profile, and says so (rule 7)', () => {
    rule('r1')
    rule('r2', { profileId: 'p2', walletId: 'p2w', categoryId: 'p2c', nextOn: '2026-11-01' })
    wallet('p2w', { profileId: 'p2' })
    category('p2c', 'expense', { profileId: 'p2' })
    pass()
    expect(rows('transactions', 'r1')).toEqual(['2026-10-01', '2026-11-01'])
    expect(rows('transactions', 'r2')).toEqual(['2026-11-01'])
    expect(nextOn('r1')).toBe('2026-12-01')
    expect(toastState.toasts().at(0)?.title).toBe('บันทึกรายการซ้ำ 3 รายการ')
  })

  it('waits for the first sync round while it can sync, and for a round to end', () => {
    rule('r1')
    canSync.set(true)
    pass()
    expect(rows('transactions', 'r1')).toEqual([])
    rounds.set(1)
    isSyncing.set(true)
    pass()
    expect(rows('transactions', 'r1')).toEqual([])
    isSyncing.set(false)
    pass()
    expect(rows('transactions', 'r1')).toHaveLength(2)
  })

  it('never writes an occurrence this device holds already, live or skipped (rule 9)', () => {
    pulled('transactions', {
      id: occurrenceId('r1', '2026-10-01'),
      profileId: 'p1',
      walletId: 'bank',
      categoryId: 'rent',
      amount: 900000,
      occurredOn: '2026-10-01',
      note: 'edited elsewhere',
      excludeFromReport: false,
      recurringId: 'r1',
    })
    pulled('transactions', {
      id: occurrenceId('r1', '2026-11-01'),
      profileId: 'p1',
      walletId: 'bank',
      categoryId: 'rent',
      amount: 850000,
      occurredOn: '2026-11-01',
      note: '',
      excludeFromReport: false,
      recurringId: 'r1',
      deletedAt: 5,
    })
    rule('r1')
    pass()
    expect(rows('transactions', 'r1')).toEqual(['2026-10-01', '2026-11-01 skipped'])
    expect(getRow(db, 'transactions', occurrenceId('r1', '2026-10-01'))?.['amount']).toBe(900000)
    expect(nextOn('r1')).toBe('2026-12-01')
  })

  it('skips paused rules, and moves a rule stopped by an archived wallet on without recording (rule 12)', () => {
    rule('paused', { isPaused: true })
    wallet('old', { isArchived: true })
    rule('stopped', { walletId: 'old' })
    pass()
    expect(rows('transactions', 'paused')).toEqual([])
    expect(nextOn('paused')).toBe('2026-10-01')
    expect(rows('transactions', 'stopped')).toEqual([])
    expect(nextOn('stopped')).toBe('2026-12-01')
    expect(service.items().find((item) => item.rule.id === 'stopped')).toMatchObject({
      state: 'stopped',
      stoppedBy: { kind: 'wallet', name: 'old' },
    })
  })

  it('opens no write for a due ask-first rule, so the pass never runs itself again', () => {
    rule('r1', { confirm: true })
    pass()
    const before = changes()
    pass()
    expect(changes()).toBe(before + 1) // only the bump `pass` makes itself
    expect(listOps(db, 'pending')).toEqual([])
  })

  it('ends after its count: no next date (rule 3)', () => {
    rule('r1', { endCount: 2 })
    pass()
    expect(rows('transactions', 'r1')).toEqual(['2026-10-01', '2026-11-01'])
    expect(nextOn('r1')).toBeNull()
    expect(service.items()[0].state).toBe('ended')
  })

  it('records transfers too, between the rule’s two wallets (Q4)', () => {
    rule('t1', { kind: 'transfer', categoryId: null, toWalletId: 'save', nextOn: '2026-11-01' })
    pass()
    expect(getRow(db, 'transfers', occurrenceId('t1', '2026-11-01'))).toMatchObject({
      fromWalletId: 'bank',
      toWalletId: 'save',
      amount: 850000,
      recurringId: 't1',
    })
  })

  it('lists due ask-first occurrences; confirm, edit or skip each, or all at once (rule 10)', () => {
    rule('r1', { confirm: true })
    pass()
    expect(rows('transactions', 'r1')).toEqual([])
    expect(service.due().map((due) => due.on)).toEqual(['2026-10-01', '2026-11-01'])
    service.confirm('r1', '2026-11-01', { amount: 123400 })
    // The older one is still due, so the next date stays on it.
    expect(nextOn('r1')).toBe('2026-10-01')
    service.skip('r1', '2026-10-01')
    expect(rows('transactions', 'r1')).toEqual(['2026-10-01 skipped', '2026-11-01'])
    expect(getRow(db, 'transactions', occurrenceId('r1', '2026-11-01'))?.['amount']).toBe(123400)
    expect(nextOn('r1')).toBe('2026-12-01')
    expect(service.due()).toEqual([])

    rule('r2', { confirm: true, nextOn: '2026-10-01' })
    expect(service.confirmAll()).toBe(2)
    expect(rows('transactions', 'r2')).toEqual(['2026-10-01', '2026-11-01'])
    expect(nextOn('r2')).toBe('2026-12-01')
  })

  it('edits: the template keeps the next date, a new schedule starts from today (rule 4)', () => {
    rule('r1', { nextOn: '2026-12-01' })
    service.update('r1', values({ amount: 900000 }))
    expect(getRow(db, 'recurring_rules', 'r1')).toMatchObject({
      amount: 900000,
      nextOn: '2026-12-01',
    })
    service.update('r1', values({ frequency: 'week' }))
    expect(nextOn('r1')).toBe('2026-11-12')
    // Nothing is recorded backwards.
    expect(rows('transactions', 'r1')).toEqual([])
  })

  it('pauses and resumes from today, deletes with undo (rules 5–6)', () => {
    rule('r1', { nextOn: '2026-12-01' })
    service.setPaused('r1', true)
    expect(getRow(db, 'recurring_rules', 'r1')?.['isPaused']).toBe(true)
    db.exec(`UPDATE recurring_rules SET next_on = '2026-09-01' WHERE id = 'r1'`)
    service.setPaused('r1', false)
    // The paused 1 Oct and 1 Nov aren't caught up: the next one after today.
    expect(nextOn('r1')).toBe('2026-12-01')
    expect(rows('transactions', 'r1')).toEqual([])
    service.remove('r1')
    expect(service.byId('r1')).toBeNull()
    service.restore('r1')
    expect(service.byId('r1')).not.toBeNull()
  })

  it('shows the occurrences to come for 3 months in the wallets in view, never stored (rule 17)', () => {
    rule('r1', { nextOn: '2026-12-01' })
    rule('c1', { walletId: 'cash', nextOn: '2026-11-20', frequency: 'week' })
    const all = service.upcoming({ from: '2026-12-01', to: null }, null)
    expect(all.filter((item) => item.item.rule.id === 'r1').map((item) => item.on)).toEqual([
      '2027-02-01',
      '2027-01-01',
      '2026-12-01',
    ])
    expect(
      service.upcoming({ from: '2026-12-01', to: null }, ['bank']).map((item) => item.item.rule.id)
    ).not.toContain('c1')
    expect(listOps(db, 'pending')).toEqual([])
  })

  it('takes the rules of a deleted wallet, and moves those of a merged category (rules 13–14)', () => {
    rule('r1', { nextOn: '2026-12-01' })
    rule('r2', { walletId: 'cash', nextOn: '2026-12-01' })
    category('rent', 'expense', { deletedAt: 5, mergedIntoId: 'home' })
    category('home', 'expense')
    pulled('wallets', { ...getRow(db, 'wallets', 'cash'), deletedAt: 5 })
    pass()
    expect(getRow(db, 'recurring_rules', 'r1')?.['categoryId']).toBe('home')
    expect(getRow(db, 'recurring_rules', 'r1')?.['deletedAt']).toBeNull()
    expect(getRow(db, 'recurring_rules', 'r2')?.['deletedAt']).not.toBeNull()
  })

  it('makes a wallet with a rule keep its currency, and deleting it takes the rule (rules 14–15)', () => {
    rule('r1', { walletId: 'cash', nextOn: '2026-12-01' })
    const wallets = TestBed.inject(WalletService)
    expect(wallets.canChangeCurrency('cash')).toBe(false)
    expect(wallets.ruleCount('cash')).toBe(1)
    wallets.remove('cash')
    expect(getRow(db, 'recurring_rules', 'r1')?.['deletedAt']).not.toBeNull()
  })
})
