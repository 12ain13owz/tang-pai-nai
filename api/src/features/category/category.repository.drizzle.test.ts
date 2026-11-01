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
import type { SyncPushHandler, SyncRowWrite } from '@/core/sync'
import { CATEGORY_MESSAGE } from './category.const'
import { categorySyncHandler } from './category.repository.drizzle'

let dir: string
let close: () => void
let db: Database

const push = categorySyncHandler.push as SyncPushHandler

const category = (
  id: string,
  name: string,
  changeSeq: number,
  extra: Partial<SyncRowWrite> = {}
) => ({
  id,
  profileId: 'pa',
  type: 'expense',
  parentId: null,
  name,
  icon: 'lucideShapes',
  color: '#475569',
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
  color: '#15803d',
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
  deletedAt,
  changeSeq: 1,
  updatedBy: userId,
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-category-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
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

describe('categorySyncHandler', () => {
  it('writes a category and replaces it on the next write, without userId', async () => {
    expect(await push.write(db, 'alice', category('c1', 'Food', 15))).toEqual(
      category('c1', 'Food', 15)
    )
    await push.write(db, 'alice', category('c2', 'Coffee', 16, { parentId: 'c1' }))
    await push.write(db, 'alice', category('c2', 'Tea', 17, { parentId: 'c1', isArchived: true }))
    expect(await push.find(db, 'c2')).toEqual({
      ownerId: 'alice',
      row: category('c2', 'Tea', 17, { parentId: 'c1', isArchived: true }),
    })
    expect(await push.find(db, 'nope')).toBeNull()
  })

  it("pulls only the user's categories after the cursor, tombstones included", async () => {
    await push.write(db, 'alice', category('c1', 'A', 15))
    await push.write(db, 'bob', category('c2', 'B', 16, { profileId: 'pb', updatedBy: 'bob' }))
    await push.write(db, 'alice', category('c3', 'C', 17, { deletedAt: 1000 }))
    const rows = await categorySyncHandler.pull(db, 'alice', 15, 10)
    expect(rows.map((row) => row.id)).toEqual(['c3'])
    expect(await categorySyncHandler.pull(db, 'alice', 0, 1)).toHaveLength(1)
    expect((await categorySyncHandler.pull(db, 'bob', 0, 10)).map((row) => row.id)).toEqual(['c2'])
  })

  it("refuses a profile that isn't the user's live one, and a move to another profile", async () => {
    for (const profileId of ['pb', 'gone', 'nope']) {
      expect(await push.check(db, 'alice', category('c9', 'X', 0, { profileId }))).toBe(
        CATEGORY_MESSAGE.PROFILE_GONE
      )
    }
    await push.write(db, 'alice', category('c1', 'Food', 15))
    expect(await push.check(db, 'alice', category('c1', 'Food', 0, { profileId: 'pa2' }))).toBe(
      CATEGORY_MESSAGE.PROFILE_FIXED
    )
  })

  it('needs a live, top-level parent of the same profile and type, open for an open child', async () => {
    await push.write(db, 'alice', category('food', 'Food', 15))
    await push.write(db, 'alice', category('coffee', 'Coffee', 16, { parentId: 'food' }))
    await push.write(db, 'alice', category('salary', 'Salary', 17, { type: 'income' }))
    await push.write(db, 'alice', category('other', 'Other', 18, { profileId: 'pa2' }))
    await push.write(db, 'alice', category('old', 'Old', 19, { isArchived: true }))
    await push.write(db, 'alice', category('dead', 'Dead', 20, { deletedAt: 900 }))
    await push.write(db, 'bob', category('bobs', 'Bob', 21, { profileId: 'pb' }))
    const under = async (parentId: string, extra: Partial<SyncRowWrite> = {}) =>
      push.check(db, 'alice', category('c9', 'New', 0, { parentId, ...extra }))
    expect(await under('food')).toBeNull()
    expect(await under('coffee')).toBe(CATEGORY_MESSAGE.PARENT_INVALID) // a child
    expect(await under('salary')).toBe(CATEGORY_MESSAGE.PARENT_INVALID) // another type
    expect(await under('other')).toBe(CATEGORY_MESSAGE.PARENT_INVALID) // another profile
    expect(await under('dead')).toBe(CATEGORY_MESSAGE.PARENT_GONE)
    expect(await under('bobs')).toBe(CATEGORY_MESSAGE.PARENT_GONE)
    expect(await under('nope')).toBe(CATEGORY_MESSAGE.PARENT_GONE)
    expect(await under('old')).toBe(CATEGORY_MESSAGE.PARENT_ARCHIVED)
    expect(await under('old', { isArchived: true })).toBeNull() // archived with its parent
  })

  it('keeps a parent with live children top-level and of its type', async () => {
    await push.write(db, 'alice', category('food', 'Food', 15))
    await push.write(db, 'alice', category('home', 'Home', 16))
    await push.write(db, 'alice', category('coffee', 'Coffee', 17, { parentId: 'food' }))
    expect(await push.check(db, 'alice', category('food', 'Food', 0, { parentId: 'home' }))).toBe(
      CATEGORY_MESSAGE.HAS_CHILDREN
    )
    expect(await push.check(db, 'alice', category('food', 'Food', 0, { type: 'income' }))).toBe(
      CATEGORY_MESSAGE.TYPE_FIXED
    )
    expect(
      await push.check(db, 'alice', category('home', 'Home', 0, { type: 'income' }))
    ).toBeNull()
    // A child may move to the top level or under another parent.
    expect(await push.check(db, 'alice', category('coffee', 'Coffee', 0))).toBeNull()
    expect(
      await push.check(db, 'alice', category('coffee', 'Coffee', 0, { parentId: 'home' }))
    ).toBeNull()
    // Once its child is gone, the parent is free again.
    await push.write(
      db,
      'alice',
      category('coffee', 'Coffee', 18, { parentId: 'food', deletedAt: 5 })
    )
    expect(
      await push.check(db, 'alice', category('food', 'Food', 0, { parentId: 'home' }))
    ).toBeNull()
  })

  it('refuses a name used by an open sibling, in any case, and nowhere else', async () => {
    await push.write(db, 'alice', category('food', 'Food', 15))
    await push.write(db, 'alice', category('other1', 'Other', 16, { parentId: 'food' }))
    await push.write(db, 'alice', category('old', 'Old', 17, { isArchived: true }))
    const name = async (text: string, extra: Partial<SyncRowWrite> = {}) =>
      push.check(db, 'alice', category('c9', text, 0, extra))
    expect(await name('FOOD')).toBe(CATEGORY_MESSAGE.NAME_TAKEN)
    expect(await name('other', { parentId: 'food' })).toBe(CATEGORY_MESSAGE.NAME_TAKEN)
    expect(await name('Other')).toBeNull() // top level, not under Food
    expect(await name('Food', { type: 'income' })).toBeNull()
    expect(await name('Food', { profileId: 'pa2' })).toBeNull()
    expect(await name('Old')).toBeNull() // archived
    expect(await name('Food', { isArchived: true })).toBeNull()
    expect(await push.check(db, 'alice', category('food', 'Food', 0))).toBeNull() // itself
    // Bringing an archived one back into a clash is refused.
    await push.write(db, 'alice', category('old2', 'Food', 18, { isArchived: true }))
    expect(await push.check(db, 'alice', category('old2', 'Food', 0))).toBe(
      CATEGORY_MESSAGE.NAME_TAKEN
    )
  })

  it('refuses a 201st open category but lets archived ones in', async () => {
    for (let i = 1; i <= 200; i++) {
      await push.write(db, 'alice', category(`c${i}`, `C${i}`, 100 + i))
    }
    expect(await push.check(db, 'alice', category('c201', 'C201', 0))).toBe(
      CATEGORY_MESSAGE.TOO_MANY
    )
    expect(
      await push.check(db, 'alice', category('c201', 'C201', 0, { isArchived: true }))
    ).toBeNull()
    expect(await push.check(db, 'alice', category('c200', 'Renamed', 0))).toBeNull()
    expect(
      await push.check(db, 'alice', category('c201', 'C201', 0, { profileId: 'pa2' }))
    ).toBeNull()
  })

  it('runs no check on a tombstone', async () => {
    expect(
      await push.check(db, 'alice', category('c9', 'X', 0, { profileId: 'pb', deletedAt: 5 }))
    ).toBeNull()
  })

  it('purges old tombstones, and its children go with a purged parent or profile', async () => {
    await push.write(db, 'alice', category('c1', 'A', 15, { deletedAt: 100 }))
    await push.write(db, 'alice', category('c2', 'B', 16, { deletedAt: 900 }))
    await push.write(db, 'alice', category('c3', 'C', 17, { parentId: 'c1', deletedAt: 900 }))
    expect(await push.purge(db, 500)).toEqual({ removed: 1, maxSeq: 15 })
    expect(await push.find(db, 'c3')).toBeNull()
    await push.write(db, 'alice', category('c4', 'D', 18, { profileId: 'gone', deletedAt: 900 }))
    await db.delete(profiles)
    expect(await push.find(db, 'c4')).toBeNull()
  })
})
