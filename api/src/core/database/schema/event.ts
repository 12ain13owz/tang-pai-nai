import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { syncColumns } from '@/core/database/columns'
import { users } from '@/core/database/schema/auth'
import { profiles } from '@/core/database/schema/profile'

// docs/features/event.md → Data model. A trip or event that transactions point at
// (`transactions.eventId`); its totals are computed from them, never stored.
export const events = sqliteTable(
  'events',
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Cascade: purging a profile's old tombstone takes its events' tombstones with it.
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** 1–50 characters. */
    name: text().notNull(),
    /** A lucide export name or one of our own `tpn` icons (as wallets). */
    icon: text().notNull(),
    /** `#rrggbb`. */
    color: text().notNull(),
    /** `YYYY-MM-DD`. */
    startOn: text().notNull(),
    /** `YYYY-MM-DD` not before `startOn`, or null (no end set). */
    endOn: text(),
    /** "จบแล้ว": out of the picker and the form's default (event rule 6). */
    isClosed: integer({ mode: 'boolean' }).notNull(),
    ...syncColumns,
  },
  (table) => [
    index('events_user_seq_idx').on(table.userId, table.changeSeq),
    index('events_change_seq_idx').on(table.changeSeq),
    index('events_profile_idx').on(table.profileId),
  ]
)
