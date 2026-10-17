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
