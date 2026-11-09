import type { EventItem, EventMoney, TripEvent } from '@/core/event'
import { shortDate } from '@/core/recurring'
import { fromDay, formatMoney } from '@/shared/utils'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** "7–12 พ.ย. 2026", or "ตั้งแต่ 1 ต.ค. 2026" without an end. */
export const eventDates = (event: TripEvent, t: Translate, locale: string): string =>
  event.endOn
    ? new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).formatRange(fromDay(event.startOn), fromDay(event.endOn))
    : t('events.since', { date: shortDate(event.startOn, locale) })

/** The expense of each currency, "0.00" in THB when nothing is tagged yet. */
export const expenseLines = (money: readonly EventMoney[], locale: string): string[] =>
  money.length === 0
    ? [formatMoney(0, 'THB', 2, locale)]
    : money.map((line) => formatMoney(line.expense, line.currencyCode, line.minorUnit, locale))

/** `events.<key>` with `count`, or its `<key>One` form for one ("1 transaction"). */
export const counted = (t: Translate, key: string, count: number): string =>
  t(`events.${key}${count === 1 ? 'One' : ''}`, { count })

/** A row of the events list (mock-up frame 1). */
export const eventRow = (item: EventItem, t: Translate, locale: string) => ({
  item,
  dates: eventDates(item.event, t, locale),
  expense: expenseLines(item.money, locale).join(' · '),
  count: counted(t, 'rows', item.count),
})
