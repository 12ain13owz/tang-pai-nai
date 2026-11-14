import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { ProfileService } from '@/core/profile'
import { TransactionService } from '@/core/transaction'
import { ReportService } from './report.service'

describe('ReportService', () => {
  let db: LocalDatabase
  let service: ReportService
  let transactions: TransactionService
  const changes = signal(0)

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
    canSync: signal(false),
    isSyncing: signal(false),
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
      color: '#15803d',
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
  let seq = 0
  const transaction = (occurredOn: string, categoryId: string, amount: number, extra = {}) =>
    pulled('transactions', {
      id: `t${++seq}`,
      profileId: 'p1',
      walletId: 'cash',
      categoryId,
      amount,
      occurredOn,
      note: '',
      excludeFromReport: false,
      ...extra,
    })
  const transfer = (occurredOn: string, from: string, to: string, amount: number) =>
    pulled('transfers', {
      id: `r${++seq}`,
      profileId: 'p1',
      fromWalletId: from,
      toWalletId: to,
      amount,
      occurredOn,
      note: '',
    })

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    for (const id of ['p1', 'p2']) {
      putRow(db, 'profiles', {
        ...base,
        id,
        name: id,
        icon: 'lucideHouse',
        color: '#15803d',
        sortOrder: id === 'p1' ? 0 : 1,
      })
    }
    for (const [code, sortOrder] of [
      ['THB', 0],
      ['USD', 1],
    ] as const) {
      putRow(db, 'currencies', {
        code,
        minorUnit: 2,
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
    service = TestBed.inject(ReportService)
    transactions = TestBed.inject(TransactionService)
    transactions.today.set('2026-11-02')
    wallet('cash', { initialBalance: 10000 })
    wallet('card', { sortOrder: 1 })
    wallet('save', { sortOrder: 2, excludeFromTotal: true })
    category('food', 'expense')
    category('coffee', 'expense', { parentId: 'food', color: '#a16207' })
    category('fun', 'expense', { isArchived: true })
    category('salary', 'income')
    // October, the month before today's.
    transaction('2026-09-30', 'food', 400)
    transaction('2026-10-01', 'salary', 50000)
    transaction('2026-10-05', 'food', 1000)
    transaction('2026-10-06', 'coffee', 300, { walletId: 'card' })
    transaction('2026-10-07', 'food', 200, { excludeFromReport: true })
    transaction('2026-10-09', 'fun', 150)
    transfer('2026-10-08', 'card', 'save', 500)
    transfer('2026-10-10', 'cash', 'card', 100)
    TestBed.tick()
    service.tab.set(-1)
  })

  afterEach(() => db.close())

  it('sums a period like the Transactions tab and adds the balances, the left-out rows and the day average (rules 1, 9–11)', () => {
    expect(service.range()).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(service.summaries()).toEqual([
      {
        currencyCode: 'THB',
        minorUnit: 2,
        income: 50000,
        expense: 1450,
        net: 48550,
        // To the savings wallet, left out of "ทุกกระเป๋า"; cash → card cancels out.
        transfer: -500,
        debt: 0,
        excludedCount: 1,
        excluded: -200,
        // 10,000 initial − 400 on 30 Sep.
        start: 9600,
        // start + net − the left-out row − the transfer out of view.
        end: 9600 + 48550 - 200 - 500,
        // 1,450 / 31 days, rounded half up to the minor unit.
        perDay: 47,
      },
    ])
    expect(service.hasData()).toBe(true)
  })

  it('averages the current period over the days up to today (rule 10)', () => {
    transaction('2026-11-01', 'food', 1001)
    service.tab.set(0)
    expect(service.summaries()[0]).toMatchObject({ expense: 1001, perDay: 501 })
  })

  it('folds sub-categories into their top-level category, largest first, archived ones too (rules 4–6)', () => {
    expect(service.breakdown()).toEqual([
      {
        id: 'food',
        name: 'food',
        icon: 'lucideShapes',
        color: '#475569',
        type: 'expense',
        amount: 1300,
        count: 2,
        isArchived: false,
        childCount: 1,
        direct: false,
      },
      expect.objectContaining({ id: 'fun', amount: 150, isArchived: true }),
    ])
    service.type.set('income')
    expect(service.breakdown().map((share) => [share.id, share.amount])).toEqual([
      ['salary', 50000],
    ])
  })

  it('splits a parent into its children and the money on itself as "ไม่ระบุหมวดย่อย" (Q4)', () => {
    const shares = service.byCategory(
      service.range(),
      service.walletIds(),
      'expense',
      'THB',
      'food'
    )
    expect(shares.map((share) => [share.id, share.amount, share.direct])).toEqual([
      ['food', 1000, true],
      ['coffee', 300, false],
    ])
    expect(
      service.categoryTotal(service.range(), service.walletIds(), ['food', 'coffee'], 'THB')
    ).toBe(1300)
    expect(
      service.categoryTotal(service.previousRange(), service.walletIds(), ['food', 'coffee'], 'THB')
    ).toBe(400)
  })

  it('splits the chosen period into its own months, none inside one month (rule 7)', () => {
    expect(service.trend()).toBeNull()
    service.selectUnit('year')
    const year = service.trend()
    expect(year?.step).toBe('month')
    expect(year?.points).toHaveLength(12)
    expect(year?.points.at(0)).toMatchObject({ from: '2026-01-01', to: '2026-01-31' })
    expect(year?.points.at(8)).toMatchObject({ from: '2026-09-01', income: 0, expense: 400 })
    expect(year?.points.at(9)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      income: 50000,
      expense: 1450,
    })
    service.selectUnit('quarter')
    expect(service.trend()?.points.map((point) => point.from)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ])
    service.selectCustom({ from: '2026-10-01', to: '2026-10-15' })
    expect(service.trend()).toBeNull()
    // The first and last part are cut to the range.
    service.selectCustom({ from: '2026-09-15', to: '2026-10-05' })
    expect(service.trend()).toEqual({
      step: 'month',
      points: [
        { from: '2026-09-15', to: '2026-09-30', income: 0, expense: 400 },
        { from: '2026-10-01', to: '2026-10-05', income: 50000, expense: 1000 },
      ],
    })
    service.selectCustom({ from: '2025-02-10', to: '2026-10-31' })
    expect(service.trend()?.step).toBe('quarter')
    expect(service.trend()?.points.at(0)?.from).toBe('2025-02-10')
    expect(service.trend()?.points).toHaveLength(8)
    service.selectCustom({ from: '2022-06-01', to: '2026-10-31' })
    expect(service.trend()?.step).toBe('year')
    expect(service.trend()?.points.map((point) => point.from)).toEqual([
      '2022-06-01',
      '2023-01-01',
      '2024-01-01',
      '2025-01-01',
      '2026-01-01',
    ])
  })

  it('follows the Transactions tab wallet, an excluded one too (Q3)', () => {
    transactions.selectWallet('save')
    expect(service.summaries()).toEqual([
      expect.objectContaining({ income: 0, expense: 0, transfer: 500, start: 0, end: 500 }),
    ])
    // Only transfers moved the balance: still worth a card, not the empty state.
    expect(service.hasData()).toBe(true)
    service.tab.set(-3)
    expect(service.hasData()).toBe(false)
  })

  it('shows one currency at a time in the breakdown and trend, the first by default (Q6)', () => {
    wallet('usd', { currencyCode: 'USD', sortOrder: 3 })
    transaction('2026-10-11', 'food', 700, { walletId: 'usd' })
    expect(service.currencies()).toEqual(['THB', 'USD'])
    expect(service.currencyCode()).toBe('THB')
    service.chosenCurrency.set('USD')
    expect(service.breakdown().map((share) => share.amount)).toEqual([700])
    service.selectUnit('year')
    expect(service.trend()?.points.at(9)).toMatchObject({ expense: 700, income: 0 })
  })

  it('has no "อนาคต" tab, and the period before a custom range is as long as it', () => {
    expect(service.tabs()).toEqual([-2, -1, 0])
    service.selectCustom({ from: '2026-10-11', to: '2026-10-20' })
    expect(service.range()).toEqual({ from: '2026-10-11', to: '2026-10-20' })
    expect(service.previousRange()).toEqual({ from: '2026-10-01', to: '2026-10-10' })
  })

  it('remembers its unit per profile, apart from the Transactions tab, and never a custom range', () => {
    service.selectUnit('year')
    expect(localStorage.getItem('tpn-profile:report:unit:p1')).toBe('year')
    expect(transactions.unit()).toBe('month')
    TestBed.inject(ProfileService).select('p2')
    TestBed.tick()
    expect(service.unit()).toBe('month')
    TestBed.inject(ProfileService).select('p1')
    TestBed.tick()
    expect(service.unit()).toBe('year')
    expect(service.tab()).toBe(0)
    service.selectCustom({ from: '2026-10-11', to: '2026-10-20' })
    expect(localStorage.getItem('tpn-profile:report:unit:p1')).toBe('year')
  })

  it('keeps the chosen period when a write or a pull reads the profile again', () => {
    pulled('profiles', {
      id: 'p1',
      name: 'renamed',
      icon: 'lucideHouse',
      color: '#15803d',
      sortOrder: 0,
    })
    TestBed.tick()
    expect(service.tab()).toBe(-1)
  })
})
