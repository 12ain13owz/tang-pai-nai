import { Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArrowLeftRight,
  lucideChevronDown,
  lucideCircleAlert,
  lucideRepeat,
} from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { CATEGORY_DEFAULT_ICON } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { SyncService } from '@/core/offline'
import { describeRepeat, RecurringService, shortDate } from '@/core/recurring'
import type { RuleItem } from '@/core/recurring'
import { TransactionService, TransferService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { formatAmount } from '@/shared/utils'

interface RuleRow {
  item: RuleItem
  title: string
  note: string
  schedule: string
  /** Why it records nothing now, in the destructive colour (recurring rule 12). */
  warning: string
  amount: string
}

/**
 * Account › รายการซ้ำ (docs/features/recurring.md → Web screens, mock-up frames 5 and 7): the
 * current profile's rules, "ใช้อยู่" by next date, "หยุดไว้" (paused, or stopped by an archived
 * wallet or category), then "สิ้นสุดแล้ว" folded. A row opens the rule in its sheet.
 */
@Component({
  selector: 'app-recurring-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState, IconBadge],
  providers: [
    provideIcons({ lucideArrowLeftRight, lucideChevronDown, lucideCircleAlert, lucideRepeat }),
  ],
  template: `
    <div class="flex flex-col gap-4 p-4">
      @if (rows().length === 0) {
        <app-empty-state
          [heading]="'recurring.emptyHeading' | transloco"
          [description]="'recurring.emptyText' | transloco"
        >
          <ng-icon name="lucideRepeat" />
        </app-empty-state>
      }
      @for (group of groups(); track group.key) {
        @if (group.rows.length > 0) {
          <section class="flex flex-col gap-3" [attr.aria-labelledby]="'recurring-' + group.key">
            @if (group.key === 'ended') {
              <button
                type="button"
                class="flex min-h-11 items-center justify-between text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                [attr.aria-expanded]="showEnded()"
                [id]="'recurring-' + group.key"
                (click)="showEnded.set(!showEnded())"
              >
                {{ 'recurring.groupEnded' | transloco: { count: group.rows.length } }}
                <ng-icon
                  name="lucideChevronDown"
                  size="16"
                  [class.rotate-180]="showEnded()"
                  aria-hidden="true"
                />
              </button>
            } @else {
              <h2 [id]="'recurring-' + group.key" class="text-sm font-medium text-muted-foreground">
                {{ group.heading | transloco: { count: group.rows.length } }}
              </h2>
            }
            @if (group.key !== 'ended' || showEnded()) {
              <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                @for (row of group.rows; track row.item.rule.id) {
                  <li>
                    <button
                      type="button"
                      class="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      [class.opacity-60]="row.item.state === 'paused' || row.item.state === 'ended'"
                      (click)="recurringService.open(row.item.rule.id)"
                    >
                      <span class="relative shrink-0">
                        @if (row.item.rule.kind === 'transfer') {
                          <span
                            class="flex size-10 items-center justify-center rounded-full bg-muted text-foreground"
                          >
                            <ng-icon name="lucideArrowLeftRight" size="20" aria-hidden="true" />
                          </span>
                        } @else {
                          <app-icon-badge
                            [icon]="row.item.icon"
                            [color]="row.item.color"
                            [fallback]="categoryIcon"
                          />
                        }
                        <app-icon-badge
                          class="absolute -right-1 -bottom-1 rounded-full ring-2 ring-card"
                          [icon]="row.item.walletIcon"
                          [color]="row.item.walletColor"
                          [fallback]="walletIcon"
                          [size]="20"
                        />
                      </span>
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span class="flex min-w-0 items-center gap-1.5">
                          <span class="truncate text-base font-semibold">{{ row.title }}</span>
                          @if (row.item.rule.confirm) {
                            <span
                              class="shrink-0 rounded-md bg-brand/10 px-1.5 text-xs font-semibold text-brand"
                            >
                              {{ 'recurring.askTag' | transloco }}
                            </span>
                          }
                        </span>
                        @if (row.note) {
                          <span class="truncate text-sm text-muted-foreground">{{ row.note }}</span>
                        }
                        @if (row.warning) {
                          <span class="flex items-center gap-1 text-sm text-destructive">
                            <ng-icon name="lucideCircleAlert" size="14" aria-hidden="true" />
                            {{ row.warning }}
                          </span>
                        }
                        <span class="text-sm text-muted-foreground">{{ row.schedule }}</span>
                      </span>
                      <span
                        class="shrink-0 text-right text-base tabular-nums"
                        [class.text-income]="row.item.rule.kind !== 'transfer' && row.item.sign > 0"
                        [class.text-expense]="
                          row.item.rule.kind !== 'transfer' && row.item.sign < 0
                        "
                      >
                        {{ row.amount }}
                      </span>
                    </button>
                  </li>
                }
              </ul>
            }
          </section>
        }
      }
      @if (recurringService.atLimit()) {
        <p class="text-sm text-muted-foreground">{{ 'recurring.limit' | transloco }}</p>
      } @else {
        <div class="flex gap-2">
          <button
            hlmBtn
            variant="outline"
            type="button"
            class="h-11 flex-1"
            [disabled]="!recurringService.canWrite()"
            (click)="add()"
          >
            {{ 'recurring.add' | transloco }}
          </button>
          @if (walletService.openWallets().length >= 2) {
            <button
              hlmBtn
              type="button"
              class="h-11 flex-1 bg-brand/10 text-brand hover:bg-brand/15"
              [disabled]="!recurringService.canWrite()"
              (click)="addTransfer()"
            >
              {{ 'transfers.open' | transloco }}
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class RecurringPage {
  protected recurringService = inject(RecurringService)
  protected walletService = inject(WalletService)
  private transactionService = inject(TransactionService)
  private transferService = inject(TransferService)
  private syncService = inject(SyncService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private route = inject(ActivatedRoute)
  private router = inject(Router)

  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected walletIcon = WALLET_DEFAULT_ICON
  protected showEnded = signal(false)

  protected rows = computed<RuleRow[]>(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const t = (key: string, params?: Record<string, unknown>) =>
      this.transloco.translate(key, params)
    return this.recurringService.items().map((item) => {
      const { rule } = item
      const minorUnit = this.walletService.minorUnit(item.currencyCode)
      const parts = [describeRepeat(rule, rule.startOn, t, locale)]
      if (rule.endCount !== null) {
        parts.push(
          t('recurring.progress', {
            done: Math.min(rule.endCount, this.recurringService.recordedCount(rule)),
            n: rule.endCount,
          })
        )
      }
      if (item.state === 'paused') {
        parts.push(t('recurring.paused'))
      } else if (item.dueOn) {
        parts.push(t('recurring.dueOn', { date: shortDate(item.dueOn, locale, false) }))
      } else if (rule.nextOn && item.state === 'active') {
        parts.push(t('recurring.next', { date: shortDate(rule.nextOn, locale) }))
      }
      const transfer = rule.kind === 'transfer'
      return {
        item,
        title: transfer
          ? t('recurring.transferTitle', { from: item.walletName, to: item.toWalletName })
          : item.title,
        note: rule.note,
        schedule: parts.join(' · '),
        warning: item.stoppedBy
          ? t(
              item.stoppedBy.kind === 'wallet'
                ? 'recurring.stoppedWallet'
                : 'recurring.stoppedCategory',
              {
                name: item.stoppedBy.name,
              }
            )
          : '',
        amount: formatAmount(
          transfer ? rule.amount : item.sign * rule.amount,
          minorUnit,
          locale,
          !transfer
        ),
      }
    })
  })
  protected groups = computed(() => {
    const rows = this.rows()
    return [
      {
        key: 'active',
        heading: 'recurring.groupActive',
        rows: rows.filter((row) => row.item.state === 'active'),
      },
      {
        key: 'paused',
        heading: 'recurring.groupPaused',
        rows: rows.filter((row) => row.item.state === 'paused' || row.item.state === 'stopped'),
      },
      {
        key: 'ended',
        heading: 'recurring.groupEnded',
        rows: rows.filter((row) => row.item.state === 'ended'),
      },
    ]
  })

  constructor() {
    // "Fix" in the sync sheet opens this page with the rejected op's id.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const fix = params.get('fix')
      const op = fix ? this.syncService.rejectedOp(fix) : null
      if (fix && op) {
        const state = { mode: 'fixRule' as const, opId: fix, id: op.rowId }
        if (op.row['kind'] === 'transfer') {
          this.transferService.open(state)
        } else {
          this.transactionService.open(state)
        }
        void this.router.navigate([], { queryParams: {}, replaceUrl: true })
      }
    })
  }

  protected add(): void {
    this.transactionService.open({ mode: 'create', repeat: true })
  }

  protected addTransfer(): void {
    this.transferService.open({ mode: 'create', repeat: true })
  }
}
