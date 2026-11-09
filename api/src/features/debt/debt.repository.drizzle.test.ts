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
import { debtEntries, debts } from '@/core/database/schema/debt'
import { profiles } from '@/core/database/schema/profile'
import { transactions } from '@/core/database/schema/transaction'
import { wallets } from '@/core/database/schema/wallet'
import type { SyncPushHandler, SyncRowWrite } from '@/core/sync'
import { DEBT_ENTRY_MESSAGE, DEBT_LIMITS, DEBT_MESSAGE } from './debt.const'
import { debtEntrySyncHandler, debtSyncHandler } from './debt.repository.drizzle'

let dir: string
let close: () => void
let db: Database
const push = debtSyncHandler.push as SyncPushHandler
const entryPush = debtEntrySyncHandler.push as SyncPushHandler

const sync = (userId: string, deletedAt: number | null = null) => ({
  createdAt: 1,
  updatedAt: 1,
  deletedAt,
  changeSeq: 1,
  updatedBy: userId,
})
const debt = (id: string, changeSeq: number, extra: Partial<SyncRowWrite> = {}) => ({
  id,
  profileId: 'pa',
  direction: 'borrowed',
  person: 'แม่',
  note: '',
  currencyCode: 'THB',
  countAs: 'spent',
  categoryId: null,
  dueOn: null,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  changeSeq,
  updatedBy: 'alice',
  ...extra,
})
const entry = (id: string, changeSeq: number, extra: Partial<SyncRowWrite> = {}) => ({
  id,
  profileId: 'pa',
  debtId: 'mom',
  kind: 'principal',
  walletId: 'cash',
  amount: 1000000,
  occurredOn: '2026-08-15',
  note: '',
  recurringId: null,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  changeSeq,
  updatedBy: 'alice',
  ...extra,
})
const input = (row: ReturnType<typeof debt> | ReturnType<typeof entry>) => {
  const { changeSeq: _seq, updatedBy: _by, ...rest } = row
  return rest
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-debt-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(created.db, { migrationsFolder: 'drizzle' })
  await created.db.update(currencies).set({ isActive: true }).where(eq(currencies.code, 'USD'))
  await created.db.insert(users).values([
    { id: 'alice', email: 'a@example.com', displayName: 'a' },
    { id: 'bob', email: 'b@example.com', displayName: 'b' },
  ])
  await created.db.insert(profiles).values(
    ['pa', 'pa2', 'pb'].map((id) => ({
      id,
      userId: id === 'pb' ? 'bob' : 'alice',
      name: id,
      icon: 'lucideHouse',
      color: '#15803d',
      sortOrder: 0,
      ...sync(id === 'pb' ? 'bob' : 'alice'),
    }))
  )
  const wallet = (
    id: string,
    profileId: string,
    currencyCode = 'THB',
    deletedAt: number | null = null
  ) => ({
    id,
    userId: profileId === 'pb' ? 'bob' : 'alice',
    profileId,
    name: id,
    currencyCode,
    initialBalance: 0,
    icon: 'lucideWallet',
    color: '#15803d',
    excludeFromTotal: false,
    isArchived: false,
    sortOrder: 0,
    ...sync('alice', deletedAt),
  })
  await created.db
    .insert(wallets)
    .values([
      wallet('cash', 'pa'),
      wallet('usd', 'pa', 'USD'),
      wallet('dead', 'pa', 'THB', 900),
      wallet('other', 'pa2'),
    ])
  const category = (id: string, type: 'income' | 'expense', profileId = 'pa') => ({
    id,
    userId: 'alice',
    profileId,
    type,
    parentId: null,
    name: id,
    icon: 'lucideShapes',
    color: '#475569',
    isArchived: false,
    sortOrder: 0,
    ...sync('alice'),
  })
  await created.db
    .insert(categories)
    .values([
      category('shop', 'expense'),
      category('gift', 'income'),
      category('far', 'expense', 'pa2'),
    ])
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('debtSyncHandler', () => {
  it('writes a debt and replaces it on the next write, without userId; pulls only the user’s', async () => {
    expect(await push.write(db, 'alice', debt('mom', 15))).toEqual(debt('mom', 15))
    await push.write(db, 'alice', debt('mom', 16, { person: 'แม่ (ยืม)' }))
    expect(await push.find(db, 'mom')).toEqual({
      ownerId: 'alice',
      row: debt('mom', 16, { person: 'แม่ (ยืม)' }),
    })
    await push.write(db, 'bob', debt('bobs', 17, { profileId: 'pb' }))
    expect((await debtSyncHandler.pull(db, 'alice', 0, 100)).map((row) => row.id)).toEqual(['mom'])
    expect(await debtSyncHandler.pull(db, 'alice', 16, 100)).toEqual([])
  })

  it('validates the shape: direction, person, counting and its category, due date (rules 1–2)', () => {
    const valid = input(
      debt('00000000-0000-7000-8000-000000000001', 1, {
        profileId: '00000000-0000-7000-8000-0000000000aa',
      })
    )
    expect(push.validate({ ...valid, person: ' แม่ ' })).toMatchObject({
      ok: true,
      row: { person: 'แม่' },
    })
    expect(push.validate({ ...valid, person: '  ' })).toMatchObject({ ok: false })
    expect(push.validate({ ...valid, direction: 'gift' })).toMatchObject({ ok: false })
    expect(
      push.validate({
        ...valid,
        direction: 'lent',
        countAs: 'repaid',
        categoryId: '00000000-0000-7000-8000-0000000000cc',
      })
    ).toEqual({
      ok: false,
      message: DEBT_MESSAGE.COUNT_AS_LENT,
    })
    expect(push.validate({ ...valid, countAs: 'repaid' })).toEqual({
      ok: false,
      message: DEBT_MESSAGE.CATEGORY_FIELD,
    })
    expect(push.validate({ ...valid, categoryId: '00000000-0000-7000-8000-0000000000cc' })).toEqual(
      {
        ok: false,
        message: DEBT_MESSAGE.CATEGORY_FIELD,
      }
    )
    expect(push.validate({ ...valid, dueOn: '1999-12-31' })).toMatchObject({ ok: false })
    expect(push.validate({ ...valid, dueOn: '2070-02-28' })).toMatchObject({ ok: true })
  })

  it('needs the live profile; direction, counting and currency never change', async () => {
    expect(await push.check(db, 'alice', input(debt('mom', 1)))).toBeNull()
    expect(await push.check(db, 'alice', input(debt('x', 1, { profileId: 'pb' })))).toBe(
      DEBT_MESSAGE.PROFILE_GONE
    )
    expect(await push.check(db, 'alice', input(debt('x', 1, { currencyCode: 'EUR' })))).toBe(
      DEBT_MESSAGE.CURRENCY_INACTIVE
    )
    await push.write(db, 'alice', debt('mom', 2))
    expect(await push.check(db, 'alice', input(debt('mom', 2, { profileId: 'pa2' })))).toBe(
      DEBT_MESSAGE.PROFILE_FIXED
    )
    for (const change of [
      { direction: 'lent' },
      { countAs: 'repaid', categoryId: 'shop' },
      { currencyCode: 'USD' },
    ]) {
      expect(await push.check(db, 'alice', input(debt('mom', 2, change)))).toBe(DEBT_MESSAGE.FIXED)
    }
    // A tombstone breaks no rule.
    expect(
      await push.check(db, 'alice', input(debt('mom', 2, { profileId: 'pa2', deletedAt: 5 })))
    ).toBeNull()
  })

  it('needs an expense category of the profile for a repaid debt, and follows a merge', async () => {
    const repaid = (categoryId: string) => input(debt('ktc', 1, { countAs: 'repaid', categoryId }))
    expect(await push.check(db, 'alice', repaid('shop'))).toBeNull()
    expect(await push.check(db, 'alice', repaid('gift'))).toBe(DEBT_MESSAGE.CATEGORY_NOT_EXPENSE)
    expect(await push.check(db, 'alice', repaid('far'))).toBe(DEBT_MESSAGE.CATEGORY_NOT_EXPENSE)
    expect(await push.check(db, 'alice', repaid('nope'))).toBe(DEBT_MESSAGE.CATEGORY_GONE)
    await db
      .update(categories)
      .set({ deletedAt: 5, mergedIntoId: 'shop' })
      .where(eq(categories.id, 'far'))
    await db.update(categories).set({ profileId: 'pa' }).where(eq(categories.id, 'far'))
    expect(await push.resolve?.(db, 'alice', repaid('far'))).toMatchObject({ categoryId: 'shop' })
  })

  it('holds at most 100 open debts per profile; closed ones and a stored one pass (rule 1)', async () => {
    const rows = Array.from({ length: DEBT_LIMITS.OPEN_PER_PROFILE }, (_, i) =>
      debt(`d${i}`, i + 1)
    )
    await db.insert(debts).values(rows.map((row) => ({ ...row, userId: 'alice' })))
    await db
      .insert(debtEntries)
      .values(
        rows.map((row, i) => ({ ...entry(`e${i}`, 200 + i, { debtId: row.id }), userId: 'alice' }))
      )
    expect(await push.check(db, 'alice', input(debt('new', 1)))).toBe(DEBT_MESSAGE.LIMIT)
    expect(await push.check(db, 'alice', input(debt('d0', 1, { note: 'x' })))).toBeNull()
    // Paying one back closes it: a place frees up.
    await db
      .insert(debtEntries)
      .values({ ...entry('pay', 400, { debtId: 'd0', kind: 'repayment' }), userId: 'alice' })
    expect(await push.check(db, 'alice', input(debt('new', 1)))).toBeNull()
  })

  it('purges old tombstones with their entries', async () => {
    await push.write(db, 'alice', debt('mom', 1, { deletedAt: 100 }))
    await entryPush.write(db, 'alice', entry('e1', 2, { deletedAt: 100 }))
    expect(await push.purge(db, 200)).toEqual({ removed: 1, maxSeq: 1 })
    expect(await entryPush.find(db, 'e1')).toBeNull()
  })
})

describe('debtEntrySyncHandler', () => {
  beforeEach(async () => {
    await push.write(db, 'alice', debt('mom', 1))
    await push.write(db, 'alice', debt('ktc', 2, { countAs: 'repaid', categoryId: 'shop' }))
  })

  it('writes an entry and pulls only the user’s', async () => {
    expect(await entryPush.write(db, 'alice', entry('e1', 5))).toEqual(entry('e1', 5))
    expect((await debtEntrySyncHandler.pull(db, 'alice', 0, 10)).map((row) => row.id)).toEqual([
      'e1',
    ])
    expect(await debtEntrySyncHandler.pull(db, 'bob', 0, 10)).toEqual([])
  })

  it('needs the live debt and a live wallet of the profile in the debt’s currency (rule 6)', async () => {
    const check = async (extra: Partial<SyncRowWrite>) =>
      entryPush.check(db, 'alice', input(entry('e1', 1, extra)))
    expect(await check({})).toBeNull()
    expect(await check({ debtId: 'nope' })).toBe(DEBT_ENTRY_MESSAGE.DEBT_GONE)
    expect(await check({ walletId: 'dead' })).toBe(DEBT_ENTRY_MESSAGE.WALLET_GONE)
    expect(await check({ walletId: 'other' })).toBe(DEBT_ENTRY_MESSAGE.OTHER_PROFILE)
    expect(await check({ walletId: 'usd' })).toBe(DEBT_ENTRY_MESSAGE.OTHER_CURRENCY)
    expect(await check({ walletId: null })).toBe(DEBT_ENTRY_MESSAGE.NO_WALLET)
    expect(await check({ walletId: null, debtId: 'ktc' })).toBeNull()
    await entryPush.write(db, 'alice', entry('e1', 3))
    expect(await check({ debtId: 'ktc' })).toBe(DEBT_ENTRY_MESSAGE.DEBT_FIXED)
  })

  it('takes an entry pushed after its debt was deleted with it, quietly (debt rule 5)', async () => {
    await push.write(db, 'alice', debt('mom', 9, { deletedAt: 3000, updatedAt: 3000 }))
    expect(
      await entryPush.resolve?.(db, 'alice', input(entry('late', 1, { updatedAt: 2000 })))
    ).toMatchObject({
      deletedAt: 3000,
    })
    expect(
      await entryPush.resolve?.(
        db,
        'alice',
        input(entry('fine', 1, { debtId: 'ktc', walletId: null }))
      )
    ).toMatchObject({
      deletedAt: null,
    })
  })

  it('keeps the stored row for a second create of a recorded repayment (debt rule 13)', () => {
    expect(entryPush.keepsStored?.(input(entry('e1', 1, { recurringId: 'r1' })))).toBe(true)
    expect(entryPush.keepsStored?.(input(entry('e1', 1)))).toBe(false)
  })

  it('lets a transaction keep a deleted debt’s money', async () => {
    await db.insert(transactions).values({
      id: 't1',
      userId: 'alice',
      profileId: 'pa',
      walletId: 'cash',
      categoryId: 'shop',
      amount: 300000,
      occurredOn: '2026-09-05',
      note: '',
      excludeFromReport: false,
      recurringId: null,
      debtId: 'ktc',
      ...sync('alice'),
    })
    await push.write(
      db,
      'alice',
      debt('ktc', 9, { countAs: 'repaid', categoryId: 'shop', deletedAt: 5 })
    )
    expect(await push.purge(db, 10)).toEqual({ removed: 1, maxSeq: 9 })
    const [row] = await db.select().from(transactions).where(eq(transactions.id, 't1'))
    expect(row.debtId).toBe('ktc')
  })
})
