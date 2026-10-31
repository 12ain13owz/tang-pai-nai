import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/core/config'
import { createDatabase } from '@/core/database/client'
import { users } from '@/core/database/schema/auth'
import { createSyncRegistry } from '@/core/sync'
import type { SyncTableHandler } from '@/core/sync'
import { createDrizzleSyncRepository } from './sync.repository.drizzle'
import type { HistoryEntry, OpResult } from './sync.entity'
import type { SyncRepository } from './sync.repository'

// A real SQLite file per test with the committed migrations (`:memory:` gives each
// transaction its own empty database).
let dir: string
let close: () => void
let repo: SyncRepository
const handler = {
  table: 'notes',
  pull: vi.fn<SyncTableHandler['pull']>(async () => Promise.resolve([])),
  push: {
    validate: vi.fn(),
    find: vi.fn(async () => Promise.resolve(null)),
    check: vi.fn(async () => Promise.resolve(null)),
    write: vi.fn(),
    purge: vi.fn(async () => Promise.resolve({ removed: 0, maxSeq: 0 })),
  },
}

const ALICE = 'alice'
const PHONE = '11111111-1111-4111-8111-111111111111'
const LAPTOP = '22222222-2222-4222-8222-222222222222'

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-sync-'))
  const { client, db } = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(db, { migrationsFolder: 'drizzle' })
  await db.insert(users).values({ id: ALICE, email: 'a@example.com', displayName: 'a' })
  const registry = createSyncRegistry()
  registry.register(handler)
  registry.register({ table: 'currencies', pull: async () => Promise.resolve([]) })
  repo = createDrizzleSyncRepository(db, registry)
  close = () => client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

const applied: OpResult = { opId: 'op-1', status: 'applied', row: null, changeSeq: null }

const history = (overrides: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'h1',
  table: 'notes',
  rowId: 'n1',
  overwrittenBy: ALICE,
  overwrittenByDevice: LAPTOP,
  previous: { id: 'n1', title: 'Coffee' },
  loserUserId: ALICE,
  loserDeviceId: null,
  changeSeq: 20,
  createdAt: 1,
  ...overrides,
})

describe('createDrizzleSyncRepository', () => {
  it('starts after the seeded currencies and counts up', async () => {
    expect(await repo.lastSeq()).toBe(14)
    expect(await repo.nextSeq()).toBe(15)
    expect(await repo.nextSeq()).toBe(16)
    expect(await repo.lastSeq()).toBe(16)
  })

  it('only ever raises the purge watermark', async () => {
    expect(await repo.purgedSeq()).toBe(0)
    await repo.raisePurgedSeq(10)
    await repo.raisePurgedSeq(5)
    expect(await repo.purgedSeq()).toBe(10)
  })

  it('stores an op with its result and finds it again', async () => {
    expect(await repo.findOp('op-1')).toBeNull()
    await repo.saveOp({
      opId: 'op-1',
      userId: ALICE,
      deviceId: PHONE,
      appliedAt: 5,
      result: applied,
    })
    expect(await repo.findOp('op-1')).toEqual({ userId: ALICE, result: applied })
  })

  it('deletes op records applied before a time', async () => {
    await repo.saveOp({
      opId: 'op-1',
      userId: ALICE,
      deviceId: PHONE,
      appliedAt: 5,
      result: applied,
    })
    await repo.saveOp({
      opId: 'op-2',
      userId: ALICE,
      deviceId: PHONE,
      appliedAt: 50,
      result: applied,
    })
    expect(await repo.deleteOpsBefore(10)).toBe(1)
    expect(await repo.findOp('op-2')).not.toBeNull()
  })

  it('gives notices only to the loser, not the overwriting device, within the cursor range', async () => {
    await repo.addHistory(history({ id: 'h1', changeSeq: 20 }))
    await repo.addHistory(history({ id: 'h2', changeSeq: 30 }))
    await repo.addHistory(history({ id: 'h3', changeSeq: 25, loserDeviceId: PHONE }))
    expect((await repo.notices(ALICE, PHONE, 0, 100)).map((notice) => notice.id)).toEqual([
      'h1',
      'h2',
    ])
    expect(await repo.notices(ALICE, PHONE, 20, 25)).toEqual([])
    expect(await repo.notices(ALICE, LAPTOP, 0, 100)).toEqual([])
    expect(await repo.notices(ALICE, PHONE, 0, 100)).toMatchObject([
      { previous: { title: 'Coffee' }, overwrittenBy: ALICE, table: 'notes', rowId: 'n1' },
      { id: 'h2' },
    ])
  })

  it('rolls a transaction back when the work throws', async () => {
    await expect(
      repo.transaction(async (tx) => {
        await tx.nextSeq()
        throw new Error('boom')
      })
    ).rejects.toThrow()
    expect(await repo.lastSeq()).toBe(14)
  })

  it("hands per-table work to the table's handler, inside the transaction", async () => {
    await repo.transaction(async (tx) => {
      await tx.pull('notes', ALICE, 3, 10)
      await tx.find('notes', 'n1')
      return null
    })
    expect(handler.pull).toHaveBeenCalledWith(expect.anything(), ALICE, 3, 10)
    expect(handler.push.find).toHaveBeenCalledWith(expect.anything(), 'n1')
  })

  it('refuses push work on a pull-only table', async () => {
    await expect(repo.find('currencies', 'THB')).rejects.toThrow('pull-only')
  })
})
