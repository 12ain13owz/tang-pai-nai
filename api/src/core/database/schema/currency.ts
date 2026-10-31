import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// docs/features/currency.md → Data model. Master data: pulled by devices, never pushed or deleted,
// so it has `changeSeq` but no `deletedAt` / `updatedBy`. Rows come from a migration.
export const currencies = sqliteTable(
  'currencies',
  {
    code: text().primaryKey(),
    minorUnit: integer().notNull(),
    isActive: integer({ mode: 'boolean' }).notNull().default(false),
    sortOrder: integer().notNull().default(0),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
    changeSeq: integer().notNull(),
  },
  (table) => [uniqueIndex('currencies_change_seq_idx').on(table.changeSeq)]
)
