import { afterEach, describe, expect, it, vi } from 'vitest'
import { TRANSFER_MESSAGE } from './transfer.const'
import { validateTransfer } from './transfer.schema'

const valid = {
  id: '0199a000-0000-7000-8000-000000000401',
  profileId: '0199a000-0000-7000-8000-000000000001',
  fromWalletId: '0199a000-0000-7000-8000-000000000101',
  toWalletId: '0199a000-0000-7000-8000-000000000102',
  amount: 100000,
  occurredOn: '2026-11-02',
  note: '  กดตู้ ',
  createdAt: 1000,
  updatedAt: 1000,
}

const messageOf = (input: object) => {
  const result = validateTransfer({ ...valid, ...input })
  return result.ok ? null : result.message
}

afterEach(() => {
  vi.useRealTimers()
})

describe('validateTransfer', () => {
  it('accepts a transfer, trims the note and defaults deletedAt to null', () => {
    expect(validateTransfer(valid)).toEqual({
      ok: true,
      row: { ...valid, note: 'กดตู้', deletedAt: null },
    })
  })

  it('defaults a missing note and ignores server columns', () => {
    const { note: _note, ...bare } = valid
    const result = validateTransfer({ ...bare, changeSeq: 9, updatedBy: 'x', userId: 'y' })
    expect(result.ok && result.row['note']).toBe('')
    expect(result.ok && Object.keys(result.row)).not.toContain('userId')
  })

  it('refuses the same wallet on both sides (rule 1)', () => {
    expect(messageOf({ toWalletId: valid.fromWalletId })).toBe(TRANSFER_MESSAGE.SAME_WALLET)
  })

  it('takes an amount from 1 to 10¹⁵ minor units, integers only (rule 3)', () => {
    expect(messageOf({ amount: 1 })).toBeNull()
    expect(messageOf({ amount: 1_000_000_000_000_000 })).toBeNull()
    for (const amount of [0, -5, 1_000_000_000_000_001]) {
      expect(messageOf({ amount })).toMatch(/amount/)
    }
    expect(messageOf({ amount: 1.5 })).toMatch(/Amount must be of type integer/)
  })

  it('takes a real date up to a year and a day after today, and a note of 500 (rule 4)', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] })
    expect(messageOf({ occurredOn: '2027-11-04' })).toBeNull()
    for (const occurredOn of ['1999-12-31', '2027-11-05', '2026-02-30']) {
      expect(messageOf({ occurredOn })).toBe('Invalid occurredOn format')
    }
    expect(messageOf({ note: ` ${'x'.repeat(500)} ` })).toBeNull()
    expect(messageOf({ note: 'x'.repeat(501) })).toMatch(/500/)
  })

  it('needs UUIDs for the row and the rows it points at', () => {
    for (const field of ['id', 'profileId', 'fromWalletId', 'toWalletId']) {
      expect(messageOf({ [field]: 'nope' })).toBe(`Invalid ${field} format`)
    }
  })
})
