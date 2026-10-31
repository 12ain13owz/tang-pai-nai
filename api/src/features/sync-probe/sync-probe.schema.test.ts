import { describe, expect, it } from 'vitest'
import { validateSyncProbe } from './sync-probe.schema'

const valid = {
  id: '0199a000-0000-7000-8000-000000000001',
  title: '  Coffee ',
  amount: 6550,
  createdAt: 1000,
  updatedAt: 1000,
}

describe('validateSyncProbe', () => {
  it('accepts a probe, trims the title and defaults deletedAt to null', () => {
    expect(validateSyncProbe(valid)).toEqual({
      ok: true,
      row: { ...valid, title: 'Coffee', deletedAt: null },
    })
  })

  it('ignores server columns a device sends', () => {
    const result = validateSyncProbe({ ...valid, changeSeq: 99, updatedBy: 'x', userId: 'y' })
    expect(result.ok && Object.keys(result.row).sort()).toEqual([
      'amount',
      'createdAt',
      'deletedAt',
      'id',
      'title',
      'updatedAt',
    ])
  })

  it.each([
    ['an empty title', { title: '  ' }, 'Title is required'],
    ['a title over 50 characters', { title: 'x'.repeat(51) }, 'Title must be at most 50'],
    ['a fractional amount', { amount: 1.5 }, 'Amount must be of type integer'],
    ['a negative amount', { amount: -1 }, 'Invalid amount format'],
    ['an id that is not a UUID', { id: 'abc' }, 'Invalid id format'],
  ])('refuses %s', (_name, change, message) => {
    const result = validateSyncProbe({ ...valid, ...change })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain(message)
  })
})
