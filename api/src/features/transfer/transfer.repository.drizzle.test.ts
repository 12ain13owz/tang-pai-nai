import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '@/core/config'
import type { Database } from '@/core/database'
import { createDatabase } from '@/core/database/client'
import { users } from '@/core/database/schema/auth'
import { currencies } from '@/core/database/schema/currency'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'
import type { SyncPushHandler, SyncRowWrite } from '@/core/sync'
import { TRANSFER_MESSAGE } from './transfer.const'
import { transferSyncHandler } from './transfer.repository.drizzle'

let dir: string
let close: () => void
let db: Database

const push = transferSyncHandler.push as SyncPushHandler

const transfer = (id: string, changeSeq: number, extra: Partial<SyncRowWrite> = {}) => ({
  id,
  profileId: 'pa',
  fromWalletId: 'bank',
  toWalletId: 'cash',
  amount: 100000,
  occurredOn: '2026-11-02',
  note: '',
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  changeSeq,
  updatedBy: 'alice',
  ...extra,
})

const sync = (userId: string, deletedAt: number | null = null) => ({
  createdAt: 1,
  updatedAt: 1,
  deletedAt,
  changeSeq: 1,
  updatedBy: userId,
})

const profile = (id: string, userId: string, deletedAt: number | null = null) => ({
  id,
  userId,
  name: id,
  icon: 'lucideHouse',
  color: '#15803d',
  sortOrder: 0,
  ...sync(userId, deletedAt),
})

const wallet = (
  id: string,
  userId: string,
  profileId: string,
  extra: Partial<typeof wallets.$inferInsert> = {}
) => ({
  id,
  userId,
  profileId,
  name: id,
  currencyCode: 'THB',
  initialBalance: 0,
  icon: 'lucideWallet',
  color: '#15803d',
  excludeFromTotal: false,
  isArchived: false,
  sortOrder: 0,
  ...sync(userId),
  ...extra,
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-transfer-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(created.db, { migrationsFolder: 'drizzle' })
  await created.db.update(currencies).set({ isActive: true }).where(eq(currencies.code, 'USD'))
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
  await created.db
    .insert(wallets)
    .values([
      wallet('bank', 'alice', 'pa'),
      wallet('cash', 'alice', 'pa'),
      wallet('usd', 'alice', 'pa', { currencyCode: 'USD' }),
      wallet('old', 'alice', 'pa', { isArchived: true }),
      wallet('dead', 'alice', 'pa', { deletedAt: 900 }),
      wallet('other', 'alice', 'pa2'),
      wallet('other2', 'alice', 'pa2'),
      wallet('bobs', 'bob', 'pb'),
      wallet('bobs2', 'bob', 'pb'),
    ])
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('transferSyncHandler', () => {
  it('writes a transfer and replaces it on the next write, without userId', async () => {
    expect(await push.write(db, 'alice', transfer('r1', 15, { note: 'กดตู้' }))).toEqual(
      transfer('r1', 15, { note: 'กดตู้' })
    )
    await push.write(db, 'alice', transfer('r1', 16, { amount: 50000 }))
    expect(await push.find(db, 'r1')).toEqual({
      ownerId: 'alice',
      row: transfer('r1', 16, { amount: 50000 }),
    })
    expect(await push.find(db, 'nope')).toBeNull()
  })

  it("pulls only the user's transfers after the cursor, tombstones included", async () => {
    await push.write(db, 'alice', transfer('r1', 15))
    await push.write(
      db,
      'bob',
      transfer('r2', 16, { profileId: 'pb', fromWalletId: 'bobs', toWalletId: 'bobs2' })
    )
    await push.write(db, 'alice', transfer('r3', 17, { deletedAt: 1000 }))
    expect((await transferSyncHandler.pull(db, 'alice', 15, 10)).map((row) => row.id)).toEqual([
      'r3',
    ])
    expect(await transferSyncHandler.pull(db, 'alice', 0, 1)).toHaveLength(1)
    expect((await transferSyncHandler.pull(db, 'bob', 0, 10)).map((row) => row.id)).toEqual(['r2'])
  })

  it("refuses a profile that isn't the user's live one, and a move to another profile", async () => {
    for (const profileId of ['pb', 'gone', 'nope']) {
      expect(await push.check(db, 'alice', transfer('r9', 0, { profileId }))).toBe(
        TRANSFER_MESSAGE.PROFILE_GONE
      )
    }
    await push.write(db, 'alice', transfer('r1', 15))
    expect(
      await push.check(
        db,
        'alice',
        transfer('r1', 0, { profileId: 'pa2', fromWalletId: 'other', toWalletId: 'other2' })
      )
    ).toBe(TRANSFER_MESSAGE.PROFILE_FIXED)
  })

  it("needs the user's live wallets of the profile on both sides; archived ones are fine", async () => {
    const check = async (extra: Partial<SyncRowWrite>) =>
      push.check(db, 'alice', transfer('r9', 0, extra))
    expect(await check({})).toBeNull()
    expect(await check({ toWalletId: 'old' })).toBeNull()
    expect(await check({ fromWalletId: 'old', toWalletId: 'bank' })).toBeNull()
    for (const fromWalletId of ['dead', 'bobs', 'nope']) {
      expect(await check({ fromWalletId })).toBe(TRANSFER_MESSAGE.FROM_GONE)
    }
    for (const toWalletId of ['dead', 'bobs', 'nope']) {
      expect(await check({ toWalletId })).toBe(TRANSFER_MESSAGE.TO_GONE)
    }
    expect(await check({ toWalletId: 'other' })).toBe(TRANSFER_MESSAGE.OTHER_PROFILE)
    expect(await check({ fromWalletId: 'other' })).toBe(TRANSFER_MESSAGE.OTHER_PROFILE)
  })

  it('refuses wallets of different currencies (rule 1, Q2)', async () => {
    expect(await push.check(db, 'alice', transfer('r9', 0, { toWalletId: 'usd' }))).toBe(
      TRANSFER_MESSAGE.OTHER_CURRENCY
    )
  })

  it('runs no check on a tombstone', async () => {
    expect(
      await push.check(db, 'alice', transfer('r9', 0, { fromWalletId: 'bobs', deletedAt: 5 }))
    ).toBeNull()
  })

  it('purges old tombstones, and goes with a purged wallet on either side or profile', async () => {
    await push.write(db, 'alice', transfer('r1', 15, { deletedAt: 100 }))
    await push.write(db, 'alice', transfer('r2', 16, { deletedAt: 900 }))
    expect(await push.purge(db, 500)).toEqual({ removed: 1, maxSeq: 15 })
    expect(await push.find(db, 'r2')).not.toBeNull()
    await push.write(db, 'alice', transfer('r3', 17, { toWalletId: 'old' }))
    await push.write(db, 'alice', transfer('r4', 18, { fromWalletId: 'old' }))
    await db.delete(wallets).where(eq(wallets.id, 'old'))
    expect(await push.find(db, 'r3')).toBeNull()
    expect(await push.find(db, 'r4')).toBeNull()
    await db.delete(profiles)
    expect(await push.find(db, 'r2')).toBeNull()
  })
})
