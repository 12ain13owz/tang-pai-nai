import { and, asc, count, eq, gt, isNull, lt, max, ne } from 'drizzle-orm'
import { syncProbes } from '@/core/database/schema/sync-probe'
import { wrapUnexpected } from '@/core/error'
import type { SyncTableHandler } from '@/core/sync'
import { SYNC_PROBE_MESSAGE } from './sync-probe.const'
import { validateSyncProbe } from './sync-probe.schema'
import type { SyncProbe } from './sync-probe.entity'

type ProbeRow = typeof syncProbes.$inferSelect

const toProbe = ({ userId: _userId, ...row }: ProbeRow): SyncProbe => row

const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
  wrapUnexpected(work, { operation: `syncProbeSync.${operation}`, metadata: { ...metadata } })

/** The dev-only probe table's sync handler (offline-sync → tables synced in 4a.2). */
export const syncProbeSyncHandler: SyncTableHandler = {
  table: 'sync_probes',
  pull: async (executor, userId, since, limit) =>
    run('pull', async () => {
      const rows = await executor
        .select()
        .from(syncProbes)
        .where(and(eq(syncProbes.userId, userId), gt(syncProbes.changeSeq, since)))
        .orderBy(asc(syncProbes.changeSeq))
        .limit(limit)
      return rows.map(toProbe)
    }),
  push: {
    validate: validateSyncProbe,
    find: async (executor, id) =>
      run(
        'find',
        async () => {
          const rows = await executor.select().from(syncProbes).where(eq(syncProbes.id, id))
          const row = rows.at(0)
          return row ? { ownerId: row.userId, row: toProbe(row) } : null
        },
        { id }
      ),
    // A title is unique among the user's live probes: the server-only rule that makes a real
    // rejection possible (a device can't see what another device added offline).
    check: async (executor, userId, row) =>
      run('check', async () => {
        if (row.deletedAt !== null) {
          return null
        }
        const [{ taken }] = await executor
          .select({ taken: count() })
          .from(syncProbes)
          .where(
            and(
              eq(syncProbes.userId, userId),
              eq(syncProbes.title, String(row.title)),
              isNull(syncProbes.deletedAt),
              ne(syncProbes.id, row.id)
            )
          )
        return taken > 0 ? SYNC_PROBE_MESSAGE.TITLE_TAKEN : null
      }),
    write: async (executor, userId, row) =>
      run(
        'write',
        async () => {
          const values = {
            id: row.id,
            userId,
            title: String(row.title),
            amount: Number(row.amount),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(syncProbes)
            .values(values)
            .onConflictDoUpdate({ target: syncProbes.id, set: values })
            .returning()
          return toProbe(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) =>
      run('purge', async () => {
        const old = lt(syncProbes.deletedAt, before)
        const [{ maxSeq }] = await executor
          .select({ maxSeq: max(syncProbes.changeSeq) })
          .from(syncProbes)
          .where(old)
        const removed = await executor
          .delete(syncProbes)
          .where(old)
          .returning({ id: syncProbes.id })
        return { removed: removed.length, maxSeq: maxSeq ?? 0 }
      }),
  },
}
