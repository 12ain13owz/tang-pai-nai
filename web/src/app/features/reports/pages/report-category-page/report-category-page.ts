import { Component, computed, DestroyRef, effect, inject } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideSearchX } from '@ng-icons/lucide'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { ReportService } from '@/core/report'
import { PageTitleStrategy } from '@/core/routing'
import { TransactionService } from '@/core/transaction'
import { ReportDayList } from '@/features/reports/components/day-list'
import { ReportShareList } from '@/features/reports/components/share-list'
import { periodName, reportView, sharePercent } from '@/features/reports/report-view'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { PeriodStrip, Swipe } from '@/shared/components/period'

/** Which part of a category the page shows (report.md Q4–Q5). */
type Scope = 'whole' | 'direct' | 'child'

/**
 * A category's page in Reports (report.md → Web screens, owner's choices Q4–Q5 in #10), for
 * the tab's period, wallets and currency. A top-level category shows its total, its share of
 * the type, the previous period (E4), its sub-categories with "ไม่ระบุหมวดย่อย" for the money on
 * itself, then every counted transaction of it and its children; a sub-category (or "direct")
 * shows only its own. A row opens the transaction sheet.
 */
@Component({
  selector: 'app-report-category-page',
  imports: [
    TranslocoPipe,
    NgIcon,
    EmptyState,
    IconBadge,
    PeriodStrip,
    Swipe,
    ReportShareList,
    ReportDayList,
  ],
  providers: [provideIcons({ lucideSearchX })],
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
      @if (target(); as category) {
        <section
          class="flex flex-col items-center gap-1 rounded-xl border border-border bg-card px-4 py-4 text-center text-card-foreground"
        >
          <app-icon-badge
            [icon]="category.icon"
            [color]="category.color"
            [fallback]="categoryIcon"
            [size]="48"
          />
          @if (path(); as path) {
            <span class="mt-1 text-sm text-muted-foreground">{{ path }}</span>
          }
          <span
            class="text-3xl leading-tight font-bold tabular-nums"
            [class.text-income]="category.type === 'income' && total() > 0"
            [class.text-expense]="category.type === 'expense' && total() > 0"
          >
            {{ view.amount(category.type === 'income' ? total() : -total()) }}
          </span>
          <span class="text-sm text-muted-foreground">{{ shareLine() }}</span>
          <span class="text-xs text-muted-foreground tabular-nums">{{ previousLine() }}</span>
        </section>
        @if (showChildren()) {
          <section
            class="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 pt-3 pb-1 text-card-foreground"
            aria-labelledby="report-sub-categories"
          >
            <h2 id="report-sub-categories" class="text-sm font-medium text-muted-foreground">
              {{ 'reports.subCategories' | transloco }}
            </h2>
            <app-report-share-list
              [base]="'/reports/category/' + id()"
              [shares]="children()"
              [total]="total()"
              [minorUnit]="reportService.minorUnit()"
            />
          </section>
        }
        @if (items().length > 0) {
          <p class="text-center text-sm text-muted-foreground">
            {{ 'reports.count' | transloco: { count: items().length } }}
          </p>
          <app-report-day-list [items]="items()" [showWallet]="showWallet()" />
        } @else {
          <p class="py-6 text-center text-sm text-muted-foreground">
            {{ 'reports.noneInPeriod' | transloco }}
          </p>
        }
      } @else {
        <app-empty-state
          [heading]="'reports.notFound' | transloco"
          [description]="'reports.notFoundText' | transloco"
        >
          <ng-icon name="lucideSearchX" />
        </app-empty-state>
      }
    </div>
  `,
})
export class ReportCategoryPage {
  protected reportService = inject(ReportService)
  private categoryService = inject(CategoryService)
  private transactionService = inject(TransactionService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private pageTitleStrategy = inject(PageTitleStrategy)
  private params = toSignal(inject(ActivatedRoute).paramMap)

  protected view = reportView()
  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon

  protected id = computed(() => this.params()?.get('id') ?? '')
  private sub = computed(() => this.params()?.get('sub') ?? null)
  /** The category of the URL's first id (top-level from the breakdown). */
  private category = computed(() => this.categoryService.byId(this.id()))
  private scope = computed<Scope>(() => {
    const sub = this.sub()
    return sub === null ? 'whole' : sub === 'direct' ? 'direct' : 'child'
  })
  /** The category the page is about (a sub-category must be the first id's child). */
  protected target = computed(() => {
    const category = this.category()
    const sub = this.sub()
    if (!category || sub === null || sub === 'direct') {
      return category
    }
    const child = this.categoryService.byId(sub)
    return child?.parentId === category.id ? child : null
  })
  /** The rows this page counts and lists. */
  private categoryIds = computed<string[]>(() => {
    const category = this.category()
    const target = this.target()
    if (!category || !target) {
      return []
    }
    switch (this.scope()) {
      case 'whole':
        return [category.id, ...this.categoryService.childrenOf(category.id).map((c) => c.id)]
      case 'direct':
        return [category.id]
      default:
        return [target.id]
    }
  })

  protected total = computed(() => this.totalOf(this.reportService.range()))
  private previous = computed(() => this.totalOf(this.reportService.previousRange()))
  /** The share's whole: the type's total, or the parent's for a sub-category. */
  private whole = computed(() => {
    const category = this.category()
    const code = this.reportService.currencyCode()
    if (!category || !code) {
      return 0
    }
    if (this.scope() === 'whole') {
      const line = this.reportService.summaries().find((item) => item.currencyCode === code)
      return category.type === 'income' ? (line?.income ?? 0) : (line?.expense ?? 0)
    }
    return this.reportService.categoryTotal(
      this.reportService.range(),
      this.reportService.walletIds(),
      [category.id, ...this.categoryService.childrenOf(category.id).map((c) => c.id)],
      code
    )
  })

  protected children = computed(() => {
    const category = this.category()
    const code = this.reportService.currencyCode()
    if (!category || !code || this.scope() !== 'whole') {
      return []
    }
    return this.reportService.byCategory(
      this.reportService.range(),
      this.reportService.walletIds(),
      category.type,
      code,
      category.id
    )
  })
  /** Only when it splits into sub-categories (money only on the parent isn't a breakdown). */
  protected showChildren = computed(() => this.children().some((share) => !share.direct))

  protected items = computed(() => {
    const code = this.reportService.currencyCode()
    const ids = this.categoryIds()
    if (!code || ids.length === 0) {
      return []
    }
    return this.transactionService.list(
      this.reportService.range(),
      this.reportService.walletIds(),
      {
        categoryIds: ids,
        report: 'counted',
        currencyCode: code,
      }
    )
  })
  protected showWallet = computed(() => this.transactionService.viewWallet() === null)

  /** `อาหาร › กาแฟ` for a sub-category, `อาหาร › ไม่ระบุหมวดย่อย` for the parent's own money. */
  protected path = computed(() => {
    this.languageService.language()
    const category = this.category()
    const target = this.target()
    if (!category || !target || this.scope() === 'whole') {
      return null
    }
    const leaf =
      this.scope() === 'direct' ? this.transloco.translate('reports.direct') : target.name
    return `${category.name} › ${leaf}`
  })

  protected shareLine = computed(() => {
    this.languageService.language()
    const category = this.category()
    if (!category) {
      return ''
    }
    const whole =
      this.scope() === 'whole'
        ? this.transloco.translate(
            category.type === 'income' ? 'reports.wholeIncome' : 'reports.wholeExpense'
          )
        : category.name
    const share = sharePercent(this.total(), this.whole(), this.languageService.locale())
    return `${this.transloco.translate('reports.shareOf', { share, whole })} · ${this.view.period()}`
  })

  /** E4: the same category in the period before. */
  protected previousLine = computed(() => {
    this.languageService.language()
    const period = periodName(
      this.reportService.unit(),
      this.reportService.previousRange(),
      this.languageService.locale()
    )
    return this.transloco.translate('reports.previous', {
      period,
      amount: this.view.amount(this.previous(), false),
    })
  })

  constructor() {
    // The header shows the category's name (the route's title is only "รายงาน").
    effect(() => {
      this.languageService.language()
      const category = this.category()
      const target = this.target()
      let title: string | null = null
      if (category && target) {
        title =
          this.scope() === 'direct'
            ? `${category.name} · ${this.transloco.translate('reports.direct')}`
            : target.name
      }
      this.pageTitleStrategy.setOverride(title)
    })
    inject(DestroyRef).onDestroy(() => this.pageTitleStrategy.setOverride(null))
  }

  private totalOf(range: { from: string; to: string }): number {
    const code = this.reportService.currencyCode()
    const ids = this.categoryIds()
    if (!code || ids.length === 0) {
      return 0
    }
    return this.reportService.categoryTotal(range, this.reportService.walletIds(), ids, code)
  }
}
