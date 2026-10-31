import { describe, expect, it } from 'vitest'
import { createSyncRegistry } from '@/core/sync'
import type { SyncRow, SyncValidation } from '@/core/sync'
import { SYNC_LIMITS, SyncErrorCode } from './sync.const'
import { createMemorySyncRepository } from './sync.repository.memory'
import { createSyncService } from './sync.service'
import type { OpResult, PushOp } from './sync.entity'
import type { MemorySyncOptions } from './sync.repository.memory'

const NOW = 1_800_000_000_000
const ALICE = 'user-alice'
const BOB = 'user-bob'
const PHONE = '11111111-1111-4111-8111-111111111111'
const LAPTOP = '22222222-2222-4222-8222-222222222222'

// A pushable table with one feature rule (a title is required) and a pull-only one.
const validateNote = (input: unknown): SyncValidation => {
  const row = input as Record<string, unknown>
  if (typeof row.title !== 'string' || row.title === '') {
    return { ok: false, message: 'Title is required' }
  }
  return {
    ok: true,
    row: {
      id: String(row.id),
      title: row.title,
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      deletedAt: typeof row.deletedAt === 'number' ? row.deletedAt : null,
    },
  }
}

const THB: SyncRow = { id: 'THB', code: 'THB', changeSeq: 1, updatedAt: NOW, isActive: true }

const setup = (options: MemorySyncOptions = {}) => {
  let now = NOW
  let ids = 0
  const registry = createSyncRegistry()
  const noop = async () => Promise.reject(new Error('not used by the memory repository'))
  registry.register({ table: 'currencies', pull: noop })
  registry.register({
    table: 'notes',
    pull: noop,
    push: { validate: validateNote, find: noop, check: noop, write: noop, purge: noop },
  })
  const memory = createMemorySyncRepository({
    shared: { currencies: [THB] },
    checks: {
      notes: (rows, _userId, row) =>
        rows.some((other) => other.title === row.title && other.id !== row.id && !other.deletedAt)
          ? 'Title in use'
          : null,
    },
    ...options,
  })
  const service = createSyncService({
    syncRepo: memory.repo,
    registry,
    clock: () => now,
    newId: () => `history-${++ids}`,
  })
  return {
    service,
    memory,
    tick: (ms: number) => {
      now += ms
    },
    now: () => now,
  }
}

let opCount = 0
const op = (overrides: Partial<PushOp> & { row: PushOp['row'] }): PushOp => ({
  opId: `0199a000-0000-7000-8000-${String(++opCount).padStart(12, '0')}`,
  table: 'notes',
  op: 'upsert',
  baseSeq: null,
  ...overrides,
})

const note = (id: string, title: string, at: number, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  createdAt: at,
  updatedAt: at,
  ...extra,
})

const one = async (
  service: ReturnType<typeof setup>['service'],
  userId: string,
  deviceId: string,
  pushed: PushOp
): Promise<OpResult> => {
  const [result] = await service.push(userId, deviceId, [pushed])
  return result
}

describe('createSyncService › push', () => {
  it('applies a new row, stamping changeSeq and updatedBy', async () => {
    const { service } = setup()
    const result = await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) }))
    expect(result).toMatchObject({
      status: 'applied',
      changeSeq: 2,
      row: { id: 'n1', title: 'Coffee', changeSeq: 2, updatedBy: ALICE, deletedAt: null },
    })
  })

  it('clamps device times to the server clock', async () => {
    const { service, now } = setup()
    const result = await one(
      service,
      ALICE,
      PHONE,
      op({ row: note('n1', 'Coffee', now() + 60_000, { deletedAt: now() + 60_000 }) })
    )
    expect(result.row).toMatchObject({ createdAt: now(), updatedAt: now(), deletedAt: now() })
  })

  it('answers a retried opId with the stored result and applies nothing', async () => {
    const { service } = setup()
    const first = op({ row: note('n1', 'Coffee', NOW) })
    await one(service, ALICE, PHONE, first)
    const again = await one(service, ALICE, PHONE, { ...first, row: note('n1', 'Tea', NOW) })
    expect(again).toMatchObject({ status: 'applied', changeSeq: 2, row: { title: 'Coffee' } })
  })

  it('rejects an opId that belongs to another user', async () => {
    const { service } = setup()
    const first = op({ row: note('n1', 'Coffee', NOW) })
    await one(service, ALICE, PHONE, first)
    const result = await one(service, BOB, LAPTOP, { ...first, row: note('n2', 'Tea', NOW) })
    expect(result).toMatchObject({ status: 'rejected', code: 'ID_TAKEN', row: null })
  })

  it('rejects a row id that belongs to another user, without showing their row', async () => {
    const { service } = setup()
    await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) }))
    const result = await one(service, BOB, LAPTOP, op({ row: note('n1', 'Mine', NOW) }))
    expect(result).toMatchObject({ status: 'rejected', code: 'ID_TAKEN', row: null })
  })

  it('rejects an unknown table and a pull-only table', async () => {
    const { service } = setup()
    const [unknown, readOnly] = await service.push(ALICE, PHONE, [
      op({ table: 'wallets', row: { id: 'w1' } }),
      op({ table: 'currencies', row: { id: 'THB' }, baseSeq: 1 }),
    ])
    expect(unknown).toMatchObject({ status: 'rejected', code: 'UNKNOWN_TABLE' })
    expect(readOnly).toMatchObject({ status: 'rejected', code: 'READ_ONLY' })
  })

  it("rejects a row that breaks the feature's validation, returning the server's row", async () => {
    const { service } = setup()
    await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) }))
    const result = await one(service, ALICE, PHONE, op({ row: note('n1', '', NOW), baseSeq: 2 }))
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'VALIDATION',
      message: 'Title is required',
      row: { title: 'Coffee' },
    })
  })

  it('rejects a row that breaks a rule about other rows, and stores the rejection', async () => {
    const { service, memory } = setup()
    await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) }))
    const pushed = op({ row: note('n2', 'Coffee', NOW) })
    const result = await one(service, ALICE, LAPTOP, pushed)
    expect(result).toMatchObject({ status: 'rejected', code: 'CONFLICT', message: 'Title in use' })
    expect(memory.row('notes', 'n2')).toBeNull()
    expect(memory.opResult(pushed.opId)).toMatchObject({ status: 'rejected' })
  })

  it('applies one op even when another in the same push is rejected', async () => {
    const { service } = setup()
    const results = await service.push(ALICE, PHONE, [
      op({ row: note('n1', '', NOW) }),
      op({ row: note('n2', 'Tea', NOW) }),
    ])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'applied'])
  })

  it('applies an edit based on the current changeSeq without any history', async () => {
    const { service, memory, tick, now } = setup()
    await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) }))
    tick(1000)
    const result = await one(
      service,
      ALICE,
      LAPTOP,
      op({ row: note('n1', 'Latte', now()), baseSeq: 2 })
    )
    expect(result).toMatchObject({ status: 'applied', changeSeq: 3, row: { title: 'Latte' } })
    expect(memory.history()).toEqual([])
  })

  describe('conflicts (rule 12)', () => {
    const conflict = async () => {
      const context = setup()
      const { service, tick, now } = context
      await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) })) // seq 2
      tick(5000)
      await one(service, ALICE, PHONE, op({ row: note('n1', 'Latte', now()), baseSeq: 2 })) // 3
      return context
    }

    it('overrides a stale edit that is older, and notices the device that lost', async () => {
      const { service, memory } = await conflict()
      const result = await one(
        service,
        ALICE,
        LAPTOP,
        op({ row: note('n1', 'Tea', NOW + 1000), baseSeq: 2 })
      )
      expect(result).toMatchObject({
        status: 'overridden',
        changeSeq: 3,
        row: { title: 'Latte' },
        notice: { table: 'notes', rowId: 'n1', previous: { title: 'Tea' }, overwrittenBy: ALICE },
      })
      expect(memory.history()).toMatchObject([{ loserDeviceId: LAPTOP, changeSeq: 3 }])
    })

    it('lets the server row win a tie', async () => {
      const { service, now } = await conflict()
      const result = await one(
        service,
        ALICE,
        LAPTOP,
        op({ row: note('n1', 'Tea', now()), baseSeq: 2 })
      )
      expect(result.status).toBe('overridden')
    })

    it('applies a stale edit that is later, keeping the applied version for the other devices', async () => {
      const { service, memory, tick, now } = await conflict()
      tick(1000)
      const result = await one(
        service,
        ALICE,
        LAPTOP,
        op({ row: note('n1', 'Tea', now()), baseSeq: 2 })
      )
      expect(result).toMatchObject({ status: 'applied', changeSeq: 4, row: { title: 'Tea' } })
      expect(memory.history()).toMatchObject([
        {
          previous: { title: 'Latte' },
          loserUserId: ALICE,
          loserDeviceId: null,
          overwrittenByDevice: LAPTOP,
          changeSeq: 4,
        },
      ])
    })

    it('treats a row the device thinks is new but the server has as a conflict', async () => {
      const { service } = await conflict()
      const result = await one(service, ALICE, LAPTOP, op({ row: note('n1', 'Tea', NOW) }))
      expect(result.status).toBe('overridden')
    })

    it('lets a stale delete win over an edit (delete beats edit)', async () => {
      const { service, memory } = await conflict()
      const result = await one(
        service,
        ALICE,
        LAPTOP,
        op({ op: 'delete', row: { id: 'n1', updatedAt: NOW }, baseSeq: 2 })
      )
      expect(result).toMatchObject({ status: 'applied', changeSeq: 4, row: { deletedAt: NOW } })
      expect(memory.history()).toMatchObject([{ previous: { title: 'Latte' } }])
    })

    it('keeps a deleted row deleted against a stale edit', async () => {
      const { service, tick, now } = await conflict()
      await one(service, ALICE, PHONE, op({ op: 'delete', row: { id: 'n1' }, baseSeq: 3 })) // 4
      tick(1000)
      const result = await one(
        service,
        ALICE,
        LAPTOP,
        op({ row: note('n1', 'Tea', now()), baseSeq: 3 })
      )
      expect(result).toMatchObject({ status: 'overridden', row: { title: 'Latte' } })
      expect(result.row?.deletedAt).toBe(now() - 1000)
    })

    it('restores a deleted row from an up-to-date upsert (undo)', async () => {
      const { service, now } = await conflict()
      await one(service, ALICE, PHONE, op({ op: 'delete', row: { id: 'n1' }, baseSeq: 3 })) // 4
      const result = await one(
        service,
        ALICE,
        PHONE,
        op({ row: note('n1', 'Latte', now(), { deletedAt: null }), baseSeq: 4 })
      )
      expect(result).toMatchObject({ status: 'applied', row: { deletedAt: null } })
    })
  })

  it('applies a delete of a row the server never had, and a repeated delete, as no-ops', async () => {
    const { service } = setup()
    const missing = await one(service, ALICE, PHONE, op({ op: 'delete', row: { id: 'ghost' } }))
    expect(missing).toMatchObject({ status: 'applied', row: null, changeSeq: null })
    await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) }))
    await one(service, ALICE, PHONE, op({ op: 'delete', row: { id: 'n1' }, baseSeq: 2 }))
    const again = await one(
      service,
      ALICE,
      PHONE,
      op({ op: 'delete', row: { id: 'n1' }, baseSeq: 3 })
    )
    expect(again).toMatchObject({ status: 'applied', changeSeq: 3 })
  })
})

describe('createSyncService › pull', () => {
  it("returns the user's rows and master data in changeSeq order, with the tables", async () => {
    const { service } = setup()
    await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) }))
    await one(service, BOB, LAPTOP, op({ row: note('n2', 'Bob', NOW) }))
    const result = await service.pull(ALICE, { since: 0, limit: 500, deviceId: PHONE })
    expect(result.changes.map(({ table, row }) => `${table}:${row.id}`)).toEqual([
      'currencies:THB',
      'notes:n1',
    ])
    expect(result).toMatchObject({ cursor: 3, hasMore: false, tables: ['currencies', 'notes'] })
  })

  it('pages with limit, and the cursor is the last row while there is more', async () => {
    const { service } = setup()
    await one(service, ALICE, PHONE, op({ row: note('n1', 'A', NOW) }))
    await one(service, ALICE, PHONE, op({ row: note('n2', 'B', NOW) }))
    const first = await service.pull(ALICE, { since: 0, limit: 2, deviceId: PHONE })
    expect(first).toMatchObject({ cursor: 2, hasMore: true })
    const second = await service.pull(ALICE, { since: first.cursor, limit: 2, deviceId: PHONE })
    expect(second.changes.map(({ row }) => row.id)).toEqual(['n2'])
    expect(second).toMatchObject({ cursor: 3, hasMore: false })
  })

  it("moves a quiet device's cursor up to the server's counter", async () => {
    const { service } = setup()
    await one(service, BOB, LAPTOP, op({ row: note('n2', 'Bob', NOW) })) // seq 2, not Alice's
    const result = await service.pull(ALICE, { since: 1, limit: 500, deviceId: PHONE })
    expect(result).toMatchObject({ changes: [], cursor: 2 })
  })

  it('gives a conflict notice to the losing devices but not the one that won', async () => {
    const { service, tick, now } = setup()
    await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW) }))
    tick(1000)
    await one(service, ALICE, LAPTOP, op({ row: note('n1', 'Tea', now()), baseSeq: null }))
    const phone = await service.pull(ALICE, { since: 2, limit: 500, deviceId: PHONE })
    const laptop = await service.pull(ALICE, { since: 2, limit: 500, deviceId: LAPTOP })
    expect(phone.notices).toMatchObject([{ rowId: 'n1', previous: { title: 'Coffee' } }])
    expect(laptop.notices).toEqual([])
  })

  it('answers 410 CURSOR_EXPIRED for a cursor below the purge watermark', async () => {
    const { service, tick } = setup()
    await one(service, ALICE, PHONE, op({ row: note('n1', 'Coffee', NOW, { deletedAt: NOW }) }))
    tick(SYNC_LIMITS.RETENTION_MS + 1)
    await service.cleanup()
    await expect(
      service.pull(ALICE, { since: 1, limit: 500, deviceId: PHONE })
    ).rejects.toMatchObject({ status: 410, code: SyncErrorCode.CURSOR_EXPIRED })
    await expect(
      service.pull(ALICE, { since: 0, limit: 500, deviceId: PHONE })
    ).resolves.toMatchObject({ cursor: 2 })
  })
})

describe('createSyncService › cleanup', () => {
  it('purges old tombstones and op records, and raises the watermark', async () => {
    const { service, memory, tick, now } = setup()
    await one(service, ALICE, PHONE, op({ row: note('old', 'Old', NOW, { deletedAt: NOW }) }))
    tick(SYNC_LIMITS.RETENTION_MS + 1)
    await one(service, ALICE, PHONE, op({ row: note('new', 'New', now(), { deletedAt: now() }) }))
    const removed = await service.cleanup()
    expect(removed).toEqual({ tombstones: 1, ops: 1 })
    expect(memory.row('notes', 'old')).toBeNull()
    expect(memory.row('notes', 'new')).not.toBeNull()
    expect(await memory.repo.purgedSeq()).toBe(2)
  })
})
