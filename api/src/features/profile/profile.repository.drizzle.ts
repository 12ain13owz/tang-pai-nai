import { and, asc, count, eq, gt, isNull, lt, max, ne, sql } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { profiles } from '@/core/database/schema/profile'
import { wrapUnexpected } from '@/core/error'
import type { SyncTableHandler } from '@/core/sync'
import { PROFILE_LIMITS, PROFILE_MESSAGE } from './profile.const'
import { validateProfile } from './profile.schema'
import type { Profile } from './profile.entity'

type ProfileRow = typeof profiles.$inferSelect

const toProfile = ({ userId: _userId, ...row }: ProfileRow): Profile => row

const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
  wrapUnexpected(work, { operation: `profileSync.${operation}`, metadata: { ...metadata } })

/** The user's other live profiles matching `extra`. */
const countLiveOthers = async (
  executor: Executor,
  userId: string,
  id: string,
  extra?: ReturnType<typeof sql>
) => {
  const [{ total }] = await executor
    .select({ total: count() })
    .from(profiles)
    .where(and(eq(profiles.userId, userId), isNull(profiles.deletedAt), ne(profiles.id, id), extra))
  return total
}

/** The profiles table's sync handler (docs/features/profile.md rule 1). */
export const profileSyncHandler: SyncTableHandler = {
  table: 'profiles',
  pull: async (executor, userId, since, limit) =>
    run('pull', async () => {
      const rows = await executor
        .select()
        .from(profiles)
        .where(and(eq(profiles.userId, userId), gt(profiles.changeSeq, since)))
        .orderBy(asc(profiles.changeSeq))
        .limit(limit)
      return rows.map(toProfile)
    }),
  push: {
    validate: validateProfile,
    find: async (executor, id) =>
      run(
        'find',
        async () => {
          const rows = await executor.select().from(profiles).where(eq(profiles.id, id))
          const row = rows.at(0)
          return row ? { ownerId: row.userId, row: toProfile(row) } : null
        },
        { id }
      ),
    // Rules a device can't check offline: a name unique among the user's live profiles (rule 2)
    // and at most 20 of them (rule 4). A tombstone breaks neither.
    check: async (executor, userId, row) =>
      run('check', async () => {
        if (row.deletedAt !== null) {
          return null
        }
        const name = String(row.name)
        const sameName = sql`lower(${profiles.name}) = lower(${name})`
        if ((await countLiveOthers(executor, userId, row.id, sameName)) > 0) {
          return PROFILE_MESSAGE.NAME_TAKEN
        }
        if ((await countLiveOthers(executor, userId, row.id)) >= PROFILE_LIMITS.PER_USER) {
          return PROFILE_MESSAGE.TOO_MANY
        }
        return null
      }),
    write: async (executor, userId, row) =>
      run(
        'write',
        async () => {
          const values = {
            id: row.id,
            userId,
            name: String(row.name),
            icon: String(row.icon),
            color: String(row.color),
            sortOrder: Number(row.sortOrder),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(profiles)
            .values(values)
            .onConflictDoUpdate({ target: profiles.id, set: values })
            .returning()
          return toProfile(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) =>
      run('purge', async () => {
        const old = lt(profiles.deletedAt, before)
        const [{ maxSeq }] = await executor
          .select({ maxSeq: max(profiles.changeSeq) })
          .from(profiles)
          .where(old)
        const removed = await executor.delete(profiles).where(old).returning({ id: profiles.id })
        return { removed: removed.length, maxSeq: maxSeq ?? 0 }
      }),
  },
}
