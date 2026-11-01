import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { syncColumns } from '@/core/database/columns'
import { users } from '@/core/database/schema/auth'
import { currencies } from '@/core/database/schema/currency'
import { profiles } from '@/core/database/schema/profile'

// docs/features/wallet.md → Data model. A synced table like `profiles`: the id comes from the
// device, rows travel through /sync/push and /sync/pull, and "delete" is a tombstone.
export const wallets = sqliteTable(
  'wallets',
  {
    id: text().primaryKey(),
    /** The owner (offline-sync rule 13). */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cascade: purging a profile's old tombstone takes its wallets' tombstones with it, whatever
    // order the cleanup visits the tables in.
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    currencyCode: text()
      .notNull()
      .references(() => currencies.code),
    /** Minor units, may be negative. */
    initialBalance: integer().notNull(),
    icon: text().notNull(),
    color: text().notNull(),
    excludeFromTotal: integer({ mode: 'boolean' }).notNull(),
    isArchived: integer({ mode: 'boolean' }).notNull(),
    sortOrder: integer().notNull(),
    ...syncColumns,
  },
  (table) => [
    index('wallets_user_seq_idx').on(table.userId, table.changeSeq),
    index('wallets_change_seq_idx').on(table.changeSeq),
    index('wallets_profile_idx').on(table.profileId),
  ]
)

// Members of a shared wallet (offline-sync rules 13–16). Server only, not synced, and empty until
// the sharing UI (#16). The owner isn't listed.
export const walletMembers = sqliteTable(
  'wallet_members',
  {
    walletId: text()
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text({ enum: ['editor', 'viewer'] }).notNull(),
    addedAt: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.walletId, table.userId] }),
    index('wallet_members_user_idx').on(table.userId),
  ]
)
