import { Component, computed, inject, input, linkedSignal } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { LanguageService } from '@/core/i18n'
import type { Trend } from '@/core/report'
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
 * The chosen period split into its months (report.md rule 7): a pair of bars per part in the
 * money colours. Tapping a pair shows its figures above the bars and fades the others; it
 * never changes the chosen period. Drawn with plain elements, no chart library (Q1).
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
          {{ 'reports.trend.' + trend().step | transloco }}
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
      <p
        class="mt-2 flex min-h-5 flex-wrap items-baseline justify-center gap-x-2 text-xs text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        @if (detail(); as part) {
          <span class="font-semibold text-foreground">{{ part.period }}</span>
          <span>
            {{ 'categories.income' | transloco }}
            <span class="font-semibold text-income">{{ part.income }}</span>
          </span>
          <span>
            {{ 'categories.expense' | transloco }}
            <span class="font-semibold text-expense">{{ part.expense }}</span>
          </span>
        } @else {
          {{ 'reports.trendHint.' + trend().step | transloco }}
        }
      </p>
      <div class="relative mt-1 h-40 pl-9">
        @for (line of scale(); track line.top) {
          <div class="absolute inset-x-0 flex items-center gap-1" [style.top.%]="line.top">
            <span class="w-8 -translate-y-1/2 text-right text-[11px] text-muted-foreground">
              {{ line.label }}
            </span>
            <span class="h-px flex-1 -translate-y-1/2 bg-border"></span>
          </div>
        }
        <div class="relative flex h-full gap-0.5">
          @for (bar of bars(); track bar.from; let i = $index) {
            <button
              type="button"
              class="flex h-full min-w-0 flex-1 flex-col items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              [class.ring-1]="bar.picked"
              [class.ring-brand]="bar.picked"
              [attr.aria-pressed]="bar.picked"
              [attr.aria-label]="bar.label"
              (click)="pick(i)"
            >
              <span class="flex w-full flex-1 items-end justify-center gap-0.5 pt-1">
                <span
                  class="w-[30%] max-w-3.5 rounded-t-[4px] bg-income"
                  [class.opacity-40]="bar.faded"
                  [style.height.%]="bar.income"
                ></span>
                <span
                  class="w-[30%] max-w-3.5 rounded-t-[4px] bg-expense"
                  [class.opacity-40]="bar.faded"
                  [style.height.%]="bar.expense"
                ></span>
              </span>
              <span
                class="h-6 pt-1 text-[11px] leading-5 whitespace-nowrap text-muted-foreground"
                [class.font-semibold]="bar.picked"
                [class.text-foreground]="bar.picked"
                aria-hidden="true"
              >
                {{ bar.name }}
              </span>
            </button>
          }
        </div>
      </div>
    </section>
  `,
})
export class ReportTrend {
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)

  trend = input.required<Trend>()
  minorUnit = input.required<number>()

  /** The pair whose figures show; cleared when the period (and so the parts) changes. */
  protected picked = linkedSignal<Trend, number | null>({
    source: () => this.trend(),
    computation: (trend, previous) =>
      previous &&
      previous.value !== null &&
      previous.source.points.at(0)?.from === trend.points.at(0)?.from &&
      previous.source.points.length === trend.points.length
        ? previous.value
        : null,
  })

  private largest = computed(() =>
    Math.max(0, ...this.trend().points.flatMap((point) => [point.income, point.expense]))
  )
  private max = computed(() => niceCeil(this.largest()))

  /** Gridlines at the top, the middle and zero; the bars' area ends 1.5rem above the bottom. */
  protected scale = computed(() => {
    const max = this.max()
    const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
    const major = (minor: number) => compact.format(minor / 10 ** this.minorUnit())
    if (this.largest() === 0) {
      // Nothing in any part (a wallet with transfers only): the zero line alone.
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
    const picked = this.picked()
    const { step, points } = this.trend()
    const month = new Intl.DateTimeFormat(locale, { month: 'short' })
    const full = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' })
    const money = (minor: number) => formatAmount(minor, this.minorUnit(), locale)
    return points.map((point, i) => {
      const date = fromDay(point.from)
      const quarter = `Q${Math.floor(date.getMonth() / 3) + 1}`
      const year = String(date.getFullYear())
      const name = step === 'month' ? month.format(date) : step === 'quarter' ? quarter : year
      const period =
        step === 'month' ? full.format(date) : step === 'quarter' ? `${quarter} ${year}` : year
      const income = money(point.income)
      const expense = money(point.expense)
      return {
        from: point.from,
        name,
        period,
        incomeText: income,
        expenseText: expense,
        picked: picked === i,
        faded: picked !== null && picked !== i,
        income: (point.income / max) * 100,
        expense: (point.expense / max) * 100,
        label: this.transloco.translate('reports.trendBar', { period, income, expense }),
      }
    })
  })

  protected detail = computed(() => {
    const index = this.picked()
    const bar = index === null ? undefined : this.bars().at(index)
    return bar ? { period: bar.period, income: bar.incomeText, expense: bar.expenseText } : null
  })

  protected pick(index: number): void {
    this.picked.update((current) => (current === index ? null : index))
  }
}
