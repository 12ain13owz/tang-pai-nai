import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EnvConfig } from '@/core/config'
import * as schema from './schema'

const FILE_PREFIX = 'file:'

// libsql creates the SQLite file but not its folder (`data/` is gitignored, so it may not exist yet).
const ensureLocalDirectory = (url: string): void => {
  if (url.startsWith(FILE_PREFIX)) {
    mkdirSync(dirname(url.slice(FILE_PREFIX.length)), { recursive: true })
  }
}

export const createDatabase = ({ DATABASE_URL, DATABASE_AUTH_TOKEN }: EnvConfig) => {
  ensureLocalDirectory(DATABASE_URL)
  const client = createClient({ url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN })
  const db = drizzle(client, { schema, casing: 'snake_case' })

  return { client, db }
}

export type Database = ReturnType<typeof createDatabase>['db']
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
/** The database or an open transaction on it: what a repository adapter runs its queries on. */
export type Executor = Database | Transaction
