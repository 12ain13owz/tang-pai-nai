import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { syncColumns } from '@/core/database/columns'
import { users } from '@/core/database/schema/auth'
import { categories } from '@/core/database/schema/category'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'

// docs/features/recurring.md → Data model. A rule for money that repeats: the device records
// each occurrence as a transaction or transfer when it is due, synced like any other row.
export const recurringRules = sqliteTable(
  'recurring_rules',
  {
    id: text().primaryKey(),
    /** The wallets' owner. */
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cascades: purging a profile's, wallet's or category's old tombstone takes the rule's.
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** `transaction` | `transfer` | `debt` (a debt's repayment, debt rule 13). */
    kind: text().notNull(),
    /** The transaction's wallet, or the wallet a transfer leaves. */
    walletId: text()
      .notNull()
      .references(() => wallets.id, { onDelete: 'cascade' }),
    /** A transaction rule's category; null for a transfer. */
    categoryId: text().references(() => categories.id, { onDelete: 'cascade' }),
    /** A transfer rule's wallet the money goes to; null for a transaction. */
    toWalletId: text().references(() => wallets.id, { onDelete: 'cascade' }),
    /**
     * A `debt` rule's debt, or a transaction rule's (its instalments); else null. No FK: SQLite
     * can't add one with a cascade to a table that exists, and the device deletes a debt's rules
     * with it (debt rule 5).
     */
    debtId: text(),
    /** Minor units, always > 0. */
    amount: integer().notNull(),
    /** `''` when empty. */
    note: text().notNull(),
    excludeFromReport: integer({ mode: 'boolean' }).notNull(),
    /** `YYYY-MM-DD`, the first occurrence. */
    startOn: text().notNull(),
    /** `day` | `week` | `month` | `year`. */
    frequency: text().notNull(),
    /** Every `interval` units, 1–99. */
    interval: integer().notNull(),
    /** `YYYY-MM-DD`: no occurrence after it. */
    endOn: text(),
    /** No occurrence after this many. */
    endCount: integer(),
    /** Ask before recording a due occurrence. */
    confirm: integer({ mode: 'boolean' }).notNull(),
    /** The first occurrence not recorded or skipped yet; null once the rule has ended. */
    nextOn: text(),
    isPaused: integer({ mode: 'boolean' }).notNull(),
    ...syncColumns,
  },
  (table) => [
    index('recurring_rules_user_seq_idx').on(table.userId, table.changeSeq),
    index('recurring_rules_change_seq_idx').on(table.changeSeq),
    index('recurring_rules_profile_idx').on(table.profileId),
    index('recurring_rules_wallet_idx').on(table.walletId),
    index('recurring_rules_category_idx').on(table.categoryId),
    index('recurring_rules_to_wallet_idx').on(table.toWalletId),
    index('recurring_rules_debt_idx').on(table.debtId),
  ]
)
