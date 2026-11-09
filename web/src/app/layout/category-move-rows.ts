import { CATEGORY_TABLE } from '@/core/category'
import { fromSql, queueWrite } from '@/core/offline'
import type { LocalDatabase, SqlValue, SyncRow } from '@/core/offline'
import { cleanHidden, findWallet, TRANSACTION_TABLE, WALLET_TABLE } from '@/core/wallet'

/** A wallet that holds some of a category's transactions, with how many (export.md rule 8). */
export interface MoveSource {
  walletId: string
  walletName: string
  walletIcon: string
  walletColor: string
  count: number
}

/** What a move changed, so the toast's เลิกทำ can put it back (rule 9). */
export interface MoveUndo {
  fromId: string
  toId: string
  ids: string[]
  /** The wallet whose hidden list the move changed, and the list before. */
  hidden: { walletId: string; before: string[] } | null
}

/**
 * The wallets holding `categoryId`'s own live transactions, archived ones too, in the wallets'
 * order (rule 8). Its children's rows are not counted: they stay where they are (rule 7).
 */
export const moveSources = (db: LocalDatabase, categoryId: string): MoveSource[] =>
  db
    .selectObjects(
      `SELECT w.id, w.name, w.icon, w.color, count(*) AS n
       FROM ${TRANSACTION_TABLE} t JOIN ${WALLET_TABLE} w ON w.id = t.wallet_id
       WHERE t.category_id = ? AND t.deleted_at IS NULL
       GROUP BY w.id
       ORDER BY w.is_archived, w.sort_order, w.created_at, w.id`,
      [categoryId]
    )
    .map((row) => ({
      walletId: String(row['id']),
      walletName: String(row['name'] ?? ''),
      walletIcon: String(row['icon'] ?? ''),
      walletColor: String(row['color'] ?? ''),
      count: Number(row['n']),
    }))

const isLive = (db: LocalDatabase, categoryId: string): boolean =>
  db.selectValue(`SELECT 1 FROM ${CATEGORY_TABLE} WHERE id = ? AND deleted_at IS NULL`, [
    categoryId,
  ]) !== undefined

const moveRows = (
  db: LocalDatabase,
  rows: Record<string, SqlValue>[],
  categoryId: string,
  now: number
): string[] =>
  rows.map((raw) => {
    const row = fromSql(TRANSACTION_TABLE, raw) as SyncRow & { id: string }
    // Only `categoryId` changes; a pending op of the row is rewritten (outbox rule).
    queueWrite(db, TRANSACTION_TABLE, 'upsert', { ...row, categoryId, updatedAt: now })
    return row.id
  })

const setHidden = (db: LocalDatabase, walletId: string, ids: string[], now: number): void => {
  const wallet = findWallet(db, walletId)
  if (!wallet || wallet.deletedAt !== null) {
    return
  }
  queueWrite(db, WALLET_TABLE, 'upsert', {
    ...wallet,
    hiddenCategoryIds: cleanHidden(db, ids),
    updatedAt: now,
  })
}

/**
 * Rule 9: moves `fromId`'s own live transactions (of `walletId` only, when given) to `toId`, and
 * hides `fromId` in that wallet when asked, inside the caller's write. Null when there is
 * nothing to move or the target is not a live category.
 */
export const moveCategoryRows = (
  db: LocalDatabase,
  fromId: string,
  toId: string,
  walletId: string | null,
  hide: boolean,
  now: number
): MoveUndo | null => {
  if (fromId === toId || !isLive(db, toId)) {
    return null
  }
  const rows = db.selectObjects(
    `SELECT * FROM ${TRANSACTION_TABLE}
     WHERE category_id = ? AND deleted_at IS NULL${walletId ? ' AND wallet_id = ?' : ''}`,
    walletId ? [fromId, walletId] : [fromId]
  )
  if (rows.length === 0) {
    return null
  }
  const ids = moveRows(db, rows, toId, now)
  let hidden: MoveUndo['hidden'] = null
  const wallet = walletId && hide ? findWallet(db, walletId) : null
  if (wallet && !wallet.hiddenCategoryIds.includes(fromId)) {
    hidden = { walletId: wallet.id, before: wallet.hiddenCategoryIds }
    setHidden(db, wallet.id, [...wallet.hiddenCategoryIds, fromId], now)
  }
  return { fromId, toId, ids, hidden }
}

/**
 * The toast's เลิกทำ (rule 9): rows of the move still live on the target go back to the source
 * (one edited since keeps its new category), and the wallet's hidden list goes back. How many
 * rows went back.
 */
export const undoCategoryMove = (db: LocalDatabase, undo: MoveUndo, now: number): number => {
  if (!isLive(db, undo.fromId)) {
    return 0
  }
  let back = 0
  // In chunks: SQLite caps the number of bound values.
  for (let start = 0; start < undo.ids.length; start += 500) {
    const chunk = undo.ids.slice(start, start + 500)
    const rows = db.selectObjects(
      `SELECT * FROM ${TRANSACTION_TABLE}
       WHERE category_id = ? AND deleted_at IS NULL AND id IN (${chunk.map(() => '?').join(', ')})`,
      [undo.toId, ...chunk]
    )
    back += moveRows(db, rows, undo.fromId, now).length
  }
  if (undo.hidden) {
    const wallet = findWallet(db, undo.hidden.walletId)
    if (wallet) {
      // Only the id this move added comes off; other changes made meanwhile stay.
      const added = !undo.hidden.before.includes(undo.fromId)
      setHidden(
        db,
        wallet.id,
        added
          ? wallet.hiddenCategoryIds.filter((id) => id !== undo.fromId)
          : wallet.hiddenCategoryIds,
        now
      )
    }
  }
  return back
}
