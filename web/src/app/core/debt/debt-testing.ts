import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import type { Routes } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { TransactionService } from '@/core/transaction'

/**
 * A test database with profile `p1`, wallets `cash` / `bank`, categories `shop` / `interest`
 * (expense) and `gift` (income), and real services (spec helper, like `report-testing.ts`).
 * `debt` and `entry` put pulled rows; `changes` re-runs the reads.
 */
export const setUpDebts = async (today = '2026-11-09', routes: Routes = []) => {
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
    rounds: signal(0),
    lastSyncedAt: signal<number | null>(1),
    rejectedOp: (opId: string) => findOp(db, opId),
  }
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null, changeSeq: 1, updatedBy: 'u1' }
  const pulled = (table: string, row: object) => {
    putRow(db, table, { ...base, ...row })
    changes.update((n) => n + 1)
  }
  putRow(db, 'profiles', {
    ...base,
    id: 'p1',
    name: 'ครอบครัว',
    icon: 'lucideHouse',
    color: '#16a34a',
    sortOrder: 0,
  })
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
      provideRouter(routes),
      { provide: OfflineService, useValue: offline },
      { provide: SyncService, useValue: sync },
      {
        provide: NetworkStatusService,
        useValue: { isOnline: signal(true), serverReachable: signal(true) },
      },
    ],
  })
  TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
  TestBed.inject(TransactionService).today.set(today)
  for (const [id, initialBalance, sortOrder] of [
    ['cash', 500000, 0],
    ['bank', 6000000, 1],
  ] as const) {
    pulled('wallets', {
      id,
      profileId: 'p1',
      name: id,
      currencyCode: 'THB',
      initialBalance,
      icon: 'lucideWallet',
      color: '#16a34a',
      excludeFromTotal: false,
      isArchived: false,
      sortOrder,
    })
  }
  for (const [id, type] of [
    ['shop', 'expense'],
    ['interest', 'expense'],
    ['gift', 'income'],
  ] as const) {
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
    })
  }
  const debt = (id: string, extra: object = {}) =>
    pulled('debts', {
      id,
      profileId: 'p1',
      direction: 'borrowed',
      person: id,
      note: '',
      currencyCode: 'THB',
      countAs: 'spent',
      categoryId: null,
      dueOn: null,
      ...extra,
    })
  let n = 0
  const entry = (debtId: string, kind: string, amount: number, extra: object = {}) =>
    pulled('debt_entries', {
      id: `${debtId}-e${++n}`,
      profileId: 'p1',
      debtId,
      kind,
      walletId: 'cash',
      amount,
      occurredOn: '2026-10-01',
      note: '',
      recurringId: null,
      ...extra,
    })
  const transaction = (id: string, extra: object = {}) =>
    pulled('transactions', {
      id,
      profileId: 'p1',
      walletId: 'bank',
      categoryId: 'shop',
      amount: 300000,
      occurredOn: '2026-10-05',
      note: '',
      excludeFromReport: false,
      recurringId: null,
      debtId: null,
      ...extra,
    })
  return { db, changes, sync, pulled, debt, entry, transaction }
}
