import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { syncColumns } from '@/core/database/columns'
import { users } from '@/core/database/schema/auth'
import { categories } from '@/core/database/schema/category'
import { currencies } from '@/core/database/schema/currency'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'

// docs/features/debt.md → Data model. A debt borrowed from or lent to someone; what is left is
// computed from its entries and linked transactions, never stored.
export const debts = sqliteTable(
  'debts',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cascades: purging a profile's or category's old tombstone takes the debt's.
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** `borrowed` | `lent`; never changes. */
    direction: text().notNull(),
    /** Who or where, free text (1–50). */
    person: text().notNull(),
    /** `''` when empty. */
    note: text().notNull(),
    /** Never changes: its entries' wallets have it. */
    currencyCode: text()
      .notNull()
      .references(() => currencies.code),
    /** `spent` | `repaid` (borrowed only); never changes. */
    countAs: text().notNull(),
    /** The expense category of a `repaid` debt's instalments; null for `spent`. */
    categoryId: text().references(() => categories.id, { onDelete: 'cascade' }),
    /** `YYYY-MM-DD` or null. */
    dueOn: text(),
    ...syncColumns,
  },
  (table) => [
    index('debts_user_seq_idx').on(table.userId, table.changeSeq),
    index('debts_change_seq_idx').on(table.changeSeq),
    index('debts_profile_idx').on(table.profileId),
    index('debts_category_idx').on(table.categoryId),
  ]
)

// The money of a debt that is not income or expense (debt rule 3): borrowed / lent, repaid.
export const debtEntries = sqliteTable(
  'debt_entries',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    debtId: text()
      .notNull()
      .references(() => debts.id, { onDelete: 'cascade' }),
    /** `principal` | `repayment`. */
    kind: text().notNull(),
    /** Null only on a `repaid` debt (its principal, a forgiven rest; debt rule 4). */
    walletId: text().references(() => wallets.id, { onDelete: 'cascade' }),
    /** Minor units, always > 0. */
    amount: integer().notNull(),
    /** `YYYY-MM-DD`. */
    occurredOn: text().notNull(),
    /** `''` when empty. */
    note: text().notNull(),
    /** The recurring rule this row is an occurrence of (no FK: the rule may be gone). */
    recurringId: text(),
    ...syncColumns,
  },
  (table) => [
    index('debt_entries_user_seq_idx').on(table.userId, table.changeSeq),
    index('debt_entries_change_seq_idx').on(table.changeSeq),
    index('debt_entries_profile_idx').on(table.profileId),
    index('debt_entries_debt_idx').on(table.debtId),
    index('debt_entries_wallet_idx').on(table.walletId),
  ]
)
