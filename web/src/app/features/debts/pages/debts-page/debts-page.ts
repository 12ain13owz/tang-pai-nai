import { Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronDown, lucideHandCoins } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import { DEBTS_ROUTE, DebtService } from '@/core/debt'
import type { DebtDirection } from '@/core/debt'
import { LanguageService } from '@/core/i18n'
import { DebtSheets } from '@/features/debts/components/debt-sheets'
import { debtRow } from '@/features/debts/debt-view'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { formatMoney } from '@/shared/utils'

/**
 * หนี้ / เงินกู้ (docs/features/debt.md → Web screens, mock-up frames 2 and 10): ยืมมา | ให้ยืม,
 * what is left in total, the open debts by due date, "ปิดแล้ว (n)" folded, and "บันทึกหนี้".
 */
@Component({
  selector: 'app-debts-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, RouterLink, EmptyState, IconBadge, DebtSheets],
  providers: [provideIcons({ lucideChevronDown, lucideHandCoins })],
  template: `
    <div class="flex flex-col gap-4 p-4">
      <div
        class="flex rounded-lg bg-muted p-1"
        role="tablist"
        [attr.aria-label]="'debts.direction' | transloco"
      >
        @for (option of directions; track option) {
          <button
            type="button"
            role="tab"
            class="h-9 flex-1 rounded-md text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            [class.bg-card]="tab() === option"
            [class.font-semibold]="tab() === option"
            [class.text-muted-foreground]="tab() !== option"
            [attr.aria-selected]="tab() === option"
            (click)="choose(option)"
          >
            {{ 'debts.' + option | transloco }} ({{ countOf(option) }})
          </button>
        }
      </div>
      @if (open().length === 0 && closed().length === 0) {
        <app-empty-state
          [heading]="'debts.emptyHeading.' + tab() | transloco"
          [description]="'debts.emptyText' | transloco"
        >
          <ng-icon name="lucideHandCoins" />
        </app-empty-state>
      } @else {
        <section
          class="flex flex-col items-center rounded-2xl border border-border bg-card px-4 py-3.5"
        >
          <span class="text-sm text-muted-foreground">{{
            'debts.leftTotal.' + tab() | transloco
          }}</span>
          @for (line of totals(); track line.code) {
            <span
              class="text-2xl font-bold tabular-nums"
              [class.text-expense]="tab() === 'borrowed'"
              [class.text-income]="tab() === 'lent'"
              >{{ line.text }}</span
            >
          }
        </section>
      }
      @if (open().length > 0) {
        <ul class="divide-y divide-border rounded-2xl border border-border bg-card">
          @for (row of open(); track row.item.debt.id) {
            <li>
              <a
                class="flex min-h-16 items-center gap-3 px-4 py-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                [routerLink]="[route, row.item.debt.id]"
              >
                @if (categoryOf(row.item.debt.categoryId); as category) {
                  <app-icon-badge
                    [icon]="category.icon"
                    [color]="category.color"
                    [fallback]="categoryIcon"
                  />
                } @else {
                  <span
                    class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
                  >
                    <ng-icon name="lucideHandCoins" size="20" aria-hidden="true" />
                  </span>
                }
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-base font-semibold">{{ row.item.debt.person }}</span>
                    @if (row.item.debt.countAs === 'repaid') {
                      <span
                        class="shrink-0 rounded-md bg-brand/10 px-1.5 text-xs font-semibold text-brand"
                        >{{ 'debts.repaidTag' | transloco }}</span
                      >
                    }
                  </span>
                  @if (row.sub) {
                    <span class="truncate text-sm text-muted-foreground">{{ row.sub }}</span>
                  }
                  <span class="truncate text-xs text-muted-foreground">{{ row.progress }}</span>
                  <span
                    class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-full rounded-full"
                      [class.bg-brand]="tab() === 'borrowed'"
                      [class.bg-income]="tab() === 'lent'"
                      [style.width.%]="row.share"
                    ></span>
                  </span>
                </span>
                <span class="flex shrink-0 flex-col items-end">
                  <span
                    class="text-base font-semibold tabular-nums"
                    [class.text-expense]="tab() === 'borrowed'"
                    [class.text-income]="tab() === 'lent'"
                    >{{ row.left }}</span
                  >
                  @if (row.when) {
                    <span
                      class="text-xs"
                      [class.text-destructive]="row.item.overdue"
                      [class.text-muted-foreground]="!row.item.overdue"
                      >{{ row.when }}</span
                    >
                  }
                </span>
              </a>
            </li>
          }
        </ul>
      }
      @if (closed().length > 0) {
        <button
          type="button"
          class="flex min-h-11 items-center justify-between text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          [attr.aria-expanded]="showClosed()"
          (click)="showClosed.set(!showClosed())"
        >
          {{ 'debts.closedGroup' | transloco: { count: closed().length } }}
          <ng-icon
            name="lucideChevronDown"
            size="16"
            [class.rotate-180]="showClosed()"
            aria-hidden="true"
          />
        </button>
        @if (showClosed()) {
          <ul class="divide-y divide-border rounded-2xl border border-border bg-card">
            @for (row of closed(); track row.item.debt.id) {
              <li>
                <a
                  class="flex min-h-16 items-center gap-3 px-4 py-2.5 opacity-65 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                  [routerLink]="[route, row.item.debt.id]"
                >
                  <span
                    class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
                  >
                    <ng-icon name="lucideHandCoins" size="20" aria-hidden="true" />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-base font-semibold">{{ row.item.debt.person }}</span>
                    <span class="truncate text-sm text-muted-foreground">{{ row.sub }}</span>
                  </span>
                  <span class="flex shrink-0 flex-col items-end">
                    <span class="text-base tabular-nums">{{ row.left }}</span>
                    <span class="text-xs text-muted-foreground">{{ row.when }}</span>
                  </span>
                </a>
              </li>
            }
          </ul>
        }
      }
      @if (debtService.atLimit()) {
        <p class="text-sm text-muted-foreground">{{ 'debts.limit' | transloco }}</p>
      } @else {
        <button
          hlmBtn
          variant="outline"
          type="button"
          class="h-11"
          [disabled]="!debtService.canWrite()"
          (click)="debtService.open({ mode: 'create', direction: tab() })"
        >
          {{ 'debts.add' | transloco }}
        </button>
      }
    </div>
    <app-debt-sheets />
  `,
})
export class DebtsPage {
  protected debtService = inject(DebtService)
  private categoryService = inject(CategoryService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private activatedRoute = inject(ActivatedRoute)
  private router = inject(Router)

  protected readonly directions: readonly DebtDirection[] = ['borrowed', 'lent']
  protected readonly route = DEBTS_ROUTE
  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected tab = signal<DebtDirection>('borrowed')
  protected showClosed = signal(false)

  private rows = computed(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params)
    return this.debtService
      .items()
      .filter((item) => item.debt.direction === this.tab())
      .map((item) => debtRow(item, t, locale))
  })
  protected open = computed(() => this.rows().filter((row) => !row.item.closed))
  protected closed = computed(() =>
    this.rows()
      .filter((row) => row.item.closed)
      .sort((a, b) => (b.item.lastOn ?? '').localeCompare(a.item.lastOn ?? ''))
  )
  /** What is left of the open debts, one line per currency. */
  protected totals = computed(() => {
    const locale = this.languageService.locale()
    const sums = new Map<string, { amount: number; minorUnit: number }>()
    for (const row of this.open()) {
      const { debt, left, minorUnit } = row.item
      const sum = sums.get(debt.currencyCode) ?? { amount: 0, minorUnit }
      sum.amount += Math.max(0, left)
      sums.set(debt.currencyCode, sum)
    }
    if (sums.size === 0) {
      sums.set('THB', { amount: 0, minorUnit: 2 })
    }
    return [...sums.entries()].map(([code, sum]) => ({
      code,
      text: formatMoney(sum.amount, code, sum.minorUnit, locale),
    }))
  })

  constructor() {
    this.activatedRoute.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const tab = params.get('tab')
      if (tab === 'lent' || tab === 'borrowed') {
        this.tab.set(tab)
      }
      const fix = params.get('fix')
      if (fix) {
        this.debtService.openFix(fix)
        void this.router.navigate([], { queryParams: {}, replaceUrl: true })
      }
    })
  }

  protected countOf(direction: DebtDirection): number {
    return this.debtService.openItems().filter((item) => item.debt.direction === direction).length
  }

  protected categoryOf(id: string | null) {
    return id ? this.categoryService.byId(id) : null
  }

  protected choose(direction: DebtDirection): void {
    this.tab.set(direction)
    void this.router.navigate([], {
      queryParams: { tab: direction === 'lent' ? 'lent' : null },
      replaceUrl: true,
    })
  }
}
