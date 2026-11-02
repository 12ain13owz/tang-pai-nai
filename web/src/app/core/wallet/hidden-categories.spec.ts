import { putRow } from '@/core/offline'
import type { LocalDatabase } from '@/core/offline'
import { openTestDatabase } from '@/core/offline/testing-db'
import { cleanHidden, findWallet, isHiddenIn } from './hidden-categories'

describe('hidden categories (category rule 13)', () => {
  let db: LocalDatabase
  const category = (id: string, extra: object = {}) =>
    putRow(db, 'categories', {
      id,
      profileId: 'p1',
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
      updatedBy: 'u1',
      ...extra,
    })
  beforeEach(async () => {
    db = await openTestDatabase()
  })
  afterEach(() => db.close())

  it('hides a category listed itself or through its parent', () => {
    expect(isHiddenIn(['a'], { id: 'a', parentId: null })).toBe(true)
    expect(isHiddenIn(['a'], { id: 'a1', parentId: 'a' })).toBe(true)
    expect(isHiddenIn(['a1'], { id: 'a', parentId: null })).toBe(false)
    expect(isHiddenIn([], { id: 'b', parentId: 'a' })).toBe(false)
  })

  it('drops duplicates and known tombstones, keeps archived and unknown ids', () => {
    category('live')
    category('archived', { isArchived: true })
    category('gone', { deletedAt: 5 })
    expect(cleanHidden(db, ['live', 'gone', 'archived', 'unknown', 'live'])).toEqual([
      'live',
      'archived',
      'unknown',
    ])
    expect(cleanHidden(db, [])).toEqual([])
  })

  it('keeps at most 200, dropping archived ones first', () => {
    category('archived', { isArchived: true })
    const ids = ['archived', ...Array.from({ length: 205 }, (_, i) => `c${i}`)]
    const kept = cleanHidden(db, ids)
    expect(kept).toHaveLength(200)
    expect(kept).not.toContain('archived')
    expect(kept[0]).toBe('c0')
  })

  it('reads a wallet with its list, [] when the column holds no array', () => {
    putRow(db, 'wallets', {
      id: 'w1',
      profileId: 'p1',
      name: 'Cash',
      currencyCode: 'THB',
      initialBalance: 0,
      icon: 'lucideWallet',
      color: '#16a34a',
      excludeFromTotal: false,
      isArchived: false,
      sortOrder: 0,
      hiddenCategoryIds: ['a', 'b'],
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
      changeSeq: 1,
      updatedBy: 'u1',
    })
    expect(findWallet(db, 'w1')?.hiddenCategoryIds).toEqual(['a', 'b'])
    db.exec(`UPDATE wallets SET hidden_category_ids = '{"x":1}'`)
    expect(findWallet(db, 'w1')?.hiddenCategoryIds).toEqual([])
    expect(findWallet(db, 'nope')).toBeNull()
  })
})
