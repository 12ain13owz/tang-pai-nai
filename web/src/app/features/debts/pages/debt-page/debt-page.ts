import { Component, computed, DestroyRef, effect, inject, untracked } from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronRight, lucideHandCoins, lucidePencil, lucideRepeat } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { CATEGORY_DEFAULT_ICON } from '@/core/category'
import { DebtService } from '@/core/debt'
import type { DebtHistoryItem } from '@/core/debt'
import { LanguageService } from '@/core/i18n'
import { describeRepeat, RecurringService, shortDate } from '@/core/recurring'
import { PageTitleStrategy } from '@/core/routing'
import { TransactionService } from '@/core/transaction'
import { DebtSheets } from '@/features/debts/components/debt-sheets'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { formatAmount, formatMoney, fromDay } from '@/shared/utils'

/**
 * A debt's page (docs/features/debt.md → Web screens, mock-up frames 5, 7, 9): what is left, the
 * bar, paid / total, due, how it counts; the instalments to come (its rules); repay / borrow more
 * / close; the history, newest first, each row opening its sheet. Its title is the person.
 */
@Component({
  selector: 'app-debt-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState, IconBadge, DebtSheets],
  providers: [provideIcons({ lucideChevronRight, lucideHandCoins, lucidePencil, lucideRepeat })],
  template: `
    @if (item(); as current) {
      <div class="flex flex-col gap-4 p-4">
        <section
          class="relative flex flex-col items-center rounded-2xl border border-border bg-card px-4 pt-3.5 pb-4 text-center"
        >
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            class="absolute top-1.5 right-1.5 size-11"
            [disabled]="!debtService.canWrite()"
            [attr.aria-label]="'debts.edit' | transloco"
            (click)="debtService.open({ mode: 'edit', id: current.debt.id })"
          >
            <ng-icon name="lucidePencil" size="18" aria-hidden="true" />
          </button>
          <span class="text-sm text-muted-foreground">{{ heroLabel() }}</span>
          <span
            class="text-3xl font-bold tabular-nums"
            [class.text-expense]="!current.closed && current.debt.direction === 'borrowed'"
            [class.text-income]="!current.closed && current.debt.direction === 'lent'"
            >{{ leftText() }}</span
          >
          <span class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span
              class="block h-full rounded-full"
              [class.bg-brand]="current.debt.direction === 'borrowed'"
              [class.bg-income]="current.debt.direction === 'lent'"
              [style.width.%]="share()"
            ></span>
          </span>
          <span class="mt-2 flex flex-col gap-0.5 text-sm text-muted-foreground">
            @for (line of facts(); track $index) {
              <span [class.text-destructive]="line.warn">{{ line.text }}</span>
            }
          </span>
        </section>
        @for (rule of rules(); track rule.id) {
          <button
            type="button"
            class="flex min-h-15 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            (click)="recurringService.open(rule.id)"
          >
            <ng-icon
              name="lucideRepeat"
              size="22"
              class="shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-base">{{ rule.title }}</span>
              <span class="truncate text-sm text-muted-foreground">{{ rule.sub }}</span>
            </span>
            <span class="shrink-0 text-base tabular-nums">{{ rule.amount }}</span>
            <ng-icon
              name="lucideChevronRight"
              size="18"
              class="text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        }
        <div class="flex gap-2">
          @if (!current.closed) {
            <button
              hlmBtn
              type="button"
              class="h-11 min-w-0 flex-1"
              [disabled]="!debtService.canWrite()"
              (click)="repay()"
            >
              {{ repayLabel() | transloco }}
            </button>
          }
          <button
            hlmBtn
            type="button"
            class="h-11 min-w-0 flex-1 bg-brand/10 text-brand hover:bg-brand/15"
            [disabled]="!debtService.canWrite()"
            (click)="more()"
          >
            {{ 'debts.more.' + current.debt.direction | transloco }}
          </button>
          @if (current.left > 0) {
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11 shrink-0 px-4"
              [disabled]="!debtService.canWrite()"
              (click)="debtService.closeSheet.set(current.debt.id)"
            >
              {{ 'debts.close' | transloco }}
            </button>
          }
        </div>
        <h2 class="text-sm font-medium text-muted-foreground">
          {{ 'debts.history' | transloco }}
        </h2>
        <ul class="divide-y divide-border rounded-2xl border border-border bg-card">
          @for (row of history(); track row.item.id) {
            <li>
              <button
                type="button"
                class="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                (click)="openRow(row.item)"
              >
                <span class="relative shrink-0">
                  @if (row.item.kind === 'transaction') {
                    <app-icon-badge
                      [icon]="row.item.categoryIcon"
                      [color]="row.item.categoryColor"
                      [fallback]="categoryIcon"
                    />
                  } @else {
                    <span
                      class="flex size-10 items-center justify-center rounded-full bg-muted text-foreground"
                    >
                      <ng-icon name="lucideHandCoins" size="20" aria-hidden="true" />
                    </span>
                  }
                  @if (row.wallet; as wallet) {
                    <app-icon-badge
                      class="absolute -right-1 -bottom-1 rounded-full ring-2 ring-card"
                      [icon]="wallet.icon"
                      [color]="wallet.color"
                      [fallback]="walletIcon"
                      [size]="20"
                    />
                  }
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-base font-semibold">{{ row.title }}</span>
                    @if (row.tag) {
                      <span
                        class="shrink-0 rounded-md bg-muted px-1.5 text-xs font-semibold text-muted-foreground"
                        >{{ row.tag }}</span
                      >
                    }
                  </span>
                  <span class="truncate text-sm text-muted-foreground">{{ row.sub }}</span>
                </span>
                <span
                  class="shrink-0 text-right text-base tabular-nums"
                  [class.text-income]="row.sign > 0"
                  [class.text-expense]="row.sign < 0"
                  >{{ row.amount }}</span
                >
              </button>
            </li>
          }
        </ul>
        <p class="px-1 text-sm text-muted-foreground">{{ 'debts.historyNote' | transloco }}</p>
      </div>
    } @else {
      <div class="p-4">
        <app-empty-state
          [heading]="'debts.goneHeading' | transloco"
          [description]="'debts.goneText' | transloco"
        >
          <ng-icon name="lucideHandCoins" />
        </app-empty-state>
      </div>
    }
    <app-debt-sheets />
  `,
})
export class DebtPage {
  protected debtService = inject(DebtService)
  protected recurringService = inject(RecurringService)
  private transactionService = inject(TransactionService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private pageTitleStrategy = inject(PageTitleStrategy)
  private activatedRoute = inject(ActivatedRoute)
  private router = inject(Router)

  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected walletIcon = WALLET_DEFAULT_ICON
  private params = toSignal(this.activatedRoute.paramMap, {
    initialValue: this.activatedRoute.snapshot.paramMap,
  })
  private id = computed(() => this.params().get('id') ?? '')
  protected item = computed(() => this.debtService.item(this.id()))

  private money = (minor: number) => {
    const item = this.item()
    return item
      ? formatMoney(minor, item.debt.currencyCode, item.minorUnit, this.languageService.locale())
      : ''
  }
  private t = (key: string, params?: Record<string, unknown>) =>
    this.transloco.translate(key, params)

  protected heroLabel = computed(() => {
    this.languageService.language()
    const item = this.item()
    if (!item) {
      return ''
    }
    if (item.closed) {
      return this.t('debts.closedLabel')
    }
    if (item.left < 0) {
      return this.t('debts.overpaid')
    }
    return this.t(
      item.debt.countAs === 'repaid' ? 'debts.leftRepaid' : `debts.leftOf.${item.debt.direction}`
    )
  })
  protected leftText = computed(() => {
    const item = this.item()
    return item ? this.money(item.closed ? item.total : Math.abs(item.left)) : ''
  })
  protected share = computed(() => {
    const item = this.item()
    return item && item.total > 0 ? Math.min(100, Math.round((100 * item.paid) / item.total)) : 0
  })
  protected facts = computed(() => {
    this.languageService.language()
    const item = this.item()
    if (!item) {
      return []
    }
    const { debt } = item
    const locale = this.languageService.locale()
    const today = this.transactionService.today()
    const lines: { text: string; warn: boolean }[] = [
      {
        text:
          debt.countAs === 'repaid'
            ? this.t('debts.instalmentsPaid', {
                count: item.instalments,
                paid: this.money(item.paid),
              }) + this.t('debts.ofTotal', { total: this.money(item.total) })
            : this.t(`debts.paidOf.${debt.direction}`, {
                paid: this.money(item.paid),
                total: this.money(item.total),
              }),
        warn: false,
      },
    ]
    if (item.interest > 0) {
      lines.push({
        text: this.t(`debts.interestTotal.${debt.direction}`, {
          amount: this.money(item.interest),
        }),
        warn: false,
      })
    }
    if (item.closed && item.lastOn) {
      lines.push({
        text: this.t(item.forgiven ? 'debts.closedForgiven' : 'debts.closedPaid', {
          date: shortDate(item.lastOn, locale),
        }),
        warn: false,
      })
    } else if (debt.dueOn) {
      const days = Math.round(
        (fromDay(debt.dueOn).getTime() - fromDay(today).getTime()) / 86_400_000
      )
      lines.push({
        text: this.t(item.overdue ? 'debts.overdueLine' : 'debts.dueLine', {
          date: shortDate(debt.dueOn, locale),
          days: Math.abs(days),
        }),
        warn: item.overdue,
      })
    }
    lines.push({
      text: [debt.note, this.t(`debts.countLine.${debt.countAs}`)].filter((x) => x).join(' · '),
      warn: false,
    })
    return lines
  })
  /** The debt's instalments to come (debt rule 13). */
  protected rules = computed(() => {
    this.languageService.language()
    const item = this.item()
    if (!item) {
      return []
    }
    const locale = this.languageService.locale()
    return this.debtService
      .rules(item.debt.id)
      .map((id) => this.recurringService.byId(id))
      .filter((rule) => rule !== null)
      .map((rule) => {
        const state = this.recurringService.itemOf(rule).state
        const left =
          rule.endCount !== null && rule.nextOn
            ? rule.endCount - this.recurringService.recordedCount(rule)
            : null
        return {
          id: rule.id,
          title: rule.nextOn
            ? this.t('debts.nextInstalment', { date: shortDate(rule.nextOn, locale) })
            : this.t('recurring.ended'),
          sub: [
            describeRepeat(rule, rule.startOn, this.t, locale),
            left !== null && left > 0 ? this.t('debts.instalmentsLeft', { count: left }) : '',
            state === 'paused'
              ? this.t('recurring.paused')
              : state === 'stopped'
                ? this.t('debts.ruleStopped')
                : this.t(rule.confirm ? 'recurring.ask' : 'recurring.auto'),
          ]
            .filter((part) => part)
            .join(' · '),
          amount: formatAmount(
            item.debt.direction === 'lent' ? rule.amount : -rule.amount,
            item.minorUnit,
            locale,
            true
          ),
        }
      })
  })
  protected history = computed(() => {
    this.languageService.language()
    const item = this.item()
    if (!item) {
      return []
    }
    const locale = this.languageService.locale()
    const day = (on: string) => shortDate(on, locale)
    const rows = this.debtService.history(item.debt.id)
    const settles = rows.filter((row) => row.kind === 'transaction' && row.settles).reverse()
    return rows.map((row) => {
      if (row.kind === 'entry') {
        const { entry } = row
        return {
          item: row,
          title: this.t(`debts.entry.${item.debt.direction}.${entry.kind}`),
          tag: '',
          sub: [
            day(entry.occurredOn),
            entry.walletId
              ? this.t(`debts.walletShort.${row.signed > 0 ? 'in' : 'out'}`, {
                  name: row.walletName,
                })
              : this.t(entry.kind === 'principal' ? 'debts.noCashIn' : 'debts.forgivenRest'),
            entry.note,
          ]
            .filter((part) => part)
            .join(' · '),
          sign: entry.walletId ? Math.sign(row.signed) : 0,
          amount: formatAmount(
            entry.walletId ? row.signed : entry.amount,
            item.minorUnit,
            locale,
            entry.walletId !== null
          ),
          wallet: entry.walletId ? { icon: row.walletIcon, color: row.walletColor } : null,
        }
      }
      const number = row.settles ? settles.indexOf(row) + 1 : 0
      return {
        item: row,
        title: row.categoryName,
        tag: this.t(row.type === 'income' ? 'categories.income' : 'categories.expense'),
        sub: [
          day(row.occurredOn),
          row.walletName,
          number > 0 && item.debt.countAs === 'repaid'
            ? this.t('debts.instalmentNo', { n: number })
            : '',
          row.note,
        ]
          .filter((part) => part)
          .join(' · '),
        sign: row.type === 'income' ? 1 : -1,
        amount: formatAmount(
          row.type === 'income' ? row.amount : -row.amount,
          item.minorUnit,
          locale,
          true
        ),
        wallet: { icon: row.walletIcon, color: row.walletColor },
      }
    })
  })
  protected repayLabel = computed(() => {
    const debt = this.item()?.debt
    return debt?.countAs === 'repaid' ? 'debts.payInstalment' : `debts.repay.${debt?.direction}`
  })

  constructor() {
    effect(() => {
      const person = this.item()?.debt.person ?? null
      untracked(() => this.pageTitleStrategy.setOverride(person))
    })
    inject(DestroyRef).onDestroy(() => this.pageTitleStrategy.setOverride(null))
    // A row of the Transactions tab (?entry=) or a repayment rule (?rule=) opens its sheet here.
    this.activatedRoute.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const entry = params.get('entry')
      const rule = params.get('rule')
      if (entry) {
        this.debtService.openEntry({ mode: 'edit', id: entry })
      } else if (rule) {
        this.debtService.openEntry({ mode: 'rule', id: rule })
      }
      if (entry || rule) {
        void this.router.navigate([], { queryParams: {}, replaceUrl: true })
      }
    })
  }

  protected repay(): void {
    const item = this.item()
    if (!item) {
      return
    }
    if (item.debt.countAs !== 'repaid') {
      this.debtService.openEntry({ mode: 'create', debtId: item.debt.id, kind: 'repayment' })
      return
    }
    // An instalment is an ordinary expense in the debt's category (debt rule 3).
    const rule = this.debtService
      .rules(item.debt.id)
      .map((id) => this.recurringService.byId(id))
      .find((found) => found !== null)
    this.transactionService.open({
      mode: 'create',
      type: 'expense',
      values: {
        walletId: rule?.walletId ?? this.transactionService.defaultWalletId() ?? '',
        categoryId: item.debt.categoryId ?? '',
        amount: rule?.amount ?? Math.max(0, item.left),
        occurredOn: this.transactionService.today(),
        note: '',
        excludeFromReport: false,
        debtId: item.debt.id,
      },
    })
  }

  protected more(): void {
    const item = this.item()
    if (item) {
      this.debtService.openEntry({ mode: 'create', debtId: item.debt.id, kind: 'principal' })
    }
  }

  protected openRow(row: DebtHistoryItem): void {
    if (row.kind === 'entry') {
      this.debtService.openEntry({ mode: 'edit', id: row.id })
    } else {
      this.transactionService.open({ mode: 'edit', id: row.id })
    }
  }
}
