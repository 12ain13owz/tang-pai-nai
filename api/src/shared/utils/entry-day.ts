// The date of a money entry (a transaction, a transfer): transaction rule 4, transfer rule 4.

export const ENTRY_DAY = {
  /** The earliest day. */
  FIRST: '2000-01-01',
  /** Days after the server's today a date may be: one year plus a day for time zones. */
  FUTURE_DAYS: 367,
  PATTERN: /^\d{4}-\d{2}-\d{2}$/,
} as const

const DAY_MS = 86_400_000

/** A real calendar date (`2026-02-30` is not). */
const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** `YYYY-MM-DD`, a real date, from 2000-01-01 to a year (and a day) after the server's today. */
export const isEntryDay = (value: string): boolean =>
  ENTRY_DAY.PATTERN.test(value) &&
  isRealDate(value) &&
  value >= ENTRY_DAY.FIRST &&
  value <= new Date(Date.now() + ENTRY_DAY.FUTURE_DAYS * DAY_MS).toISOString().slice(0, 10)

/** `YYYY-MM-DD` and a real date, with no range (a recurring rule's end or next date). */
export const isCalendarDay = (value: string): boolean =>
  ENTRY_DAY.PATTERN.test(value) && isRealDate(value) && value >= ENTRY_DAY.FIRST
