import { findPending, fromSql, moveOpLast, putRow, queueWrite } from '@/core/offline'
import type { LocalDatabase, SyncRow } from '@/core/offline'
import { RECURRING_TABLE, TRANSACTION_TABLE } from '@/core/wallet'
import { CATEGORY_TABLE } from './category.type'

/** How many merges in a row are followed (a target merged again later), as on the server. */
const MAX_HOPS = 5

const findRow = (db: LocalDatabase, table: string, id: string): SyncRow | null => {
  const row = db.selectObjects(`SELECT * FROM ${table} WHERE id = ?`, [id]).at(0)
  return row ? fromSql(table, row) : null
}

/**
 * Where rows of a merged category go (docs/features/category.md rule 15), as far as this device
 * knows: the live category its tombstone's `mergedIntoId` leads to, following later merges, of
 * the same profile and type and not one of its own children. Null otherwise. The server's
 * `findMergeTarget` reads the same way.
 */
export const mergeTargetOf = (db: LocalDatabase, categoryId: string): string | null => {
  const source = findRow(db, CATEGORY_TABLE, categoryId)
  if (!source || source['deletedAt'] === null) {
    return null
  }
  let current = source
  for (let hop = 0; hop < MAX_HOPS && typeof current['mergedIntoId'] === 'string'; hop++) {
    const next = findRow(db, CATEGORY_TABLE, current['mergedIntoId'])
    if (
      !next ||
      next['profileId'] !== source['profileId'] ||
      next['type'] !== source['type'] ||
      next['id'] === source['id']
    ) {
      return null
    }
    if (next['deletedAt'] === null) {
      return next['parentId'] === source['id'] ? null : String(next['id'])
    }
    current = next
  }
  return null
}

/**
 * Changes a row that moves with a merge. One with a pending op gets the op rewritten (the op
 * holds the values it pushes); any other changes here only, because the server makes the same
 * move and its version arrives with the next pull (rule 15).
 */
export const moveRow = (
  db: LocalDatabase,
  table: string,
  row: SyncRow & { id: string },
  changes: SyncRow,
  now: number
): void => {
  if (findPending(db, table, row.id)) {
    queueWrite(db, table, 'upsert', { ...row, ...changes, updatedAt: now })
    // After the rows it may now point at (a target made after it).
    moveOpLast(db, table, row.id)
  } else {
    putRow(db, table, { ...row, ...changes })
  }
}

/**
 * Moves the live transactions of `fromId` to `toId` (rule 15), and its live recurring rules
 * (recurring rule 13); how many transactions.
 */
export const moveTransactions = (
  db: LocalDatabase,
  fromId: string,
  toId: string,
  now: number
): number => {
  let moved = 0
  for (const table of [TRANSACTION_TABLE, RECURRING_TABLE]) {
    const rows = db.selectObjects(
      `SELECT * FROM ${table} WHERE category_id = ? AND deleted_at IS NULL`,
      [fromId]
    )
    for (const row of rows) {
      moveRow(db, table, fromSql(table, row) as SyncRow & { id: string }, { categoryId: toId }, now)
    }
    if (table === TRANSACTION_TABLE) {
      moved = rows.length
    }
  }
  return moved
}

interface MergeLeftovers {
  /** Live children of a merged parent, with the target each is merged into. */
  children: { child: SyncRow & { id: string }; target: string }[]
  /** Merged categories that still hold live transactions or rules, with their targets. */
  categories: { id: string; target: string }[]
}

/** What still points at a merged tombstone here and has a target to follow (rule 15). */
const mergeLeftovers = (db: LocalDatabase): MergeLeftovers => {
  const children = db
    .selectObjects(
      `SELECT c.* FROM ${CATEGORY_TABLE} c JOIN ${CATEGORY_TABLE} p ON p.id = c.parent_id
       WHERE c.deleted_at IS NULL AND p.deleted_at IS NOT NULL AND p.merged_into_id IS NOT NULL`
    )
    .map((row) => fromSql(CATEGORY_TABLE, row) as SyncRow & { id: string })
    .map((child) => ({ child, target: mergeTargetOf(db, String(child['parentId'])) }))
  const categories = db
    .selectObjects(
      `SELECT DISTINCT t.category_id AS id
       FROM (SELECT category_id, deleted_at FROM ${TRANSACTION_TABLE}
             UNION ALL SELECT category_id, deleted_at FROM ${RECURRING_TABLE}) t
       JOIN ${CATEGORY_TABLE} c ON c.id = t.category_id
       WHERE t.deleted_at IS NULL AND c.deleted_at IS NOT NULL AND c.merged_into_id IS NOT NULL`
    )
    .map((row) => ({ id: String(row['id']), target: mergeTargetOf(db, String(row['id'])) }))
  const found = <T extends { target: string | null }>(list: T[]) =>
    list.filter((item): item is T & { target: string } => item.target !== null)
  return { children: found(children), categories: found(categories) }
}

/** Whether `followMerges` has anything to do (so a sweep writes only when needed). */
export const hasMergeLeftovers = (db: LocalDatabase): boolean => {
  const { children, categories } = mergeLeftovers(db)
  return children.length > 0 || categories.length > 0
}

/**
 * What still points at a merged tombstone here (pulled from a device that didn't know of the
 * merge, or a tombstone pulled before the rows) follows it: live children are merged into the
 * target and every live transaction moves (rule 15). Run before the plain sweeps (category
 * rule 6, transaction rule 10), which take what has no target to follow.
 */
export const followMerges = (db: LocalDatabase, now: number): void => {
  const { children } = mergeLeftovers(db)
  for (const { child, target } of children) {
    moveRow(db, CATEGORY_TABLE, child, { deletedAt: now, mergedIntoId: target }, now)
  }
  // Read again: the children just merged hold transactions too.
  for (const { id, target } of mergeLeftovers(db).categories) {
    moveTransactions(db, id, target, now)
  }
}
