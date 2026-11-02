import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { ComponentFixture } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { TransactionService } from '@/core/transaction'
import { addDays, toDay } from '@/shared/utils'
import { TransactionsPage } from './transactions-page'

describe('TransactionsPage', () => {
  let fixture: ComponentFixture<TransactionsPage>
  let db: LocalDatabase
  let transactions: TransactionService
  const changes = signal(0)
  const today = toDay()
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null, changeSeq: 5, updatedBy: 'u1' }

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
  const element = () => fixture.nativeElement as HTMLElement
  const settle = async () => {
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const put = (table: string, row: object) => {
    putRow(db, table, { ...base, ...row })
    changes.update((n) => n + 1)
  }
  const transaction = (id: string, extra: object = {}) =>
    put('transactions', {
      id,
      profileId: 'p1',
      walletId: 'cash',
      categoryId: 'food',
      amount: 6500,
      occurredOn: today,
      note: '',
      excludeFromReport: false,
      ...extra,
    })
  const rows = () => [...element().querySelectorAll('section ul > li')]

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    put('profiles', { id: 'p1', name: 'Home', icon: 'lucideHouse', color: '#16a34a', sortOrder: 0 })
    putRow(db, 'currencies', {
      code: 'THB',
      minorUnit: 2,
      isActive: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      changeSeq: 1,
    })
    for (const [id, sortOrder] of [
      ['cash', 0],
      ['card', 1],
    ] as const) {
      put('wallets', {
        id,
        profileId: 'p1',
        name: id,
        currencyCode: 'THB',
        initialBalance: 100000,
        icon: 'lucideWallet',
        color: '#16a34a',
        excludeFromTotal: false,
        isArchived: false,
        sortOrder,
      })
    }
    put('categories', {
      id: 'food',
      profileId: 'p1',
      type: 'expense',
      parentId: null,
      name: 'Food',
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 0,
    })
    put('categories', {
      id: 'pay',
      profileId: 'p1',
      type: 'income',
      parentId: null,
      name: 'Pay',
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 0,
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
    transactions = TestBed.inject(TransactionService)
    fixture = TestBed.createComponent(TransactionsPage)
    await settle()
  })

  afterEach(() => {
    fixture.destroy()
    db.close()
  })

  it("groups this month's rows by day with the day's net, the summary and the total", async () => {
    transaction('a', { note: 'ลาเต้เย็น' })
    transaction('b', { amount: 4500000, categoryId: 'pay', walletId: 'card' })
    if (today.slice(8) !== '01') {
      transaction('c', { occurredOn: addDays(today, -1), amount: 1000 })
    }
    transaction('older', { occurredOn: addDays(`${today.slice(0, 8)}01`, -1) })
    await settle()
    const cards = [...element().querySelectorAll('section[aria-label]')].filter((s) =>
      s.querySelector('ul')
    )
    expect(cards[0].textContent).toContain(th.transactions.today)
    expect(cards[0].textContent).toContain('+44,935.00')
    expect(element().textContent).not.toContain('older')
    expect(element().textContent).toContain('฿')
    expect(rows()[0].textContent).toContain('Pay')
  })

  it('shows the wallet badge and only the note on "ทุกกระเป๋า", no badge for one wallet', async () => {
    transaction('a', { note: 'ลาเต้เย็น' })
    await settle()
    const row = rows()[0]
    expect(row.querySelectorAll('app-icon-badge')).toHaveLength(2)
    expect(row.textContent).toContain('ลาเต้เย็น')
    expect(row.querySelector('.sr-only')?.textContent.trim()).toBe('cash')
    transactions.selectWallet('cash')
    await settle()
    expect(rows()[0].querySelectorAll('app-icon-badge')).toHaveLength(1)
  })

  it('draws a long period 100 rows at a time', async () => {
    for (let i = 0; i < 150; i++) {
      transaction(`t${String(i).padStart(3, '0')}`, { createdAt: i })
    }
    transactions.selectUnit('all')
    await settle()
    expect(rows()).toHaveLength(100)
    expect(element().querySelector('div.h-px')).not.toBeNull()
  })

  it('says when the period is empty and offers to add', () => {
    expect(element().textContent).toContain(th.transactions.emptyHeading)
    const add = [...element().querySelectorAll('button')].find(
      (b) => b.textContent.trim() === th.transactions.add
    )
    add?.click()
    expect(transactions.sheet()).toEqual({ mode: 'create' })
  })
})
