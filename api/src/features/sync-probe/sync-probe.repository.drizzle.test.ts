import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env } from '@/core/config'
import type { Database } from '@/core/database'
import { createDatabase } from '@/core/database/client'
import { users } from '@/core/database/schema/auth'
import type { SyncPushHandler, SyncRowWrite } from '@/core/sync'
import { SYNC_PROBE_MESSAGE } from './sync-probe.const'
import { syncProbeSyncHandler } from './sync-probe.repository.drizzle'

let dir: string
let close: () => void
let db: Database
const push = syncProbeSyncHandler.push as SyncPushHandler

const probe = (
  id: string,
  title: string,
  changeSeq: number,
  extra: Partial<SyncRowWrite> = {}
) => ({
  id,
  title,
  amount: 6550,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  changeSeq,
  updatedBy: 'alice',
  ...extra,
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-probe-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(created.db, { migrationsFolder: 'drizzle' })
  await created.db.insert(users).values([
    { id: 'alice', email: 'a@example.com', displayName: 'a' },
    { id: 'bob', email: 'b@example.com', displayName: 'b' },
  ])
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

describe('syncProbeSyncHandler', () => {
  it('writes a probe and replaces it on the next write, without leaking userId', async () => {
    const written = await push.write(db, 'alice', probe('p1', 'Coffee', 15))
    expect(written).toEqual(probe('p1', 'Coffee', 15))
    await push.write(db, 'alice', probe('p1', 'Latte', 16))
    expect(await push.find(db, 'p1')).toEqual({ ownerId: 'alice', row: probe('p1', 'Latte', 16) })
    expect(await push.find(db, 'nope')).toBeNull()
  })

  it("pulls only the user's probes after the cursor, tombstones included", async () => {
    await push.write(db, 'alice', probe('p1', 'A', 15))
    await push.write(db, 'bob', probe('p2', 'B', 16, { updatedBy: 'bob' }))
    await push.write(db, 'alice', probe('p3', 'C', 17, { deletedAt: 1000 }))
    const rows = await syncProbeSyncHandler.pull(db, 'alice', 15, 10)
    expect(rows.map((row) => row.id)).toEqual(['p3'])
    expect(await syncProbeSyncHandler.pull(db, 'alice', 0, 1)).toHaveLength(1)
  })

  it("refuses a title already used by another of the user's live probes", async () => {
    await push.write(db, 'alice', probe('p1', 'Tea', 15))
    await push.write(db, 'alice', probe('p2', 'Old', 16, { deletedAt: 1000 }))
    expect(await push.check(db, 'alice', probe('p9', 'Tea', 0))).toBe(
      SYNC_PROBE_MESSAGE.TITLE_TAKEN
    )
    expect(await push.check(db, 'alice', probe('p1', 'Tea', 0))).toBeNull() // itself
    expect(await push.check(db, 'alice', probe('p9', 'Old', 0))).toBeNull() // deleted
    expect(await push.check(db, 'bob', probe('p9', 'Tea', 0))).toBeNull() // someone else's
    expect(await push.check(db, 'alice', probe('p9', 'Tea', 0, { deletedAt: 5 }))).toBeNull()
  })

  it('purges tombstones deleted before a time and answers the highest changeSeq removed', async () => {
    await push.write(db, 'alice', probe('p1', 'A', 15, { deletedAt: 100 }))
    await push.write(db, 'alice', probe('p2', 'B', 16, { deletedAt: 200 }))
    await push.write(db, 'alice', probe('p3', 'C', 17, { deletedAt: 900 }))
    await push.write(db, 'alice', probe('p4', 'D', 18))
    expect(await push.purge(db, 500)).toEqual({ removed: 2, maxSeq: 16 })
    expect(await push.purge(db, 500)).toEqual({ removed: 0, maxSeq: 0 })
  })
})
