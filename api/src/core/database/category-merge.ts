import { eq } from 'drizzle-orm'
import { categories } from './schema/category'
import type { Executor } from './client'

/** How many merges in a row are followed (a target merged again later). */
const MAX_HOPS = 5

type CategoryRow = typeof categories.$inferSelect

const findCategory = async (executor: Executor, id: string): Promise<CategoryRow | undefined> =>
  (await executor.select().from(categories).where(eq(categories.id, id))).at(0)

/**
 * Where rows of a merged category go (docs/features/category.md rule 15): the live category its
 * tombstone's `mergedIntoId` leads to, following later merges, of the same owner, profile and
 * type, and not one of its own children. Null for a live category, a plain tombstone or a target
 * that is gone. Read by the category handler (its follow-ups) and the transaction handler (a
 * late push), so it lives here rather than in either feature.
 */
export const findMergeTarget = async (
  executor: Executor,
  userId: string,
  categoryId: string
): Promise<CategoryRow | null> => {
  const source = await findCategory(executor, categoryId)
  if (!source || source.userId !== userId || source.deletedAt === null) {
    return null
  }
  let current = source
  for (let hop = 0; hop < MAX_HOPS && current.mergedIntoId; hop++) {
    const next = await findCategory(executor, current.mergedIntoId)
    const fits =
      next !== undefined &&
      next.userId === userId &&
      next.profileId === source.profileId &&
      next.type === source.type &&
      next.id !== source.id
    if (!fits) {
      return null
    }
    if (next.deletedAt === null) {
      return next.parentId === source.id ? null : next
    }
    current = next
  }
  return null
}
