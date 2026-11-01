import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import type { TestRequest } from '@angular/common/http/testing'
import { signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { AuthStore } from '@/core/auth'
import type { AuthUser } from '@/core/auth'
import { NetworkStatusService } from '@/core/network'
import { OfflineService } from './offline.service'
import { countOps, findPending, listOps, queueWrite } from './outbox'
import { getRow, putRow } from './sync-tables'
import { SyncService } from './sync.service'
import { openTestDatabase } from './testing-db'
import type { LocalDatabase } from './local-database'

const user: AuthUser = {
  id: 'u1',
  email: 'u1@example.com',
  displayName: 'mom',
  avatarUrl: null,
  timezone: 'Asia/Bangkok',
  hasPassword: false,
  phone: null,
  identities: [],
}

/** A profile row: any pushable table behaves the same in the outbox and sync. */
const profile = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  icon: 'lucideHouse',
  color: '#16a34a',
  sortOrder: 0,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  ...extra,
})

const envelope = (data: unknown) => ({ message: 'ok', timestamp: '', data })

interface PushedOp {
  opId: string
  table: string
  op: string
  row: Record<string, unknown> & { id: string }
  baseSeq: number | null
}

/** The open database and the bits of `OfflineService` sync uses. */
const fakeOffline = (db: LocalDatabase) => {
  const changes = signal(0)
  return {
    isOpen: signal(true),
    isTrusted: signal(true),
    changes,
    db: () => db,
    write: <T>(work: (database: LocalDatabase) => T): T => {
      const result = db.transaction(work)
      changes.update((n) => n + 1)
      return result
    },
    syncMeta: (key: string) => {
      const value = db.selectValue('SELECT value FROM sync_meta WHERE key = ?', [key])
      return typeof value === 'string' ? value : null
    },
  }
}

describe('SyncService', () => {
  let db: LocalDatabase
  let offline: ReturnType<typeof fakeOffline>
  let http: HttpTestingController
  let service: SyncService
  let pullData: (since: number) => unknown

  /** Answers every request until `work` settles: push from `pushAnswer`, pull from `pullData`. */
  const drive = async (
    work: Promise<unknown>,
    pushAnswer: (ops: PushedOp[], req: TestRequest) => void = (ops, req) =>
      req.flush(
        envelope({
          results: ops.map((op, i) => ({
            opId: op.opId,
            status: 'applied',
            row: { ...op.row, changeSeq: 20 + i, updatedBy: 'u1' },
            changeSeq: 20 + i,
          })),
        })
      )
  ) => {
    const state = { done: false }
    void work.finally(() => {
      state.done = true
    })
    for (let i = 0; i < 200 && !state.done; i++) {
      for (const req of http.match(() => true)) {
        if (req.request.method === 'POST') {
          pushAnswer((req.request.body as { ops: PushedOp[] }).ops, req)
        } else {
          const since = Number(new URL(req.request.url, 'http://x').searchParams.get('since'))
          req.flush(envelope(pullData(since)))
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await work
  }

  const emptyPull = (since: number) => ({
    changes: [],
    notices: [],
    cursor: since,
    hasMore: false,
    tables: ['currencies', 'profiles'],
  })

  beforeEach(async () => {
    db = await openTestDatabase()
    db.exec(`INSERT INTO sync_meta (key, value) VALUES ('deviceId', 'd1'), ('userId', 'u1')`)
    offline = fakeOffline(db)
    pullData = emptyPull
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OfflineService, useValue: offline },
      ],
    })
    TestBed.inject(AuthStore).setSession({ accessToken: 't', expiresIn: 600, user })
    http = TestBed.inject(HttpTestingController)
    service = TestBed.inject(SyncService)
    // A round the constructor's effect may have started.
    await drive(service.sync())
  })

  afterEach(() => db.close())

  it('pushes queued ops, keeps the server rows, then pulls and stores the cursor', async () => {
    offline.write((tx) => queueWrite(tx, 'profiles', 'upsert', profile('p1', 'Coffee')))
    expect(service.status()).toBe('pending')
    pullData = (since) => ({
      changes: [
        {
          table: 'currencies',
          row: {
            id: 'THB',
            code: 'THB',
            minorUnit: 2,
            isActive: true,
            sortOrder: 0,
            createdAt: 1,
            updatedAt: 1,
            changeSeq: 1,
          },
        },
      ],
      notices: [],
      cursor: Math.max(since, 21),
      hasMore: false,
      tables: ['currencies', 'profiles'],
    })
    const pushed: PushedOp[] = []
    await drive(service.sync(), (ops, req) => {
      pushed.push(...ops)
      req.flush(
        envelope({
          results: ops.map((op) => ({
            opId: op.opId,
            status: 'applied',
            row: { ...op.row, changeSeq: 20, updatedBy: 'u1' },
            changeSeq: 20,
          })),
        })
      )
    })
    expect(pushed).toMatchObject([
      { table: 'profiles', op: 'upsert', baseSeq: null, row: { name: 'Coffee' } },
    ])
    expect(countOps(db, 'pending')).toBe(0)
    expect(getRow(db, 'profiles', 'p1')).toMatchObject({ changeSeq: 20, updatedBy: 'u1' })
    expect(getRow(db, 'currencies', 'THB')).toMatchObject({ isActive: true })
    expect(offline.syncMeta('cursor')).toBe('21')
    expect(service.serverTables()).toEqual(['currencies', 'profiles'])
    expect(service.lastSyncedAt()).not.toBeNull()
    expect(service.status()).toBe('synced')
  })

  it('pulls page after page while the server says there is more', async () => {
    const asked: number[] = []
    pullData = (since) => {
      asked.push(since)
      return { ...emptyPull(since), cursor: since + 10, hasMore: since < 20 }
    }
    offline.write((tx) => tx.exec(`INSERT OR REPLACE INTO sync_meta VALUES ('cursor', '0')`))
    await drive(service.sync())
    expect(asked).toEqual([0, 10, 20])
    expect(offline.syncMeta('cursor')).toBe('30')
  })

  it('stores the winner and a notice when an op was overridden', async () => {
    offline.write((tx) =>
      queueWrite(tx, 'profiles', 'upsert', profile('p1', 'Tea', { changeSeq: 5 }))
    )
    const notice = {
      id: 'h1',
      table: 'profiles',
      rowId: 'p1',
      previous: profile('p1', 'Tea'),
      createdAt: 9,
    }
    await drive(service.sync(), (ops, req) =>
      req.flush(
        envelope({
          results: [
            {
              opId: ops[0].opId,
              status: 'overridden',
              row: { ...profile('p1', 'Latte'), changeSeq: 7 },
              changeSeq: 7,
              notice,
            },
          ],
        })
      )
    )
    expect(getRow(db, 'profiles', 'p1')).toMatchObject({ name: 'Latte', changeSeq: 7 })
    expect(countOps(db, 'pending')).toBe(0)
    expect(service.notices()).toMatchObject([{ id: 'h1', previous: { name: 'Tea' } }])
    service.dismissNotice('h1')
    expect(service.notices()).toEqual([])
  })

  it("keeps a rejected op aside and puts the server's row back", async () => {
    putRow(db, 'profiles', { ...profile('p1', 'Coffee'), changeSeq: 5 })
    offline.write((tx) => {
      queueWrite(tx, 'profiles', 'upsert', { ...profile('p1', 'Tea'), changeSeq: 5 })
      queueWrite(tx, 'profiles', 'upsert', profile('p2', 'Tea'))
    })
    await drive(service.sync(), (ops, req) =>
      req.flush(
        envelope({
          results: [
            {
              opId: ops[0].opId,
              status: 'rejected',
              row: { ...profile('p1', 'Coffee'), changeSeq: 5 },
              code: 'CONFLICT',
              message: 'x',
            },
            { opId: ops[1].opId, status: 'rejected', row: null, code: 'CONFLICT', message: 'x' },
          ],
        })
      )
    )
    expect(getRow(db, 'profiles', 'p1')).toMatchObject({ name: 'Coffee' })
    expect(getRow(db, 'profiles', 'p2')).toBeNull()
    expect(service.rejected()).toMatchObject([
      { rowId: 'p1', code: 'CONFLICT', row: { name: 'Tea' } },
      { rowId: 'p2', code: 'CONFLICT' },
    ])
    expect(service.status()).toBe('errors')
    expect(service.rejectedOp(service.rejected()[0].opId)?.rowId).toBe('p1')
    service.discard(service.rejected()[0].opId)
    service.discard(service.rejected()[0].opId)
    expect(service.status()).toBe('synced')
  })

  it('keeps a newer edit made while its op was in flight, now based on the server row', async () => {
    offline.write((tx) => queueWrite(tx, 'profiles', 'upsert', profile('p1', 'Coffee')))
    const pushed: PushedOp[][] = []
    await drive(service.sync(), (ops, req) => {
      pushed.push(ops)
      if (pushed.length === 1) {
        offline.write((tx) =>
          queueWrite(tx, 'profiles', 'upsert', profile('p1', 'Latte', { updatedAt: 2000 }))
        )
      }
      req.flush(
        envelope({
          results: ops.map((op) => ({
            opId: op.opId,
            status: 'applied',
            row: { ...op.row, changeSeq: 20 + pushed.length },
            changeSeq: 20 + pushed.length,
          })),
        })
      )
    })
    // The newer op went out in the round's next batch, based on what the server then held.
    expect(pushed.map((ops) => [ops[0].row['name'], ops[0].baseSeq])).toEqual([
      ['Coffee', null],
      ['Latte', 21],
    ])
    expect(countOps(db, 'pending')).toBe(0)
    expect(getRow(db, 'profiles', 'p1')).toMatchObject({ name: 'Latte', changeSeq: 22 })
  })

  it('never lets a pulled row overwrite a local edit that is still pending', async () => {
    offline.isOpen.set(true)
    TestBed.inject(NetworkStatusService).isOnline.set(true)
    offline.write((tx) => queueWrite(tx, 'profiles', 'upsert', profile('p1', 'Mine')))
    pullData = (since) => ({
      ...emptyPull(since),
      changes: [{ table: 'profiles', row: { ...profile('p1', 'Theirs'), changeSeq: 30 } }],
      cursor: 30,
    })
    // The push fails (API down), the pull is never reached; then the pull alone runs.
    await drive(service.sync(), (_ops, req) => req.flush(null, { status: 503, statusText: 'down' }))
    expect(findPending(db, 'profiles', 'p1')).not.toBeNull()
    const pull = (service as unknown as { pull: () => Promise<void> }).pull.bind(service)
    await drive(pull())
    expect(getRow(db, 'profiles', 'p1')).toMatchObject({ name: 'Mine' })
    expect(offline.syncMeta('cursor')).toBe('30')
  })

  it('starts over from 0 when the cursor is past the retention (410)', async () => {
    putRow(db, 'profiles', { ...profile('p9', 'Old'), changeSeq: 3 })
    offline.write((tx) => tx.exec(`INSERT OR REPLACE INTO sync_meta VALUES ('cursor', '3')`))
    const asked: number[] = []
    let first = true
    await drive(service.sync(), undefined)
    // Answer the next round by hand: 410 first, then a fresh pull.
    const round = service.sync()
    for (let i = 0; i < 100; i++) {
      for (const req of http.match(() => true)) {
        const since = Number(new URL(req.request.url, 'http://x').searchParams.get('since'))
        asked.push(since)
        if (first) {
          first = false
          req.flush(
            { message: 'gone', code: 'CURSOR_EXPIRED', timestamp: '' },
            { status: 410, statusText: 'Gone' }
          )
        } else {
          req.flush(envelope({ ...emptyPull(since), cursor: 40 }))
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await round
    expect(asked).toEqual([3, 0])
    expect(getRow(db, 'profiles', 'p9')).toBeNull()
    expect(offline.syncMeta('cursor')).toBe('40')
  })

  it('does nothing offline or without a live session, and says so', async () => {
    const network = TestBed.inject(NetworkStatusService)
    network.isOnline.set(false)
    offline.write((tx) => queueWrite(tx, 'profiles', 'upsert', profile('p1', 'A')))
    await service.sync()
    expect(http.match(() => true)).toEqual([])
    expect(service.status()).toBe('offline')
    network.isOnline.set(true)
    TestBed.inject(AuthStore).clear('expired')
    expect(service.canSync()).toBe(false)
    expect(service.status()).toBe('pending')
  })

  it('answers how many ops a sign-out would lose after trying to push', async () => {
    offline.write((tx) => queueWrite(tx, 'profiles', 'upsert', profile('p1', 'A')))
    let lost = 0
    await drive(
      service.flush().then((count) => {
        lost = count
      }),
      (_ops, req) => req.error(new ProgressEvent('error'))
    )
    expect(lost).toBe(1)
    await drive(service.flush().then((count) => (lost = count)))
    expect(lost).toBe(0)
    expect(listOps(db, 'pending')).toEqual([])
  })
})
