import { Component, computed, inject, model } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowLeftRight, lucideCheck, lucideHandCoins } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { CATEGORY_DEFAULT_ICON } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { RecurringService, ruleTitle, shortDate } from '@/core/recurring'
import type { Occurrence } from '@/core/recurring'
import { TransactionService, TransferService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import { formatAmount, fromDay } from '@/shared/utils'

/**
 * "ถึงกำหนด" (docs/features/recurring.md rule 10, mock-up frame 10): the due occurrences of
 * ask-first rules, oldest first, each with "บันทึก" (as the rule says, on its day) and "ข้าม";
 * a tap on one opens the form filled from its rule, so this month's bill can be typed first.
 */
@Component({
  selector: 'app-due-sheet',
  imports: [TranslocoPipe, NgIcon, HlmButton, HlmDrawerImports, IconBadge, SheetFrame],
  providers: [provideIcons({ lucideArrowLeftRight, lucideCheck, lucideHandCoins })],
  template: `
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        <app-sheet-frame
          [title]="'recurring.dueHeading' | transloco"
          [leadingLabel]="'sheet.close' | transloco"
          (leading)="open.set(false)"
        >
          <ul class="divide-y divide-border rounded-xl border border-border bg-card">
            @for (row of rows(); track row.occurrence.id) {
              <li class="flex flex-col gap-2 py-2.5">
                <button
                  type="button"
                  class="flex min-h-12 w-full items-center gap-3 px-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                  (click)="edit(row.occurrence)"
                >
                  <span class="relative shrink-0">
                    @if (row.occurrence.item.rule.kind !== 'transaction') {
                      <span
                        class="flex size-10 items-center justify-center rounded-full bg-muted text-foreground"
                      >
                        <ng-icon
                          [name]="
                            row.occurrence.item.rule.kind === 'debt'
                              ? 'lucideHandCoins'
                              : 'lucideArrowLeftRight'
                          "
                          size="20"
                          aria-hidden="true"
                        />
                      </span>
                    } @else {
                      <app-icon-badge
                        [icon]="row.occurrence.item.icon"
                        [color]="row.occurrence.item.color"
                        [fallback]="categoryIcon"
                      />
                    }
                    <app-icon-badge
                      class="absolute -right-1 -bottom-1 rounded-full ring-2 ring-card"
                      [icon]="row.occurrence.item.walletIcon"
                      [color]="row.occurrence.item.walletColor"
                      [fallback]="walletIcon"
                      [size]="20"
                    />
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-base font-semibold">{{ row.title }}</span>
                    <span class="truncate text-sm text-muted-foreground">{{ row.sub }}</span>
                  </span>
                  <span
                    class="shrink-0 text-base tabular-nums"
                    [class.text-income]="row.occurrence.item.sign > 0"
                    [class.text-expense]="row.occurrence.item.sign < 0"
                  >
                    {{ row.amount }}
                  </span>
                </button>
                <div class="flex gap-2 pr-4 pl-17">
                  <button
                    hlmBtn
                    type="button"
                    class="h-9 bg-brand/10 px-3 text-sm text-brand hover:bg-brand/15"
                    [disabled]="!recurringService.canWrite()"
                    (click)="confirm(row.occurrence)"
                  >
                    <ng-icon name="lucideCheck" size="16" aria-hidden="true" />
                    {{ 'recurring.confirm' | transloco }}
                  </button>
                  <button
                    hlmBtn
                    variant="outline"
                    type="button"
                    class="h-9 px-3 text-sm"
                    [disabled]="!recurringService.canWrite()"
                    (click)="skip(row.occurrence)"
                  >
                    {{ 'recurring.skip' | transloco }}
                  </button>
                </div>
              </li>
            }
          </ul>
          <p class="text-sm text-muted-foreground">{{ 'recurring.dueHint' | transloco }}</p>
          @if (rows().length > 1) {
            <div sheetFooter class="pt-3">
              <button
                hlmBtn
                type="button"
                class="h-11 w-full text-base"
                [disabled]="!recurringService.canWrite()"
                (click)="confirmAll()"
              >
                {{ 'recurring.confirmAll' | transloco: { count: rows().length } }}
              </button>
            </div>
          }
        </app-sheet-frame>
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class DueSheet {
  protected recurringService = inject(RecurringService)
  private transactionService = inject(TransactionService)
  private transferService = inject(TransferService)
  private walletService = inject(WalletService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)

  open = model(false)
  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected walletIcon = WALLET_DEFAULT_ICON

  protected rows = computed(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const day = new Intl.DateTimeFormat(locale, { weekday: 'short' })
    return this.recurringService.due().map((occurrence) => {
      const { item } = occurrence
      const minorUnit = this.walletService.minorUnit(item.currencyCode)
      return {
        occurrence,
        title: ruleTitle(item, (key, params) => this.transloco.translate(key, params), true),
        sub: [
          `${day.format(fromDay(occurrence.on))} ${shortDate(occurrence.on, locale)}`,
          item.walletName,
          item.rule.note,
        ]
          .filter((part) => part)
          .join(' · '),
        amount: formatAmount(item.sign * item.rule.amount, minorUnit, locale, true),
      }
    })
  })

  protected confirm(occurrence: Occurrence): void {
    this.recurringService.confirm(occurrence.item.rule.id, occurrence.on)
    toast.success(this.transloco.translate('recurring.confirmed'))
    this.closeWhenDone()
  }

  protected skip(occurrence: Occurrence): void {
    this.recurringService.skip(occurrence.item.rule.id, occurrence.on)
    toast(this.transloco.translate('recurring.skipped'))
    this.closeWhenDone()
  }

  protected confirmAll(): void {
    const count = this.recurringService.confirmAll()
    toast.success(this.transloco.translate('recurring.allConfirmed', { count }))
    this.open.set(false)
  }

  /** The form, filled from the rule; saving it records this occurrence (rule 10). */
  protected edit(occurrence: Occurrence): void {
    const { rule } = occurrence.item
    const target = { ruleId: rule.id, on: occurrence.on }
    this.open.set(false)
    if (rule.kind === 'debt') {
      // A debt's repayment is recorded as the rule says, from its debt's page (debt rule 13).
      this.recurringService.open(rule.id)
      return
    }
    if (rule.kind === 'transfer') {
      this.transferService.open({
        mode: 'create',
        occurrence: target,
        values: {
          fromWalletId: rule.walletId,
          toWalletId: rule.toWalletId ?? '',
          amount: rule.amount,
          occurredOn: occurrence.on,
          note: rule.note,
        },
      })
      return
    }
    this.transactionService.open({
      mode: 'create',
      occurrence: target,
      type: occurrence.item.sign > 0 ? 'income' : 'expense',
      values: {
        walletId: rule.walletId,
        categoryId: rule.categoryId ?? '',
        amount: rule.amount,
        occurredOn: occurrence.on,
        note: rule.note,
        excludeFromReport: rule.excludeFromReport,
      },
    })
  }

  private closeWhenDone(): void {
    if (this.recurringService.due().length === 0) {
      this.open.set(false)
    }
  }
}
