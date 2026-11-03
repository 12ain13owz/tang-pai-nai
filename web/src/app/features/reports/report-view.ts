import { computed, inject } from '@angular/core'
import { TranslocoService } from '@jsverse/transloco'
import { LanguageService } from '@/core/i18n'
import { ReportService } from '@/core/report'
import type { ReportUnit } from '@/core/report'
import { periodLabel } from '@/core/transaction'
import { formatAmount, fromDay } from '@/shared/utils'

/** `dd/mm/yyyy`, as the period chips write dates (ค.ศ.). */
const dmy = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`

/**
 * A period by name, not by distance (`ต.ค. 2026`, `Q3 2026`, `2026`, `01/10/2026 – 15/10/2026`),
 * for the summary's heading and a category's share line.
 */
export const periodName = (
  unit: ReportUnit,
  range: { from: string; to: string },
  locale: string
): string => {
  const date = fromDay(range.from)
  switch (unit) {
    case 'month':
      return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(date)
    case 'quarter':
      return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
    case 'year':
      return String(date.getFullYear())
    default:
      return `${dmy(range.from)} – ${dmy(range.to)}`
  }
}

/** A share of a whole as a rounded percentage (display only; the amounts stay exact). */
export const sharePercent = (part: number, whole: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
    whole > 0 ? part / whole : 0
  )

/**
 * The period strip, swipe and money formatting every report page shares (call in an injection
 * context).
 */
export const reportView = () => {
  const reportService = inject(ReportService)
  const languageService = inject(LanguageService)
  const transloco = inject(TranslocoService)

  const chips = computed(() => {
    languageService.language()
    const unit = reportService.unit()
    const today = reportService.today()
    const custom = reportService.custom()
    return reportService.tabs().map((tab) => {
      const result = periodLabel(unit, tab, today, custom)
      return { id: tab, label: 'key' in result ? transloco.translate(result.key) : result.text }
    })
  })

  return {
    chips,
    /** The chosen period by name. */
    period: computed(() =>
      periodName(reportService.unit(), reportService.range(), languageService.locale())
    ),
    choose: (id: number | string) => reportService.tab.set(Number(id)),
    /** A sideways swipe moves to the next or previous period. */
    move: (step: 1 | -1) => {
      const tabs = reportService.tabs()
      const index = tabs.indexOf(reportService.tab())
      const next = index < 0 ? undefined : tabs[index + step]
      if (next !== undefined) {
        reportService.tab.set(next)
      }
    },
    /** Signed figures without the symbol (one currency in view, as the Transactions tab). */
    amount: (minor: number, signed = true) =>
      formatAmount(minor, reportService.minorUnit(), languageService.locale(), signed),
  }
}
