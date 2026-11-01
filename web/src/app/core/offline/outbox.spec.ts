import { countOps, deleteOp, findOp, findPending, listOps, queueWrite } from './outbox'
import { getRow } from './sync-tables'
import { openTestDatabase } from './testing-db'
import type { LocalDatabase } from './local-database'

/** A profile row: any pushable table behaves the same in the outbox and sync. */
const profile = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  icon: 'lucideHouse',
  color: '#16a34a',
  sortOrder: 0,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  ...extra,
})

describe('outbox', () => {
  let db: LocalDatabase
  beforeEach(async () => {
    db = await openTestDatabase()
  })
  afterEach(() => db.close())

  describe('queueWrite', () => {
    it('writes the row and queues an op based on the changeSeq the device saw', () => {
      queueWrite(db, 'profiles', 'upsert', profile('p1', 'Coffee', { changeSeq: 15 }))
      expect(getRow(db, 'profiles', 'p1')).toMatchObject({ name: 'Coffee', changeSeq: 15 })
      expect(listOps(db, 'pending')).toMatchObject([
        { table: 'profiles', rowId: 'p1', op: 'upsert', baseSeq: 15, status: 'pending' },
      ])
    })

    it('queues a row the server never saw with a null baseSeq', () => {
      queueWrite(db, 'profiles', 'upsert', profile('p1', 'Coffee'))
      expect(findPending(db, 'profiles', 'p1')?.baseSeq).toBeNull()
    })

    it('keeps one pending op per row: a newer write replaces it with a new opId, same baseSeq', () => {
      queueWrite(db, 'profiles', 'upsert', profile('p1', 'Coffee', { changeSeq: 15 }))
      const first = findPending(db, 'profiles', 'p1')
      queueWrite(db, 'profiles', 'upsert', profile('p1', 'Latte', { changeSeq: 16 }))
      const second = findPending(db, 'profiles', 'p1')
      expect(countOps(db, 'pending')).toBe(1)
      expect(second).toMatchObject({ seq: first?.seq, baseSeq: 15, row: { name: 'Latte' } })
      expect(second?.opId).not.toBe(first?.opId)
    })

    it('sends only the id and time for a delete, and keeps the tombstone locally', () => {
      queueWrite(
        db,
        'profiles',
        'delete',
        profile('p1', 'Coffee', { updatedAt: 2000, deletedAt: 2000 })
      )
      expect(findPending(db, 'profiles', 'p1')).toMatchObject({
        op: 'delete',
        row: { id: 'p1', updatedAt: 2000 },
      })
      expect(getRow(db, 'profiles', 'p1')).toMatchObject({ deletedAt: 2000 })
    })

    it('refuses a pull-only table', () => {
      expect(() => queueWrite(db, 'currencies', 'upsert', { id: 'THB' })).toThrow('read-only')
    })

    it('queues a new pending op beside a rejected one for the same row', () => {
      queueWrite(db, 'profiles', 'upsert', profile('p1', 'Tea'))
      const rejected = findPending(db, 'profiles', 'p1')
      db.exec(`UPDATE outbox SET status = 'rejected', code = 'CONFLICT' WHERE op_id = ?`, [
        rejected?.opId ?? '',
      ])
      queueWrite(db, 'profiles', 'upsert', profile('p1', 'Green tea'))
      expect(countOps(db, 'pending')).toBe(1)
      expect(countOps(db, 'rejected')).toBe(1)
      expect(listOps(db, 'rejected')).toMatchObject([{ code: 'CONFLICT', row: { name: 'Tea' } }])
    })
  })

  it('lists ops in the order they were queued, with a limit', () => {
    queueWrite(db, 'profiles', 'upsert', profile('p1', 'A'))
    queueWrite(db, 'profiles', 'upsert', profile('p2', 'B'))
    queueWrite(db, 'profiles', 'upsert', profile('p3', 'C'))
    expect(listOps(db, 'pending', 2).map((op) => op.rowId)).toEqual(['p1', 'p2'])
  })

  it('finds and deletes an op by opId', () => {
    queueWrite(db, 'profiles', 'upsert', profile('p1', 'A'))
    const { opId } = listOps(db, 'pending')[0]
    expect(findOp(db, opId)?.rowId).toBe('p1')
    deleteOp(db, opId)
    expect(findOp(db, opId)).toBeNull()
  })
})
