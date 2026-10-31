import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from '@/core/database/schema/auth'

// Sync bookkeeping (docs/features/offline-sync.md → Data model → Server: sync tables).

// One row (id = 1): the database-wide `changeSeq` counter and the purge watermark (rule 9).
export const syncState = sqliteTable(
  'sync_state',
  {
    id: integer().primaryKey(),
    lastSeq: integer().notNull().default(0),
    purgedSeq: integer().notNull().default(0),
  },
  (table) => [check('sync_state_single_row', sql`${table.id} = 1`)]
)

// Pushed ops, so a retried push never applies an op twice (rule 10).
export const syncOps = sqliteTable(
  'sync_ops',
  {
    opId: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text().notNull(),
    appliedAt: integer().notNull(),
    // The per-op result as sent, JSON.
    result: text().notNull(),
  },
  (table) => [index('sync_ops_applied_at_idx').on(table.appliedAt)]
)

// The versions that lost a conflict (rule 12).
export const changeHistory = sqliteTable(
  'change_history',
  {
    id: text().primaryKey(),
    table: text().notNull(),
    rowId: text().notNull(),
    walletId: text(),
    overwrittenBy: text().notNull(),
    overwrittenByDevice: text().notNull(),
    previous: text().notNull(),
    loserUserId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    loserDeviceId: text(),
    changeSeq: integer().notNull(),
    createdAt: integer().notNull(),
  },
  (table) => [index('change_history_loser_seq_idx').on(table.loserUserId, table.changeSeq)]
)
