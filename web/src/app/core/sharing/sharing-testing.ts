import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import type { Routes } from '@angular/router'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { OfflineService, putRow, SHARED_TABLES, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import type { OwnerSharing, SharedWithMe } from './sharing.type'

/** The API's envelope around `data`. */
export const envelope = (data?: unknown) => ({ message: 'ok', timestamp: '', data })

export const NOTHING: SharedWithMe = { invites: [], shares: [] }
export const NO_ONE: OwnerSharing = { members: [], invites: [], unsharedWalletIds: [] }

/**
 * A test database with profile `p1` and open wallets `home` / `cash` (plus archived `old`), the
 * HTTP testing backend, a signed-in `u1` and network signals to flip (spec helper for sharing).
 */
export const setUpSharing = async (routes: Routes = []) => {
  const db: LocalDatabase = await openTestDatabase()
  const changes = signal(0)
  const base = { createdAt: 1, updatedAt: 1, deletedAt: null, changeSeq: 1, updatedBy: 'u1' }
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
  for (const [id, name, sortOrder, isArchived] of [
    ['home', 'ค่าบ้าน', 0, false],
    ['cash', 'เงินสด', 1, false],
    ['old', 'เก่า', 2, true],
  ] as const) {
    putRow(db, 'wallets', {
      ...base,
      id,
      profileId: 'p1',
      name,
      currencyCode: 'THB',
      initialBalance: 0,
      icon: 'lucideWallet',
      color: '#16a34a',
      excludeFromTotal: false,
      isArchived,
      sortOrder,
      hiddenCategoryIds: [],
    })
  }
  const network = { isOnline: signal(true), serverReachable: signal(true) }
  const sharedActive = signal(false)
  const bump = () => changes.update((n) => n + 1)
  /** What the fake push does with the TEMP outbox (default: every op applied); counts pushes. */
  const sync = {
    pushes: 0,
    answer: (database: LocalDatabase): void => {
      database.exec(`DELETE FROM outbox WHERE status = 'pending'`)
    },
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
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: OfflineService,
        useValue: {
          isOpen: signal(true),
          isTrusted: signal(true),
          meta: signal(null),
          changes,
          sharedActive,
          db: () => db,
          write: <T>(work: (database: LocalDatabase) => T): T => {
            const result = db.transaction(work)
            bump()
            return result
          },
          enterShared: () => {
            db.createShadows(SHARED_TABLES)
            sharedActive.set(true)
            bump()
          },
          fillShared: (work: (database: LocalDatabase) => void) => {
            db.transaction(work)
            bump()
          },
          leaveShared: () => {
            if (sharedActive()) {
              db.dropShadows(SHARED_TABLES)
              sharedActive.set(false)
              bump()
            }
          },
        },
      },
      {
        provide: SyncService,
        useValue: {
          canSync: signal(false),
          isSyncing: signal(false),
          rounds: signal(0),
          lastSyncedAt: signal(1),
          idle: async () => Promise.resolve(),
          pushShared: async () => {
            sync.pushes++
            sync.answer(db)
            bump()
            return Promise.resolve()
          },
        },
      },
      { provide: NetworkStatusService, useValue: network },
    ],
  })
  TestBed.inject(AuthStore).user.set({ id: 'u1' } as AuthUser)
  return { db, network, sync, sharedActive, http: TestBed.inject(HttpTestingController) }
}
