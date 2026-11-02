import { afterEach, describe, expect, it, vi } from 'vitest'
import { isEntryDay } from './entry-day'

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
