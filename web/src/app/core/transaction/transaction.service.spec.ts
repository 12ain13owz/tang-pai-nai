import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, getRow, listOps, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { WalletService } from '@/core/wallet'
import { TransactionService } from './transaction.service'
import type { TransactionValues } from './transaction.type'

describe('TransactionService', () => {
  let db: LocalDatabase
  let service: TransactionService
  const changes = signal(0)

  const offline = {
    isOpen: signal(true),
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
    canSync: signal(false),
    isSyncing: signal(false),
    lastSyncedAt: signal<number | null>(1),
    rejectedOp: (opId: string) => findOp(db, opId),
  }
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null, changeSeq: 1, updatedBy: 'u1' }
  /** Rows as a pull would write them, outside the outbox. */
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
  const transaction = (id: string, extra: object = {}) =>
    pulled('transactions', {
      id,
      profileId: 'p1',
      walletId: 'cash',
      categoryId: 'food',
      amount: 1000,
      occurredOn: '2026-11-02',
      note: '',
      excludeFromReport: false,
      ...extra,
    })
  const values: TransactionValues = {
    walletId: 'card',
    categoryId: 'food',
    amount: 6500,
    occurredOn: '2026-11-02',
    note: '  ลาเต้เย็น ',
    excludeFromReport: false,
  }
  const november = { from: '2026-11-01', to: '2026-11-30' }

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
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
    for (const [code, minorUnit, sortOrder] of [
      ['THB', 2, 0],
      ['USD', 2, 1],
    ] as const) {
      putRow(db, 'currencies', {
        code,
        minorUnit,
        isActive: true,
        sortOrder,
        createdAt: 1,
        updatedAt: 1,
        changeSeq: 1,
      })
    }
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: { th },
          translocoConfig: { availableLangs: ['th'], defaultLang: 'th' },
          preloadLangs: true,
        }),
      ],
      providers: [
        { provide: OfflineService, useValue: offline },
        { provide: SyncService, useValue: sync },
        {
          provide: NetworkStatusService,
          useValue: { isOnline: signal(true), serverReachable: signal(true) },
        },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    service = TestBed.inject(TransactionService)
    wallet('cash', { sortOrder: 0 })
    wallet('card', { sortOrder: 1 })
    category('food', 'expense')
    category('salary', 'income')
  })

  afterEach(() => db.close())

  it('lists a period newest day first, then the one recorded last (rule 13), with its category and wallet', () => {
    transaction('a', { occurredOn: '2026-11-01', createdAt: 5 })
    transaction('b', { occurredOn: '2026-11-02', createdAt: 1 })
    transaction('c', { occurredOn: '2026-11-02', createdAt: 9, categoryId: 'salary' })
    transaction('october', { occurredOn: '2026-10-31' })
    transaction('gone', { deletedAt: 5 })
    transaction('other', { profileId: 'p2' })
    const items = service.list(november)
    expect(items.map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect(items[0]).toMatchObject({
      type: 'income',
      categoryName: 'salary',
      walletName: 'cash',
      currencyCode: 'THB',
    })
    expect(service.list({ from: null, to: null }).map((item) => item.id)).toContain('october')
    expect(service.list(november, ['card'])).toEqual([])
    expect(service.list(november, [])).toEqual([])
  })

  it('sums income and expense per currency, leaving out excludeFromReport rows (rule 11)', () => {
    wallet('usd', { currencyCode: 'USD' })
    transaction('a', { amount: 1000 })
    transaction('b', { amount: 250, excludeFromReport: true })
    transaction('c', { amount: 50000, categoryId: 'salary' })
    transaction('d', { amount: 700, walletId: 'usd' })
    expect(service.summary(november)).toEqual([
      { currencyCode: 'THB', minorUnit: 2, income: 50000, expense: 1000, net: 49000, transfer: 0 },
      { currencyCode: 'USD', minorUnit: 2, income: 0, expense: 700, net: -700, transfer: 0 },
    ])
  })

  it('creates a transaction in the current profile, trims the note and remembers the wallet', () => {
    const id = service.save(null, values)
    const row = getRow(db, 'transactions', id)
    expect(row).toMatchObject({
      profileId: 'p1',
      walletId: 'card',
      amount: 6500,
      note: 'ลาเต้เย็น',
      deletedAt: null,
    })
    expect(listOps(db, 'pending').map((op) => [op.table, op.rowId])).toEqual([['transactions', id]])
    expect(service.defaultWalletId()).toBe('card')
  })

  it('edits in place, keeping createdAt, profile and baseSeq', () => {
    transaction('t1', { createdAt: 77, changeSeq: 9 })
    service.save('t1', { ...values, amount: 99 })
    expect(getRow(db, 'transactions', 't1')).toMatchObject({
      amount: 99,
      createdAt: 77,
      profileId: 'p1',
    })
    expect(listOps(db, 'pending')[0].baseSeq).toBe(9)
  })

  it('deletes as a tombstone and brings it back for undo (rule 7)', () => {
    transaction('t1')
    service.remove('t1')
    expect(service.byId('t1')).toBeNull()
    expect(listOps(db, 'pending')[0].op).toBe('delete')
    service.restore('t1')
    expect(service.byId('t1')).not.toBeNull()
    expect(listOps(db, 'pending')).toHaveLength(1)
  })

  it('starts a new one on the first open wallet when none was used here', () => {
    expect(service.defaultWalletId()).toBe('cash')
    localStorage.setItem('tpn-profile:tx:p1', 'gone')
    expect(service.defaultWalletId()).toBe('cash')
  })

  it('ranks "ใช้บ่อย" by uses in the last 90 days of the type, ties to the one recorded last', () => {
    service.today.set('2026-11-02')
    category('coffee', 'expense')
    category('fuel', 'expense')
    transaction('t1', { categoryId: 'coffee', createdAt: 10 })
    transaction('t2', { categoryId: 'coffee', createdAt: 11 })
    transaction('t3', { categoryId: 'food', createdAt: 12 })
    transaction('t4', { categoryId: 'fuel', createdAt: 13 })
    transaction('t5', { categoryId: 'fuel', occurredOn: '2026-08-01' }) // older than 90 days
    transaction('t6', { categoryId: 'food', deletedAt: 20 })
    transaction('t7', { categoryId: 'salary' })
    transaction('t8', { categoryId: 'food', profileId: 'p2' })
    expect(service.frequentCategoryIds('p1', 'expense')).toEqual(['coffee', 'fuel', 'food'])
    expect(service.frequentCategoryIds('p1', 'income')).toEqual(['salary'])
    expect(service.frequentCategoryIds('p1', 'expense', 90, 1)).toEqual(['coffee'])
    expect(service.frequentCategoryIds('', 'expense')).toEqual([])
  })

  it('remembers the type of the last one added, per profile', () => {
    expect(service.lastType()).toBe('expense')
    service.rememberType('income')
    expect(service.lastType()).toBe('income')
    expect(service.lastType('p2')).toBe('expense')
  })

  it('tombstones live transactions whose wallet or category was deleted elsewhere (rule 10)', () => {
    transaction('t1', { walletId: 'card' })
    transaction('t2', { categoryId: 'salary' })
    transaction('t3')
    wallet('card', { sortOrder: 1, deletedAt: 9 })
    category('salary', 'income', { deletedAt: 9 })
    TestBed.tick()
    expect(service.byId('t1')).toBeNull()
    expect(service.byId('t2')).toBeNull()
    expect(service.byId('t3')).not.toBeNull()
    expect(listOps(db, 'pending').map((op) => [op.rowId, op.op])).toEqual([
      ['t1', 'delete'],
      ['t2', 'delete'],
    ])
  })

  it('moves live transactions of a merged category to its target instead (category rule 15)', () => {
    category('coffee', 'expense')
    transaction('t1', { categoryId: 'coffee' })
    category('coffee', 'expense', { deletedAt: 9, mergedIntoId: 'food' })
    TestBed.tick()
    expect(service.byId('t1')).toMatchObject({ categoryId: 'food', deletedAt: null })
    // The server makes the same move: nothing to push.
    expect(listOps(db, 'pending')).toHaveLength(0)
  })

  it('shows every wallet but those left out of the total, archived ones included (rule 11)', () => {
    wallet('kid', { excludeFromTotal: true })
    wallet('old', { isArchived: true })
    expect(service.viewWalletIds().sort()).toEqual(['card', 'cash', 'old'])
    service.selectWallet('kid')
    expect(service.viewWalletIds()).toEqual(['kid'])
    expect(JSON.parse(localStorage.getItem('tpn-profile:tx:view:p1') ?? '{}')).toEqual({
      walletId: 'kid',
      unit: 'month',
    })
  })

  it('starts the period tabs at the oldest transaction and goes back to the current one on a new unit', () => {
    service.today.set('2026-11-02')
    transaction('old', { occurredOn: '2026-08-20' })
    expect(service.tabs()).toEqual([-3, -2, -1, 0, 'future'])
    service.tab.set(-1)
    expect(service.range()).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    service.selectUnit('year')
    expect(service.tab()).toBe(0)
    expect(service.range()).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('keeps the chosen period and wallet after a write or a pull (the profile row is read again)', () => {
    service.today.set('2026-11-02')
    transaction('old', { occurredOn: '2026-08-20' })
    TestBed.tick()
    service.selectWallet('card')
    service.tab.set(-1)
    service.save(null, values)
    TestBed.tick()
    pulled('profiles', {
      id: 'p1',
      name: 'renamed',
      icon: 'lucideHouse',
      color: '#16a34a',
      sortOrder: 0,
    })
    TestBed.tick()
    expect(service.tab()).toBe(-1)
    expect(service.viewWalletId()).toBe('card')
  })

  it('narrows the list to categories, counted or excluded rows, and a currency (report.md)', () => {
    wallet('usd', { currencyCode: 'USD' })
    category('coffee', 'expense', { parentId: 'food' })
    transaction('a')
    transaction('b', { categoryId: 'coffee' })
    transaction('c', { categoryId: 'coffee', excludeFromReport: true })
    transaction('d', { categoryId: 'coffee', walletId: 'usd' })
    transaction('e', { categoryId: 'salary' })
    const ids = (filter: Parameters<TransactionService['list']>[2]) =>
      service
        .list(november, null, filter)
        .map((item) => item.id)
        .sort()
    expect(ids({ categoryIds: ['food', 'coffee'] })).toEqual(['a', 'b', 'c', 'd'])
    expect(ids({ categoryIds: ['coffee'], report: 'counted' })).toEqual(['b', 'd'])
    expect(ids({ report: 'excluded' })).toEqual(['c'])
    expect(ids({ categoryIds: ['coffee'], currencyCode: 'THB' })).toEqual(['b', 'c'])
    expect(ids({ categoryIds: [] })).toEqual([])
  })

  it('opens a fix with the refused values', () => {
    service.save(null, values)
    const op = listOps(db, 'pending')[0]
    db.exec(`UPDATE outbox SET status = 'rejected' WHERE op_id = ?`, [op.opId])
    service.openFix(op.opId)
    expect(service.sheet()).toMatchObject({
      mode: 'fix',
      opId: op.opId,
      profileId: 'p1',
      values: { walletId: 'card', amount: 6500 },
    })
    expect(TestBed.inject(WalletService).byId('card')).not.toBeNull()
  })
})
