import { integer, text } from 'drizzle-orm/sqlite-core'
import { v7 as uuidv7 } from 'uuid'

// Shared column builders so every table follows the locked conventions (ROADMAP → Money & data):
// UUIDv7 string ids, timestamps as integer epoch ms.

export const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => uuidv7())

export const epochMs = () => integer({ mode: 'timestamp_ms' })

export const timestamps = {
  createdAt: epochMs()
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: epochMs()
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
}

// Columns of every synced table (docs/features/offline-sync.md → Data model). Times stay plain
// epoch-ms numbers, because devices send and compare them as numbers. `id` comes from the device
// (UUIDv7), so synced tables use a plain text primary key without a default.
export const syncColumns = {
  createdAt: integer().notNull(),
  updatedAt: integer().notNull(),
  deletedAt: integer(),
  changeSeq: integer().notNull(),
  updatedBy: text().notNull(),
}
