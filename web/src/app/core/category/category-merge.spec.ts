import { findPending, listOps, putRow, queueWrite } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { followMerges, hasMergeLeftovers, mergeTargetOf } from './category-merge'

const category = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  profileId: 'p',
  type: 'expense',
  parentId: null,
  name: id,
  icon: 'lucideShapes',
  color: '#475569',
  isArchived: false,
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  changeSeq: 1,
  ...extra,
})

const transaction = (id: string, categoryId: string, extra: Record<string, unknown> = {}) => ({
  id,
  profileId: 'p',
  walletId: 'w',
  categoryId,
  amount: 100,
  occurredOn: '2026-11-01',
  note: '',
  excludeFromReport: false,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
  changeSeq: 1,
  ...extra,
})

const merged = (id: string, into: string, extra: Record<string, unknown> = {}) =>
  category(id, { deletedAt: 5, mergedIntoId: into, ...extra })

describe('category-merge', () => {
  let db: LocalDatabase
  const row = (table: string, id: string) =>
    db.selectObjects(`SELECT * FROM ${table} WHERE id = ?`, [id])[0]

  beforeEach(async () => {
    db = await openTestDatabase()
  })

  afterEach(() => db.close())

  describe('mergeTargetOf', () => {
    it('follows merges to a live category of the same profile and type, up to five', () => {
      for (const value of [
        category('end', { isArchived: true }),
        merged('m1', 'm2'),
        merged('m2', 'm3'),
        merged('m3', 'm4'),
        merged('m4', 'm5'),
        merged('m5', 'end'),
        merged('m0', 'm1'),
      ]) {
        putRow(db, 'categories', value)
      }
      expect(mergeTargetOf(db, 'm1')).toBe('end')
      expect(mergeTargetOf(db, 'm0')).toBeNull()
    })

    it('answers null for a live or plain category, a dead end, another type or its own child', () => {
      for (const value of [
        category('live'),
        category('plain', { deletedAt: 5 }),
        category('salary', { type: 'income' }),
        category('other', { profileId: 'q' }),
        merged('toSalary', 'salary'),
        merged('toOther', 'other'),
        merged('toNowhere', 'nope'),
        merged('home', 'rent'),
        category('rent', { parentId: 'home' }),
      ]) {
        putRow(db, 'categories', value)
      }
      for (const id of ['live', 'plain', 'toSalary', 'toOther', 'toNowhere', 'home', 'nope']) {
        expect(mergeTargetOf(db, id)).toBeNull()
      }
    })
  })

  describe('followMerges', () => {
    it('moves rows of a merged tombstone, rewriting pending ops only', () => {
      putRow(db, 'categories', category('food'))
      putRow(db, 'categories', category('rice', { parentId: 'food' }))
      putRow(db, 'categories', merged('water', 'rice', { parentId: 'food' }))
      putRow(db, 'categories', category('gone', { deletedAt: 5 }))
      putRow(db, 'categories', merged('home', 'food'))
      putRow(db, 'categories', category('kid', { parentId: 'home' }))
      putRow(db, 'transactions', transaction('t1', 'water'))
      queueWrite(db, 'transactions', 'upsert', transaction('t2', 'water', { changeSeq: null }))
      putRow(db, 'transactions', transaction('t3', 'gone'))
      putRow(db, 'transactions', transaction('t4', 'kid'))
      putRow(db, 'transactions', transaction('t5', 'water', { deletedAt: 5 }))
      expect(hasMergeLeftovers(db)).toBe(true)

      followMerges(db, 99)

      expect(row('transactions', 't1')).toMatchObject({ category_id: 'rice', updated_at: 1 })
      expect(findPending(db, 'transactions', 't1')).toBeNull()
      expect(row('transactions', 't2')['category_id']).toBe('rice')
      expect(findPending(db, 'transactions', 't2')?.row).toMatchObject({
        categoryId: 'rice',
        updatedAt: 99,
      })
      expect(row('categories', 'kid')).toMatchObject({ deleted_at: 99, merged_into_id: 'food' })
      expect(row('transactions', 't4')['category_id']).toBe('food')
      // A plain tombstone and a deleted row are left to the plain sweeps.
      expect(row('transactions', 't3')['category_id']).toBe('gone')
      expect(row('transactions', 't5')['category_id']).toBe('water')
      expect(listOps(db, 'pending').map((op) => op.rowId)).toEqual(['t2'])
      expect(hasMergeLeftovers(db)).toBe(false)
    })

    it('has nothing to do when a merge leads nowhere', () => {
      putRow(db, 'categories', merged('water', 'nope'))
      putRow(db, 'transactions', transaction('t1', 'water'))
      expect(hasMergeLeftovers(db)).toBe(false)
    })
  })
})
