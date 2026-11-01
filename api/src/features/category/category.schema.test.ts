import { describe, expect, it } from 'vitest'
import { validateCategory } from './category.schema'

const valid = {
  id: '0199a000-0000-7000-8000-000000000201',
  profileId: '0199a000-0000-7000-8000-000000000001',
  type: 'expense',
  parentId: '0199a000-0000-7000-8000-000000000200',
  name: '  กาแฟ ',
  icon: 'lucideCoffee',
  color: '#a16207',
  isArchived: false,
  sortOrder: 0,
  createdAt: 1000,
  updatedAt: 1000,
}

describe('validateCategory', () => {
  it('accepts a category, trims the name and defaults deletedAt to null', () => {
    expect(validateCategory(valid)).toEqual({
      ok: true,
      row: { ...valid, name: 'กาแฟ', deletedAt: null },
    })
  })

  it('treats a missing parent as a top-level category and ignores server columns', () => {
    const { parentId: _parentId, ...top } = valid
    const result = validateCategory({ ...top, changeSeq: 9, updatedBy: 'x', userId: 'y' })
    expect(result.ok && result.row['parentId']).toBeNull()
    expect(result.ok && Object.keys(result.row).sort()).toEqual([
      'color',
      'createdAt',
      'deletedAt',
      'icon',
      'id',
      'isArchived',
      'name',
      'parentId',
      'profileId',
      'sortOrder',
      'type',
      'updatedAt',
    ])
  })

  it('accepts the limits: a 40-character name, income, a tpn icon, a tombstone', () => {
    for (const change of [
      { name: 'x'.repeat(40) },
      { type: 'income' },
      { icon: 'tpnBubbleTea' },
      { parentId: null },
      { deletedAt: 2000 },
    ]) {
      expect(validateCategory({ ...valid, ...change }).ok).toBe(true)
    }
  })

  it.each([
    ['an empty name', { name: '   ' }, 'Name is required'],
    ['a name over 40 characters', { name: 'x'.repeat(41) }, 'Name must be at most 40'],
    ['an unknown type', { type: 'debt' }, 'Invalid type format'],
    ['a parent id that is not a UUID', { parentId: 'abc' }, 'Invalid parentId format'],
    ['itself as its parent', { parentId: valid.id }, 'Invalid parentId format'],
    ['a profile id that is not a UUID', { profileId: 'abc' }, 'Invalid profileId format'],
    ['an icon of another library', { icon: 'faCoffee' }, 'Invalid icon format'],
    ['an icon name over 40 characters', { icon: `tpn${'A'.repeat(38)}` }, 'Invalid icon format'],
    ['an uppercase colour', { color: '#A16207' }, 'Invalid color format'],
    ['a missing archive flag', { isArchived: undefined }, 'Is archived must be of type boolean'],
    ['a negative sort order', { sortOrder: -1 }, 'Invalid sortOrder format'],
  ])('refuses %s', (_name, change, message) => {
    const result = validateCategory({ ...valid, ...change })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain(message)
  })
})
