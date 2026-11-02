import { addDays, addMonths, fromDay, isDay, toDay } from './day'

describe('day helpers', () => {
  it('turns a local date into YYYY-MM-DD and back', () => {
    expect(toDay(new Date(2026, 10, 2, 23, 59))).toBe('2026-11-02')
    expect(toDay(fromDay('2024-02-29'))).toBe('2024-02-29')
  })

  it('moves by days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it("moves by months, clamped to the target month's last day", () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29')
    expect(addMonths('2026-11-15', -12)).toBe('2025-11-15')
  })

  it('knows a real date', () => {
    expect(isDay('2026-11-02')).toBe(true)
    expect(isDay('2026-02-30')).toBe(false)
    expect(isDay('26-11-02')).toBe(false)
  })
})
