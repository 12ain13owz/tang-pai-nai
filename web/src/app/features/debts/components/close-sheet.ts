import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronRight, lucideWallet } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import { DebtService } from '@/core/debt'
import { LanguageService } from '@/core/i18n'
import { TransactionService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import { addDays, formatMoney } from '@/shared/utils'
import { DebtCategoryPick } from './category-pick'
import { DebtDateRow } from './date-row'
import { DebtWalletPick } from './wallet-pick'

type View = 'form' | 'wallet' | 'category'

/**
 * "ปิดหนี้" with something left (debt rule 4, mock-up frame 9): pay (or get) back the rest into a
 * wallet, or forgive it: counted once now (an expense of a lent debt, an income of a borrowed one
 * counted when spent) in a category; a `repaid` debt's rest goes uncounted.
 */
@Component({
  selector: 'app-debt-close-sheet',
  imports: [
    TranslocoPipe,
    NgIcon,
    HlmButton,
    HlmDrawerImports,
    IconBadge,
    SheetFrame,
    DebtCategoryPick,
    DebtDateRow,
    DebtWalletPick,
  ],
  providers: [provideIcons({ lucideChevronRight, lucideWallet })],
  template: `
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="debtService.closeSheet.set(null)">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        @switch (view()) {
          @case ('form') {
            <app-sheet-frame
              [title]="'debts.close' | transloco"
              [leadingLabel]="'sheet.close' | transloco"
              (leading)="debtService.closeSheet.set(null)"
            >
              @if (item(); as current) {
                <div class="flex flex-col gap-4">
                  <p class="px-1 text-base">
                    {{
                      'debts.closeLeft.' + current.debt.direction
                        | transloco: { name: current.debt.person, amount: leftText() }
                    }}
                  </p>
                  <div
                    class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                    role="radiogroup"
                    [attr.aria-label]="'debts.close' | transloco"
                  >
                    @for (option of options; track option) {
                      <button
                        type="button"
                        role="radio"
                        class="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        [attr.aria-checked]="how() === option"
                        (click)="how.set(option)"
                      >
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span class="text-base">{{
                            'debts.closeHow.' + option + '.' + current.debt.direction | transloco
                          }}</span>
                          <span class="text-sm text-muted-foreground">{{ hintOf(option) }}</span>
                        </span>
                        <span
                          class="size-5 shrink-0 rounded-full border-2 border-border"
                          [class.border-6]="how() === option"
                          [class.border-brand]="how() === option"
                          aria-hidden="true"
                        ></span>
                      </button>
                    }
                  </div>
                  <div
                    class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                  >
                    @if (how() === 'rest') {
                      <button
                        type="button"
                        class="flex min-h-15 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        (click)="view.set('wallet')"
                      >
                        <span class="flex w-10 shrink-0 justify-center">
                          @if (wallet(); as w) {
                            <app-icon-badge
                              [icon]="w.icon"
                              [color]="w.color"
                              [fallback]="walletIcon"
                              [size]="32"
                            />
                          } @else {
                            <ng-icon
                              name="lucideWallet"
                              size="22"
                              class="text-muted-foreground"
                              aria-hidden="true"
                            />
                          }
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span class="text-xs text-muted-foreground">{{
                            'debts.walletOf.' + current.debt.direction + '.repayment' | transloco
                          }}</span>
                          <span class="truncate text-base">{{ wallet()?.name ?? '' }}</span>
                        </span>
                        <ng-icon
                          name="lucideChevronRight"
                          size="20"
                          class="text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    } @else if (counts()) {
                      <button
                        type="button"
                        class="flex min-h-15 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        (click)="view.set('category')"
                      >
                        <span class="flex w-10 shrink-0 justify-center">
                          <app-icon-badge
                            [icon]="category()?.icon ?? ''"
                            [color]="category()?.color ?? ''"
                            [fallback]="categoryIcon"
                            [size]="32"
                          />
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span class="text-xs text-muted-foreground">{{
                            (current.debt.direction === 'lent'
                              ? 'debts.forgiveExpense'
                              : 'debts.forgiveIncome'
                            ) | transloco
                          }}</span>
                          <span
                            class="truncate text-base"
                            [class.text-muted-foreground]="!category()"
                            >{{ category()?.name ?? ('debts.pickCategory' | transloco) }}</span
                          >
                        </span>
                        <ng-icon
                          name="lucideChevronRight"
                          size="20"
                          class="text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    }
                    <app-debt-date-row [control]="day" [value]="dayValue()" [max]="lastDay()" />
                  </div>
                  @if (missing()) {
                    <p role="alert" class="-mt-2 px-1 text-sm text-destructive">
                      {{
                        (how() === 'rest' ? 'debts.walletRequired' : 'debts.categoryRequired')
                          | transloco
                      }}
                    </p>
                  }
                  <p class="px-1 text-sm text-muted-foreground">
                    {{ 'debts.closeNote' | transloco }}
                  </p>
                </div>
              }
              <div sheetFooter class="pt-3">
                <button
                  hlmBtn
                  type="button"
                  class="h-11 w-full text-base"
                  [disabled]="!debtService.canWrite()"
                  (click)="confirm()"
                >
                  {{ 'debts.close' | transloco }}
                </button>
              </div>
            </app-sheet-frame>
          }
          @case ('wallet') {
            <app-sheet-frame
              [title]="'debts.walletOf.' + item()?.debt?.direction + '.repayment' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <app-debt-wallet-pick
                [wallets]="walletChoices()"
                [chosen]="walletId()"
                (picked)="walletId.set($event); view.set('form')"
              />
            </app-sheet-frame>
          }
          @case ('category') {
            <app-sheet-frame
              [title]="'debts.pickCategory' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <app-debt-category-pick
                [profileId]="item()?.debt?.profileId ?? ''"
                [type]="item()?.debt?.direction === 'lent' ? 'expense' : 'income'"
                [chosen]="categoryId()"
                (picked)="categoryId.set($event); view.set('form')"
              />
            </app-sheet-frame>
          }
        }
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class DebtCloseSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private languageService = inject(LanguageService)
  protected debtService = inject(DebtService)
  private walletService = inject(WalletService)
  private categoryService = inject(CategoryService)
  private transactionService = inject(TransactionService)

  protected walletIcon = WALLET_DEFAULT_ICON
  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected readonly options = ['rest', 'forgive'] as const
  protected view = signal<View>('form')
  protected how = signal<'rest' | 'forgive'>('rest')
  protected walletId = signal<string | null>(null)
  protected categoryId = signal<string | null>(null)
  protected missing = signal(false)
  protected day = this.nnfb.control('')
  private dayValues = toSignal(this.day.valueChanges, { initialValue: '' })
  protected dayValue = computed(() => this.dayValues() || this.transactionService.today())
  protected lastDay = computed(() => addDays(this.transactionService.today(), 365))

  protected open = computed(() => this.debtService.closeSheet() !== null)
  protected item = computed(() => {
    const id = this.debtService.closeSheet()
    return id ? this.debtService.item(id) : null
  })
  /** A forgiven rest counts once now, except a `repaid` debt's (never counted, debt rule 4). */
  protected counts = computed(() => this.item()?.debt.countAs === 'spent')
  protected wallet = computed(() => {
    const id = this.walletId()
    return id ? this.walletService.byId(id) : null
  })
  protected category = computed(() => {
    const id = this.categoryId()
    return id ? this.categoryService.byId(id) : null
  })
  protected walletChoices = computed(() => {
    const debt = this.item()?.debt
    return debt
      ? this.walletService
          .openOf(debt.profileId)
          .filter((wallet) => wallet.currencyCode === debt.currencyCode)
      : []
  })
  protected leftText = computed(() => {
    const item = this.item()
    return item
      ? formatMoney(
          item.left,
          item.debt.currencyCode,
          item.minorUnit,
          this.languageService.locale()
        )
      : ''
  })

  constructor() {
    effect(() => {
      const id = this.debtService.closeSheet()
      untracked(() => {
        if (!id) {
          return
        }
        this.view.set('form')
        this.how.set('rest')
        this.missing.set(false)
        this.categoryId.set(null)
        this.walletId.set(this.walletChoices().at(0)?.id ?? null)
        this.day.reset(this.transactionService.today())
      })
    })
  }

  protected hintOf(option: 'rest' | 'forgive'): string {
    this.languageService.language()
    const item = this.item()
    if (!item) {
      return ''
    }
    const amount = this.leftText()
    if (option === 'rest') {
      return this.transloco.translate(`debts.closeHint.rest.${item.debt.direction}`, { amount })
    }
    return this.transloco.translate(
      item.debt.countAs === 'repaid'
        ? 'debts.closeHint.forgiveRepaid'
        : `debts.closeHint.forgive.${item.debt.direction}`,
      { amount }
    )
  }

  protected confirm(): void {
    const item = this.item()
    if (!item || !this.debtService.canWrite()) {
      return
    }
    const how = this.how()
    const walletId = this.walletId()
    const categoryId = this.categoryId()
    if ((how === 'rest' && !walletId) || (how === 'forgive' && this.counts() && !categoryId)) {
      this.missing.set(true)
      return
    }
    this.debtService.close(
      item.debt.id,
      how === 'rest' ? { kind: 'rest', walletId: walletId ?? '' } : { kind: 'forgive', categoryId },
      this.dayValue()
    )
    toast.success(this.transloco.translate('debts.closed'))
    this.debtService.closeSheet.set(null)
  }
}
