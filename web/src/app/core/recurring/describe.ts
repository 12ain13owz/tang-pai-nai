import { fromDay } from '@/shared/utils'
import { lastOccurrence, occurrencesBetween } from './schedule'
import type { RecurringSchedule, RepeatValues, RuleItem } from './recurring.type'

/** A translate function (`TranslocoService.translate`). */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/** A day as the app writes it in a line: `25 พ.ย. 2026` / `25 Nov 2026`. */
export const shortDate = (day: string, locale: string, withYear = true): string =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(fromDay(day))

/** "ทุกเดือน วันที่ 25", "ทุก 2 สัปดาห์ วันศุกร์", "ทุกปี 25 พ.ย." (rule 3, from `startOn`). */
export const describeRepeat = (
  repeat: Pick<RepeatValues, 'frequency' | 'interval'>,
  startOn: string,
  t: Translate,
  locale: string
): string => {
  const date = fromDay(startOn)
  const params = {
    n: repeat.interval,
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date),
    day: date.getDate(),
    date: shortDate(startOn, locale, false),
  }
  return t(`recurring.${repeat.interval === 1 ? 'every' : 'everyN'}.${repeat.frequency}`, params)
}

/** "ไม่สิ้นสุด", "ถึง 31 ธ.ค. 2027", "12 ครั้ง". */
export const describeEnd = (
  repeat: Pick<RepeatValues, 'endOn' | 'endCount'>,
  t: Translate,
  locale: string
): string => {
  if (repeat.endCount !== null) {
    return t('recurring.endCountText', { n: repeat.endCount })
  }
  return repeat.endOn !== null
    ? t('recurring.endOnText', { date: shortDate(repeat.endOn, locale) })
    : t('recurring.endNever')
}

/** "ไม่สิ้นสุด · บันทึกให้อัตโนมัติ": the end and how a due one is recorded. */
export const describeRest = (repeat: RepeatValues, t: Translate, locale: string): string =>
  `${describeEnd(repeat, t, locale)} · ${t(repeat.confirm ? 'recurring.ask' : 'recurring.auto')}`

/**
 * Rule 3's line for the 29th–31st of a month: the next few months that don't have that day use
 * their last day. Null when the start day is in every month.
 */
export const shortMonthLine = (
  repeat: Pick<RepeatValues, 'frequency' | 'interval'>,
  startOn: string,
  t: Translate,
  locale: string
): string | null => {
  const day = Number(startOn.slice(8, 10))
  if (repeat.frequency !== 'month' || day < 29) {
    return null
  }
  const schedule: RecurringSchedule = { ...repeat, startOn, endOn: null, endCount: null }
  const dates = occurrencesBetween(schedule, startOn, '9999-12-31', 5)
    .slice(1)
    .map((value) => shortDate(value, locale))
  return t('recurring.shortMonth', { day, dates: dates.join(' · ') })
}

/** "ครั้งสุดท้าย 30 ก.ย. 2027", for an end by count. */
export const lastLine = (
  schedule: RecurringSchedule,
  t: Translate,
  locale: string
): string | null => {
  if (schedule.endCount === null) {
    return null
  }
  const last = lastOccurrence(schedule)
  return last ? t('recurring.lastOne', { date: shortDate(last, locale) }) : null
}

/**
 * A rule's title in a list: its category, "โอนเงิน" (or "กสิกร → ออมทรัพย์" with `full`), or a
 * debt's repayment ("คืนเงิน · แม่", debt rule 13).
 */
export const ruleTitle = (item: RuleItem, t: Translate, full = false): string => {
  switch (item.rule.kind) {
    case 'transfer':
      return full
        ? t('recurring.transferTitle', { from: item.walletName, to: item.toWalletName })
        : t('transfers.title')
    case 'debt':
      return `${t(`debts.entry.${item.debtDirection ?? 'borrowed'}.repayment`)} · ${item.title}`
    default:
      return item.title
  }
}
