import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { syncColumns } from '@/core/database/columns'
import { users } from '@/core/database/schema/auth'
import { categories } from '@/core/database/schema/category'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'

// docs/features/transaction.md → Data model. A synced table like `categories`: the id comes from
// the device, rows travel through /sync/push and /sync/pull, and "delete" is a tombstone. The
// sign and the currency aren't stored: they come from the category's type and the wallet.
export const transactions = sqliteTable(
  'transactions',
  {
    id: text().primaryKey(),
    /** The wallet's owner. */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cascades: purging a profile's, wallet's or category's old tombstone takes its
    // transactions' tombstones with it (a live row never points at one for long, rule 10).
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    walletId: text()
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    categoryId: text()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    /** Minor units, always > 0. */
    amount: integer().notNull(),
    /** `YYYY-MM-DD`, the device's local date. */
    occurredOn: text().notNull(),
    /** `''` when empty. */
    note: text().notNull(),
    excludeFromReport: integer({ mode: 'boolean' }).notNull(),
    /** The recurring rule this row is an occurrence of (no FK: the rule may be gone). */
    recurringId: text(),
    ...syncColumns,
  },
  (table) => [
    index('transactions_user_seq_idx').on(table.userId, table.changeSeq),
    index('transactions_change_seq_idx').on(table.changeSeq),
    index('transactions_profile_idx').on(table.profileId),
    index('transactions_wallet_idx').on(table.walletId),
    index('transactions_category_idx').on(table.categoryId),
  ]
)
