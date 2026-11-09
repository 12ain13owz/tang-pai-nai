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
import { debts } from '@/core/database/schema/debt'
import { events } from '@/core/database/schema/event'
import { profiles } from '@/core/database/schema/profile'
import { wallets } from '@/core/database/schema/wallet'
import type { SyncPushHandler, SyncRowWrite } from '@/core/sync'
import { TRANSACTION_MESSAGE } from './transaction.const'
import { transactionSyncHandler } from './transaction.repository.drizzle'

let dir: string
let close: () => void
let db: Database

const push = transactionSyncHandler.push as SyncPushHandler

const transaction = (id: string, changeSeq: number, extra: Partial<SyncRowWrite> = {}) => ({
  id,
  profileId: 'pa',
  walletId: 'cash',
  categoryId: 'food',
  amount: 6500,
  occurredOn: '2026-11-02',
  note: '',
  excludeFromReport: false,
  recurringId: null,
  debtId: null,
  eventId: null,
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
  dir = mkdtempSync(join(tmpdir(), 'tpn-transaction-'))
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
      wallet('cash', 'alice', 'pa'),
      wallet('card', 'alice', 'pa'),
      wallet('usd', 'alice', 'pa', { currencyCode: 'USD' }),
      wallet('old', 'alice', 'pa', { isArchived: true }),
      wallet('dead', 'alice', 'pa', { deletedAt: 900 }),
      wallet('other', 'alice', 'pa2'),
      wallet('bobs', 'bob', 'pb'),
    ])
  await created.db
    .insert(categories)
    .values([
      category('food', 'alice', 'pa'),
      category('salary', 'alice', 'pa', { type: 'income' }),
      category('oldcat', 'alice', 'pa', { isArchived: true }),
      category('deadcat', 'alice', 'pa', { deletedAt: 900 }),
      category('othercat', 'alice', 'pa2'),
      category('bobcat', 'bob', 'pb'),
    ])
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('transactionSyncHandler', () => {
  it('writes a transaction and replaces it on the next write, without userId', async () => {
    expect(await push.write(db, 'alice', transaction('t1', 15, { note: 'ข้าว' }))).toEqual(
      transaction('t1', 15, { note: 'ข้าว' })
    )
    await push.write(db, 'alice', transaction('t1', 16, { amount: 99, excludeFromReport: true }))
    expect(await push.find(db, 't1')).toEqual({
      ownerId: 'alice',
      row: transaction('t1', 16, { amount: 99, excludeFromReport: true }),
    })
    expect(await push.find(db, 'nope')).toBeNull()
  })

  it("pulls only the user's transactions after the cursor, tombstones included", async () => {
    await push.write(db, 'alice', transaction('t1', 15))
    await push.write(
      db,
      'bob',
      transaction('t2', 16, { profileId: 'pb', walletId: 'bobs', categoryId: 'bobcat' })
    )
    await push.write(db, 'alice', transaction('t3', 17, { deletedAt: 1000 }))
    expect((await transactionSyncHandler.pull(db, 'alice', 15, 10)).map((row) => row.id)).toEqual([
      't3',
    ])
    expect(await transactionSyncHandler.pull(db, 'alice', 0, 1)).toHaveLength(1)
    expect((await transactionSyncHandler.pull(db, 'bob', 0, 10)).map((row) => row.id)).toEqual([
      't2',
    ])
  })

  it("refuses a profile that isn't the user's live one, and a move to another profile", async () => {
    for (const profileId of ['pb', 'gone', 'nope']) {
      expect(await push.check(db, 'alice', transaction('t9', 0, { profileId }))).toBe(
        TRANSACTION_MESSAGE.PROFILE_GONE
      )
    }
    await push.write(db, 'alice', transaction('t1', 15))
    expect(
      await push.check(
        db,
        'alice',
        transaction('t1', 0, { profileId: 'pa2', walletId: 'other', categoryId: 'othercat' })
      )
    ).toBe(TRANSACTION_MESSAGE.PROFILE_FIXED)
  })

  it("needs the user's live wallet and category of the same profile; archived ones are fine", async () => {
    const check = async (extra: Partial<SyncRowWrite>) =>
      push.check(db, 'alice', transaction('t9', 0, extra))
    expect(await check({})).toBeNull()
    expect(await check({ walletId: 'old', categoryId: 'oldcat' })).toBeNull()
    expect(await check({ categoryId: 'salary' })).toBeNull()
    for (const walletId of ['dead', 'bobs', 'nope']) {
      expect(await check({ walletId })).toBe(TRANSACTION_MESSAGE.WALLET_GONE)
    }
    for (const categoryId of ['deadcat', 'bobcat', 'nope']) {
      expect(await check({ categoryId })).toBe(TRANSACTION_MESSAGE.CATEGORY_GONE)
    }
    expect(await check({ walletId: 'other' })).toBe(TRANSACTION_MESSAGE.OTHER_PROFILE)
    expect(await check({ categoryId: 'othercat' })).toBe(TRANSACTION_MESSAGE.OTHER_PROFILE)
  })

  it('refuses a move to a wallet with another currency, not to one with the same', async () => {
    await push.write(db, 'alice', transaction('t1', 15))
    expect(await push.check(db, 'alice', transaction('t1', 0, { walletId: 'card' }))).toBeNull()
    expect(await push.check(db, 'alice', transaction('t1', 0, { walletId: 'usd' }))).toBe(
      TRANSACTION_MESSAGE.CURRENCY_FIXED
    )
    // A new transaction may go to any wallet.
    expect(await push.check(db, 'alice', transaction('t2', 0, { walletId: 'usd' }))).toBeNull()
  })

  it('runs no check on a tombstone', async () => {
    expect(
      await push.check(db, 'alice', transaction('t9', 0, { walletId: 'bobs', deletedAt: 5 }))
    ).toBeNull()
  })

  it('purges old tombstones, and goes with a purged wallet, category or profile', async () => {
    await push.write(db, 'alice', transaction('t1', 15, { deletedAt: 100 }))
    await push.write(db, 'alice', transaction('t2', 16, { deletedAt: 900 }))
    expect(await push.purge(db, 500)).toEqual({ removed: 1, maxSeq: 15 })
    expect(await push.find(db, 't2')).not.toBeNull()
    await push.write(db, 'alice', transaction('t3', 17, { walletId: 'card' }))
    await push.write(db, 'alice', transaction('t4', 18, { categoryId: 'salary' }))
    await db.delete(wallets).where(eq(wallets.id, 'card'))
    await db.delete(categories).where(eq(categories.id, 'salary'))
    expect(await push.find(db, 't3')).toBeNull()
    expect(await push.find(db, 't4')).toBeNull()
    await db.delete(profiles)
    expect(await push.find(db, 't2')).toBeNull()
  })

  it('moves a live row on a merged category to its target before the checks (rule 15)', async () => {
    await db
      .insert(categories)
      .values([
        category('coffee', 'alice', 'pa', { deletedAt: 900, mergedIntoId: 'food' }),
        category('tea', 'alice', 'pa', { deletedAt: 900, mergedIntoId: 'deadcat' }),
      ])
    const late = { ...transaction('t9', 0, { categoryId: 'coffee' }), changeSeq: undefined }
    expect(await push.resolve?.(db, 'alice', late)).toEqual({ ...late, categoryId: 'food' })
    // A plain tombstone, a dead end or a tombstone row stays as pushed (and the check decides).
    for (const categoryId of ['deadcat', 'tea', 'food']) {
      const row = transaction('t9', 0, { categoryId })
      expect(await push.resolve?.(db, 'alice', row)).toBe(row)
    }
    const deleted = transaction('t9', 0, { categoryId: 'coffee', deletedAt: 5 })
    expect(await push.resolve?.(db, 'alice', deleted)).toBe(deleted)
  })

  it('stores the recurring rule of an occurrence, and keeps the stored one on a second create (recurring rule 9)', async () => {
    const row = { id: 'x', createdAt: 1, updatedAt: 1, deletedAt: null }
    expect(push.keepsStored?.({ ...row, recurringId: 'r1' })).toBe(true)
    expect(push.keepsStored?.({ ...row, recurringId: null })).toBe(false)
  })

  it('links a debt of its profile and currency; a link to a gone debt is cleared (debt rule 8)', async () => {
    const debtRow = (id: string, profileId: string, extra: object = {}) => ({
      id,
      userId: 'alice',
      profileId,
      direction: 'borrowed',
      person: id,
      note: '',
      currencyCode: 'THB',
      countAs: 'spent',
      categoryId: null,
      dueOn: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null as number | null,
      changeSeq: 90,
      updatedBy: 'alice',
      ...extra,
    })
    await db
      .insert(debts)
      .values([
        debtRow('mom', 'pa'),
        debtRow('far', 'pa2'),
        debtRow('gone', 'pa', { deletedAt: 5 }),
      ])
    const linked = (debtId: string, extra: Partial<SyncRowWrite> = {}) =>
      transaction('t9', 0, { debtId, ...extra })
    expect(await push.check(db, 'alice', linked('mom'))).toBeNull()
    expect(await push.check(db, 'alice', linked('far'))).toBe(
      TRANSACTION_MESSAGE.DEBT_OTHER_PROFILE
    )
    expect(await push.check(db, 'alice', linked('mom', { walletId: 'usd' }))).toBe(
      TRANSACTION_MESSAGE.DEBT_OTHER_CURRENCY
    )
    expect(await push.resolve?.(db, 'alice', linked('gone'))).toMatchObject({ debtId: null })
    expect(await push.resolve?.(db, 'alice', linked('nope'))).toMatchObject({ debtId: null })
    expect(await push.resolve?.(db, 'alice', linked('mom'))).toMatchObject({ debtId: 'mom' })
    expect((await push.write(db, 'alice', linked('mom'))).debtId).toBe('mom')
  })

  it('tags an event of its profile; a link to a gone event is cleared (event rule 3)', async () => {
    const eventRow = (id: string, profileId: string, extra: object = {}) => ({
      id,
      userId: profileId === 'pb' ? 'bob' : 'alice',
      profileId,
      name: id,
      icon: 'lucidePlane',
      color: '#0e7490',
      startOn: '2026-11-07',
      endOn: null,
      isClosed: false,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null as number | null,
      changeSeq: 95,
      updatedBy: 'alice',
      ...extra,
    })
    await db
      .insert(events)
      .values([
        eventRow('cm', 'pa'),
        eventRow('done', 'pa', { isClosed: true }),
        eventRow('far', 'pa2'),
        eventRow('gone', 'pa', { deletedAt: 5 }),
        eventRow('bobs', 'pb'),
      ])
    const tagged = (eventId: string) => transaction('t9', 0, { eventId })
    expect(await push.check(db, 'alice', tagged('cm'))).toBeNull()
    expect(await push.check(db, 'alice', tagged('done'))).toBeNull()
    expect(await push.check(db, 'alice', tagged('far'))).toBe(
      TRANSACTION_MESSAGE.EVENT_OTHER_PROFILE
    )
    for (const id of ['gone', 'nope', 'bobs']) {
      expect(await push.resolve?.(db, 'alice', tagged(id))).toMatchObject({ eventId: null })
    }
    expect(await push.resolve?.(db, 'alice', tagged('cm'))).toMatchObject({ eventId: 'cm' })
    expect((await push.write(db, 'alice', tagged('cm'))).eventId).toBe('cm')
  })
})
