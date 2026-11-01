import type { LocalDatabase, SqlValue } from './local-database'

/**
 * The synced tables the device knows (offline-sync → Data model → Device). Rows travel camelCase
 * (the API's JSON) and are stored snake_case; `booleans` are stored as 0 / 1.
 */
export interface SyncTable {
  key: string
  columns: readonly string[]
  booleans?: readonly string[]
  /** Pull-only master data: no outbox ops, no tombstones. */
  readOnly?: boolean
}

export const SYNC_TABLES: Readonly<Record<string, SyncTable>> = {
  currencies: {
    key: 'code',
    columns: ['code', 'minorUnit', 'isActive', 'sortOrder', 'createdAt', 'updatedAt', 'changeSeq'],
    booleans: ['isActive'],
    readOnly: true,
  },
  profiles: {
    key: 'id',
    columns: [
      'id',
      'name',
      'icon',
      'color',
      'sortOrder',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'changeSeq',
      'updatedBy',
    ],
  },
  wallets: {
    key: 'id',
    columns: [
      'id',
      'profileId',
      'name',
      'currencyCode',
      'initialBalance',
      'icon',
      'color',
      'excludeFromTotal',
      'isArchived',
      'sortOrder',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'changeSeq',
      'updatedBy',
    ],
    booleans: ['excludeFromTotal', 'isArchived'],
  },
  // Dev only, removed at #6.2.
  sync_probes: {
    key: 'id',
    columns: [
      'id',
      'title',
      'amount',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'changeSeq',
      'updatedBy',
    ],
  },
}

export type SyncRow = Record<string, unknown>

const snake = (name: string): string => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

const toSql = (table: SyncTable, column: string, value: unknown): SqlValue => {
  if (table.booleans?.includes(column)) {
    return value ? 1 : 0
  }
  if (value === undefined || value === null) {
    return null
  }
  return typeof value === 'number' || typeof value === 'string' ? value : JSON.stringify(value)
}

/** Writes `row` (camelCase) into its table, replacing the row with the same key. */
export const putRow = (db: LocalDatabase, name: string, row: SyncRow): void => {
  const table = SYNC_TABLES[name]
  const columns = table.columns.map(snake).join(', ')
  const marks = table.columns.map(() => '?').join(', ')
  db.exec(
    `INSERT OR REPLACE INTO ${name} (${columns}) VALUES (${marks})`,
    table.columns.map((column) => toSql(table, column, row[column]))
  )
}

export const deleteRow = (db: LocalDatabase, name: string, id: string): void => {
  db.exec(`DELETE FROM ${name} WHERE ${snake(SYNC_TABLES[name].key)} = ?`, [id])
}

/** One row by key, camelCase, or null. */
export const getRow = (db: LocalDatabase, name: string, id: string): SyncRow | null => {
  const table = SYNC_TABLES[name]
  const [row] = db.selectObjects(`SELECT * FROM ${name} WHERE ${snake(table.key)} = ?`, [id]) as (
    Record<string, SqlValue> | undefined
  )[]
  return row ? fromSql(name, row) : null
}

/** A stored row back to camelCase (booleans as booleans). */
export const fromSql = (name: string, row: Record<string, SqlValue>): SyncRow => {
  const table = SYNC_TABLES[name]
  const out: SyncRow = {}
  for (const column of table.columns) {
    const value = row[snake(column)]
    out[column] = table.booleans?.includes(column) ? value === 1 : value
  }
  return out
}

/** Clears every synced table (a full resync, rule 9). The outbox stays. */
export const clearSyncTables = (db: LocalDatabase): void => {
  for (const name of Object.keys(SYNC_TABLES)) {
    db.exec(`DELETE FROM ${name}`)
  }
}
