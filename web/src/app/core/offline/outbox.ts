import { putRow, SYNC_TABLES } from './sync-tables'
import { uuidv7 } from './uuid'
import type { LocalDatabase, SqlValue } from './local-database'
import type { SyncRow } from './sync-tables'

/** An op waiting in the outbox, or refused by the server (offline-sync rule 10). */
export interface OutboxOp {
  seq: number
  opId: string
  table: string
  rowId: string
  op: 'upsert' | 'delete'
  row: SyncRow
  baseSeq: number | null
  createdAt: number
  status: 'pending' | 'rejected'
  code: string | null
  error: string | null
}

const toOp = (row: Record<string, SqlValue>): OutboxOp => ({
  seq: Number(row['seq']),
  opId: String(row['op_id']),
  table: String(row['tbl']),
  rowId: String(row['row_id']),
  op: row['op'] === 'delete' ? 'delete' : 'upsert',
  row: JSON.parse(String(row['row'])) as SyncRow,
  baseSeq: row['base_seq'] === null ? null : Number(row['base_seq']),
  createdAt: Number(row['created_at']),
  status: row['status'] === 'rejected' ? 'rejected' : 'pending',
  code: row['code'] === null ? null : String(row['code']),
  error: row['error'] === null ? null : String(row['error']),
})

export const listOps = (db: LocalDatabase, status: OutboxOp['status'], limit = -1): OutboxOp[] =>
  db
    .selectObjects('SELECT * FROM outbox WHERE status = ? ORDER BY seq LIMIT ?', [status, limit])
    .map(toOp)

export const findOp = (db: LocalDatabase, opId: string): OutboxOp | null => {
  const [row] = db.selectObjects('SELECT * FROM outbox WHERE op_id = ?', [opId]) as (
    Record<string, SqlValue> | undefined
  )[]
  return row ? toOp(row) : null
}

export const findPending = (db: LocalDatabase, table: string, rowId: string): OutboxOp | null => {
  const [row] = db.selectObjects(
    `SELECT * FROM outbox WHERE tbl = ? AND row_id = ? AND status = 'pending'`,
    [table, rowId]
  ) as (Record<string, SqlValue> | undefined)[]
  return row ? toOp(row) : null
}

export const countOps = (db: LocalDatabase, status: OutboxOp['status']): number =>
  Number(db.selectValue('SELECT count(*) FROM outbox WHERE status = ?', [status]))

/**
 * Rule 8: a local write of `row` and its outbox op, in the caller's transaction. One pending op
 * per row: a newer write replaces the pending op (with a new `opId`, in case the old one is in
 * flight) and keeps its `baseSeq`.
 */
export const queueWrite = (
  db: LocalDatabase,
  table: string,
  op: OutboxOp['op'],
  row: SyncRow & { id: string }
): void => {
  if (SYNC_TABLES[table].readOnly) {
    throw new Error(`${table} is read-only on devices`)
  }
  putRow(db, table, row)
  const outboxRow = JSON.stringify(
    op === 'delete' ? { id: row.id, updatedAt: row['updatedAt'] } : row
  )
  const pending = findPending(db, table, row.id)
  if (pending) {
    db.exec('UPDATE outbox SET op_id = ?, op = ?, row = ? WHERE seq = ?', [
      uuidv7(),
      op,
      outboxRow,
      pending.seq,
    ])
    return
  }
  const changeSeq = row['changeSeq']
  db.exec(
    'INSERT INTO outbox (op_id, tbl, row_id, op, row, base_seq, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      uuidv7(),
      table,
      row.id,
      op,
      outboxRow,
      typeof changeSeq === 'number' ? changeSeq : null,
      Date.now(),
    ]
  )
}

export const deleteOp = (db: LocalDatabase, opId: string): void => {
  db.exec('DELETE FROM outbox WHERE op_id = ?', [opId])
}
