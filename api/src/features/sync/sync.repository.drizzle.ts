import { and, eq, gt, isNull, lt, lte, ne, sql } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { changeHistory, syncOps, syncState } from '@/core/database/schema/sync'
import { wrapUnexpected } from '@/core/error'
import type { SyncPushHandler, SyncRegistry, SyncTableHandler } from '@/core/sync'
import type { OpResult } from './sync.entity'
import type { SyncRepository } from './sync.repository'

const STATE_ID = 1

export const createDrizzleSyncRepository = (
  db: Executor,
  registry: Pick<SyncRegistry, 'get'>
): SyncRepository => {
  const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
    wrapUnexpected(work, { operation: `syncRepository.${operation}`, metadata: { ...metadata } })

  const handler = (table: string): SyncTableHandler => {
    const found = registry.get(table)
    if (!found) {
      throw new Error(`Sync table "${table}" is not registered`)
    }
    return found
  }
  const pushHandler = (table: string): SyncPushHandler => {
    const found = handler(table).push
    if (!found) {
      throw new Error(`Sync table "${table}" is pull-only`)
    }
    return found
  }

  return {
    transaction: async (work) =>
      run('transaction', async () =>
        db.transaction(async (tx) => work(createDrizzleSyncRepository(tx, registry)))
      ),

    nextSeq: async () =>
      run('nextSeq', async () => {
        const [state] = await db
          .update(syncState)
          .set({ lastSeq: sql`${syncState.lastSeq} + 1` })
          .where(eq(syncState.id, STATE_ID))
          .returning({ lastSeq: syncState.lastSeq })
        return state.lastSeq
      }),

    lastSeq: async () =>
      run('lastSeq', async () => {
        const rows = await db
          .select({ lastSeq: syncState.lastSeq })
          .from(syncState)
          .where(eq(syncState.id, STATE_ID))
        return rows.at(0)?.lastSeq ?? 0
      }),

    purgedSeq: async () =>
      run('purgedSeq', async () => {
        const rows = await db
          .select({ purgedSeq: syncState.purgedSeq })
          .from(syncState)
          .where(eq(syncState.id, STATE_ID))
        return rows.at(0)?.purgedSeq ?? 0
      }),

    raisePurgedSeq: async (seq) =>
      run('raisePurgedSeq', async () => {
        await db
          .update(syncState)
          .set({ purgedSeq: sql`max(${syncState.purgedSeq}, ${seq})` })
          .where(eq(syncState.id, STATE_ID))
      }),

    findOp: async (opId) =>
      run(
        'findOp',
        async () => {
          const rows = await db.select().from(syncOps).where(eq(syncOps.opId, opId))
          const row = rows.at(0)
          return row ? { userId: row.userId, result: JSON.parse(row.result) as OpResult } : null
        },
        { opId }
      ),

    saveOp: async ({ result, ...op }) =>
      run(
        'saveOp',
        async () => {
          await db.insert(syncOps).values({ ...op, result: JSON.stringify(result) })
        },
        { opId: op.opId }
      ),

    addHistory: async ({ previous, ...entry }) =>
      run('addHistory', async () => {
        await db.insert(changeHistory).values({ ...entry, previous: JSON.stringify(previous) })
      }),

    notices: async (userId, deviceId, since, upTo) =>
      run('notices', async () => {
        const rows = await db
          .select()
          .from(changeHistory)
          .where(
            and(
              eq(changeHistory.loserUserId, userId),
              isNull(changeHistory.loserDeviceId),
              ne(changeHistory.overwrittenByDevice, deviceId),
              gt(changeHistory.changeSeq, since),
              lte(changeHistory.changeSeq, upTo)
            )
          )
          .orderBy(changeHistory.changeSeq)
        return rows.map((row) => ({
          id: row.id,
          table: row.table,
          rowId: row.rowId,
          previous: JSON.parse(row.previous) as Record<string, unknown>,
          overwrittenBy: row.overwrittenBy,
          createdAt: row.createdAt,
        }))
      }),

    deleteOpsBefore: async (before) =>
      run('deleteOpsBefore', async () => {
        const removed = await db
          .delete(syncOps)
          .where(lt(syncOps.appliedAt, before))
          .returning({ opId: syncOps.opId })
        return removed.length
      }),

    pull: async (table, userId, since, limit) => handler(table).pull(db, userId, since, limit),
    find: async (table, id) => pushHandler(table).find(db, id),
    check: async (table, userId, row) => pushHandler(table).check(db, userId, row),
    write: async (table, userId, row) => pushHandler(table).write(db, userId, row),
    purge: async (table, before) => pushHandler(table).purge(db, before),
  }
}
