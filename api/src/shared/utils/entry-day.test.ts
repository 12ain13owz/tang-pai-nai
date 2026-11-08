import { afterEach, describe, expect, it, vi } from 'vitest'
import { isCalendarDay, isEntryDay } from './entry-day'

afterEach(() => {
  vi.useRealTimers()
})

describe('isEntryDay', () => {
  it('takes a real date from 2000-01-01 to a year and a day after the server’s today', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T12:00:00Z'), toFake: ['Date'] })
    for (const day of ['2000-01-01', '2024-02-29', '2027-11-04']) {
      expect(isEntryDay(day)).toBe(true)
    }
    for (const day of ['1999-12-31', '2027-11-05', '2026-02-30', '26-11-02', '2026-1-2', '']) {
      expect(isEntryDay(day)).toBe(false)
    }
  })
})

describe('isCalendarDay', () => {
  it('takes a real date from 2000 on with no upper bound (a rule’s end or next date)', () => {
    expect(isCalendarDay('2099-12-31')).toBe(true)
    expect(isCalendarDay('2027-02-30')).toBe(false)
    expect(isCalendarDay('1999-12-31')).toBe(false)
    expect(isCalendarDay('2027-1-1')).toBe(false)
  })
})
