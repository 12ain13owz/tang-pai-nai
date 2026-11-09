import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '@/core/config'
import type { Database } from '@/core/database'
import { createDatabase } from '@/core/database/client'
import { users } from '@/core/database/schema/auth'
import { events } from '@/core/database/schema/event'
import { profiles } from '@/core/database/schema/profile'
import type { SyncPushHandler, SyncRowWrite } from '@/core/sync'
import { EVENT_LIMITS, EVENT_MESSAGE } from './event.const'
import { eventSyncHandler } from './event.repository.drizzle'

let dir: string
let close: () => void
let db: Database
const push = eventSyncHandler.push as SyncPushHandler

const event = (id: string, changeSeq: number, extra: Partial<SyncRowWrite> = {}) => ({
  id,
  profileId: 'pa',
  name: 'เชียงใหม่',
  icon: 'lucidePlane',
  color: '#0e7490',
  startOn: '2026-11-07',
  endOn: '2026-11-12',
  isClosed: false,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  changeSeq,
  updatedBy: 'alice',
  ...extra,
})
const input = (row: ReturnType<typeof event>) => {
  const { changeSeq: _seq, updatedBy: _by, ...rest } = row
  return rest
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tpn-event-'))
  const created = createDatabase({ ...env, DATABASE_URL: `file:${join(dir, 'test.db')}` })
  await migrate(created.db, { migrationsFolder: 'drizzle' })
  await created.db.insert(users).values([
    { id: 'alice', email: 'a@example.com', displayName: 'a' },
    { id: 'bob', email: 'b@example.com', displayName: 'b' },
  ])
  await created.db.insert(profiles).values(
    ['pa', 'pa2', 'gone', 'pb'].map((id) => ({
      id,
      userId: id === 'pb' ? 'bob' : 'alice',
      name: id,
      icon: 'lucideHouse',
      color: '#15803d',
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: id === 'gone' ? 5 : null,
      changeSeq: 1,
      updatedBy: 'alice',
    }))
  )
  db = created.db
  close = () => created.client.close()
})

afterEach(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('eventSyncHandler', () => {
  it('writes an event and replaces it on the next write, without userId; pulls only the user’s', async () => {
    expect(await push.write(db, 'alice', event('cm', 15))).toEqual(event('cm', 15))
    await push.write(db, 'alice', event('cm', 16, { isClosed: true }))
    expect(await push.find(db, 'cm')).toEqual({
      ownerId: 'alice',
      row: event('cm', 16, { isClosed: true }),
    })
    await push.write(db, 'bob', event('bobs', 17, { profileId: 'pb' }))
    expect((await eventSyncHandler.pull(db, 'alice', 0, 100)).map((row) => row.id)).toEqual(['cm'])
    expect(await eventSyncHandler.pull(db, 'alice', 16, 100)).toEqual([])
  })

  it('validates the shape: name, icon, colour, dates, an end not before the start (rule 2)', () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T12:00:00Z'), toFake: ['Date'] })
    const valid = input(
      event('00000000-0000-7000-8000-000000000001', 1, {
        profileId: '00000000-0000-7000-8000-0000000000aa',
      })
    )
    expect(push.validate({ ...valid, name: ' เชียงใหม่ ' })).toMatchObject({
      ok: true,
      row: { name: 'เชียงใหม่' },
    })
    const { endOn: _end, isClosed: _closed, ...bare } = valid
    expect(push.validate(bare)).toMatchObject({ ok: true, row: { endOn: null, isClosed: false } })
    expect(push.validate({ ...valid, endOn: '2026-11-07' })).toMatchObject({ ok: true })
    for (const bad of [
      { name: '  ' },
      { name: 'x'.repeat(EVENT_LIMITS.NAME_MAX + 1) },
      { icon: 'plane' },
      { color: 'red' },
      { startOn: '1999-12-31' },
      { startOn: '2027-11-12' },
      { startOn: '2026-02-30' },
      { endOn: '2026-11-06' },
      { isClosed: 'yes' },
    ]) {
      expect(push.validate({ ...valid, ...bad }), JSON.stringify(bad)).toMatchObject({ ok: false })
    }
    expect(push.validate({ ...valid, endOn: '2026-11-01' })).toEqual({
      ok: false,
      message: EVENT_MESSAGE.END_BEFORE_START,
    })
  })

  it('needs a live profile of the user and never moves to another (rule 1)', async () => {
    expect(await push.check(db, 'alice', event('cm', 0))).toBeNull()
    expect(await push.check(db, 'alice', event('cm', 0, { profileId: 'gone' }))).toBe(
      EVENT_MESSAGE.PROFILE_GONE
    )
    expect(await push.check(db, 'alice', event('cm', 0, { profileId: 'pb' }))).toBe(
      EVENT_MESSAGE.PROFILE_GONE
    )
    await push.write(db, 'alice', event('cm', 1))
    expect(await push.check(db, 'alice', event('cm', 0, { profileId: 'pa2' }))).toBe(
      EVENT_MESSAGE.PROFILE_FIXED
    )
    expect(await push.check(db, 'alice', event('cm', 0, { profileId: 'gone', deletedAt: 9 }))).toBe(
      null
    )
  })

  it('holds at most 50 open events per profile; closed ones and stored open ones pass (rule 1)', async () => {
    await db.insert(events).values(
      Array.from({ length: EVENT_LIMITS.OPEN_PER_PROFILE }, (_, i) => ({
        ...event(`e${i}`, i + 1),
        userId: 'alice',
      }))
    )
    expect(await push.check(db, 'alice', event('new', 0))).toBe(EVENT_MESSAGE.LIMIT)
    expect(await push.check(db, 'alice', event('new', 0, { isClosed: true }))).toBeNull()
    expect(await push.check(db, 'alice', event('e3', 0, { name: 'แก้ชื่อ' }))).toBeNull()
    expect(await push.check(db, 'alice', event('new', 0, { profileId: 'pa2' }))).toBeNull()
    await push.write(db, 'alice', event('e4', 99, { isClosed: true }))
    // Reopening a closed one counts like a new open one.
    expect(await push.check(db, 'alice', event('e4', 0))).toBeNull()
    await push.write(db, 'alice', event('e5', 100, { isClosed: true }))
    await push.write(db, 'alice', event('e4', 101))
    await push.write(db, 'alice', event('x', 102))
    expect(await push.check(db, 'alice', event('e5', 0))).toBe(EVENT_MESSAGE.LIMIT)
  })

  it('purges tombstones older than the cutoff and reports the highest changeSeq', async () => {
    await push.write(db, 'alice', event('old', 3, { deletedAt: 10 }))
    await push.write(db, 'alice', event('new', 4, { deletedAt: 500 }))
    expect(await push.purge(db, 100)).toEqual({ removed: 1, maxSeq: 3 })
    expect((await eventSyncHandler.pull(db, 'alice', 0, 100)).map((row) => row.id)).toEqual(['new'])
  })
})
