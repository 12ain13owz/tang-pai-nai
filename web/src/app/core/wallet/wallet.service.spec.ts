import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, listOps, OfflineService, putRow, queueWrite, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { WalletService } from './wallet.service'
import type { WalletValues } from './wallet.type'

describe('WalletService', () => {
  let db: LocalDatabase
  let service: WalletService
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

  const profile = (id: string, sortOrder: number, deletedAt: number | null = null) =>
    putRow(db, 'profiles', {
      id,
      name: id,
      icon: 'lucideHouse',
      color: '#16a34a',
      sortOrder,
      createdAt: 1,
      updatedAt: 1,
      deletedAt,
      changeSeq: 1,
      updatedBy: 'u1',
    })
  const wallet = (id: string, extra: object = {}) => ({
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
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    changeSeq: 10,
    updatedBy: 'u1',
    ...extra,
  })
  /** A row as a pull would write it, outside the outbox. */
  const pulled = (value: ReturnType<typeof wallet>) => {
    putRow(db, 'wallets', value)
    changes.update((n) => n + 1)
  }
  const names = () => service.wallets().map((item) => item.name)
  const ops = () => listOps(db, 'pending')
  const values: WalletValues = {
    name: ' Card ',
    icon: 'tpnCardChip',
    color: '#dc2626',
    currencyCode: 'THB',
    initialBalance: -1825075,
    excludeFromTotal: false,
    hiddenCategoryIds: [],
  }

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    profile('p1', 0)
    profile('p2', 1)
    // As pulled: THB active (sortOrder 0), JPY not (currency.md seed).
    for (const [code, minorUnit, isActive, sortOrder] of [
      ['THB', 2, true, 0],
      ['JPY', 0, false, 3],
    ] as const) {
      putRow(db, 'currencies', {
        code,
        minorUnit,
        isActive,
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
        { provide: NetworkStatusService, useValue: { isOnline: signal(true) } },
      ],
    })
    TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
    service = TestBed.inject(WalletService)
    changes.update((n) => n + 1)
  })

  afterEach(() => db.close())

  it("lists the current profile's live wallets in order, archived ones apart (rule 10)", () => {
    pulled(wallet('b', { sortOrder: 1 }))
    pulled(wallet('a', { sortOrder: 1, createdAt: 500 }))
    pulled(wallet('c', { sortOrder: 0, isArchived: true }))
    pulled(wallet('gone', { deletedAt: 5 }))
    pulled(wallet('other', { profileId: 'p2' }))
    expect(names()).toEqual(['c', 'a', 'b'])
    expect(service.openWallets().map((item) => item.id)).toEqual(['a', 'b'])
    expect(service.archived().map((item) => item.id)).toEqual(['c'])
    expect(service.hasWallet()).toBe(true)
  })

  it('has no wallet in a profile that has none, so the first-wallet step shows (rule 12)', () => {
    pulled(wallet('other', { profileId: 'p2' }))
    expect(service.hasWallet()).toBe(false)
  })

  it('totals open wallets that count, one line per currency (rule 7)', () => {
    db.exec(`UPDATE currencies SET is_active = 1 WHERE code = 'JPY'`)
    pulled(wallet('cash', { initialBalance: 150050 }))
    pulled(wallet('card', { initialBalance: -1825075 }))
    pulled(wallet('gold', { initialBalance: 999, excludeFromTotal: true }))
    pulled(wallet('old', { initialBalance: 999, isArchived: true }))
    pulled(wallet('yen', { initialBalance: 15000, currencyCode: 'JPY' }))
    expect(service.totals()).toEqual([
      { currencyCode: 'THB', minorUnit: 2, amount: -1675025 },
      { currencyCode: 'JPY', minorUnit: 0, amount: 15000 },
    ])
  })

  it('reads currency digits and the default currency from the pulled currencies', () => {
    expect(service.minorUnit('JPY')).toBe(0)
    expect(service.minorUnit('ZZZ')).toBe(2)
    expect(service.defaultCurrency()).toBe('THB')
    expect(service.activeCurrencies().map((currency) => currency.code)).toEqual(['THB'])
  })

  it('creates a wallet last in the current profile and queues it', () => {
    pulled(wallet('a', { sortOrder: 4 }))
    const id = service.save(null, values)
    expect(service.byId(id)).toMatchObject({
      profileId: 'p1',
      name: 'Card',
      initialBalance: -1825075,
      isArchived: false,
      sortOrder: 5,
    })
    expect(ops()).toMatchObject([{ table: 'wallets', rowId: id, op: 'upsert', baseSeq: null }])
  })

  it('edits a wallet in place: its profile, archive flag, order and baseSeq stay', () => {
    pulled(wallet('a', { profileId: 'p2', sortOrder: 3, isArchived: true }))
    service.save('a', values, null, 'p1')
    expect(service.byId('a')).toMatchObject({
      profileId: 'p2',
      name: 'Card',
      isArchived: true,
      sortOrder: 3,
    })
    expect(ops()[0]).toMatchObject({ baseSeq: 10 })
  })

  it('saves hiddenCategoryIds cleaned, and the outbox row carries the array (category rule 13)', () => {
    putRow(db, 'categories', {
      id: 'gone',
      profileId: 'p1',
      type: 'expense',
      parentId: null,
      name: 'Gone',
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: 5,
      changeSeq: 1,
      updatedBy: 'u1',
    })
    const id = service.save(null, { ...values, hiddenCategoryIds: ['c1', 'gone', 'c1', 'c2'] })
    expect(service.byId(id)?.hiddenCategoryIds).toEqual(['c1', 'c2'])
    expect(ops()[0].row['hiddenCategoryIds']).toEqual(['c1', 'c2'])
    // A pulled row from before 7.2 has none.
    pulled(wallet('old'))
    expect(service.byId('old')?.hiddenCategoryIds).toEqual([])
  })

  it("lists any profile's open wallets (the category form's wallets)", () => {
    pulled(wallet('a'))
    pulled(wallet('b', { profileId: 'p2' }))
    pulled(wallet('c', { profileId: 'p2', isArchived: true }))
    expect(service.openOf('p1').map((item) => item.id)).toEqual(['a'])
    expect(service.openOf('p2').map((item) => item.id)).toEqual(['b'])
  })

  it('saves a fix into the given profile and drops the rejected op', () => {
    db.transaction((tx) => queueWrite(tx, 'wallets', 'upsert', wallet('w9', { name: 'Cash' })))
    db.exec(`UPDATE outbox SET status = 'rejected', code = 'CONFLICT'`)
    db.exec(`DELETE FROM wallets`)
    const opId = listOps(db, 'rejected')[0].opId
    service.save('w9', { ...values, name: 'Cash 2' }, opId, 'p2')
    expect(listOps(db, 'rejected')).toHaveLength(0)
    expect(service.byId('w9')).toMatchObject({ profileId: 'p2', name: 'Cash 2' })
  })

  it("opens a fix with the refused values, in the current profile when the wallet's is gone", () => {
    profile('dead', 2, 5)
    db.transaction((tx) =>
      queueWrite(tx, 'wallets', 'upsert', wallet('w9', { profileId: 'dead', name: 'Cash' }))
    )
    db.exec(`UPDATE outbox SET status = 'rejected', code = 'CONFLICT'`)
    const opId = listOps(db, 'rejected')[0].opId
    service.openFix(opId)
    expect(service.sheet()).toEqual({
      mode: 'fix',
      opId,
      id: 'w9',
      profileId: 'p1',
      values: {
        name: 'Cash',
        icon: 'lucideWallet',
        color: '#16a34a',
        currencyCode: 'THB',
        initialBalance: 0,
        excludeFromTotal: false,
        hiddenCategoryIds: [],
      },
    })
    service.openFix('nope')
    expect(service.sheet()).toMatchObject({ opId })
  })

  it("knows a taken name among the profile's open wallets only (rule 3)", () => {
    pulled(wallet('a', { name: 'Cash' }))
    pulled(wallet('b', { name: 'Old', isArchived: true }))
    pulled(wallet('c', { name: 'Shop', profileId: 'p2' }))
    expect(service.nameTaken(' CASH ', null)).toBe(true)
    expect(service.nameTaken('Cash', 'a')).toBe(false)
    expect(service.nameTaken('Old', null)).toBe(false)
    expect(service.nameTaken('Shop', null)).toBe(false)
    expect(service.nameTaken('Shop', null, 'p2')).toBe(true)
  })

  it('archives and brings back, refusing a taken name or a 21st open wallet (rules 3, 6)', () => {
    pulled(wallet('a', { name: 'Cash' }))
    expect(service.setArchived('a', true)).toBeNull()
    expect(service.byId('a')?.isArchived).toBe(true)
    pulled(wallet('b', { name: 'cash' }))
    expect(service.setArchived('a', false)).toBe('nameTaken')
    db.exec(`DELETE FROM wallets WHERE id = 'b'`)
    for (let i = 0; i < 20; i++) {
      pulled(wallet(`w${i}`))
    }
    expect(service.atLimit()).toBe(true)
    expect(service.setArchived('a', false)).toBe('limit')
    expect(service.byId('a')?.isArchived).toBe(true)
  })

  it('deletes a wallet as a tombstone', () => {
    pulled(wallet('a'))
    service.remove('a')
    expect(service.byId('a')).toBeNull()
    expect(service.hasWallet()).toBe(false)
    expect(ops()).toMatchObject([{ rowId: 'a', op: 'delete', baseSeq: 10 }])
  })

  it('moves an open wallet, keeps archived ones after, and writes only what changed', () => {
    pulled(wallet('a', { sortOrder: 0 }))
    pulled(wallet('b', { sortOrder: 1 }))
    pulled(wallet('c', { sortOrder: 2 }))
    pulled(wallet('z', { sortOrder: 3, isArchived: true }))
    service.moveTo('c', 0)
    expect(service.openWallets().map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(ops().map((op) => op.rowId)).toEqual(['c', 'a', 'b'])
    service.moveTo('c', 9)
    service.moveTo('nope', 0)
    expect(ops()).toHaveLength(3)
  })
})
