import { Component, computed, inject, input } from '@angular/core'
import { RouterLink } from '@angular/router'
import { TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronRight } from '@ng-icons/lucide'
import { CATEGORY_DEFAULT_ICON } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import type { CategoryShare } from '@/core/report'
import { sharePercent } from '@/features/reports/report-view'
import { IconBadge, userColor } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { formatAmount } from '@/shared/utils'

/**
 * A breakdown by category (report.md rules 4–6, owner's choice Q1-B in #10): a thin bar split
 * by category, then one row per category, largest first, each with a bar of its size in the
 * category's colour. The badge and the name carry identity (user colours may repeat). A row
 * opens the category's page.
 */
@Component({
  selector: 'app-report-share-list',
  imports: [RouterLink, NgIcon, IconBadge],
  providers: [provideIcons({ lucideChevronRight })],
  template: `
    <div class="mb-1 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      @for (row of rows(); track row.key) {
        <span
          class="h-full min-w-0.5"
          [style.flex-grow]="row.amount"
          [style.background]="row.color"
        ></span>
      }
    </div>
    <ul class="divide-y divide-border">
      @for (row of rows(); track row.key) {
        <li>
          <a
            class="-mx-2 flex min-h-15 items-center gap-3 rounded-lg px-2 py-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            [routerLink]="row.link"
          >
            <app-icon-badge [icon]="row.icon" [color]="row.color" [fallback]="categoryIcon" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex items-baseline justify-between gap-2">
                <span class="truncate text-base font-medium">{{ row.name }}</span>
                <span class="shrink-0 text-base font-medium tabular-nums">{{ row.money }}</span>
              </span>
              <span class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span
                  class="block h-full rounded-full"
                  [style.width.%]="row.size"
                  [style.background]="row.color"
                ></span>
              </span>
              <span
                class="mt-1 flex justify-between gap-2 text-xs text-muted-foreground tabular-nums"
              >
                <span>{{ row.share }}</span>
                @if (row.note) {
                  <span class="truncate">{{ row.note }}</span>
                }
              </span>
            </span>
            <ng-icon
              name="lucideChevronRight"
              size="18"
              class="shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </a>
        </li>
      }
    </ul>
  `,
})
export class ReportShareList {
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)

  shares = input.required<readonly CategoryShare[]>()
  /** The whole the shares are of (the type's total, or the parent's). */
  total = input.required<number>()
  minorUnit = input.required<number>()
  /** Where a row leads: `<base>/<id>`, or `<base>/direct` for money on the parent itself. */
  base = input.required<string>()

  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon

  protected rows = computed(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const shares = this.shares()
    const largest = Math.max(1, ...shares.map((share) => share.amount))
    return shares.map((share) => {
      const notes = [
        share.direct ? this.transloco.translate('reports.directHint') : null,
        share.childCount > 0
          ? this.transloco.translate('reports.childCount', { count: share.childCount })
          : null,
        share.isArchived ? this.transloco.translate('reports.archived') : null,
      ].filter((note) => note !== null)
      return {
        key: share.direct ? `${share.id}:direct` : share.id,
        link: `${this.base()}/${share.direct ? 'direct' : share.id}`,
        name: share.direct ? this.transloco.translate('reports.direct') : share.name,
        icon: share.icon,
        color: userColor(share.color),
        amount: share.amount,
        money: formatAmount(share.amount, this.minorUnit(), locale),
        size: (share.amount / largest) * 100,
        share: sharePercent(share.amount, this.total(), locale),
        note: notes.join(' · '),
      }
    })
  })
}
