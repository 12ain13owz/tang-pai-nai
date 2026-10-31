import { GoneError } from '@/core/error'
import type {
  SyncPushHandler,
  SyncRegistry,
  SyncRow,
  SyncRowInput,
  SyncRowWrite,
} from '@/core/sync'
import { SYNC_LIMITS, SYNC_MESSAGE, SyncErrorCode, SyncRejectCode } from './sync.const'
import type { OpResult, PullChange, PullResult, PushOp, SyncNotice } from './sync.entity'
import type { SyncRepository } from './sync.repository'

export interface SyncServiceDeps {
  syncRepo: SyncRepository
  registry: Pick<SyncRegistry, 'get' | 'all'>
  clock?: () => number
  newId: () => string
}

export interface PullQuery {
  since: number
  limit: number
  deviceId: string
}

type Stored = { ownerId: string; row: SyncRow }

const rejected = (
  opId: string,
  code: SyncRejectCode,
  message: string,
  row: SyncRow | null = null
): OpResult => ({ opId, status: 'rejected', row, code, message })

/** The server side of docs/features/offline-sync.md rules 9–12. */
export const createSyncService = ({
  syncRepo,
  registry,
  clock = Date.now,
  newId,
}: SyncServiceDeps) => {
  /** Rule 10: ops in order, each in its own transaction, each answered on its own. */
  const push = async (userId: string, deviceId: string, ops: PushOp[]): Promise<OpResult[]> => {
    const results: OpResult[] = []
    for (const op of ops) {
      results.push(await pushOne(userId, deviceId, op))
    }
    return results
  }

  const pushOne = async (userId: string, deviceId: string, op: PushOp): Promise<OpResult> => {
    const handler = registry.get(op.table)
    if (!handler) {
      return rejected(op.opId, SyncRejectCode.UNKNOWN_TABLE, SYNC_MESSAGE.UNKNOWN_TABLE)
    }
    if (!handler.push) {
      return rejected(op.opId, SyncRejectCode.READ_ONLY, SYNC_MESSAGE.READ_ONLY)
    }
    const pushHandler = handler.push
    return syncRepo.transaction(async (tx) => {
      // A retried push answers what it answered the first time.
      const stored = await tx.findOp(op.opId)
      if (stored) {
        return stored.userId === userId
          ? stored.result
          : rejected(op.opId, SyncRejectCode.ID_TAKEN, SYNC_MESSAGE.ID_TAKEN)
      }
      const result = await decide(tx, userId, deviceId, op, pushHandler)
      await tx.saveOp({ opId: op.opId, userId, deviceId, appliedAt: clock(), result })
      return result
    })
  }

  const decide = async (
    tx: SyncRepository,
    userId: string,
    deviceId: string,
    op: PushOp,
    pushHandler: Pick<SyncPushHandler, 'validate'>
  ): Promise<OpResult> => {
    const now = clock()
    const existing = await tx.find(op.table, op.row.id)
    if (existing && existing.ownerId !== userId) {
      return rejected(op.opId, SyncRejectCode.ID_TAKEN, SYNC_MESSAGE.ID_TAKEN)
    }
    const conflict =
      existing !== null && (op.baseSeq === null || op.baseSeq < existing.row.changeSeq)

    if (op.op === 'delete') {
      return remove(tx, userId, deviceId, op, existing, conflict, now)
    }

    const validation = pushHandler.validate(op.row)
    if (!validation.ok) {
      return rejected(op.opId, SyncRejectCode.VALIDATION, validation.message, existing?.row)
    }
    const candidate = clampTimes(validation.row, now)

    if (existing && conflict) {
      const lost = await settleConflict(tx, userId, deviceId, op, existing, candidate, now)
      if (lost) {
        return lost
      }
    }

    const broken = await tx.check(op.table, userId, candidate)
    if (broken) {
      return rejected(op.opId, SyncRejectCode.CONFLICT, broken, existing?.row)
    }
    const row = await stamp(tx, op.table, userId, candidate)
    if (existing && conflict) {
      await record(tx, op.table, lostLater(existing, userId, deviceId, row.changeSeq, now))
    }
    return { opId: op.opId, status: 'applied', row, changeSeq: row.changeSeq }
  }

  /** Rule 12 between one user's devices: `overridden` when the pushed version loses, else null. */
  const settleConflict = async (
    tx: SyncRepository,
    userId: string,
    deviceId: string,
    op: PushOp,
    existing: Stored,
    candidate: SyncRowInput,
    now: number
  ): Promise<OpResult | null> => {
    const existingDeleted = (existing.row.deletedAt ?? null) !== null
    // Delete beats edit; otherwise the later edit wins, and a tie goes to the server's row.
    const candidateWins =
      !existingDeleted &&
      (candidate.deletedAt !== null || candidate.updatedAt > existing.row.updatedAt)
    if (candidateWins) {
      return null
    }
    const notice = await record(tx, op.table, {
      previous: candidate,
      overwrittenBy: existing.row.updatedBy ?? userId,
      overwrittenByDevice: deviceId,
      loserUserId: userId,
      loserDeviceId: deviceId,
      changeSeq: existing.row.changeSeq,
      now,
    })
    return {
      opId: op.opId,
      status: 'overridden',
      row: existing.row,
      changeSeq: existing.row.changeSeq,
      notice,
    }
  }

  const remove = async (
    tx: SyncRepository,
    userId: string,
    deviceId: string,
    op: PushOp,
    existing: Stored | null,
    conflict: boolean,
    now: number
  ): Promise<OpResult> => {
    // Deleting what the server doesn't have, or has deleted already, changes nothing.
    if (!existing || (existing.row.deletedAt ?? null) !== null) {
      return {
        opId: op.opId,
        status: 'applied',
        row: existing?.row ?? null,
        changeSeq: existing?.row.changeSeq ?? null,
      }
    }
    const deletedAt = Math.min(numberOr(op.row.updatedAt, now), now)
    const tombstone: SyncRowInput = {
      ...existing.row,
      id: existing.row.id,
      createdAt: numberOr(existing.row.createdAt, now),
      updatedAt: deletedAt,
      deletedAt,
    }
    const row = await stamp(tx, op.table, userId, tombstone)
    if (conflict) {
      await record(tx, op.table, lostLater(existing, userId, deviceId, row.changeSeq, now))
    }
    return { opId: op.opId, status: 'applied', row, changeSeq: row.changeSeq }
  }

  const stamp = async (
    tx: SyncRepository,
    table: string,
    userId: string,
    row: SyncRowInput
  ): Promise<SyncRow> => {
    const write: SyncRowWrite = { ...row, changeSeq: await tx.nextSeq(), updatedBy: userId }
    return tx.write(table, userId, write)
  }

  // An applied version lost to a later push: pull tells the loser's other devices (rule 12).
  const lostLater = (
    existing: Stored,
    userId: string,
    deviceId: string,
    changeSeq: number,
    now: number
  ) => ({
    previous: existing.row,
    overwrittenBy: userId,
    overwrittenByDevice: deviceId,
    loserUserId: existing.row.updatedBy ?? existing.ownerId,
    loserDeviceId: null,
    changeSeq,
    now,
  })

  const record = async (
    tx: SyncRepository,
    table: string,
    entry: {
      previous: Record<string, unknown>
      overwrittenBy: string
      overwrittenByDevice: string
      loserUserId: string
      loserDeviceId: string | null
      changeSeq: number
      now: number
    }
  ): Promise<SyncNotice> => {
    const { now, ...rest } = entry
    const id = newId()
    const rowId = String(entry.previous.id)
    await tx.addHistory({ id, table, rowId, ...rest, createdAt: now })
    return {
      id,
      table,
      rowId,
      previous: entry.previous,
      overwrittenBy: entry.overwrittenBy,
      createdAt: now,
    }
  }

  /** Rule 9: every row the user may sync with `changeSeq > since`, across tables, in order. */
  const pull = async (
    userId: string,
    { since, limit, deviceId }: PullQuery
  ): Promise<PullResult> => {
    if (since > 0 && since < (await syncRepo.purgedSeq())) {
      throw new GoneError(SYNC_MESSAGE.CURSOR_EXPIRED, { since })
        .withCode(SyncErrorCode.CURSOR_EXPIRED)
        .withOperation('syncPull')
    }
    // Read before the rows: writes commit in `changeSeq` order, so every row up to it is visible.
    const lastSeq = await syncRepo.lastSeq()
    const handlers = registry.all()
    const merged: PullChange[] = []
    for (const handler of handlers) {
      const rows = await syncRepo.pull(handler.table, userId, since, limit + 1)
      merged.push(...rows.map((row) => ({ table: handler.table, row })))
    }
    merged.sort((a, b) => a.row.changeSeq - b.row.changeSeq)
    const changes = merged.slice(0, limit)
    const hasMore = merged.length > limit
    const lastReturned = changes.at(-1)?.row.changeSeq ?? since
    // Nothing more for this user: jump to the server's counter, so a quiet device's cursor never
    // falls behind the purge watermark (which would answer 410 forever).
    const cursor = hasMore ? lastReturned : Math.max(lastReturned, lastSeq, since)
    const notices = await syncRepo.notices(
      userId,
      deviceId,
      since,
      hasMore ? cursor : Number.MAX_SAFE_INTEGER
    )
    return { changes, notices, cursor, hasMore, tables: handlers.map((handler) => handler.table) }
  }

  /** Rule 9: purge old tombstones and op records; a cursor below the watermark answers 410. */
  const cleanup = async (): Promise<{ tombstones: number; ops: number }> => {
    const before = clock() - SYNC_LIMITS.RETENTION_MS
    let tombstones = 0
    let maxSeq = 0
    for (const handler of registry.all()) {
      if (handler.push) {
        const purged = await syncRepo.purge(handler.table, before)
        tombstones += purged.removed
        maxSeq = Math.max(maxSeq, purged.maxSeq)
      }
    }
    if (maxSeq > 0) {
      await syncRepo.raisePurgedSeq(maxSeq)
    }
    const ops = await syncRepo.deleteOpsBefore(before)
    return { tombstones, ops }
  }

  return { push, pull, cleanup }
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/** Rule 10: a device's times are never later than the server's now. */
const clampTimes = (row: SyncRowInput, now: number): SyncRowInput => ({
  ...row,
  createdAt: Math.min(row.createdAt, now),
  updatedAt: Math.min(row.updatedAt, now),
  deletedAt: row.deletedAt === null ? null : Math.min(row.deletedAt, now),
})

export type SyncService = ReturnType<typeof createSyncService>
