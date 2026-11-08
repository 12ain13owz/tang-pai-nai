import {
  indexOnOrAfter,
  isPastEnd,
  lastOccurrence,
  nextOnOrAfter,
  occurrenceOn,
  occurrencesBetween,
} from './schedule'
import type { RecurringSchedule } from './recurring.type'

const rule = (extra: Partial<RecurringSchedule> = {}): RecurringSchedule => ({
  startOn: '2026-01-31',
  frequency: 'month',
  interval: 1,
  endOn: null,
  endCount: null,
  ...extra,
})

describe('schedule (recurring rule 3)', () => {
  it('counts every month from the start, so the 31st comes back after a short month', () => {
    expect([0, 1, 2, 3, 4].map((k) => occurrenceOn(rule(), k))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ])
    expect(occurrenceOn(rule({ startOn: '2028-01-31' }), 1)).toBe('2028-02-29')
  })

  it('steps days, weeks (the start weekday), every n months and years (29 Feb → 28 Feb)', () => {
    expect(occurrenceOn(rule({ startOn: '2026-11-08', frequency: 'day', interval: 3 }), 2)).toBe(
      '2026-11-14'
    )
    expect(occurrenceOn(rule({ startOn: '2026-11-08', frequency: 'week', interval: 2 }), 1)).toBe(
      '2026-11-22'
    )
    expect(occurrenceOn(rule({ startOn: '2026-11-25', interval: 3 }), 2)).toBe('2027-05-25')
    expect(occurrenceOn(rule({ startOn: '2028-02-29', frequency: 'year' }), 1)).toBe('2029-02-28')
    expect(occurrenceOn(rule({ startOn: '2028-02-29', frequency: 'year' }), 4)).toBe('2032-02-29')
  })

  it('finds the first occurrence on or after a day', () => {
    expect(indexOnOrAfter(rule(), '2025-12-01')).toBe(0)
    expect(indexOnOrAfter(rule(), '2026-02-28')).toBe(1)
    expect(indexOnOrAfter(rule(), '2026-03-01')).toBe(2)
    const weekly = rule({ startOn: '2026-11-08', frequency: 'week' })
    expect(indexOnOrAfter(weekly, '2026-11-09')).toBe(1)
    expect(indexOnOrAfter(weekly, '2026-11-15')).toBe(1)
    expect(nextOnOrAfter(rule({ startOn: '2026-08-31' }), '2026-11-01')).toBe('2026-11-30')
  })

  it('ends after a count (skipped ones count too) or a date', () => {
    const counted = rule({ endCount: 3 })
    expect(isPastEnd(counted, 2)).toBe(false)
    expect(isPastEnd(counted, 3)).toBe(true)
    expect(lastOccurrence(counted)).toBe('2026-03-31')
    expect(nextOnOrAfter(counted, '2026-04-01')).toBeNull()
    const dated = rule({ endOn: '2026-04-29' })
    expect(isPastEnd(dated, 2)).toBe(false)
    expect(isPastEnd(dated, 3)).toBe(true)
    expect(lastOccurrence(dated)).toBe('2026-03-31')
    expect(lastOccurrence(rule())).toBeNull()
  })

  it('lists the occurrences between two days, at most `max`', () => {
    expect(occurrencesBetween(rule(), '2026-02-01', '2026-04-30')).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
    expect(occurrencesBetween(rule({ endCount: 2 }), '2026-01-01', '2026-12-31')).toHaveLength(2)
    expect(
      occurrencesBetween(rule({ frequency: 'day' }), '2026-01-31', '2027-12-31', 10)
    ).toHaveLength(10)
  })
})
