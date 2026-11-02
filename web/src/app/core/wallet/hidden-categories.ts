import { fromSql } from '@/core/offline'
import type { LocalDatabase, SyncRow } from '@/core/offline'
import { WALLET_LIMITS, WALLET_TABLE } from './wallet.type'
import type { Wallet } from './wallet.type'

/** The categories table, read by name: `core/category` builds on this folder, not the reverse. */
const CATEGORIES = 'categories'

/**
 * Category rule 13: a category is hidden in a wallet when its own id is listed, or its parent's
 * (hiding a parent hides its children, also ones added later).
 */
export const isHiddenIn = (
  hidden: readonly string[],
  category: { id: string; parentId: string | null }
): boolean =>
  hidden.includes(category.id) || (category.parentId !== null && hidden.includes(category.parentId))

/** A stored wallet row as a `Wallet` (the JSON column may hold anything a bad write left). */
export const toWallet = (row: SyncRow): Wallet => {
  const hidden = row['hiddenCategoryIds']
  return {
    ...(row as unknown as Wallet),
    hiddenCategoryIds: Array.isArray(hidden)
      ? hidden.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

/** One wallet row of the local database, tombstones included. */
export const findWallet = (db: LocalDatabase, id: string): Wallet | null => {
  const row = db.selectObjects(`SELECT * FROM ${WALLET_TABLE} WHERE id = ?`, [id]).at(0)
  return row ? toWallet(fromSql(WALLET_TABLE, row)) : null
}

/**
 * Category rule 13 before a wallet is written: no duplicates, no ids this device knows are
 * tombstones (unknown and archived ones stay), at most 200 (archived ones go first if ever over).
 */
export const cleanHidden = (db: LocalDatabase, ids: readonly string[]): string[] => {
  const unique = [...new Set(ids)]
  if (unique.length === 0) {
    return []
  }
  const marks = unique.map(() => '?').join(', ')
  const known = new Map(
    db
      .selectObjects(
        `SELECT id, deleted_at, is_archived FROM ${CATEGORIES} WHERE id IN (${marks})`,
        unique
      )
      .map((row) => [
        String(row['id']),
        { deleted: row['deleted_at'] !== null, archived: row['is_archived'] === 1 },
      ])
  )
  const kept = unique.filter((id) => known.get(id)?.deleted !== true)
  if (kept.length <= WALLET_LIMITS.HIDDEN_CATEGORIES_MAX) {
    return kept
  }
  const open = kept.filter((id) => known.get(id)?.archived !== true)
  return open.slice(0, WALLET_LIMITS.HIDDEN_CATEGORIES_MAX)
}
