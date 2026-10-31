import { computed, DOCUMENT, effect, inject, Service, signal, untracked } from '@angular/core'
import { ApiClient, isUnreachable, toApiError } from '@/core/api'
import { AuthStore } from '@/core/auth'
import { NetworkStatusService } from '@/core/network'
import { OfflineService } from './offline.service'
import { countOps, deleteOp, findOp, findPending, listOps } from './outbox'
import { clearSyncTables, deleteRow, putRow, SYNC_TABLES } from './sync-tables'
import type { LocalDatabase, SqlValue } from './local-database'
import type { SyncMetaKey } from './offline.service'
import type { OutboxOp } from './outbox'
import type { SyncRow } from './sync-tables'

/** A conflict notice: the version that lost (offline-sync rule 12). */
export interface SyncNotice {
  id: string
  table: string
  rowId: string
  previous: SyncRow
  createdAt: number
}

/** What the header pill shows, in order of precedence (offline-sync → Web screens). */
export type SyncStatus = 'errors' | 'offline' | 'syncing' | 'pending' | 'synced'

type ServerRow = SyncRow & { id: string; changeSeq: number }

type OpResult =
  | { opId: string; status: 'applied'; row: ServerRow | null; changeSeq: number | null }
  | { opId: string; status: 'overridden'; row: ServerRow; changeSeq: number; notice: SyncNotice }
  | { opId: string; status: 'rejected'; row: ServerRow | null; code: string; message: string }

interface PullData {
  changes: { table: string; row: ServerRow }[]
  notices: SyncNotice[]
  cursor: number
  hasMore: boolean
  tables: string[]
}

const PUSH_BATCH = 100
const PULL_LIMIT = 500
/** Rounds per trigger at most, so a server that keeps answering "more" can't spin forever. */
const MAX_PAGES = 50
const WRITE_DELAY_MS = 2_000
const INTERVAL_MS = 5 * 60_000
const SYNC_LOCK = 'tpn-sync'

/**
 * Sync rounds (docs/features/offline-sync.md rules 8–12): push the outbox, then pull, under one
 * Web Lock, whenever the device is open, online and its session is live.
 */
@Service()
export class SyncService {
  private window = inject(DOCUMENT).defaultView
  private api = inject(ApiClient)
  private authStore = inject(AuthStore)
  private networkStatusService = inject(NetworkStatusService)
  private offlineService = inject(OfflineService)

  isSyncing = signal(false)
  /** When the last round finished, kept on the device. */
  lastSyncedAt = computed(() =>
    this.read((db) => {
      const value = metaValue(db, 'lastSyncedAt')
      return value === null ? null : Number(value)
    }, null)
  )
  /** Tables the server syncs, from the last pull (e.g. whether the dev-only probe exists). */
  serverTables = computed(() =>
    this.read((db) => JSON.parse(metaValue(db, 'tables') ?? '[]') as string[], [])
  )

  pendingCount = computed(() => this.read((db) => countOps(db, 'pending'), 0))
  rejected = computed(() => this.read((db) => listOps(db, 'rejected'), []))
  notices = computed(() =>
    this.read(
      (db) =>
        db
          .selectObjects('SELECT * FROM sync_notices WHERE seen_at IS NULL ORDER BY created_at')
          .map(toNotice),
      []
    )
  )
  /** Sync needs the network and a live session (rule 7: an expired one waits for sign-in). */
  canSync = computed(
    () =>
      this.offlineService.isOpen() &&
      this.networkStatusService.isOnline() &&
      this.authStore.status() === 'signedIn'
  )
  status = computed<SyncStatus>(() => {
    if (this.rejected().length > 0) {
      return 'errors'
    }
    if (!this.networkStatusService.isOnline()) {
      return 'offline'
    }
    if (this.isSyncing()) {
      return 'syncing'
    }
    return this.pendingCount() > 0 ? 'pending' : 'synced'
  })

  private writeTimer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private again = false

  constructor() {
    // Rule 11: open (unlock, start), back online, session back.
    effect(() => {
      if (this.canSync()) {
        untracked(() => void this.sync())
      }
    })
    // About 2 seconds after a local write that queued an op.
    effect(() => {
      this.offlineService.changes()
      untracked(() => this.afterWrite())
    })
    this.window?.document.addEventListener('visibilitychange', () => {
      if (this.window?.document.visibilityState === 'visible') {
        void this.sync()
      }
    })
    this.window?.setInterval(() => void this.sync(), INTERVAL_MS)
  }

  /** One round now (or right after the running one): push, then pull. */
  async sync(): Promise<void> {
    if (!this.canSync()) {
      return
    }
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.withLock(async () => {
      do {
        this.again = false
        await this.round()
      } while (this.wantsAgain())
    }).finally(() => {
      this.running = null
    })
    return this.running
  }

  /**
   * Before signing out (rule 7): push what's queued. Answers how many ops would be lost
   * (still pending or rejected).
   */
  async flush(): Promise<number> {
    if (this.offlineService.isOpen()) {
      await this.sync()
    }
    return this.offlineService.isOpen() ? this.pendingCount() + this.rejected().length : 0
  }

  /** "Discard" on a rejected op: the local row already matches the server. */
  discard(opId: string): void {
    this.offlineService.write((db) => deleteOp(db, opId))
  }

  /** A rejected op, for "fix" (its refused values). */
  rejectedOp(opId: string): OutboxOp | null {
    return this.read((db) => findOp(db, opId), null)
  }

  dismissNotice(id: string): void {
    this.offlineService.write((db) =>
      db.exec('UPDATE sync_notices SET seen_at = ? WHERE id = ?', [Date.now(), id])
    )
  }

  private async round(): Promise<void> {
    this.isSyncing.set(true)
    try {
      await this.push()
      await this.pull()
      if (this.offlineService.isOpen()) {
        this.offlineService.write((db) => setMeta(db, 'lastSyncedAt', String(Date.now())))
      }
    } catch (error) {
      // Offline or API down: nothing changed, the next trigger tries again (rule 11). A refused
      // session is the interceptor's (and the expired banner's) business.
      const apiError = toApiError(error)
      if (!isUnreachable(apiError) && apiError.status !== 401) {
        console.error('Sync failed', error)
      }
    } finally {
      this.isSyncing.set(false)
    }
  }

  private async push(): Promise<void> {
    const deviceId = this.offlineService.syncMeta('deviceId')
    for (let page = 0; page < MAX_PAGES; page++) {
      const ops = this.read((db) => listOps(db, 'pending', PUSH_BATCH), [])
      if (ops.length === 0 || !this.offlineService.isOpen()) {
        return
      }
      const response = await this.api.post<{ results: OpResult[] }>('/sync/push', {
        deviceId,
        ops: ops.map((op) => ({
          opId: op.opId,
          table: op.table,
          op: op.op,
          row: op.row,
          baseSeq: op.baseSeq,
        })),
      })
      if (!this.offlineService.isOpen()) {
        return // locked or wiped meanwhile
      }
      const results = response.data?.results ?? []
      this.offlineService.write((db) => {
        for (const [index, result] of results.entries()) {
          applyResult(db, ops[index], result)
        }
      })
    }
  }

  private async pull(): Promise<void> {
    for (let page = 0; page < MAX_PAGES; page++) {
      const cursor = Number(this.offlineService.syncMeta('cursor') ?? 0)
      const deviceId = this.offlineService.syncMeta('deviceId') ?? ''
      let data: PullData | undefined
      try {
        const params = `since=${cursor}&limit=${PULL_LIMIT}&deviceId=${deviceId}`
        data = (await this.api.get<PullData>(`/sync/pull?${params}`)).data
      } catch (error) {
        if (toApiError(error).code !== 'CURSOR_EXPIRED') {
          throw error
        }
        // Rule 9: past the tombstone retention, start over (the outbox stays).
        this.offlineService.write((db) => {
          clearSyncTables(db)
          setCursor(db, 0)
        })
        continue
      }
      if (!data || !this.offlineService.isOpen()) {
        return
      }
      const pulled = data
      this.offlineService.write((db) => applyPull(db, pulled))
      if (!pulled.hasMore) {
        return
      }
    }
  }

  private afterWrite(): void {
    if (!this.offlineService.isOpen() || this.pendingCount() === 0 || this.writeTimer) {
      return
    }
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this.sync()
    }, WRITE_DELAY_MS)
  }

  /** A trigger came in during the round (read through a method: TS can't see it change). */
  private wantsAgain(): boolean {
    return this.again && this.canSync()
  }

  /** Rule 11: one round at a time across tabs. */
  private async withLock(work: () => Promise<void>): Promise<void> {
    const locks = this.window?.navigator.locks
    if (!locks) {
      return work()
    }
    await locks.request(SYNC_LOCK, work)
  }

  /** A read of the open database that re-runs after every local write. */
  private read<T>(work: (db: LocalDatabase) => T, fallback: T): T {
    this.offlineService.changes()
    if (!this.offlineService.isOpen()) {
      return fallback
    }
    return work(this.offlineService.db())
  }
}

const setMeta = (db: LocalDatabase, key: SyncMetaKey, value: string): void => {
  db.exec('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [key, value])
}

const metaValue = (db: LocalDatabase, key: SyncMetaKey): string | null => {
  const value = db.selectValue('SELECT value FROM sync_meta WHERE key = ?', [key])
  return typeof value === 'string' ? value : null
}

const setCursor = (db: LocalDatabase, cursor: number): void => setMeta(db, 'cursor', String(cursor))

const storeNotice = (db: LocalDatabase, notice: SyncNotice): void => {
  db.exec(
    'INSERT OR IGNORE INTO sync_notices (id, tbl, row_id, previous, created_at) VALUES (?, ?, ?, ?, ?)',
    [notice.id, notice.table, notice.rowId, JSON.stringify(notice.previous), notice.createdAt]
  )
}

const toNotice = (row: Record<string, SqlValue>): SyncNotice => ({
  id: String(row['id']),
  table: String(row['tbl']),
  rowId: String(row['row_id']),
  previous: JSON.parse(String(row['previous'])) as SyncRow,
  createdAt: Number(row['created_at']),
})

/** Puts the server's version of a row in place, unless a newer local edit is waiting. */
const putServerRow = (db: LocalDatabase, table: string, id: string, row: ServerRow | null) => {
  if (!(table in SYNC_TABLES) || findPending(db, table, id)) {
    return
  }
  if (row) {
    putRow(db, table, row)
  } else {
    deleteRow(db, table, id)
  }
}

/**
 * Rule 10 on the device. The op may have been replaced by a newer write while in flight (a new
 * `opId` on the same outbox entry): then that newer op stays queued, now based on what the server
 * holds.
 */
const applyResult = (db: LocalDatabase, sent: OutboxOp, result: OpResult): void => {
  const current = findOp(db, sent.opId)
  const replaced = current === null
  if (replaced) {
    const newer = findPending(db, sent.table, sent.rowId)
    if (newer && result.status !== 'rejected' && result.changeSeq !== null) {
      db.exec('UPDATE outbox SET base_seq = ? WHERE seq = ?', [result.changeSeq, newer.seq])
    }
    if (result.status === 'overridden') {
      storeNotice(db, result.notice)
    }
    return
  }
  switch (result.status) {
    case 'applied':
      deleteOp(db, sent.opId)
      putServerRow(db, sent.table, sent.rowId, result.row)
      break
    case 'overridden':
      deleteOp(db, sent.opId)
      putServerRow(db, sent.table, sent.rowId, result.row)
      storeNotice(db, result.notice)
      break
    case 'rejected':
      // Kept with the refused values for "fix" or "discard"; the row goes back to the server's.
      db.exec(`UPDATE outbox SET status = 'rejected', code = ?, error = ? WHERE op_id = ?`, [
        result.code,
        result.message,
        sent.opId,
      ])
      putServerRow(db, sent.table, sent.rowId, result.row)
      break
  }
}

/** Rule 9: rows (never over a pending local edit), notices, then the cursor. */
const applyPull = (db: LocalDatabase, data: PullData): void => {
  for (const change of data.changes) {
    putServerRow(db, change.table, change.row.id, change.row)
  }
  for (const notice of data.notices) {
    storeNotice(db, notice)
  }
  setCursor(db, data.cursor)
  setMeta(db, 'tables', JSON.stringify(data.tables))
}
