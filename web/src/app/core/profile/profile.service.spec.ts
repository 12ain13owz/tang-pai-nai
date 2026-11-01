import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { TranslocoTestingModule } from '@jsverse/transloco'
import { toastState } from '@spartan-ng/brain/sonner'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import th from '@/core/i18n/th.json'
import { NetworkStatusService } from '@/core/network'
import { findOp, listOps, OfflineService, putRow, SyncService } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { ProfileService } from './profile.service'

describe('ProfileService', () => {
  let db: LocalDatabase
  let service: ProfileService
  const changes = signal(0)
  const trusted = signal(true)
  const online = signal(true)
  const canSync = signal(false)
  const isSyncing = signal(false)
  const lastSyncedAt = signal<number | null>(null)
  const user = signal<AuthUser | null>(null)

  const offline = {
    isOpen: signal(true),
    isTrusted: trusted,
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
    lastSyncedAt,
    rejectedOp: (opId: string) => findOp(db, opId),
  }

  const row = (id: string, name: string, sortOrder: number, extra: object = {}) => ({
    id,
    name,
    icon: 'lucideHouse',
    color: '#16a34a',
    sortOrder,
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    changeSeq: 10,
    updatedBy: 'u1',
    ...extra,
  })
  /** A row as a pull would write it, outside the outbox. */
  const pulled = (value: ReturnType<typeof row>) => {
    putRow(db, 'profiles', value)
    changes.update((n) => n + 1)
  }
  const names = () => service.profiles().map((profile) => profile.name)
  const ops = () => listOps(db, 'pending')
  const values = { name: ' Shop ', icon: 'lucideStore', color: '#ea580c' }

  const start = () => {
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
        { provide: NetworkStatusService, useValue: { isOnline: online } },
      ],
    })
    TestBed.inject(AuthStore).user.set(user())
    service = TestBed.inject(ProfileService)
    TestBed.tick()
  }

  beforeEach(async () => {
    db = await openTestDatabase()
    localStorage.clear()
    sessionStorage.clear()
    trusted.set(true)
    online.set(true)
    canSync.set(false)
    isSyncing.set(false)
    lastSyncedAt.set(null)
    user.set({ id: 'u1' } as AuthUser)
    toastState.toasts().forEach((toast) => toastState.dismiss(toast.id))
  })

  afterEach(() => db.close())

  it('lists live profiles by sortOrder, then createdAt, without tombstones', () => {
    start()
    pulled(row('p1', 'B', 1))
    pulled(row('p2', 'A', 0, { createdAt: 2000 }))
    pulled(row('p3', 'C', 0))
    pulled(row('p4', 'Gone', 0, { deletedAt: 5 }))
    expect(names()).toEqual(['C', 'A', 'B'])
  })

  it('shows the profile stored for this user on this device, else the first (rule 6)', () => {
    localStorage.setItem('tpn-profile:u1', 'p2')
    start()
    pulled(row('p1', 'One', 0))
    pulled(row('p2', 'Two', 1))
    expect(service.current()?.id).toBe('p2')
    service.select('nope')
    expect(service.current()?.id).toBe('p1')
  })

  it('creates a profile last in the order, queues it and makes it current', () => {
    start()
    pulled(row('p1', 'Home', 4))
    const id = service.save(null, values)
    expect(service.byId(id)).toMatchObject({ name: 'Shop', sortOrder: 5, deletedAt: null })
    expect(ops().map((op) => [op.rowId, op.op, op.baseSeq])).toEqual([[id, 'upsert', null]])
    expect(service.current()?.id).toBe(id)
    expect(localStorage.getItem('tpn-profile:u1')).toBe(id)
  })

  it('keeps the current profile in sessionStorage on an untrusted device', () => {
    trusted.set(false)
    start()
    const id = service.save(null, values)
    expect(sessionStorage.getItem('tpn-profile:u1')).toBe(id)
    expect(localStorage.getItem('tpn-profile:u1')).toBeNull()
  })

  it('edits a profile in place: same order, same current, baseSeq from the row', () => {
    start()
    pulled(row('p1', 'Home', 0))
    pulled(row('p2', 'Work', 1))
    service.save('p2', values)
    expect(service.byId('p2')).toMatchObject({ name: 'Shop', sortOrder: 1, icon: 'lucideStore' })
    expect(service.current()?.id).toBe('p1')
    expect(ops()[0]).toMatchObject({ rowId: 'p2', baseSeq: 10 })
  })

  it('saves a fix as a new row, drops the rejected op and makes it current', () => {
    start()
    pulled(row('p1', 'Home', 0))
    db.exec(
      `INSERT INTO outbox (op_id, tbl, row_id, op, row, base_seq, created_at, status, code)
       VALUES ('o1', 'profiles', 'p9', 'upsert', ?, NULL, 1, 'rejected', 'CONFLICT')`,
      [JSON.stringify({ id: 'p9', name: 'Home', icon: 'lucideStar', color: '#2563eb' })]
    )
    service.openFix('o1')
    expect(service.sheet()).toEqual({
      mode: 'fix',
      opId: 'o1',
      id: 'p9',
      values: { name: 'Home', icon: 'lucideStar', color: '#2563eb' },
    })
    service.save('p9', { ...values, name: 'Home 2' }, 'o1')
    expect(findOp(db, 'o1')).toBeNull()
    expect(service.current()?.name).toBe('Home 2')
  })

  it('deletes a profile as a tombstone and moves to the first one, quietly (rule 8)', () => {
    localStorage.setItem('tpn-profile:u1', 'p2')
    start()
    pulled(row('p1', 'Home', 0))
    pulled(row('p2', 'Work', 1))
    service.remove('p2')
    TestBed.tick()
    expect(names()).toEqual(['Home'])
    expect(ops()[0]).toMatchObject({ rowId: 'p2', op: 'delete' })
    expect(service.current()?.id).toBe('p1')
    expect(localStorage.getItem('tpn-profile:u1')).toBe('p1')
    expect(toastState.toasts()).toHaveLength(0)
  })

  it('says so when the current profile was deleted on another device (rule 9)', () => {
    localStorage.setItem('tpn-profile:u1', 'p2')
    start()
    pulled(row('p1', 'Home', 0))
    pulled(row('p2', 'Work', 1))
    TestBed.tick()
    pulled(row('p2', 'Work', 1, { deletedAt: 5, changeSeq: 11 }))
    TestBed.tick()
    expect(service.current()?.id).toBe('p1')
    expect(toastState.toasts().map((toast) => toast.title)).toEqual([
      'โปรไฟล์ “Work” ถูกลบจากเครื่องอื่น',
    ])
  })

  it('moves a profile and rewrites sortOrder only where it changed (rule 7)', () => {
    start()
    pulled(row('a', 'A', 0))
    pulled(row('b', 'B', 1))
    pulled(row('c', 'C', 2))
    pulled(row('d', 'D', 3))
    service.moveTo('c', 0)
    expect(names()).toEqual(['C', 'A', 'B', 'D'])
    expect(ops().map((op) => op.rowId)).toEqual(['c', 'a', 'b'])
    service.moveTo('c', 9)
    service.moveTo('c', 0)
    expect(ops()).toHaveLength(3)
  })

  it('knows a taken name in any case, except the profile itself', () => {
    start()
    pulled(row('p1', 'Home', 0))
    expect(service.nameTaken(' home ', null)).toBe(true)
    expect(service.nameTaken('HOME', 'p1')).toBe(false)
    expect(service.nameTaken('Shop', null)).toBe(false)
  })

  it('waits for the first pull of a new device before it is ready', () => {
    canSync.set(true)
    start()
    expect(service.ready()).toBe(false)
    isSyncing.set(true)
    TestBed.tick()
    isSyncing.set(false)
    TestBed.tick()
    expect(service.ready()).toBe(true)
  })

  it('is ready at once offline, or after an earlier sync', () => {
    start()
    expect(service.ready()).toBe(true)
    canSync.set(true)
    lastSyncedAt.set(1)
    expect(service.ready()).toBe(true)
  })

  it('writes on an untrusted device only while online (rule 10)', () => {
    trusted.set(false)
    start()
    expect(service.canWrite()).toBe(true)
    online.set(false)
    expect(service.canWrite()).toBe(false)
  })

  describe('with wallets (wallet rule 11)', () => {
    const wallet = (id: string, profileId: string, extra: object = {}) => {
      putRow(db, 'wallets', {
        id,
        profileId,
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
        changeSeq: 20,
        updatedBy: 'u1',
        ...extra,
      })
      changes.update((n) => n + 1)
    }
    const liveWallets = () =>
      db
        .selectObjects('SELECT id FROM wallets WHERE deleted_at IS NULL ORDER BY id')
        .map((r) => r['id'])

    it('counts the live wallets a delete takes with it, archived ones too', () => {
      start()
      pulled(row('p1', 'Home', 0))
      wallet('w1', 'p1')
      wallet('w2', 'p1', { isArchived: true })
      wallet('w3', 'p1', { deletedAt: 5 })
      wallet('w4', 'p2')
      expect(service.walletCount('p1')).toBe(2)
    })

    it("tombstones the profile's wallets in the same write as the profile", () => {
      start()
      pulled(row('p1', 'Home', 0))
      pulled(row('p2', 'Work', 1))
      wallet('w1', 'p1')
      wallet('w2', 'p2')
      service.remove('p1')
      TestBed.tick()
      expect(liveWallets()).toEqual(['w2'])
      expect(ops().map((op) => `${op.table}:${op.rowId}:${op.op}`)).toEqual([
        'wallets:w1:delete',
        'profiles:p1:delete',
      ])
    })

    it('tombstones live wallets of a profile deleted on another device', () => {
      start()
      pulled(row('p1', 'Home', 0))
      pulled(row('p2', 'Work', 1))
      wallet('w1', 'p2')
      wallet('w2', 'p1')
      TestBed.tick()
      expect(ops()).toHaveLength(0)
      pulled(row('p2', 'Work', 1, { deletedAt: 5, changeSeq: 11 }))
      TestBed.tick()
      expect(liveWallets()).toEqual(['w2'])
      expect(ops()).toMatchObject([{ table: 'wallets', rowId: 'w1', op: 'delete', baseSeq: 20 }])
    })

    it('leaves them for later on an untrusted device that is offline', () => {
      trusted.set(false)
      online.set(false)
      start()
      pulled(row('p2', 'Work', 1, { deletedAt: 5 }))
      wallet('w1', 'p2')
      TestBed.tick()
      expect(liveWallets()).toEqual(['w1'])
      online.set(true)
      TestBed.tick()
      expect(liveWallets()).toEqual([])
    })
  })
})
