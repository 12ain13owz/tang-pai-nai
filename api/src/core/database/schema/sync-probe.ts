import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { syncColumns } from '@/core/database/columns'
import { users } from '@/core/database/schema/auth'

// Temporary, dev only (offline-sync → tables synced in 4a.2): proves push end to end until Wallet
// (#6) syncs, then a migration drops it.
export const syncProbes = sqliteTable(
  'sync_probes',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    amount: integer().notNull(),
    ...syncColumns,
  },
  (table) => [
    index('sync_probes_user_seq_idx').on(table.userId, table.changeSeq),
    index('sync_probes_change_seq_idx').on(table.changeSeq),
  ]
)
