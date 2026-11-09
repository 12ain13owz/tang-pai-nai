import { setUpDebts } from '@/core/debt/debt-testing'
import { listOps, queueWrite } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { moveCategoryRows, moveSources, undoCategoryMove } from './category-move-rows'

describe('category move rows (docs/features/export.md rules 7–10)', () => {
  let db: LocalDatabase
  let setup: Awaited<ReturnType<typeof setUpDebts>>
  const categoryOf = (id: string) =>
    db.selectValue('SELECT category_id FROM transactions WHERE id = ?', [id])

  beforeEach(async () => {
    setup = await setUpDebts()
    db = setup.db
    setup.pulled('categories', {
      id: 'child',
      profileId: 'p1',
      type: 'expense',
      parentId: 'shop',
      name: 'child',
      icon: 'lucideShapes',
      color: '#475569',
      isArchived: false,
      sortOrder: 0,
    })
    setup.transaction('t1', { walletId: 'cash' })
    setup.transaction('t2')
    setup.transaction('t3')
    setup.transaction('kid', { categoryId: 'child' })
    setup.transaction('gone', { deletedAt: 3 })
  })

  afterEach(() => db.close())

  it("counts the category's own live rows per wallet, in the wallets' order", () => {
    expect(moveSources(db, 'shop').map((s) => `${s.walletId}:${s.count}`)).toEqual([
      'cash:1',
      'bank:2',
    ])
  })

  it("moves only the category's own rows, rewriting a pending op instead of adding one", () => {
    // t2 was edited offline: its op is still pending.
    queueWrite(db, 'transactions', 'upsert', {
      id: 't2',
      profileId: 'p1',
      walletId: 'bank',
      categoryId: 'shop',
      amount: 300000,
      occurredOn: '2026-10-05',
      note: 'edited offline',
      excludeFromReport: false,
      createdAt: 1,
      updatedAt: 2,
      deletedAt: null,
      changeSeq: 1,
      recurringId: null,
      debtId: null,
      eventId: null,
    })
    const undo = db.transaction((tx) => moveCategoryRows(tx, 'shop', 'interest', null, false, 9))
    expect(undo?.ids.sort()).toEqual(['t1', 't2', 't3'])
    expect(categoryOf('kid')).toBe('child')
    const ops = listOps(db, 'pending', 10)
    expect(ops).toHaveLength(3)
    expect(ops.find((op) => op.rowId === 't2')?.row).toMatchObject({
      categoryId: 'interest',
      note: 'edited offline',
    })
  })

  it('moves nothing into itself or into a category that is gone', () => {
    expect(moveCategoryRows(db, 'shop', 'shop', null, false, 9)).toBeNull()
    expect(moveCategoryRows(db, 'shop', 'nowhere', null, false, 9)).toBeNull()
    expect(moveCategoryRows(db, 'interest', 'shop', null, false, 9)).toBeNull()
  })

  it('undo leaves a row changed since, and does nothing once the source is gone', () => {
    const undo = moveCategoryRows(db, 'shop', 'interest', 'bank', true, 9)
    expect(undo?.hidden).toEqual({ walletId: 'bank', before: [] })
    db.exec("UPDATE transactions SET category_id = 'gift' WHERE id = 't2'")
    expect(undo && undoCategoryMove(db, undo, 10)).toBe(1)
    expect([categoryOf('t2'), categoryOf('t3')]).toEqual(['gift', 'shop'])
    expect(db.selectValue("SELECT hidden_category_ids FROM wallets WHERE id = 'bank'")).toBe('[]')

    const again = moveCategoryRows(db, 'shop', 'interest', null, false, 11)
    db.exec("UPDATE categories SET deleted_at = 12 WHERE id = 'shop'")
    expect(again && undoCategoryMove(db, again, 13)).toBe(0)
  })
})
