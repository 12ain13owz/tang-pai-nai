// Calendar days of transactions (ROADMAP → Money & data): `YYYY-MM-DD` in the device's local
// time, Gregorian. The era (พ.ศ.) is display only.

const pad = (value: number, size = 2) => String(value).padStart(size, '0')

/** The device's local date as `YYYY-MM-DD`. */
export const toDay = (date: Date = new Date()): string =>
  `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** `YYYY-MM-DD` as a local Date at noon (safe from DST edges). */
export const fromDay = (day: string): Date => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 12)
}

/** `day` moved by `days` (may be negative). */
export const addDays = (day: string, days: number): string => {
  const date = fromDay(day)
  date.setDate(date.getDate() + days)
  return toDay(date)
}

/** `day` moved by `months`, clamped to the target month's last day (31 Jan + 1 → 28/29 Feb). */
export const addMonths = (day: string, months: number): string => {
  const date = fromDay(day)
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1, 12)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate()
  target.setDate(Math.min(date.getDate(), last))
  return toDay(target)
}

/** Whether `value` is a real `YYYY-MM-DD` date. */
export const isDay = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && toDay(fromDay(value)) === value
