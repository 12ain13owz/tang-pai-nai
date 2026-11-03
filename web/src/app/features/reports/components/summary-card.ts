import { Component, computed, inject, input } from '@angular/core'
import { RouterLink } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowDownLeft, lucideArrowUpRight, lucideChevronRight } from '@ng-icons/lucide'
import { LanguageService } from '@/core/i18n'
import type { ReportSummary } from '@/core/report'
import { formatAmount } from '@/shared/utils'

/**
 * The Reports tab's summary card, one per currency (report.md → Web screens, owner's choice H1
 * in #10): the net as the headline, income and expense as tinted tiles, the balances on one line
 * (rule 9), and small notes for the average per day (rule 10), the transfers and the rows left
 * out (rule 11), each only when it has something to say.
 */
@Component({
  selector: 'app-report-summary-card',
  imports: [RouterLink, TranslocoPipe, NgIcon],
  providers: [provideIcons({ lucideArrowDownLeft, lucideArrowUpRight, lucideChevronRight })],
  template: `
    @let m = money();
    <section
      class="rounded-xl border border-border bg-card px-4 pt-3 pb-4 text-card-foreground"
      [attr.aria-label]="'reports.summary' | transloco: { period: period() }"
    >
      <div class="flex flex-col items-center text-center">
        <span class="text-sm text-muted-foreground">
          {{ 'reports.netOf' | transloco: { period: period() } }}
        </span>
        <span class="text-3xl leading-tight font-bold tabular-nums">{{ m.net }}</span>
      </div>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <div class="flex min-w-0 flex-col rounded-xl bg-income/10 px-3 py-2">
          <span class="flex items-center gap-1 text-xs text-muted-foreground">
            <ng-icon name="lucideArrowDownLeft" size="14" aria-hidden="true" />
            {{ 'categories.income' | transloco }}
          </span>
          <span
            class="truncate text-lg font-semibold tabular-nums"
            [class.text-income]="line().income > 0"
          >
            {{ m.income }}
          </span>
        </div>
        <div class="flex min-w-0 flex-col rounded-xl bg-expense/10 px-3 py-2">
          <span class="flex items-center gap-1 text-xs text-muted-foreground">
            <ng-icon name="lucideArrowUpRight" size="14" aria-hidden="true" />
            {{ 'categories.expense' | transloco }}
          </span>
          <span
            class="truncate text-lg font-semibold tabular-nums"
            [class.text-expense]="line().expense > 0"
          >
            {{ m.expense }}
          </span>
        </div>
      </div>
      <div
        class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t border-border pt-3"
      >
        <div class="flex min-w-0 flex-col">
          <span class="text-xs text-muted-foreground">{{ 'reports.start' | transloco }}</span>
          <span class="truncate text-base font-semibold tabular-nums">{{ m.start }}</span>
        </div>
        <span class="flex items-center text-muted-foreground" aria-hidden="true">
          <span class="h-px w-6 bg-border"></span>
          <ng-icon name="lucideChevronRight" size="16" />
        </span>
        <div class="flex min-w-0 flex-col items-end text-right">
          <span class="text-xs text-muted-foreground">{{ 'reports.end' | transloco }}</span>
          <span class="truncate text-base font-semibold tabular-nums">{{ m.end }}</span>
        </div>
      </div>
      @if (m.perDay || m.transfer || line().excludedCount > 0) {
        <div class="mt-3 flex flex-wrap gap-1.5">
          @if (m.perDay; as perDay) {
            <span
              class="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground tabular-nums"
            >
              {{ 'reports.perDay' | transloco: { amount: perDay } }}
            </span>
          }
          @if (m.transfer; as transfer) {
            <span
              class="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground tabular-nums"
            >
              {{ 'reports.transfer' | transloco: { amount: transfer } }}
            </span>
          }
          @if (line().excludedCount > 0) {
            <a
              routerLink="/reports/excluded"
              class="flex min-h-7 items-center gap-0.5 rounded-full bg-muted py-1 pr-1.5 pl-2.5 text-xs text-muted-foreground tabular-nums focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {{ 'reports.excluded' | transloco: { count: line().excludedCount } }}
              {{ m.excluded }}
              <ng-icon name="lucideChevronRight" size="14" aria-hidden="true" />
            </a>
          }
        </div>
      }
    </section>
  `,
})
export class ReportSummaryCard {
  private languageService = inject(LanguageService)

  line = input.required<ReportSummary>()
  /** The period by name (`ต.ค. 2026`). */
  period = input.required<string>()

  protected money = computed(() => {
    const line = this.line()
    const locale = this.languageService.locale()
    const format = (minor: number, signed = false) =>
      formatAmount(minor, line.minorUnit, locale, signed)
    return {
      net: format(line.net, true),
      income: format(line.income, true),
      expense: format(-line.expense, true),
      start: format(line.start),
      end: format(line.end),
      perDay: line.perDay !== null && line.expense > 0 ? format(line.perDay) : null,
      transfer: line.transfer ? format(line.transfer, true) : null,
      excluded: format(line.excluded, true),
    }
  })
}
