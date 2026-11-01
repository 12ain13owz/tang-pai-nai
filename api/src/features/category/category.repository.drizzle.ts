import { and, asc, count, eq, gt, isNull, lt, max, ne, sql } from 'drizzle-orm'
import type { Executor } from '@/core/database'
import { categories } from '@/core/database/schema/category'
import { profiles } from '@/core/database/schema/profile'
import { wrapUnexpected } from '@/core/error'
import type { SyncRowInput, SyncTableHandler } from '@/core/sync'
import { CATEGORY_LIMITS, CATEGORY_MESSAGE } from './category.const'
import { validateCategory } from './category.schema'
import type { Category } from './category.entity'
import type { SQL } from 'drizzle-orm'

type CategoryRow = typeof categories.$inferSelect

const toCategory = ({ userId: _userId, ...row }: CategoryRow): Category => row

const run = async <T>(operation: string, work: () => Promise<T>, metadata?: object) =>
  wrapUnexpected(work, { operation: `categorySync.${operation}`, metadata: { ...metadata } })

const findRow = async (executor: Executor, id: string) =>
  (await executor.select().from(categories).where(eq(categories.id, id))).at(0)

/** Other live categories (not `id`) matching `where`. */
const countOthers = async (executor: Executor, id: string, where: SQL | undefined) => {
  const [{ total }] = await executor
    .select({ total: count() })
    .from(categories)
    .where(and(isNull(categories.deletedAt), ne(categories.id, id), where))
  return total
}

/** The parent rules (category rules 3, 7); the broken rule's message or null. */
const checkParent = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput,
  profileId: string,
  parentId: string
): Promise<string | null> => {
  const parent = await findRow(executor, parentId)
  if (!parent || parent.userId !== userId || parent.deletedAt !== null) {
    return CATEGORY_MESSAGE.PARENT_GONE
  }
  if (parent.profileId !== profileId || parent.type !== row.type || parent.parentId !== null) {
    return CATEGORY_MESSAGE.PARENT_INVALID
  }
  if (parent.isArchived && row.isArchived !== true) {
    return CATEGORY_MESSAGE.PARENT_ARCHIVED
  }
  return null
}

/** Rule 1: the owner's live profile; whether `profileId` is one. */
const isLiveProfile = async (executor: Executor, userId: string, profileId: string) => {
  const rows = await executor
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, profileId), eq(profiles.userId, userId), isNull(profiles.deletedAt)))
  return rows.length > 0
}

/** Rules 2 and 11 for a non-archived row: a free name among siblings, at most 200 open. */
const checkOpen = async (
  executor: Executor,
  row: SyncRowInput,
  profileId: string,
  parentId: string | null
): Promise<string | null> => {
  const open = and(eq(categories.profileId, profileId), eq(categories.isArchived, false))
  const sameName = and(
    open,
    eq(categories.type, String(row.type) as Category['type']),
    parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
    sql`lower(${categories.name}) = lower(${String(row.name)})`
  )
  if ((await countOthers(executor, row.id, sameName)) > 0) {
    return CATEGORY_MESSAGE.NAME_TAKEN
  }
  if ((await countOthers(executor, row.id, open)) >= CATEGORY_LIMITS.PER_PROFILE) {
    return CATEGORY_MESSAGE.TOO_MANY
  }
  return null
}

/** Rules a device can't check offline (category rules 1–4, 7, 11); the message or null. */
const checkCategory = async (
  executor: Executor,
  userId: string,
  row: SyncRowInput
): Promise<string | null> => {
  // A tombstone breaks no rule (offline-sync rule 10: deletes run no check).
  if (row.deletedAt !== null) {
    return null
  }
  const profileId = String(row.profileId)
  const parentId = typeof row.parentId === 'string' ? row.parentId : null
  const stored = await findRow(executor, row.id)
  // Rule 1: one of the owner's live profiles, and a category never moves to another.
  if (stored && stored.profileId !== profileId) {
    return CATEGORY_MESSAGE.PROFILE_FIXED
  }
  if (!(await isLiveProfile(executor, userId, profileId))) {
    return CATEGORY_MESSAGE.PROFILE_GONE
  }
  const parentError =
    parentId === null ? null : await checkParent(executor, userId, row, profileId, parentId)
  if (parentError) {
    return parentError
  }
  // Rules 3–4: a parent with live children stays top-level and keeps its type.
  const reshaped = stored !== undefined && (parentId !== null || stored.type !== row.type)
  if (reshaped && (await countOthers(executor, row.id, eq(categories.parentId, row.id))) > 0) {
    return parentId !== null ? CATEGORY_MESSAGE.HAS_CHILDREN : CATEGORY_MESSAGE.TYPE_FIXED
  }
  // Rules 2 and 11: archived categories neither hold a name nor count toward the 200.
  return row.isArchived === true ? null : checkOpen(executor, row, profileId, parentId)
}

/** The categories table's sync handler (docs/features/category.md rule 1). */
export const categorySyncHandler: SyncTableHandler = {
  table: 'categories',
  pull: async (executor, userId, since, limit) =>
    run('pull', async () => {
      const rows = await executor
        .select()
        .from(categories)
        .where(and(eq(categories.userId, userId), gt(categories.changeSeq, since)))
        .orderBy(asc(categories.changeSeq))
        .limit(limit)
      return rows.map(toCategory)
    }),
  push: {
    validate: validateCategory,
    find: async (executor, id) =>
      run(
        'find',
        async () => {
          const row = await findRow(executor, id)
          return row ? { ownerId: row.userId, row: toCategory(row) } : null
        },
        { id }
      ),
    check: async (executor, userId, row) =>
      run('check', async () => checkCategory(executor, userId, row), { id: row.id }),
    write: async (executor, userId, row) =>
      run(
        'write',
        async () => {
          const values = {
            id: row.id,
            userId,
            profileId: String(row.profileId),
            type: String(row.type) as Category['type'],
            parentId: typeof row.parentId === 'string' ? row.parentId : null,
            name: String(row.name),
            icon: String(row.icon),
            color: String(row.color),
            isArchived: row.isArchived === true,
            sortOrder: Number(row.sortOrder),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            changeSeq: row.changeSeq,
            updatedBy: row.updatedBy,
          }
          const [written] = await executor
            .insert(categories)
            .values(values)
            .onConflictDoUpdate({ target: categories.id, set: values })
            .returning()
          return toCategory(written)
        },
        { id: row.id }
      ),
    purge: async (executor, before) =>
      run('purge', async () => {
        const old = lt(categories.deletedAt, before)
        const [{ maxSeq }] = await executor
          .select({ maxSeq: max(categories.changeSeq) })
          .from(categories)
          .where(old)
        const removed = await executor
          .delete(categories)
          .where(old)
          .returning({ id: categories.id })
        return { removed: removed.length, maxSeq: maxSeq ?? 0 }
      }),
  },
}
