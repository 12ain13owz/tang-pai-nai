import { describe, expect, it } from 'vitest'
import { validateProfile } from './profile.schema'

const valid = {
  id: '0199a000-0000-7000-8000-000000000001',
  name: '  ส่วนตัว ',
  icon: 'lucideHouse',
  color: '#16a34a',
  sortOrder: 0,
  createdAt: 1000,
  updatedAt: 1000,
}

describe('validateProfile', () => {
  it('accepts a profile, trims the name and defaults deletedAt to null', () => {
    expect(validateProfile(valid)).toEqual({
      ok: true,
      row: { ...valid, name: 'ส่วนตัว', deletedAt: null },
    })
  })

  it('ignores server columns a device sends', () => {
    const result = validateProfile({ ...valid, changeSeq: 99, updatedBy: 'x', userId: 'y' })
    expect(result.ok && Object.keys(result.row).sort()).toEqual([
      'color',
      'createdAt',
      'deletedAt',
      'icon',
      'id',
      'name',
      'sortOrder',
      'updatedAt',
    ])
  })

  it('accepts a name of exactly 30 characters and a tombstone', () => {
    const result = validateProfile({ ...valid, name: 'x'.repeat(30), deletedAt: 2000 })
    expect(result.ok && result.row).toMatchObject({ name: 'x'.repeat(30), deletedAt: 2000 })
  })

  it.each([
    ['an empty name', { name: '   ' }, 'Name is required'],
    ['a name over 30 characters', { name: 'x'.repeat(31) }, 'Name must be at most 30'],
    ['an icon that is not a lucide name', { icon: 'house' }, 'Invalid icon format'],
    ['an icon name over 40 characters', { icon: `lucide${'A'.repeat(35)}` }, 'Invalid icon'],
    ['an uppercase colour', { color: '#16A34A' }, 'Invalid color format'],
    ['a short colour', { color: '#fff' }, 'Invalid color format'],
    ['a negative sort order', { sortOrder: -1 }, 'Invalid sortOrder format'],
    ['a fractional sort order', { sortOrder: 1.5 }, 'Sort order must be of type integer'],
    ['an id that is not a UUID', { id: 'abc' }, 'Invalid id format'],
  ])('refuses %s', (_name, change, message) => {
    const result = validateProfile({ ...valid, ...change })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain(message)
  })
})
