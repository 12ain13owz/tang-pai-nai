import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateTransaction } from './transaction.schema'

const valid = {
  id: '0199a000-0000-7000-8000-000000000301',
  profileId: '0199a000-0000-7000-8000-000000000001',
  walletId: '0199a000-0000-7000-8000-000000000101',
  categoryId: '0199a000-0000-7000-8000-000000000201',
  amount: 6500,
  occurredOn: '2026-11-02',
  note: '  ลาเต้เย็น ',
  excludeFromReport: false,
  createdAt: 1000,
  updatedAt: 1000,
}

const messageOf = (input: object) => {
  const result = validateTransaction({ ...valid, ...input })
  return result.ok ? null : result.message
}

afterEach(() => {
  vi.useRealTimers()
})

describe('validateTransaction', () => {
  it('accepts a transaction, trims the note and defaults deletedAt to null', () => {
    expect(validateTransaction(valid)).toEqual({
      ok: true,
      row: { ...valid, note: 'ลาเต้เย็น', recurringId: null, debtId: null, deletedAt: null },
    })
  })

  it('defaults a missing note and excludeFromReport and ignores server columns', () => {
    const { note: _note, excludeFromReport: _exclude, ...bare } = valid
    const result = validateTransaction({ ...bare, changeSeq: 9, updatedBy: 'x', userId: 'y' })
    expect(result.ok && result.row['note']).toBe('')
    expect(result.ok && result.row['excludeFromReport']).toBe(false)
    expect(result.ok && Object.keys(result.row)).not.toContain('userId')
  })

  it('takes an amount from 1 to 10¹⁵ minor units, integers only', () => {
    expect(messageOf({ amount: 1 })).toBeNull()
    expect(messageOf({ amount: 1_000_000_000_000_000 })).toBeNull()
    expect(messageOf({ amount: 0 })).toMatch(/amount/)
    expect(messageOf({ amount: -5 })).toMatch(/amount/)
    expect(messageOf({ amount: 1_000_000_000_000_001 })).toMatch(/amount/)
    expect(messageOf({ amount: 1.5 })).toMatch(/Amount must be of type integer/)
    expect(messageOf({ amount: '65' })).toMatch(/Amount/)
  })

  it('takes a real date from 2000-01-01 to a year and a day after today', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] })
    expect(messageOf({ occurredOn: '2000-01-01' })).toBeNull()
    expect(messageOf({ occurredOn: '2027-11-04' })).toBeNull()
    for (const occurredOn of ['1999-12-31', '2027-11-05', '2026-02-30', '26-11-02', '2026-1-2']) {
      expect(messageOf({ occurredOn })).toBe('Invalid occurredOn format')
    }
  })

  it('refuses a note over 500 characters after trimming', () => {
    expect(messageOf({ note: ` ${'x'.repeat(500)} ` })).toBeNull()
    expect(messageOf({ note: 'x'.repeat(501) })).toMatch(/500/)
  })

  it('needs UUIDs for the row and the rows it points at', () => {
    for (const field of ['id', 'profileId', 'walletId', 'categoryId', 'debtId']) {
      expect(messageOf({ [field]: 'nope' })).toBe(`Invalid ${field} format`)
    }
  })
})
