import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '@/core/config'
import type { Database } from '@/core/database'
import { createDatabase } from '@/core/database/client'
import { users } from '@/core/database/schema/auth'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'
import type { SyncPushHandler, SyncRowWrite } from '@/core/sync'
import { WALLET_MESSAGE } from './wallet.const'
import { walletSyncHandler } from './wallet.repository.drizzle'

let dir: string
let close: () => void
let db: Database

const push = walletSyncHandler.push as SyncPushHandler

const wallet = (
  id: string,
  name: string,
  changeSeq: number,
  extra: Partial<SyncRowWrite> = {}
) => ({
  id,
  profileId: 'pa',
  name,
  currencyCode: 'THB',
  initialBalance: 0,
  icon: 'lucideWallet',
  color: '#16a34a',
  excludeFromTotal: false,
  isArchived: false,
  sortOrder: 0,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  changeSeq,
  updatedBy: 'alice',
  ...extra,
})

const profile = (id: string, userId: string, deletedAt: number | null = null) => ({
  id,
  userId,
  name: id,
  icon: 'lucideHouse',
  color: '#16a34a',
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
  deletedAt,
  changeSeq: 1,
  updatedBy: userId,
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-wallet-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  // The committed migrations: THB active, USD and the others inactive (0005_currency_seed).
  await migrate(created.db, { migrationsFolder: 'drizzle' })
  await created.db.insert(users).values([
    { id: 'alice', email: 'a@example.com', displayName: 'a' },
    { id: 'bob', email: 'b@example.com', displayName: 'b' },
  ])
  await created.db
    .insert(profiles)
    .values([
      profile('pa', 'alice'),
      profile('pa2', 'alice'),
      profile('gone', 'alice', 500),
      profile('pb', 'bob'),
    ])
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('walletSyncHandler', () => {
  it('writes a wallet with its booleans and replaces it on the next write, without userId', async () => {
    const written = await push.write(db, 'alice', wallet('w1', 'Cash', 15, { initialBalance: -5 }))
    expect(written).toEqual(wallet('w1', 'Cash', 15, { initialBalance: -5 }))
    await push.write(db, 'alice', wallet('w1', 'Card', 16, { isArchived: true }))
    expect(await push.find(db, 'w1')).toEqual({
      ownerId: 'alice',
      row: wallet('w1', 'Card', 16, { isArchived: true }),
    })
    expect(await push.find(db, 'nope')).toBeNull()
  })

  it("pulls only the user's wallets after the cursor, tombstones included", async () => {
    await push.write(db, 'alice', wallet('w1', 'A', 15))
    await push.write(db, 'bob', wallet('w2', 'B', 16, { profileId: 'pb', updatedBy: 'bob' }))
    await push.write(db, 'alice', wallet('w3', 'C', 17, { deletedAt: 1000 }))
    const rows = await walletSyncHandler.pull(db, 'alice', 15, 10)
    expect(rows.map((row) => row.id)).toEqual(['w3'])
    expect(await walletSyncHandler.pull(db, 'alice', 0, 1)).toHaveLength(1)
    expect((await walletSyncHandler.pull(db, 'bob', 0, 10)).map((row) => row.id)).toEqual(['w2'])
  })

  it("refuses a profile that isn't the user's live one, and a move to another profile", async () => {
    expect(await push.check(db, 'alice', wallet('w9', 'X', 0, { profileId: 'pb' }))).toBe(
      WALLET_MESSAGE.PROFILE_GONE
    )
    expect(await push.check(db, 'alice', wallet('w9', 'X', 0, { profileId: 'gone' }))).toBe(
      WALLET_MESSAGE.PROFILE_GONE
    )
    expect(await push.check(db, 'alice', wallet('w9', 'X', 0, { profileId: 'nope' }))).toBe(
      WALLET_MESSAGE.PROFILE_GONE
    )
    await push.write(db, 'alice', wallet('w1', 'Cash', 15))
    expect(await push.check(db, 'alice', wallet('w1', 'Cash', 0, { profileId: 'pa2' }))).toBe(
      WALLET_MESSAGE.PROFILE_FIXED
    )
  })

  it('needs an active currency for a new wallet or a changed one, not for one kept', async () => {
    expect(await push.check(db, 'alice', wallet('w9', 'X', 0, { currencyCode: 'USD' }))).toBe(
      WALLET_MESSAGE.CURRENCY_INACTIVE
    )
    expect(await push.check(db, 'alice', wallet('w9', 'X', 0, { currencyCode: 'ZZZ' }))).toBe(
      WALLET_MESSAGE.CURRENCY_INACTIVE
    )
    // A wallet whose currency was switched off later keeps it (currency rule 3).
    await db
      .insert(wallets)
      .values({ ...wallet('w1', 'Old', 15, { currencyCode: 'USD' }), userId: 'alice' })
    expect(
      await push.check(db, 'alice', wallet('w1', 'Renamed', 0, { currencyCode: 'USD' }))
    ).toBeNull()
    expect(await push.check(db, 'alice', wallet('w1', 'Renamed', 0, { currencyCode: 'JPY' }))).toBe(
      WALLET_MESSAGE.CURRENCY_INACTIVE
    )
    expect(await push.check(db, 'alice', wallet('w1', 'Renamed', 0))).toBeNull()
  })

  it("refuses a name used by another of the profile's open wallets, in any case", async () => {
    await push.write(db, 'alice', wallet('w1', 'Cash', 15))
    await push.write(db, 'alice', wallet('w2', 'Old', 16, { isArchived: true }))
    await push.write(db, 'alice', wallet('w3', 'Gone', 17, { deletedAt: 1000 }))
    expect(await push.check(db, 'alice', wallet('w9', 'CASH', 0))).toBe(WALLET_MESSAGE.NAME_TAKEN)
    expect(await push.check(db, 'alice', wallet('w1', 'Cash', 0))).toBeNull() // itself
    expect(await push.check(db, 'alice', wallet('w9', 'Old', 0))).toBeNull() // archived
    expect(await push.check(db, 'alice', wallet('w9', 'Gone', 0))).toBeNull() // deleted
    expect(await push.check(db, 'alice', wallet('w9', 'Cash', 0, { profileId: 'pa2' }))).toBeNull()
    // An archived wallet holds no name, so it may share one; a tombstone runs no check at all.
    expect(await push.check(db, 'alice', wallet('w9', 'Cash', 0, { isArchived: true }))).toBeNull()
    expect(
      await push.check(db, 'alice', wallet('w9', 'Cash', 0, { profileId: 'pb', deletedAt: 5 }))
    ).toBeNull()
  })

  it('refuses a 21st open wallet but lets archived ones in and the 20 be edited', async () => {
    for (let i = 1; i <= 20; i++) {
      await push.write(db, 'alice', wallet(`w${i}`, `W${i}`, 100 + i))
    }
    expect(await push.check(db, 'alice', wallet('w21', 'W21', 0))).toBe(WALLET_MESSAGE.TOO_MANY)
    expect(await push.check(db, 'alice', wallet('w21', 'W21', 0, { isArchived: true }))).toBeNull()
    expect(await push.check(db, 'alice', wallet('w20', 'Renamed', 0))).toBeNull()
    expect(await push.check(db, 'alice', wallet('w21', 'W21', 0, { profileId: 'pa2' }))).toBeNull()
    await push.write(db, 'alice', wallet('w20', 'W20', 200, { isArchived: true }))
    expect(await push.check(db, 'alice', wallet('w21', 'W21', 0))).toBeNull()
  })

  it('purges tombstones deleted before a time and answers the highest changeSeq removed', async () => {
    await push.write(db, 'alice', wallet('w1', 'A', 15, { deletedAt: 100 }))
    await push.write(db, 'alice', wallet('w2', 'B', 16, { deletedAt: 200 }))
    await push.write(db, 'alice', wallet('w3', 'C', 17, { deletedAt: 900 }))
    await push.write(db, 'alice', wallet('w4', 'D', 18))
    expect(await push.purge(db, 500)).toEqual({ removed: 2, maxSeq: 16 })
    expect(await push.purge(db, 500)).toEqual({ removed: 0, maxSeq: 0 })
  })

  it("goes with its profile's row when that is removed (a purged profile tombstone)", async () => {
    await push.write(db, 'alice', wallet('w1', 'A', 15, { profileId: 'gone', deletedAt: 900 }))
    await db.delete(profiles)
    expect(await push.find(db, 'w1')).toBeNull()
  })
})
