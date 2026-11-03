import { Component, computed, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChartPie } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import type { CategoryType } from '@/core/category'
import { ReportService } from '@/core/report'
import { TransactionService } from '@/core/transaction'
import { ReportShareList } from '@/features/reports/components/share-list'
import { ReportSummaryCard } from '@/features/reports/components/summary-card'
import { ReportTrend } from '@/features/reports/components/trend-chart'
import { reportView } from '@/features/reports/report-view'
import { EmptyState } from '@/shared/components/empty-state'
import { CustomRangeSheet, PeriodStrip, Swipe } from '@/shared/components/period'

/**
 * The Reports tab (docs/features/report.md → Web screens, owner's choices in #10). The header
 * (layout/transactions-header, `view="reports"`) holds the wallet switcher and "ดูตาม"; this
 * page shows the period chips, the summary card per currency (H1), the trend and the breakdown
 * by top-level category (Q1-B). Everything is read from the local database.
 */
@Component({
  selector: 'app-reports-page',
  imports: [
    TranslocoPipe,
    NgIcon,
    HlmButton,
    EmptyState,
    PeriodStrip,
    Swipe,
    CustomRangeSheet,
    ReportSummaryCard,
    ReportTrend,
    ReportShareList,
  ],
  providers: [provideIcons({ lucideChartPie })],
  host: { class: 'flex flex-col' },
  template: `
    <app-period-strip
      class="pt-2"
      [chips]="view.chips()"
      [selected]="reportService.tab()"
      [label]="'transactions.periods' | transloco"
      (chosen)="view.choose($event)"
    />
    <div class="flex flex-col gap-3 px-4 pt-1 pb-4" appSwipe (swiped)="view.move($event)">
      @if (reportService.hasData()) {
        @for (line of reportService.summaries(); track line.currencyCode) {
          <app-report-summary-card [line]="line" [period]="view.period()" />
        }
        @if (reportService.currencies().length > 1) {
          <!-- Q6: the trend and the breakdown show one currency at a time. -->
          <div class="flex gap-2" role="tablist" [attr.aria-label]="'reports.currency' | transloco">
            @for (code of reportService.currencies(); track code) {
              <button
                type="button"
                role="tab"
                class="min-h-9 rounded-full bg-muted px-3.5 text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-primary aria-selected:font-semibold aria-selected:text-primary-foreground"
                [attr.aria-selected]="code === reportService.currencyCode()"
                (click)="reportService.chosenCurrency.set(code)"
              >
                {{ code }}
              </button>
            }
          </div>
        }
        @if (trendUnit(); as unit) {
          <app-report-trend
            [points]="reportService.trend()"
            [selected]="reportService.tab()"
            [unit]="unit"
            [minorUnit]="reportService.minorUnit()"
            (pick)="reportService.tab.set($event)"
          />
        }
        <section
          class="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 pt-3 pb-1 text-card-foreground"
          aria-labelledby="report-by-category"
        >
          <div
            class="flex rounded-lg bg-muted p-1"
            role="tablist"
            [attr.aria-label]="'reports.types' | transloco"
          >
            @for (type of types; track type) {
              <button
                type="button"
                role="tab"
                class="flex h-10 flex-1 items-center justify-center rounded-md text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-card aria-selected:font-semibold aria-selected:text-foreground aria-selected:shadow-sm"
                [attr.aria-selected]="reportService.type() === type"
                (click)="reportService.type.set(type)"
              >
                {{ 'categories.' + type | transloco }}
              </button>
            }
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <h2 id="report-by-category" class="text-sm font-medium text-muted-foreground">
              {{ 'reports.byCategory' | transloco }}
            </h2>
            <span class="text-sm font-semibold tabular-nums">{{
              view.amount(typeTotal(), false)
            }}</span>
          </div>
          @if (reportService.breakdown().length > 0) {
            <app-report-share-list
              base="/reports/category"
              [shares]="reportService.breakdown()"
              [total]="typeTotal()"
              [minorUnit]="reportService.minorUnit()"
            />
          } @else {
            <p class="pb-3 text-center text-sm text-muted-foreground">
              {{ 'reports.noneOfType' | transloco }}
            </p>
          }
        </section>
      } @else {
        <app-empty-state
          [heading]="'reports.emptyHeading' | transloco"
          [description]="'reports.emptyText' | transloco"
        >
          <ng-icon name="lucideChartPie" />
        </app-empty-state>
        <button
          hlmBtn
          type="button"
          class="-mt-10 h-11 self-center px-5 text-base"
          [disabled]="!transactionService.canWrite()"
          (click)="transactionService.open({ mode: 'create' })"
        >
          {{ 'transactions.add' | transloco }}
        </button>
      }
    </div>
    <!-- "ดูตาม › กำหนดเอง" of this tab (the header's menu opens it). -->
    @defer (when reportService.customSheet()) {
      <app-custom-range-sheet
        [(open)]="reportService.customSheet"
        [range]="reportService.custom()"
        (applied)="reportService.selectCustom($event)"
      />
    }
  `,
})
export class ReportsPage {
  protected reportService = inject(ReportService)
  protected transactionService = inject(TransactionService)
  protected view = reportView()
  protected readonly types: readonly CategoryType[] = ['expense', 'income']

  /** The trend's unit; a custom range has none (Q2). */
  protected trendUnit = computed(() => {
    const unit = this.reportService.unit()
    return unit === 'custom' ? null : unit
  })

  /** The chosen type's total in the chosen currency: the base of every share. */
  protected typeTotal = computed(() => {
    const line = this.reportService
      .summaries()
      .find((item) => item.currencyCode === this.reportService.currencyCode())
    if (!line) {
      return 0
    }
    return this.reportService.type() === 'income' ? line.income : line.expense
  })
}
