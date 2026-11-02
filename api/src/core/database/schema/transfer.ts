import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { syncColumns } from '@/core/database/columns'
import { users } from '@/core/database/schema/auth'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'

// docs/features/transfer.md → Data model. One row per transfer (both sides), synced like
// `transactions`; the list shows it as two rows, out of one wallet and into the other.
export const transfers = sqliteTable(
  'transfers',
  {
    id: text().primaryKey(),
    /** The wallets' owner. */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cascades: purging a profile's or a wallet's old tombstone takes its transfers' with it.
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    fromWalletId: text()
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    toWalletId: text()
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    /** Minor units, always > 0. */
    amount: integer().notNull(),
    /** `YYYY-MM-DD`, the device's local date. */
    occurredOn: text().notNull(),
    /** `''` when empty. */
    note: text().notNull(),
    ...syncColumns,
  },
  (table) => [
    index('transfers_user_seq_idx').on(table.userId, table.changeSeq),
    index('transfers_change_seq_idx').on(table.changeSeq),
    index('transfers_profile_idx').on(table.profileId),
    index('transfers_from_wallet_idx').on(table.fromWalletId),
    index('transfers_to_wallet_idx').on(table.toWalletId),
  ]
)
