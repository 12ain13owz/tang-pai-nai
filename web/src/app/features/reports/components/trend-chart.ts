import { Component, computed, inject, input, output } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { LanguageService } from '@/core/i18n'
import type { ReportUnit, TrendPoint } from '@/core/report'
import type { PeriodTab } from '@/core/transaction'
import { formatAmount, fromDay } from '@/shared/utils'

/** The next round number at or above `value` (1, 2, 2.5, 5 × 10ⁿ), so the scale reads easily. */
const niceCeil = (value: number): number => {
  if (value <= 0) {
    return 1
  }
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value) ?? 10
  return step * power
}

/**
 * Income and expense per period, ending at the chosen one (report.md rule 7, Q2): a pair of
 * bars per period in the money colours, the chosen period at full strength and outlined, the
 * others faded. Each pair is a button that chooses its period. Drawn with plain elements, no
 * chart library (Q1).
 */
@Component({
  selector: 'app-report-trend',
  imports: [TranslocoPipe],
  template: `
    <section
      class="rounded-xl border border-border bg-card px-4 pt-3 pb-3 text-card-foreground"
      aria-labelledby="report-trend-title"
    >
      <div class="flex items-center justify-between gap-2">
        <h2 id="report-trend-title" class="text-sm font-medium text-muted-foreground">
          {{ 'reports.trend.' + unit() | transloco }}
        </h2>
        <span class="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <span class="flex items-center gap-1">
            <span class="size-2.5 rounded-sm bg-income"></span>
            {{ 'categories.income' | transloco }}
          </span>
          <span class="flex items-center gap-1">
            <span class="size-2.5 rounded-sm bg-expense"></span>
            {{ 'categories.expense' | transloco }}
          </span>
        </span>
      </div>
      <div class="relative mt-2 h-40 pl-9">
        @for (line of scale(); track line.top) {
          <div class="absolute inset-x-0 flex items-center gap-1" [style.top.%]="line.top">
            <span class="w-8 -translate-y-1/2 text-right text-[11px] text-muted-foreground">
              {{ line.label }}
            </span>
            <span class="h-px flex-1 -translate-y-1/2 bg-border"></span>
          </div>
        }
        <div class="relative flex h-full gap-1">
          @for (bar of bars(); track bar.tab) {
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 flex-col items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              [class.ring-1]="bar.selected"
              [class.ring-brand]="bar.selected"
              [attr.aria-pressed]="bar.selected"
              [attr.aria-label]="bar.label"
              (click)="pick.emit(bar.tab)"
            >
              <span class="flex w-full flex-1 items-end justify-center gap-0.5 pt-1">
                <span
                  class="w-[30%] max-w-3.5 rounded-t-[4px] bg-income"
                  [class.opacity-40]="!bar.selected"
                  [style.height.%]="bar.income"
                ></span>
                <span
                  class="w-[30%] max-w-3.5 rounded-t-[4px] bg-expense"
                  [class.opacity-40]="!bar.selected"
                  [style.height.%]="bar.expense"
                ></span>
              </span>
              <span
                class="h-6 pt-1 text-[11px] leading-5 whitespace-nowrap text-muted-foreground"
                [class.font-semibold]="bar.selected"
                [class.text-foreground]="bar.selected"
                aria-hidden="true"
              >
                {{ bar.name }}
              </span>
            </button>
          }
        </div>
      </div>
      <p class="mt-1 text-center text-xs text-muted-foreground">
        {{ 'reports.trendHint' | transloco }}
      </p>
    </section>
  `,
})
export class ReportTrend {
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)

  points = input.required<readonly TrendPoint[]>()
  selected = input.required<PeriodTab>()
  unit = input.required<Exclude<ReportUnit, 'custom'>>()
  minorUnit = input.required<number>()
  pick = output<number>()

  private largest = computed(() =>
    Math.max(0, ...this.points().flatMap((point) => [point.income, point.expense]))
  )
  private max = computed(() => niceCeil(this.largest()))

  /** Gridlines at the top, the middle and zero; the bars' area ends 1.5rem above the bottom. */
  protected scale = computed(() => {
    const max = this.max()
    const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
    const major = (minor: number) => compact.format(minor / 10 ** this.minorUnit())
    if (this.largest() === 0) {
      // Nothing in any period (a wallet with transfers only): the zero line alone.
      return [{ top: 85, label: '0' }]
    }
    // The bar area is the button minus its 1.5rem label: 0 sits at (100% − 1.5rem).
    return [
      { top: 2.5, label: major(max) },
      { top: 43.75, label: major(max / 2) },
      { top: 85, label: '0' },
    ]
  })

  protected bars = computed(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const max = this.max()
    const month = new Intl.DateTimeFormat(locale, { month: 'short' })
    const full = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    const money = (minor: number) => formatAmount(minor, this.minorUnit(), locale)
    return this.points().map((point) => {
      const date = fromDay(point.from)
      const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
      const unit = this.unit()
      const name =
        unit === 'month'
          ? month.format(date)
          : unit === 'quarter'
            ? quarter
            : String(date.getFullYear())
      const period =
        unit === 'month'
          ? full.format(date)
          : unit === 'quarter'
            ? `${quarter} ${date.getFullYear()}`
            : name
      return {
        tab: point.tab,
        name,
        selected: point.tab === this.selected(),
        income: (point.income / max) * 100,
        expense: (point.expense / max) * 100,
        label: this.transloco.translate('reports.trendBar', {
          period,
          income: money(point.income),
          expense: money(point.expense),
        }),
      }
    })
  })
}
