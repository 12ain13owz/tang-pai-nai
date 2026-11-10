import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '@/core/config'
import { createDatabase } from './client'
import { users } from './schema/auth'
import { profiles } from './schema/profile'
import { walletMembers, wallets } from './schema/wallet'
import { walletAccess } from './wallet-access'
import type { Database } from './client'

let dir: string
let close: () => void
let db: Database

const sync = (userId: string) => ({ createdAt: 1, updatedAt: 1, changeSeq: 1, updatedBy: userId })

const wallet = (
  id: string,
  extra: Partial<typeof wallets.$inferInsert> = {}
): typeof wallets.$inferInsert => ({
  id,
  userId: 'alice',
  profileId: 'pa',
  name: id,
  currencyCode: 'THB',
  initialBalance: 0,
  icon: 'lucideWallet',
  color: '#2563eb',
  excludeFromTotal: false,
  isArchived: false,
  sortOrder: 0,
  deletedAt: null,
  ...sync('alice'),
  ...extra,
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-access-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(created.db, { migrationsFolder: 'drizzle' })
  await created.db.insert(users).values([
    { id: 'alice', email: 'a@example.com', displayName: 'a' },
    { id: 'bob', email: 'b@example.com', displayName: 'b' },
    { id: 'carol', email: 'c@example.com', displayName: 'c' },
  ])
  const profile = (id: string, deletedAt: number | null = null) => ({
    id,
    userId: 'alice',
    name: id,
    icon: 'lucideHouse',
    color: '#15803d',
    sortOrder: 0,
    deletedAt,
    ...sync('alice'),
  })
  await created.db.insert(profiles).values([profile('pa'), profile('gone', 5)])
  await created.db
    .insert(wallets)
    .values([
      wallet('home'),
      wallet('old', { isArchived: true }),
      wallet('deleted', { deletedAt: 5 }),
      wallet('orphan', { profileId: 'gone' }),
    ])
  await created.db.insert(walletMembers).values(
    ['home', 'old', 'deleted', 'orphan'].flatMap((walletId) => [
      { walletId, userId: 'bob', role: 'editor' as const, addedAt: 1 },
      { walletId, userId: 'carol', role: 'viewer' as const, addedAt: 1 },
    ])
  )
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('walletAccess', () => {
  it("answers the owner and each member's role on a live, open wallet", async () => {
    expect(await walletAccess(db, 'alice', 'home')).toEqual({ ownerId: 'alice', role: 'owner' })
    expect(await walletAccess(db, 'bob', 'home')).toEqual({ ownerId: 'alice', role: 'editor' })
    expect(await walletAccess(db, 'carol', 'home')).toEqual({ ownerId: 'alice', role: 'viewer' })
  })

  it('gives members no role on an archived or deleted wallet, or one on a deleted profile', async () => {
    for (const id of ['old', 'deleted', 'orphan']) {
      expect(await walletAccess(db, 'bob', id)).toEqual({ ownerId: 'alice', role: null })
    }
    // The owner keeps owning it (their own rules decide what may be written).
    expect(await walletAccess(db, 'alice', 'deleted')).toEqual({ ownerId: 'alice', role: 'owner' })
  })

  it('answers null for a wallet that does not exist', async () => {
    expect(await walletAccess(db, 'bob', 'nope')).toBeNull()
  })
})
