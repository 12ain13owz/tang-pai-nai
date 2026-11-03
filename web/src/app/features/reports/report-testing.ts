import { signal } from '@angular/core'
import type { Provider } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { ReportService } from '@/core/report'
import { TransactionService } from '@/core/transaction'

/**
 * The report pages' specs: a test database with one profile, three wallets (one left out of
 * the total), a parent category with a child, an archived one, income, and October 2026 as
 * "เดือนที่แล้ว" (today is 2 Nov 2026). Real services over it, as `transactions-page.spec`.
 */
export const setUpReports = async (providers: Provider[] = []) => {
  const db: LocalDatabase = await openTestDatabase()
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
  const pulled = (table: string, row: object) => {
    putRow(db, table, { ...base, ...row })
    changes.update((n) => n + 1)
  }
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
      createdAt: seq,
      ...extra,
    })

  localStorage.clear()
  putRow(db, 'profiles', {
    ...base,
    id: 'p1',
    name: 'p1',
    icon: 'lucideHouse',
    color: '#15803d',
    sortOrder: 0,
  })
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
      provideRouter([]),
      { provide: OfflineService, useValue: offline },
      { provide: SyncService, useValue: sync },
      {
        provide: NetworkStatusService,
        useValue: { isOnline: signal(true), serverReachable: signal(true) },
      },
      ...providers,
    ],
  })
  TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
  const transactions = TestBed.inject(TransactionService)
  const reports = TestBed.inject(ReportService)
  transactions.today.set('2026-11-02')

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
  wallet('cash', { initialBalance: 1000000 })
  wallet('card', { sortOrder: 1 })
  wallet('save', { sortOrder: 2, excludeFromTotal: true })
  category('food', 'expense')
  category('coffee', 'expense', { parentId: 'food' })
  category('fun', 'expense', { isArchived: true })
  category('salary', 'income')
  transaction('2026-09-30', 'food', 40000)
  transaction('2026-10-01', 'salary', 5000000)
  transaction('2026-10-05', 'food', 100000, { note: 'ข้าวกล่อง' })
  transaction('2026-10-06', 'coffee', 30000, { walletId: 'card' })
  transaction('2026-10-07', 'food', 20000, { excludeFromReport: true })
  transaction('2026-10-09', 'fun', 15000)
  pulled('transfers', {
    id: 'r1',
    profileId: 'p1',
    fromWalletId: 'card',
    toWalletId: 'save',
    amount: 50000,
    occurredOn: '2026-10-08',
    note: '',
  })
  TestBed.tick()
  reports.tab.set(-1)
  return { db, pulled, wallet, transaction, transactions, reports }
}
