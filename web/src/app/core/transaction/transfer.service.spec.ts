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
import { ProfileService } from '@/core/profile'
import { WalletService } from '@/core/wallet'
import { TransactionService } from './transaction.service'
import { TransferService } from './transfer.service'
import type { TransferValues } from './transaction.type'

describe('TransferService', () => {
  let db: LocalDatabase
  let service: TransactionService
  let transfers: TransferService
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
  const transfer = (id: string, extra: object = {}) =>
    pulled('transfers', {
      id,
      profileId: 'p1',
      fromWalletId: 'bank',
      toWalletId: 'cash',
      amount: 100000,
      occurredOn: '2026-11-02',
      note: '',
      ...extra,
    })
  const values: TransferValues = {
    fromWalletId: 'bank',
    toWalletId: 'cash',
    amount: 100000,
    occurredOn: '2026-11-02',
    note: '  กดตู้ ',
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
    transfers = TestBed.inject(TransferService)
    wallet('cash', { sortOrder: 0 })
    wallet('bank', { sortOrder: 1, initialBalance: 3000000 })
    wallet('save', { sortOrder: 2, excludeFromTotal: true })
    category('food', 'expense')
    category('salary', 'income')
  })

  afterEach(() => db.close())

  it('saves one row for both sides, trims the note, and remembers the wallets (Q7)', () => {
    const id = transfers.save(null, values)
    expect(transfers.byId(id)).toMatchObject({
      profileId: 'p1',
      fromWalletId: 'bank',
      toWalletId: 'cash',
      amount: 100000,
      note: 'กดตู้',
      deletedAt: null,
    })
    expect(listOps(db, 'pending').map((op) => [op.table, op.op])).toEqual([['transfers', 'upsert']])
    expect(transfers.defaultFromId()).toBe('bank')
    expect(transfers.lastToId('bank')).toBe('cash')
    expect(transfers.lastToId('cash')).toBeNull()
    expect(service.pendingIds().has(id)).toBe(true)
  })

  it('forgets a remembered to wallet that is archived, the same, or of another currency', () => {
    wallet('usd', { currencyCode: 'USD' })
    transfers.save(null, { ...values, toWalletId: 'usd' })
    expect(transfers.lastToId('bank')).toBeNull()
    transfers.save(null, values)
    wallet('cash', { sortOrder: 0, isArchived: true })
    expect(transfers.lastToId('bank')).toBeNull()
  })

  it('lists a transfer as two rows among the transactions, the outgoing side first (Q5)', () => {
    transaction('t1', { occurredOn: '2026-11-02', createdAt: 5 })
    transfer('r1', { occurredOn: '2026-11-02', createdAt: 9, note: 'ATM' })
    transfer('r0', { occurredOn: '2026-11-01', toWalletId: 'save' })
    transfer('gone', { deletedAt: 5 })
    transfer('other', { profileId: 'p2' })
    const rows = service.entries(november, ['cash', 'bank'])
    expect(rows.map((row) => (row.kind === 'transfer' ? `${row.id}:${row.side}` : row.id))).toEqual(
      ['r1:out', 'r1:in', 't1', 'r0:out']
    )
    expect(rows[0]).toMatchObject({
      walletId: 'bank',
      walletName: 'bank',
      otherWalletName: 'cash',
      currencyCode: 'THB',
      note: 'ATM',
    })
    expect(rows[1]).toMatchObject({ walletId: 'cash', otherWalletName: 'bank' })
    // One wallet in view: only its side.
    expect(service.entries(november, ['cash']).map((row) => row.id)).toEqual(['r1', 't1'])
    expect(service.entries(november, [])).toEqual([])
  })

  it('leaves transfers out of income and expense, with their net in view as its own line', () => {
    transaction('t1', { amount: 6000 })
    transfer('r1', { amount: 100000 })
    transfer('r2', { amount: 500000, toWalletId: 'save' })
    const line = (ids: string[] | null) => service.summary(november, ids).at(0)
    expect(line(['cash', 'bank'])).toMatchObject({ income: 0, expense: 6000, transfer: -500000 })
    expect(line(['cash'])).toMatchObject({ expense: 6000, net: -6000, transfer: 100000 })
    expect(line(['save'])).toMatchObject({ income: 0, expense: 0, transfer: 500000 })
    expect(line(null)).toMatchObject({ transfer: 0 })
  })

  it('moves balances out of one wallet and into the other; a deleted one counts for nothing', () => {
    const walletService = TestBed.inject(WalletService)
    const balance = (id: string) => walletService.balance(walletService.byId(id)!)
    transfer('r1', { amount: 100000 })
    transfer('r2', { amount: 7, deletedAt: 5 })
    expect(balance('bank')).toBe(2900000)
    expect(balance('cash')).toBe(100000)
    expect(walletService.totals()).toEqual([{ currencyCode: 'THB', minorUnit: 2, amount: 3000000 }])
    expect(walletService.hasTransactions('bank')).toBe(true)
    expect(walletService.hasTransactions('cash')).toBe(true)
    expect(walletService.hasTransactions('save')).toBe(false)
    expect(walletService.canChangeCurrency('cash')).toBe(false)
  })

  it('deletes both sides as one tombstone, and undo brings them back', () => {
    transfer('r1')
    transfers.remove('r1')
    expect(transfers.byId('r1')).toBeNull()
    expect(service.entries(november, ['cash', 'bank'])).toEqual([])
    transfers.restore('r1')
    expect(service.entries(november, ['cash', 'bank'])).toHaveLength(2)
    expect(listOps(db, 'pending').map((op) => op.op)).toEqual(['upsert'])
  })

  it('tombstones live transfers with a side in a wallet deleted elsewhere (rule 8)', () => {
    transfer('r1')
    transfer('r2', { fromWalletId: 'cash', toWalletId: 'save' })
    transfer('r3', { fromWalletId: 'save', toWalletId: 'bank' })
    wallet('cash', { sortOrder: 0, deletedAt: 9 })
    TestBed.tick()
    expect(getRow(db, 'transfers', 'r1')?.['deletedAt']).not.toBeNull()
    expect(getRow(db, 'transfers', 'r2')?.['deletedAt']).not.toBeNull()
    expect(getRow(db, 'transfers', 'r3')?.['deletedAt']).toBeNull()
  })

  it('counts transfers with the profile’s transactions and starts the tabs at the oldest one', () => {
    service.today.set('2026-11-02')
    transaction('t1')
    transfer('r1', { occurredOn: '2026-09-15' })
    expect(TestBed.inject(ProfileService).transactionCount('p1')).toBe(2)
    expect(service.tabs()).toEqual([-2, -1, 0, 'future'])
  })

  it('opens a fix with the refused values', () => {
    transfers.save(null, values)
    const op = listOps(db, 'pending')[0]
    db.exec(`UPDATE outbox SET status = 'rejected' WHERE op_id = ?`, [op.opId])
    transfers.openFix(op.opId)
    expect(transfers.sheet()).toMatchObject({
      mode: 'fix',
      opId: op.opId,
      profileId: 'p1',
      values: { fromWalletId: 'bank', toWalletId: 'cash', amount: 100000 },
    })
  })
})
