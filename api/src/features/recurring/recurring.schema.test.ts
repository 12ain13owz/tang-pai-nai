import { describe, expect, it } from 'vitest'
import { RECURRING_MESSAGE } from './recurring.const'
import { validateRecurringRule } from './recurring.schema'

const valid = {
  id: '0199a000-0000-7000-8000-000000000501',
  profileId: '0199a000-0000-7000-8000-000000000001',
  kind: 'transaction',
  walletId: '0199a000-0000-7000-8000-000000000101',
  categoryId: '0199a000-0000-7000-8000-000000000201',
  amount: 850000,
  note: '  ค่าเช่า ',
  startOn: '2026-10-01',
  frequency: 'month',
  interval: 1,
  nextOn: '2026-12-01',
  createdAt: 1000,
  updatedAt: 1000,
}
const transfer = {
  ...valid,
  kind: 'transfer',
  categoryId: null,
  toWalletId: '0199a000-0000-7000-8000-000000000102',
}

const messageOf = (input: object) => {
  const result = validateRecurringRule({ ...valid, ...input })
  return result.ok ? null : result.message
}

describe('validateRecurringRule', () => {
  it('accepts a rule, trims the note and fills the defaults', () => {
    expect(validateRecurringRule(valid)).toEqual({
      ok: true,
      row: {
        ...valid,
        note: 'ค่าเช่า',
        toWalletId: null,
        debtId: null,
        excludeFromReport: false,
        endOn: null,
        endCount: null,
        confirm: false,
        isPaused: false,
        deletedAt: null,
      },
    })
  })

  it('accepts a transfer rule and always leaves it in reports (it never is)', () => {
    const result = validateRecurringRule({ ...transfer, excludeFromReport: true })
    expect(result.ok && result.row['excludeFromReport']).toBe(false)
  })

  it('needs the fields of its kind: a category, or a different wallet to transfer to', () => {
    expect(messageOf({ categoryId: null })).toBe(RECURRING_MESSAGE.KIND_FIELDS)
    expect(messageOf({ toWalletId: transfer.toWalletId })).toBe(RECURRING_MESSAGE.KIND_FIELDS)
    expect(messageOf({ ...transfer, toWalletId: null })).toBe(RECURRING_MESSAGE.KIND_FIELDS)
    expect(messageOf({ ...transfer, toWalletId: valid.walletId })).toBe(
      RECURRING_MESSAGE.SAME_WALLET
    )
  })

  it('checks the schedule: unit, interval 1–99, an end by date or count, never both', () => {
    expect(messageOf({ frequency: 'hour' })).not.toBeNull()
    expect(messageOf({ interval: 0 })).not.toBeNull()
    expect(messageOf({ interval: 100 })).not.toBeNull()
    expect(messageOf({ endCount: 0 })).not.toBeNull()
    expect(messageOf({ endCount: 1000 })).not.toBeNull()
    expect(messageOf({ endCount: 12 })).toBeNull()
    expect(messageOf({ endOn: '2027-02-30' })).not.toBeNull()
    expect(messageOf({ endOn: '2027-12-31', endCount: 3 })).toBe(RECURRING_MESSAGE.END_BOTH)
    expect(messageOf({ endOn: '2026-09-30' })).toBe(RECURRING_MESSAGE.END_BEFORE_START)
  })

  it('takes a null next date (ended), never one before the start', () => {
    expect(messageOf({ nextOn: null })).toBeNull()
    expect(messageOf({ nextOn: '2026-09-01' })).toBe(RECURRING_MESSAGE.NEXT_BEFORE_START)
    expect(messageOf({ nextOn: undefined })).not.toBeNull()
  })

  it('refuses an amount out of range and a start outside the entry days', () => {
    expect(messageOf({ amount: 0 })).not.toBeNull()
    expect(messageOf({ amount: 1.5 })).not.toBeNull()
    expect(messageOf({ startOn: '1999-12-31' })).not.toBeNull()
  })
})
