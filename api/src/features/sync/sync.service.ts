import { GoneError } from '@/core/error'
import type {
  SyncPushHandler,
  SyncRegistry,
  SyncRow,
  SyncRowInput,
  SyncRowWrite,
  SyncSharedRows,
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

type PushHandler = Pick<SyncPushHandler, 'validate' | 'keepsStored' | 'sameChange' | 'shared'>

/**
 * Whose row an op writes: the caller's own (`editor` false), or an owner's shared wallet's
 * (docs/features/sharing.md rules 11–13), or a refusal.
 */
type Acting = { ownerId: string; editor: boolean } | { code: SyncRejectCode; message: string }

/** One op's write: the caller, the row's owner and whether the caller writes as an editor. */
interface Write {
  tx: SyncRepository
  userId: string
  ownerId: string
  editor: boolean
  deviceId: string
  now: number
}

/** The stored version was written by someone other than the owner (an editor). */
const byEditor = (existing: Stored, ownerId: string) =>
  existing.row.updatedBy !== undefined && existing.row.updatedBy !== ownerId

const OWN = (userId: string): Acting => ({ ownerId: userId, editor: false })
const NOT_SHARED: Acting = { code: SyncRejectCode.NOT_SHARED, message: SYNC_MESSAGE.NOT_SHARED }

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
    pushHandler: PushHandler
  ): Promise<OpResult> => {
    const now = clock()
    const existing = await tx.find(op.table, op.row.id)
    const acting = await actingAs(tx, userId, op, existing, pushHandler.shared)
    if ('code' in acting) {
      // Someone else's row is shown only to an editor of its wallet (a stale write).
      const shown = acting.code === SyncRejectCode.STALE ? (existing?.row ?? null) : null
      return rejected(op.opId, acting.code, acting.message, shown)
    }
    // An editor's write carries the current `baseSeq` (checked above), so it never conflicts.
    const conflict =
      !acting.editor &&
      existing !== null &&
      (op.baseSeq === null || op.baseSeq < existing.row.changeSeq)
    const write: Write = {
      tx,
      userId,
      ownerId: acting.ownerId,
      editor: acting.editor,
      deviceId,
      now,
    }

    if (op.op === 'delete') {
      return remove(write, op, existing, conflict)
    }
    return upsert(write, op, existing, conflict, pushHandler)
  }

  /** Sharing rules 11–13: who the op writes for, or why it is refused. */
  const actingAs = async (
    tx: SyncRepository,
    userId: string,
    op: PushOp,
    existing: Stored | null,
    shared: SyncSharedRows | undefined
  ): Promise<Acting> => {
    if (existing?.ownerId === userId) {
      return OWN(userId)
    }
    if (!shared) {
      return existing
        ? { code: SyncRejectCode.ID_TAKEN, message: SYNC_MESSAGE.ID_TAKEN }
        : OWN(userId)
    }
    return existing
      ? editorOfStored(tx, userId, op, existing, shared)
      : editorOfNew(tx, userId, op, shared)
  }

  /** A new row: the caller's own, unless its wallet is someone else's. */
  const editorOfNew = async (
    tx: SyncRepository,
    userId: string,
    op: PushOp,
    shared: SyncSharedRows
  ): Promise<Acting> => {
    const walletId = shared.walletOf(op.row)
    const access = walletId ? await tx.walletAccess(userId, walletId) : null
    if (!access || access.role === 'owner') {
      // Unknown wallets are the feature's own check to refuse.
      return OWN(userId)
    }
    return access.role === 'editor' ? { ownerId: access.ownerId, editor: true } : NOT_SHARED
  }

  /** Someone else's row: an editor of its wallet (before and after), with the current `baseSeq`. */
  const editorOfStored = async (
    tx: SyncRepository,
    userId: string,
    op: PushOp,
    existing: Stored,
    shared: SyncSharedRows
  ): Promise<Acting> => {
    const walletIds = new Set(
      [shared.walletOf(existing.row), op.op === 'upsert' ? shared.walletOf(op.row) : null].filter(
        (id): id is string => id !== null
      )
    )
    if (walletIds.size === 0) {
      return NOT_SHARED
    }
    for (const walletId of walletIds) {
      const access = await tx.walletAccess(userId, walletId)
      if (access?.role !== 'editor' || access.ownerId !== existing.ownerId) {
        return NOT_SHARED
      }
    }
    if (op.baseSeq !== existing.row.changeSeq) {
      return { code: SyncRejectCode.STALE, message: SYNC_MESSAGE.STALE }
    }
    return { ownerId: existing.ownerId, editor: true }
  }

  const upsert = async (
    write: Write,
    op: PushOp,
    existing: Stored | null,
    conflict: boolean,
    pushHandler: PushHandler
  ): Promise<OpResult> => {
    const { tx, ownerId, now } = write
    const validation = pushHandler.validate(op.row)
    if (!validation.ok) {
      return rejected(op.opId, SyncRejectCode.VALIDATION, validation.message, existing?.row)
    }
    const prepared = prepare(write, validation.row, existing, pushHandler.shared)
    // A second create of one recurring occurrence keeps the server's row, silently (recurring
    // rule 9).
    if (existing && op.baseSeq === null && pushHandler.keepsStored?.(prepared) === true) {
      return keptQuietly(op, existing)
    }
    // A live row the feature adjusts first (a transaction on a merged category, category rule 15).
    const candidate = await tx.resolve(op.table, ownerId, clampTimes(prepared, now))
    const same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      pushHandler.sameChange?.(a, b) === true

    if (existing && conflict) {
      const lost = await settleConflict(write, op, existing, candidate, same)
      if (lost) {
        return lost
      }
    }

    const broken = await tx.check(op.table, ownerId, candidate)
    if (broken) {
      return rejected(op.opId, SyncRejectCode.CONFLICT, broken, existing?.row)
    }
    const row = await stamp(write, op.table, candidate)
    await tx.followUp(op.table, ownerId, row)
    if (existing && conflict && !same(existing.row, row)) {
      await recordLoss(write, op.table, existing, row.changeSeq)
    }
    return { opId: op.opId, status: 'applied', row, changeSeq: row.changeSeq }
  }

  /** Fields only the owner or the server sets (sharing rule 12). */
  const prepare = (
    write: Write,
    row: SyncRowInput,
    existing: Stored | null,
    shared: SyncSharedRows | undefined
  ): SyncRowInput => {
    if (!shared) {
      return row
    }
    const stored = existing?.row ?? null
    return write.editor ? shared.forEditor(row, stored, write.userId) : shared.forOwner(row, stored)
  }

  /** The server's row wins with no conflict notice (recurring rule 9). */
  const keptQuietly = (op: PushOp, existing: Stored): OpResult => ({
    opId: op.opId,
    status: 'overridden',
    row: existing.row,
    changeSeq: existing.row.changeSeq,
  })

  /**
   * Rule 12: `overridden` when the pushed version loses, else null. Between one user's devices
   * the later edit wins; over an editor's version the owner always wins (sharing rule 14).
   */
  const settleConflict = async (
    write: Write,
    op: PushOp,
    existing: Stored,
    candidate: SyncRowInput,
    same: (a: Record<string, unknown>, b: Record<string, unknown>) => boolean
  ): Promise<OpResult | null> => {
    const { tx, userId, deviceId, now } = write
    const existingDeleted = (existing.row.deletedAt ?? null) !== null
    // Delete beats edit; otherwise the later edit wins, and a tie goes to the server's row.
    const candidateWins =
      byEditor(existing, write.ownerId) ||
      (!existingDeleted &&
        (candidate.deletedAt !== null || candidate.updatedAt > existing.row.updatedAt))
    if (candidateWins) {
      return null
    }
    // Versions that differ in nothing the user changed lose without a notice.
    if (same(candidate, existing.row)) {
      return keptQuietly(op, existing)
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
    write: Write,
    op: PushOp,
    existing: Stored | null,
    conflict: boolean
  ): Promise<OpResult> => {
    const { tx, ownerId, now } = write
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
    const row = await stamp(write, op.table, tombstone)
    await tx.followUp(op.table, ownerId, row)
    if (conflict) {
      await recordLoss(write, op.table, existing, row.changeSeq)
    }
    return { opId: op.opId, status: 'applied', row, changeSeq: row.changeSeq }
  }

  /** The row is the owner's; `updatedBy` is whoever wrote it (an editor, sharing rule 12). */
  const stamp = async (write: Write, table: string, row: SyncRowInput): Promise<SyncRow> => {
    const stored: SyncRowWrite = {
      ...row,
      changeSeq: await write.tx.nextSeq(),
      updatedBy: write.userId,
    }
    return write.tx.write(table, write.ownerId, stored)
  }

  // An applied version lost to a later push: pull tells the loser's other devices (rule 12). An
  // editor who lost to the owner gets no notice (sharing rule 14).
  const recordLoss = async (write: Write, table: string, existing: Stored, changeSeq: number) => {
    if (byEditor(existing, write.ownerId)) {
      return
    }
    await record(write.tx, table, {
      previous: existing.row,
      overwrittenBy: write.userId,
      overwrittenByDevice: write.deviceId,
      loserUserId: existing.row.updatedBy ?? existing.ownerId,
      loserDeviceId: null,
      changeSeq,
      now: write.now,
    })
  }

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
