import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideChevronRight,
  lucideHandCoins,
  lucidePause,
  lucidePercent,
  lucidePlay,
  lucideTextAlignStart,
  lucideTrash2,
  lucideWallet,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import { DEBT_LIMITS, DebtService, toEntry } from '@/core/debt'
import type { Debt, EntrySheetState } from '@/core/debt'
import { LanguageService } from '@/core/i18n'
import { describeRepeat, describeRest, RecurringService, shortDate } from '@/core/recurring'
import {
  QUICK_AMOUNTS,
  QuickAmountsService,
  TRANSACTION_LIMITS,
  TransactionService,
} from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import type { Wallet } from '@/core/wallet'
import { walletPickItems } from '@/features/debts/debt-view'
import { DateRow } from '@/shared/components/date-row'
import { CalcAmountField, CalcKeypad, FORM_IMPORTS, TextareaField } from '@/shared/components/form'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import { Slide } from '@/shared/components/slide'
import { WalletPick } from '@/shared/components/wallet-pick'
import {
  addDays,
  addQuickAmount,
  CALC_KEYBOARD,
  evaluate,
  formatMoney,
  parseMajor,
  pressKey,
  toMajorText,
} from '@/shared/utils'
import type { CalcKey } from '@/shared/utils'
import { DebtCategoryPick } from './category-pick'

type View = 'form' | 'wallet' | 'category' | 'note'

/**
 * A debt's money that isn't income or expense (debt rule 3; mock-up frame 6): repay / receive
 * back, or borrow / lend more. Amount (keypad, and "ทั้งหมด" = what is left), wallet, note, date;
 * a repayment of a debt counted when spent may carry interest, a counted transaction (Q5). Also
 * edits an entry (delete with undo), fixes a refused one, and edits a repayment rule (debt rule
 * 13: amount, wallet, note; pause and delete in the header).
 */
@Component({
  selector: 'app-debt-entry-sheet',
  imports: [
    FORM_IMPORTS,
    ReactiveFormsModule,
    TranslocoPipe,
    NgIcon,
    HlmButton,
    HlmDrawerImports,
    CalcAmountField,
    CalcKeypad,
    TextareaField,
    IconBadge,
    SheetFrame,
    Slide,
    DebtCategoryPick,
    DateRow,
    WalletPick,
  ],
  providers: [
    provideIcons({
      lucideChevronRight,
      lucideHandCoins,
      lucidePause,
      lucidePercent,
      lucidePlay,
      lucideTextAlignStart,
      lucideTrash2,
      lucideWallet,
    }),
  ],
  template: `
    @let f = form.controls;
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="finish()">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] overflow-x-clip data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
        (keydown)="onKey($event)"
      >
        <div class="flex min-h-0 flex-1 flex-col" [appSlide]="depth()">
          @switch (view()) {
            @case ('form') {
              <form [formGroup]="form" class="flex min-h-0 flex-1 flex-col" (ngSubmit)="save()">
                <app-sheet-frame
                  [title]="heading()"
                  [leadingLabel]="'sheet.close' | transloco"
                  (leading)="finish()"
                >
                  @if (rule(); as current) {
                    <div sheetActions class="flex">
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        type="button"
                        class="tpn-hit size-9"
                        [disabled]="!debtService.canWrite()"
                        [attr.aria-label]="
                          (current.isPaused ? 'recurring.resume' : 'recurring.pause') | transloco
                        "
                        (click)="togglePause()"
                      >
                        <ng-icon
                          [name]="current.isPaused ? 'lucidePlay' : 'lucidePause'"
                          size="18"
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        type="button"
                        class="tpn-hit size-9 text-destructive"
                        [disabled]="!debtService.canWrite()"
                        [attr.aria-label]="'recurring.delete' | transloco"
                        (click)="remove()"
                      >
                        <ng-icon name="lucideTrash2" size="18" aria-hidden="true" />
                      </button>
                    </div>
                  } @else if (state()?.mode === 'edit') {
                    <div sheetActions class="flex">
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        type="button"
                        class="tpn-hit size-9 text-destructive"
                        [disabled]="!debtService.canWrite()"
                        [attr.aria-label]="'debts.deleteEntry' | transloco"
                        (click)="remove()"
                      >
                        <ng-icon name="lucideTrash2" size="18" aria-hidden="true" />
                      </button>
                    </div>
                  }
                  <div
                    class="flex flex-col gap-4"
                    (pointerdown)="leaveAmount($event)"
                    (focusin)="leaveAmount($event)"
                  >
                    @if (!debtService.canWrite()) {
                      <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {{
                          (debtService.serverDown() ? 'sync.serverDownWrite' : 'debts.needsOnline')
                            | transloco
                        }}
                      </p>
                    }
                    <div
                      class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                    >
                      @if (debt(); as d) {
                        <div class="flex min-h-14 items-center gap-3 px-4 py-2">
                          <span
                            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
                          >
                            <ng-icon name="lucideHandCoins" size="20" aria-hidden="true" />
                          </span>
                          <span class="flex min-w-0 flex-1 flex-col">
                            <span class="text-xs text-muted-foreground">{{
                              'debts.person.' + d.direction | transloco
                            }}</span>
                            <span class="truncate text-base">{{ d.person }}</span>
                          </span>
                          @if (leftText(); as left) {
                            <span class="shrink-0 text-sm text-muted-foreground tabular-nums">{{
                              'debts.leftShort' | transloco: { amount: left }
                            }}</span>
                          }
                        </div>
                      }
                      <div class="px-4">
                        <app-calc-amount-field
                          [control]="f.amount"
                          [label]="'transactions.amount' | transloco"
                          [currencyCode]="debt()?.currencyCode ?? ''"
                          [minorUnit]="minorUnit()"
                          [locale]="languageService.locale()"
                          [active]="keypad()"
                          (activate)="keypad.set(true)"
                        />
                      </div>
                      @if (needsWallet()) {
                        <button
                          type="button"
                          class="flex min-h-15 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          (click)="pick('wallet')"
                        >
                          <span class="flex w-10 shrink-0 justify-center">
                            @if (wallet(); as item) {
                              <app-icon-badge
                                [icon]="item.icon"
                                [color]="item.color"
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
                            <span class="text-xs text-muted-foreground">{{ walletLabel() }}</span>
                            <span class="truncate text-base">{{ wallet()?.name ?? '' }}</span>
                          </span>
                          @if (wallet(); as item) {
                            <span class="shrink-0 text-sm text-muted-foreground tabular-nums">{{
                              balanceText(item)
                            }}</span>
                          }
                          <ng-icon
                            name="lucideChevronRight"
                            size="20"
                            class="text-muted-foreground"
                            aria-hidden="true"
                          />
                        </button>
                        @if (f.walletId.touched && f.walletId.invalid) {
                          <p role="alert" class="px-4 pb-2 pl-17 text-sm text-destructive">
                            {{ 'debts.walletRequired' | transloco }}
                          </p>
                        }
                      }
                      <button
                        type="button"
                        class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        [attr.aria-label]="('transactions.note' | transloco) + ' ' + note()"
                        (click)="pick('note')"
                      >
                        <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                          <ng-icon name="lucideTextAlignStart" size="22" aria-hidden="true" />
                        </span>
                        <span
                          class="min-w-0 flex-1 truncate text-base"
                          [class.text-muted-foreground]="!note()"
                        >
                          {{ note() || ('transactions.note' | transloco) }}
                        </span>
                        <ng-icon
                          name="lucideChevronRight"
                          size="20"
                          class="text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                      @if (!rule()) {
                        <app-date-row
                          [today]="transactionService.today()"
                          [locale]="languageService.locale()"
                          [control]="f.occurredOn"
                          [value]="values().occurredOn ?? ''"
                          [max]="lastDay()"
                        />
                      }
                    </div>
                    @if (allText(); as all) {
                      <button
                        hlmBtn
                        variant="outline"
                        type="button"
                        class="-mt-1 h-10 self-start rounded-full bg-brand/10 px-4 text-brand"
                        (click)="setAll()"
                      >
                        {{ 'debts.all' | transloco: { amount: all } }}
                      </button>
                    }
                    @if (interestAllowed()) {
                      <!-- Interest or a fee: a counted transaction linked to the debt (Q5). -->
                      <div
                        class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                      >
                        <label class="flex min-h-14 items-center gap-3 px-4 py-2">
                          <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                            <ng-icon name="lucidePercent" size="22" aria-hidden="true" />
                          </span>
                          <span class="flex min-w-0 flex-1 flex-col">
                            <span class="text-base">{{
                              'debts.interest.' + debt()!.direction | transloco
                            }}</span>
                            <span class="text-xs text-muted-foreground">{{
                              'debts.interestHint.' + debt()!.direction | transloco
                            }}</span>
                          </span>
                          <input
                            class="w-28 rounded-md border border-input bg-transparent px-2 py-1.5 text-right text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            inputmode="decimal"
                            placeholder="0.00"
                            [formControl]="interestAmount"
                            [attr.aria-label]="'debts.interest.' + debt()!.direction | transloco"
                          />
                        </label>
                        @if (interestValue() > 0) {
                          <button
                            type="button"
                            class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                            (click)="pick('category')"
                          >
                            <span class="flex w-10 shrink-0 justify-center">
                              <app-icon-badge
                                [icon]="interestCategory()?.icon ?? ''"
                                [color]="interestCategory()?.color ?? ''"
                                [fallback]="categoryIcon"
                                [size]="32"
                              />
                            </span>
                            <span
                              class="min-w-0 flex-1 truncate text-base"
                              [class.text-muted-foreground]="!interestCategory()"
                              >{{
                                interestCategory()?.name ?? ('debts.interestCategory' | transloco)
                              }}</span
                            >
                            <ng-icon
                              name="lucideChevronRight"
                              size="20"
                              class="text-muted-foreground"
                              aria-hidden="true"
                            />
                          </button>
                          @if (interestMissing()) {
                            <p role="alert" class="px-4 pb-2 pl-17 text-sm text-destructive">
                              {{ 'debts.categoryRequired' | transloco }}
                            </p>
                          }
                        }
                      </div>
                    }
                    @if (hint(); as text) {
                      <p class="-mt-1 px-1 text-sm text-muted-foreground">{{ text }}</p>
                    }
                  </div>
                  <div sheetFooter class="relative flex flex-col pt-3">
                    <!-- Under the keypad while it shows: ✓ first, then save (one action at a time). -->
                    <div class="flex" [attr.inert]="keypad() ? '' : null">
                      <button
                        hlmBtn
                        type="submit"
                        class="h-11 min-w-0 flex-1 text-base"
                        [disabled]="!debtService.canWrite()"
                      >
                        {{ 'transactions.save' | transloco }}
                      </button>
                    </div>
                    @if (keypad()) {
                      <app-calc-keypad
                        class="absolute -inset-x-4 -bottom-4 z-10 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                        [quickAmounts]="quickAmounts()"
                        [locale]="languageService.locale()"
                        (pressed)="press($event)"
                        (quickPressed)="addQuick($event)"
                      />
                    }
                  </div>
                </app-sheet-frame>
              </form>
            }
            @case ('wallet') {
              <app-sheet-frame
                [title]="walletLabel()"
                leadingIcon="back"
                [leadingLabel]="'sheet.back' | transloco"
                (leading)="view.set('form')"
              >
                <app-wallet-pick
                  [wallets]="walletItems()"
                  [empty]="'debts.noWallet' | transloco"
                  [chosen]="f.walletId.value"
                  (picked)="chooseWallet($event)"
                />
              </app-sheet-frame>
            }
            @case ('category') {
              <app-sheet-frame
                [title]="'debts.interestCategory' | transloco"
                leadingIcon="back"
                [leadingLabel]="'sheet.back' | transloco"
                (leading)="view.set('form')"
              >
                <app-debt-category-pick
                  [profileId]="debt()?.profileId ?? ''"
                  [type]="debt()?.direction === 'lent' ? 'income' : 'expense'"
                  [chosen]="interestCategoryId()"
                  (picked)="interestCategoryId.set($event); view.set('form')"
                />
              </app-sheet-frame>
            }
            @case ('note') {
              <app-sheet-frame
                [title]="'transactions.note' | transloco"
                leadingIcon="back"
                [leadingLabel]="'sheet.back' | transloco"
                (leading)="view.set('form')"
              >
                <app-textarea-field
                  [control]="f.note"
                  [label]="'transactions.note' | transloco"
                  [hideLabel]="true"
                  [rows]="10"
                  [maxLength]="noteMax"
                  [hint]="note().length + ' / ' + noteMax"
                />
              </app-sheet-frame>
            }
          }
        </div>
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class DebtEntrySheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  protected languageService = inject(LanguageService)
  protected debtService = inject(DebtService)
  private walletService = inject(WalletService)
  private categoryService = inject(CategoryService)
  protected transactionService = inject(TransactionService)
  private recurringService = inject(RecurringService)
  private quickAmountsService = inject(QuickAmountsService)

  protected walletIcon = WALLET_DEFAULT_ICON
  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected noteMax = DEBT_LIMITS.NOTE_MAX
  protected state = this.debtService.entrySheet
  protected view = signal<View>('form')
  /** How deep the view is: a deeper one slides in from the right, going back from the left. */
  protected depth = computed(() => (this.view() === 'form' ? 0 : 1))
  protected keypad = signal(false)
  protected open = signal(false)
  protected interestCategoryId = signal<string | null>(null)
  protected quickAmounts = computed(() => (this.quickAmountsService.enabled() ? QUICK_AMOUNTS : []))

  /** The debt the sheet's row belongs to (also a rule's or a refused entry's). */
  private debtId = signal<string | null>(null)
  protected debt = computed<Debt | null>(() => {
    const id = this.debtId()
    return id ? this.debtService.byId(id) : null
  })
  protected minorUnit = computed(() =>
    this.walletService.minorUnit(this.debt()?.currencyCode ?? '')
  )
  private amountValid: ValidatorFn = (control) => {
    if (typeof control.value !== 'string') {
      return null
    }
    const result = evaluate(control.value, this.minorUnit())
    if (!result.ok) {
      return { amountFormat: 'transactions.amountFormat' }
    }
    if (result.minor <= 0) {
      return { amountRequired: 'transactions.amountRequired' }
    }
    return result.minor > TRANSACTION_LIMITS.AMOUNT_MAX
      ? { amountTooBig: 'transactions.amountTooBig' }
      : null
  }
  /** Validators run while the form is built: `needsWallet` (made after it) reads the kind here. */
  private walletValid: ValidatorFn = (control) => {
    const kind: unknown = control.parent?.get('kind')?.value
    const noWallet = this.debt()?.countAs === 'repaid' && kind === 'principal'
    return noWallet || control.value ? null : { required: true }
  }

  form = this.nnfb.group({
    kind: this.nnfb.control<'principal' | 'repayment'>('repayment'),
    amount: ['', [this.amountValid]],
    walletId: ['', [this.walletValid]],
    note: ['', [Validators.maxLength(DEBT_LIMITS.NOTE_MAX)]],
    occurredOn: [''],
  })
  protected interestAmount = this.nnfb.control('')
  private interestValues = toSignal(this.interestAmount.valueChanges, { initialValue: '' })
  protected values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() })

  protected rule = computed(() => {
    const state = this.state()
    return state?.mode === 'rule' ? this.recurringService.byId(state.id) : null
  })
  private kind = computed(() => this.values().kind ?? 'repayment')
  /** A `repaid` debt borrows more without a wallet (nothing comes in, debt rule 3). */
  protected needsWallet = computed(
    () => !(this.debt()?.countAs === 'repaid' && this.kind() === 'principal')
  )
  protected note = computed(() => (this.values().note ?? '').trim())
  protected wallet = computed<Wallet | null>(() => {
    const id = this.values().walletId ?? ''
    return id ? this.walletService.byId(id) : null
  })
  protected walletChoices = computed(() => {
    const debt = this.debt()
    return debt
      ? this.walletService
          .openOf(debt.profileId)
          .filter((wallet) => wallet.currencyCode === debt.currencyCode)
      : []
  })
  protected walletItems = computed(() =>
    walletPickItems(
      this.walletChoices(),
      this.walletService,
      this.languageService.locale(),
      (key) => this.transloco.translate(key)
    )
  )
  protected lastDay = computed(() => addDays(this.transactionService.today(), 365))
  protected interestValue = computed(() => {
    const parsed = parseMajor(this.interestValues() || '0', this.minorUnit())
    return parsed.ok ? parsed.minor : 0
  })
  protected interestCategory = computed(() => {
    const id = this.interestCategoryId()
    return id ? this.categoryService.byId(id) : null
  })
  protected interestMissing = signal(false)
  protected interestAllowed = computed(() => {
    const state = this.state()
    return (
      state?.mode === 'create' && this.kind() === 'repayment' && this.debt()?.countAs === 'spent'
    )
  })
  protected heading = computed(() => {
    this.languageService.language()
    const state = this.state()
    const debt = this.debt()
    if (state?.mode === 'rule') {
      return this.t('recurring.editHeading')
    }
    if (state?.mode === 'edit' || state?.mode === 'fix') {
      return this.t(state.mode === 'fix' ? 'debts.fixEntry' : 'debts.editEntry')
    }
    return this.t(`debts.sheet.${debt?.direction ?? 'borrowed'}.${this.kind()}`)
  })
  protected walletLabel = computed(() => {
    this.languageService.language()
    return this.t(`debts.walletOf.${this.debt()?.direction ?? 'borrowed'}.${this.kind()}`)
  })
  private left = computed(() => {
    const debt = this.debt()
    return debt ? (this.debtService.item(debt.id)?.left ?? 0) : 0
  })
  protected leftText = computed(() => {
    const debt = this.debt()
    const left = this.left()
    return debt && left > 0
      ? formatMoney(left, debt.currencyCode, this.minorUnit(), this.languageService.locale())
      : null
  })
  /** "ทั้งหมด x": pay (or get) back what is left (mock-up frame 6). */
  protected allText = computed(() =>
    this.state()?.mode === 'create' && this.kind() === 'repayment' ? this.leftText() : null
  )
  protected hint = computed(() => {
    this.languageService.language()
    const rule = this.rule()
    const locale = this.languageService.locale()
    if (rule) {
      return [
        describeRepeat(rule, rule.startOn, this.t, locale),
        describeRest(rule, this.t, locale),
        rule.nextOn
          ? this.t('recurring.nextLine', { date: shortDate(rule.nextOn, locale) })
          : this.t('recurring.ended'),
      ].join(' · ')
    }
    return this.state()?.mode === 'create' ? this.t('debts.notCounted') : null
  })
  private t = (key: string, params?: Record<string, unknown>) =>
    this.transloco.translate(key, params)

  constructor() {
    effect(() => {
      const state = this.state()
      untracked(() => {
        if (state) {
          this.start(state)
        }
        this.open.set(state !== null)
      })
    })
  }

  protected balanceText(wallet: Wallet): string {
    return formatMoney(
      this.walletService.balance(wallet),
      wallet.currencyCode,
      this.walletService.minorUnit(wallet.currencyCode),
      this.languageService.locale()
    )
  }

  protected setAll(): void {
    const left = this.left()
    if (left > 0) {
      this.form.controls.amount.setValue(toMajorText(left, this.minorUnit()).replace(/,/g, ''))
      this.form.controls.amount.markAsDirty()
      this.keypad.set(false)
    }
  }

  protected togglePause(): void {
    const rule = this.rule()
    if (!rule) {
      return
    }
    this.recurringService.setPaused(rule.id, !rule.isPaused)
    toast.success(this.t(rule.isPaused ? 'recurring.resumed' : 'recurring.paused2'))
  }

  protected leaveAmount(event: Event): void {
    const target = event.target
    if (
      !this.keypad() ||
      !(target instanceof Element) ||
      target.closest('app-calc-amount-field') ||
      !target.closest('button, input, label, textarea, select')
    ) {
      return
    }
    this.settleAmount()
    this.keypad.set(false)
  }

  protected pick(view: 'wallet' | 'category' | 'note'): void {
    this.settleAmount()
    this.keypad.set(false)
    this.view.set(view)
  }

  protected chooseWallet(id: string): void {
    this.form.controls.walletId.setValue(id)
    this.form.controls.walletId.markAsDirty()
    this.view.set('form')
  }

  protected press(key: CalcKey | '='): void {
    const control = this.form.controls.amount
    if (key === '=') {
      this.settleAmount()
      this.keypad.set(false)
      return
    }
    control.setValue(pressKey(control.value, key, this.minorUnit()))
    control.markAsDirty()
  }

  protected addQuick(major: number): void {
    const control = this.form.controls.amount
    control.setValue(addQuickAmount(control.value, major, this.minorUnit()))
    control.markAsDirty()
  }

  protected onKey(event: KeyboardEvent): void {
    if (!this.keypad() || this.view() !== 'form' || event.target instanceof HTMLInputElement) {
      return
    }
    const key = /^\d$/.test(event.key) ? (event.key as CalcKey) : CALC_KEYBOARD[event.key]
    if (key) {
      event.preventDefault()
      event.stopPropagation()
      this.press(key)
    }
  }

  protected save(): void {
    const state = this.state()
    const debt = this.debt()
    this.settleAmount()
    this.form.controls.walletId.updateValueAndValidity({ emitEvent: false })
    const interest = this.interestAllowed() ? this.interestValue() : 0
    this.interestMissing.set(interest > 0 && !this.interestCategoryId())
    if (!state || !debt || this.form.invalid || this.interestMissing()) {
      this.form.markAllAsTouched()
      return
    }
    if (!this.debtService.canWrite()) {
      return
    }
    const value = this.form.getRawValue()
    const amount = evaluate(value.amount, this.minorUnit())
    const minor = amount.ok ? amount.minor : 0
    if (state.mode === 'rule') {
      const rule = this.rule()
      if (rule) {
        this.recurringService.update(rule.id, {
          ...rule,
          walletId: value.walletId,
          amount: minor,
          note: value.note,
        })
        toast.success(this.t('recurring.saved'))
      }
      this.finish()
      return
    }
    const entryId =
      state.mode === 'edit' ? state.id : state.mode === 'fix' ? this.refusedId(state.opId) : null
    this.debtService.saveEntry(
      entryId,
      debt.id,
      {
        kind: value.kind,
        amount: minor,
        walletId: this.needsWallet() ? value.walletId : null,
        occurredOn: value.occurredOn,
        note: value.note,
      },
      interest > 0 && this.interestCategoryId()
        ? { amount: interest, categoryId: this.interestCategoryId() ?? '' }
        : null,
      state.mode === 'fix' ? state.opId : null
    )
    toast.success(this.t(state.mode === 'create' ? 'debts.entrySaved' : 'debts.saved'))
    this.finish()
  }

  protected remove(): void {
    const state = this.state()
    if (state?.mode === 'rule') {
      this.recurringService.remove(state.id)
      toast(this.t('recurring.deleted'), {
        action: {
          label: this.t('transactions.undo'),
          onClick: () => this.recurringService.restore(state.id),
        },
      })
      this.finish()
      return
    }
    if (state?.mode !== 'edit') {
      return
    }
    this.debtService.removeEntry(state.id)
    toast(this.t('debts.entryDeleted'), {
      action: {
        label: this.t('transactions.undo'),
        onClick: () => this.debtService.restoreEntry(state.id),
      },
    })
    this.finish()
  }

  /** Saved, deleted, ✕, a swipe down, the backdrop or Escape: unsaved input goes (DESIGN.md §6). */
  protected finish(): void {
    this.form.markAsPristine()
    this.state.set(null)
  }

  private refusedId(opId: string): string | null {
    const row = this.debtService.refused(opId, 'debt_entries')
    return row ? String(row['id']) : null
  }

  private settleAmount(): void {
    const control = this.form.controls.amount
    const result = evaluate(control.value, this.minorUnit())
    if (result.ok && result.minor > 0 && /[+\-×÷]/.test(control.value)) {
      control.setValue(toMajorText(result.minor, this.minorUnit()).replace(/,/g, ''))
    }
  }

  private amountText(minor: number, currencyCode: string): string {
    return minor > 0
      ? toMajorText(minor, this.walletService.minorUnit(currencyCode)).replace(/,/g, '')
      : ''
  }

  private start(state: EntrySheetState): void {
    this.view.set('form')
    this.interestAmount.reset('')
    this.interestMissing.set(false)
    if (state.mode === 'rule') {
      const rule = this.recurringService.byId(state.id)
      const debt = rule?.debtId ? this.debtService.byId(rule.debtId) : null
      if (!rule || !debt) {
        this.state.set(null)
        return
      }
      this.debtId.set(debt.id)
      this.form.reset({
        kind: 'repayment',
        amount: this.amountText(rule.amount, debt.currencyCode),
        walletId: rule.walletId,
        note: rule.note,
        occurredOn: rule.startOn,
      })
      this.keypad.set(false)
      return
    }
    if (state.mode === 'create') {
      const debt = this.debtService.byId(state.debtId)
      if (!debt) {
        this.state.set(null)
        return
      }
      this.debtId.set(debt.id)
      this.interestCategoryId.set(this.debtService.interestCategory(debt.id))
      const last = this.debtService
        .history(debt.id)
        .find((item) => item.kind === 'entry' && item.entry.walletId !== null)
      const lastWallet = last?.kind === 'entry' ? last.entry.walletId : null
      const usable = this.walletChoices()
      const walletId =
        usable.find((wallet) => wallet.id === lastWallet)?.id ?? usable.at(0)?.id ?? ''
      this.form.reset({
        kind: state.kind,
        amount: '',
        walletId,
        note: '',
        occurredOn: this.transactionService.today(),
      })
      this.keypad.set(true)
      return
    }
    const refused =
      state.mode === 'fix' ? this.debtService.refused(state.opId, 'debt_entries') : null
    const entry =
      state.mode === 'edit'
        ? this.debtService.entryById(state.id)
        : refused
          ? toEntry(refused)
          : null
    const debt = entry ? this.debtService.byId(entry.debtId) : null
    if (!entry || !debt) {
      this.state.set(null)
      return
    }
    this.debtId.set(debt.id)
    this.form.reset({
      kind: entry.kind,
      amount: this.amountText(entry.amount, debt.currencyCode),
      walletId: entry.walletId ?? '',
      note: entry.note,
      occurredOn: entry.occurredOn,
    })
    this.keypad.set(false)
    if (refused) {
      this.form.markAllAsTouched()
      this.form.markAsDirty()
    }
  }
}
