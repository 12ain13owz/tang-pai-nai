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
import { categories } from '@/core/database/schema/category'
import { currencies } from '@/core/database/schema/currency'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'
import type { SyncPushHandler, SyncRowWrite } from '@/core/sync'
import { RECURRING_LIMITS, RECURRING_MESSAGE } from './recurring.const'
import { recurringSyncHandler } from './recurring.repository.drizzle'

let dir: string
let close: () => void
let db: Database
const push = recurringSyncHandler.push as SyncPushHandler

const rule = (id: string, changeSeq: number, extra: Partial<SyncRowWrite> = {}) => ({
  id,
  profileId: 'pa',
  kind: 'transaction',
  walletId: 'bank',
  categoryId: 'rent',
  toWalletId: null,
  amount: 850000,
  note: '',
  excludeFromReport: false,
  startOn: '2026-10-01',
  frequency: 'month',
  interval: 1,
  endOn: null,
  endCount: null,
  confirm: false,
  nextOn: '2026-12-01',
  isPaused: false,
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
const category = (
  id: string,
  userId: string,
  profileId: string,
  extra: Partial<typeof categories.$inferInsert> = {}
) => ({
  id,
  userId,
  profileId,
  type: 'expense' as const,
  parentId: null,
  name: id,
  icon: 'lucideShapes',
  color: '#475569',
  isArchived: false,
  sortOrder: 0,
  ...sync(userId),
  ...extra,
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-recurring-'))
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
      wallet('save', 'alice', 'pa'),
      wallet('usd', 'alice', 'pa', { currencyCode: 'USD' }),
      wallet('old', 'alice', 'pa', { isArchived: true }),
      wallet('dead', 'alice', 'pa', { deletedAt: 900 }),
      wallet('other', 'alice', 'pa2'),
      wallet('bobs', 'bob', 'pb'),
    ])
  await created.db
    .insert(categories)
    .values([
      category('rent', 'alice', 'pa'),
      category('home', 'alice', 'pa'),
      category('merged', 'alice', 'pa', { deletedAt: 800, mergedIntoId: 'home' }),
      category('gonecat', 'alice', 'pa', { deletedAt: 800 }),
      category('elsewhere', 'alice', 'pa2'),
    ])
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('recurringSyncHandler', () => {
  it('writes a rule and replaces it on the next write, without userId', async () => {
    expect(await push.write(db, 'alice', rule('r1', 15, { note: 'ห้อง' }))).toEqual(
      rule('r1', 15, { note: 'ห้อง' })
    )
    await push.write(db, 'alice', rule('r1', 16, { nextOn: null, endCount: 2 }))
    expect(await push.find(db, 'r1')).toEqual({
      ownerId: 'alice',
      row: rule('r1', 16, { nextOn: null, endCount: 2 }),
    })
    expect(await push.find(db, 'nope')).toBeNull()
  })

  it("pulls only the user's rules after the cursor, tombstones included", async () => {
    await push.write(db, 'alice', rule('r1', 15))
    await push.write(
      db,
      'bob',
      rule('r2', 16, {
        profileId: 'pb',
        walletId: 'bobs',
        categoryId: null,
        kind: 'transfer',
        toWalletId: 'bobs',
      })
    )
    await push.write(db, 'alice', rule('r3', 17, { deletedAt: 1000 }))
    expect((await recurringSyncHandler.pull(db, 'alice', 15, 10)).map((row) => row.id)).toEqual([
      'r3',
    ])
    expect((await recurringSyncHandler.pull(db, 'bob', 0, 10)).map((row) => row.id)).toEqual(['r2'])
  })

  it("needs the user's live profile, which never changes", async () => {
    for (const profileId of ['pb', 'gone', 'nope']) {
      expect(await push.check(db, 'alice', rule('r9', 0, { profileId }))).toBe(
        RECURRING_MESSAGE.PROFILE_GONE
      )
    }
    await push.write(db, 'alice', rule('r1', 15))
    expect(
      await push.check(
        db,
        'alice',
        rule('r1', 0, { profileId: 'pa2', walletId: 'other', categoryId: 'elsewhere' })
      )
    ).toBe(RECURRING_MESSAGE.PROFILE_FIXED)
  })

  it('needs live wallets and category of the profile; archived ones are fine (rule 12)', async () => {
    const check = async (extra: Partial<SyncRowWrite>) =>
      push.check(db, 'alice', rule('r9', 0, extra))
    expect(await check({})).toBeNull()
    expect(await check({ walletId: 'old' })).toBeNull()
    for (const walletId of ['dead', 'bobs', 'nope']) {
      expect(await check({ walletId })).toBe(RECURRING_MESSAGE.WALLET_GONE)
    }
    expect(await check({ walletId: 'other' })).toBe(RECURRING_MESSAGE.OTHER_PROFILE)
    expect(await check({ categoryId: 'gonecat' })).toBe(RECURRING_MESSAGE.CATEGORY_GONE)
    expect(await check({ categoryId: 'elsewhere' })).toBe(RECURRING_MESSAGE.OTHER_PROFILE)
  })

  it('checks a transfer rule’s second wallet: live, same profile and currency', async () => {
    const check = async (toWalletId: string) =>
      push.check(db, 'alice', rule('r9', 0, { kind: 'transfer', categoryId: null, toWalletId }))
    expect(await check('save')).toBeNull()
    expect(await check('dead')).toBe(RECURRING_MESSAGE.TO_WALLET_GONE)
    expect(await check('other')).toBe(RECURRING_MESSAGE.OTHER_PROFILE)
    expect(await check('usd')).toBe(RECURRING_MESSAGE.OTHER_CURRENCY)
  })

  it('holds at most 100 live rules per profile; a stored one and a tombstone pass', async () => {
    for (let i = 0; i < RECURRING_LIMITS.PER_PROFILE; i++) {
      await push.write(db, 'alice', rule(`f${i}`, 20 + i))
    }
    expect(await push.check(db, 'alice', rule('r9', 0))).toBe(RECURRING_MESSAGE.LIMIT)
    expect(await push.check(db, 'alice', rule('f0', 0, { amount: 1 }))).toBeNull()
    expect(await push.check(db, 'alice', rule('r9', 0, { deletedAt: 5 }))).toBeNull()
  })

  it('follows a merged category, and never moves nextOn back for the same schedule (rules 9, 13)', async () => {
    const resolve = async (row: SyncRowWrite) => (await push.resolve?.(db, 'alice', row)) ?? row
    expect((await resolve(rule('r1', 0, { categoryId: 'merged' }))).categoryId).toBe('home')
    await push.write(db, 'alice', rule('r1', 15, { nextOn: '2027-01-01' }))
    expect((await resolve(rule('r1', 0, { nextOn: '2026-12-01' }))).nextOn).toBe('2027-01-01')
    expect((await resolve(rule('r1', 0, { nextOn: '2027-02-01' }))).nextOn).toBe('2027-02-01')
    // A new schedule may start earlier.
    expect((await resolve(rule('r1', 0, { frequency: 'week', nextOn: '2026-11-12' }))).nextOn).toBe(
      '2026-11-12'
    )
    // Ended (null) is the furthest.
    await push.write(db, 'alice', rule('r2', 16, { nextOn: null }))
    expect((await resolve(rule('r2', 0, { nextOn: '2026-12-01' }))).nextOn).toBeNull()
  })

  it('calls versions that differ only in nextOn and the sync columns the same change', () => {
    const same = (a: SyncRowWrite, b: SyncRowWrite) => push.sameChange?.(a, b)
    expect(same(rule('r1', 1), rule('r1', 9, { nextOn: '2027-01-01', updatedAt: 5 }))).toBe(true)
    expect(same(rule('r1', 1), rule('r1', 1, { amount: 1 }))).toBe(false)
    expect(same(rule('r1', 1), rule('r1', 1, { isPaused: true }))).toBe(false)
  })

  it('purges old tombstones, and goes with a purged wallet or category', async () => {
    await push.write(db, 'alice', rule('r1', 15, { deletedAt: 100 }))
    await push.write(db, 'alice', rule('r2', 16, { deletedAt: 900 }))
    expect(await push.purge(db, 500)).toEqual({ removed: 1, maxSeq: 15 })
    await push.write(db, 'alice', rule('r3', 17, { walletId: 'old' }))
    await db.delete(wallets).where(eq(wallets.id, 'old'))
    expect(await push.find(db, 'r3')).toBeNull()
    await push.write(db, 'alice', rule('r4', 18, { categoryId: 'home' }))
    await db.delete(categories).where(eq(categories.id, 'home'))
    expect(await push.find(db, 'r4')).toBeNull()
  })
})
