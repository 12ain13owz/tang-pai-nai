import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArrowUpDown,
  lucideCalendar,
  lucideCheck,
  lucideChevronLeft,
  lucideChevronRight,
  lucideCopy,
  lucideListPlus,
  lucideTextAlignStart,
  lucideTrash2,
  lucideWallet,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import {
  QUICK_AMOUNTS,
  QuickAmountsService,
  TRANSACTION_LIMITS,
  TransactionService,
  TransferService,
} from '@/core/transaction'
import type { TransferSheetState, TransferValues } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import type { Wallet } from '@/core/wallet'
import {
  CalcAmountField,
  CalcKeypad,
  FORM_IMPORTS,
  TextareaField,
  withMessage,
} from '@/shared/components/form'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import {
  addDays,
  addQuickAmount,
  CALC_KEYBOARD,
  evaluate,
  formatMoney,
  fromDay,
  pressKey,
  toDay,
  toMajorText,
} from '@/shared/utils'
import type { CalcKey } from '@/shared/utils'
import type { TransferFormGroup } from './transfer-form.type'

type View = 'form' | 'pick' | 'note' | 'confirmDiscard'

/**
 * The transfer form (docs/features/transfer.md → Web screens; owner's choice Q4 in #9: a sheet
 * of its own): one card of rows told apart by their icons: from wallet, ⇅ swap, to wallet (each
 * with its balance), amount (the calculator keypad), note (its own view), date. Create (the ⋮
 * menu, the Wallets tab), edit (either row of a transfer; copy and delete in the header) and
 * "fix" a rejected op. Opened through `TransferService.open()`; the shell loads it on first use.
 */
@Component({
  selector: 'app-transfer-sheet',
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
  ],
  providers: [
    provideIcons({
      lucideArrowUpDown,
      lucideCalendar,
      lucideCheck,
      lucideChevronLeft,
      lucideChevronRight,
      lucideCopy,
      lucideListPlus,
      lucideTextAlignStart,
      lucideTrash2,
      lucideWallet,
    }),
  ],
  template: `
    @let f = form.controls;
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="onClosed()">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
        (keydown)="onKey($event)"
      >
        @switch (view()) {
          @case ('form') {
            <form [formGroup]="form" class="flex min-h-0 flex-1 flex-col" (ngSubmit)="save()">
              <app-sheet-frame
                [title]="heading() | transloco"
                [leadingLabel]="'sheet.close' | transloco"
                (leading)="close()"
              >
                @if (editingId() && transferService.byId(editingId()!)) {
                  <div sheetActions class="flex">
                    @if (state()?.mode === 'edit') {
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        type="button"
                        class="size-11"
                        [disabled]="!transferService.canWrite()"
                        [attr.aria-label]="'transfers.copy' | transloco"
                        (click)="copy()"
                      >
                        <ng-icon name="lucideCopy" size="20" aria-hidden="true" />
                      </button>
                    }
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="size-11 text-destructive"
                      [disabled]="!transferService.canWrite()"
                      [attr.aria-label]="'transfers.delete' | transloco"
                      (click)="remove()"
                    >
                      <ng-icon name="lucideTrash2" size="20" aria-hidden="true" />
                    </button>
                  </div>
                }
                <!-- The keypad belongs to the amount row: any other control closes it (8.2). -->
                <div
                  class="flex flex-col gap-4"
                  (pointerdown)="leaveAmount($event)"
                  (focusin)="leaveAmount($event)"
                >
                  @if (!transferService.canWrite()) {
                    <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {{
                        (transferService.serverDown()
                          ? 'sync.serverDownWrite'
                          : 'transfers.needsOnline'
                        ) | transloco
                      }}
                    </p>
                  }
                  <div
                    class="relative divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                  >
                    @for (side of sides; track side) {
                      @let item = side === 'from' ? fromWallet() : toWallet();
                      <div>
                        <button
                          type="button"
                          class="flex min-h-15 w-full items-center gap-3 py-2 pr-14 pl-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          [attr.aria-label]="
                            ('transfers.' + side | transloco) +
                            ' ' +
                            (item?.name ?? ('transfers.pickTo' | transloco))
                          "
                          (click)="pick(side)"
                        >
                          <span class="flex w-10 shrink-0 justify-center">
                            @if (item) {
                              <app-icon-badge
                                [icon]="item.icon"
                                [color]="item.color"
                                [fallback]="walletIcon"
                                [size]="32"
                              />
                            } @else {
                              <span
                                class="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
                              >
                                <ng-icon name="lucideWallet" size="16" aria-hidden="true" />
                              </span>
                            }
                          </span>
                          <span class="flex min-w-0 flex-1 flex-col">
                            <span class="text-xs text-muted-foreground">{{
                              'transfers.' + side | transloco
                            }}</span>
                            <span
                              class="truncate text-base"
                              [class.text-muted-foreground]="!item"
                              >{{ item?.name ?? ('transfers.pickTo' | transloco) }}</span
                            >
                          </span>
                          @if (item) {
                            <span
                              class="shrink-0 text-sm text-muted-foreground tabular-nums"
                              [class.text-expense]="walletService.balance(item) < 0"
                              >{{ balanceText(item) }}</span
                            >
                          }
                        </button>
                        @if (side === 'to' && f.toWalletId.touched && f.toWalletId.invalid) {
                          <p role="alert" class="px-4 pb-2 pl-17 text-sm text-destructive">
                            {{ 'transfers.toRequired' | transloco }}
                          </p>
                        }
                      </div>
                    }
                    <!-- ⇅ on the line between the two wallets. -->
                    <button
                      hlmBtn
                      variant="outline"
                      size="icon"
                      type="button"
                      class="absolute top-[2.4rem] right-3 z-10 size-10 rounded-full bg-card"
                      [disabled]="!toWallet()"
                      [attr.aria-label]="'transfers.swap' | transloco"
                      (click)="swap()"
                    >
                      <ng-icon name="lucideArrowUpDown" size="18" aria-hidden="true" />
                    </button>
                    <div class="px-4">
                      <app-calc-amount-field
                        [control]="f.amount"
                        [label]="'transactions.amount' | transloco"
                        [currencyCode]="fromWallet()?.currencyCode ?? ''"
                        [minorUnit]="minorUnit()"
                        [locale]="languageService.locale()"
                        [active]="keypad()"
                        (activate)="keypad.set(true)"
                      />
                    </div>
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
                    <div class="flex min-h-14 items-center gap-2 px-4 py-2">
                      <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                        <ng-icon name="lucideCalendar" size="22" aria-hidden="true" />
                      </span>
                      <button
                        hlmBtn
                        variant="outline"
                        size="icon"
                        type="button"
                        class="size-10 shrink-0"
                        [disabled]="day() <= firstDay"
                        [attr.aria-label]="'transactions.dayBefore' | transloco"
                        (click)="moveDay(-1)"
                      >
                        <ng-icon name="lucideChevronLeft" size="20" aria-hidden="true" />
                      </button>
                      <label
                        class="relative flex h-10 min-w-0 flex-1 items-center justify-center rounded-md text-base font-medium has-focus-visible:ring-2 has-focus-visible:ring-ring"
                      >
                        <span class="truncate">{{ dayText() }}</span>
                        <input
                          type="date"
                          class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          [attr.aria-label]="'transactions.date' | transloco"
                          [min]="firstDay"
                          [max]="lastDay()"
                          [formControl]="f.occurredOn"
                        />
                      </label>
                      <button
                        hlmBtn
                        variant="outline"
                        size="icon"
                        type="button"
                        class="size-10 shrink-0"
                        [disabled]="day() >= lastDay()"
                        [attr.aria-label]="'transactions.dayAfter' | transloco"
                        (click)="moveDay(1)"
                      >
                        <ng-icon name="lucideChevronRight" size="20" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
                <div
                  sheetFooter
                  class="flex flex-col pt-3"
                  [class.-mx-4]="keypad()"
                  [class.-mb-4]="keypad()"
                >
                  <div class="flex gap-2" [class.px-4]="keypad()" [class.pb-2]="keypad()">
                    <button
                      hlmBtn
                      type="submit"
                      class="h-11 min-w-0 flex-1 text-base"
                      [disabled]="!transferService.canWrite()"
                    >
                      {{ 'transactions.save' | transloco }}
                    </button>
                    @if (state()?.mode === 'create') {
                      <button
                        hlmBtn
                        variant="outline"
                        size="icon"
                        type="button"
                        class="size-11 shrink-0"
                        [disabled]="!transferService.canWrite()"
                        [attr.aria-label]="'transactions.saveAndAdd' | transloco"
                        (click)="save(true)"
                      >
                        <ng-icon name="lucideListPlus" size="20" aria-hidden="true" />
                      </button>
                    }
                  </div>
                  @if (keypad()) {
                    <app-calc-keypad
                      class="pb-[max(0.5rem,env(safe-area-inset-bottom))]"
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
          @case ('pick') {
            @let side = pickSide();
            @let choices = side === 'from' ? fromChoices() : toChoices();
            @let chosen = side === 'from' ? f.fromWalletId.value : f.toWalletId.value;
            <app-sheet-frame
              [title]="(side === 'from' ? 'transfers.fromPick' : 'transfers.toPick') | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              @if (choices.length > 0) {
                <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                  @for (item of choices; track item.id) {
                    <li>
                      <button
                        type="button"
                        class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        [attr.aria-current]="item.id === chosen ? 'true' : null"
                        (click)="choose(side, item.id)"
                      >
                        <app-icon-badge
                          [icon]="item.icon"
                          [color]="item.color"
                          [fallback]="walletIcon"
                        />
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span class="truncate text-base">{{ item.name }}</span>
                          @if (item.excludeFromTotal) {
                            <span class="text-sm text-muted-foreground">{{
                              'wallets.excluded' | transloco
                            }}</span>
                          }
                        </span>
                        <span
                          class="shrink-0 text-sm tabular-nums"
                          [class.text-expense]="walletService.balance(item) < 0"
                          >{{ balanceText(item) }}</span
                        >
                        @if (item.id === chosen) {
                          <ng-icon
                            name="lucideCheck"
                            size="20"
                            class="text-brand"
                            aria-hidden="true"
                          />
                        }
                      </button>
                    </li>
                  }
                </ul>
              } @else {
                <p class="text-sm text-muted-foreground">{{ 'transfers.noOther' | transloco }}</p>
              }
              @if (side === 'to' || editingId()) {
                <p class="mt-3 text-sm text-muted-foreground">
                  {{ 'transfers.sameCurrency' | transloco }}
                </p>
              }
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
                [placeholder]="'transactions.notePlaceholder' | transloco"
                [hint]="note().length + ' / ' + noteMax"
              />
            </app-sheet-frame>
          }
          @case ('confirmDiscard') {
            <app-sheet-frame
              [title]="'transactions.discardHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'transactions.keepEditing' | transloco"
              (leading)="view.set('form')"
            >
              <p class="text-sm text-muted-foreground">
                {{ 'transactions.discardText' | transloco }}
              </p>
              <div sheetFooter class="pt-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  (click)="finish()"
                >
                  {{ 'transactions.discard' | transloco }}
                </button>
              </div>
            </app-sheet-frame>
          }
        }
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class TransferSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  protected languageService = inject(LanguageService)
  protected transferService = inject(TransferService)
  private transactionService = inject(TransactionService)
  protected walletService = inject(WalletService)
  private profileService = inject(ProfileService)
  private quickAmountsService = inject(QuickAmountsService)

  protected readonly sides = ['from', 'to'] as const
  protected walletIcon = WALLET_DEFAULT_ICON
  protected noteMax = TRANSACTION_LIMITS.NOTE_MAX
  protected firstDay = TRANSACTION_LIMITS.FIRST_DAY
  protected state = this.transferService.sheet
  protected view = signal<View>('form')
  /** Which wallet the picker view chooses. */
  protected pickSide = signal<'from' | 'to'>('from')
  protected keypad = signal(false)
  protected quickAmounts = computed(() => (this.quickAmountsService.enabled() ? QUICK_AMOUNTS : []))

  /** Rule 3: the expression works out to 1 … 10¹⁵ minor units. */
  private amountValid: ValidatorFn = (control) => {
    if (typeof control.value !== 'string') {
      return null
    }
    const walletId: unknown = control.parent?.get('fromWalletId')?.value
    const wallet =
      typeof walletId === 'string' && walletId ? this.walletService.byId(walletId) : null
    const result = evaluate(control.value, this.walletService.minorUnit(wallet?.currencyCode ?? ''))
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

  form: TransferFormGroup = this.nnfb.group({
    fromWalletId: [''],
    toWalletId: ['', [withMessage(Validators.required, 'transfers.toRequired')]],
    amount: ['', [this.amountValid]],
    note: ['', [Validators.maxLength(TRANSACTION_LIMITS.NOTE_MAX)]],
    occurredOn: [toDay()],
  })

  private values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() })
  protected note = computed(() => (this.values().note ?? '').trim())
  protected day = computed(() => this.values().occurredOn ?? toDay())
  protected lastDay = computed(() => addDays(this.transactionService.today(), 365))

  protected editingId = computed(() => {
    const state = this.state()
    return state && state.mode !== 'create' ? state.id : null
  })
  /** The profile the transfer belongs to (rule 1: it never moves). */
  private profileId = computed(() => {
    const state = this.state()
    const id = this.editingId()
    const row = id ? this.transferService.byId(id) : null
    if (row) {
      return row.profileId
    }
    return state?.mode === 'fix' ? state.profileId : (this.profileService.current()?.id ?? '')
  })
  /** The currency the transfer had when the sheet opened (an edit keeps it, rule 1). */
  private startCurrency = signal<string | null>(null)
  protected fromWallet = computed<Wallet | null>(() => {
    const id = this.values().fromWalletId ?? ''
    return id ? this.walletService.byId(id) : null
  })
  protected toWallet = computed<Wallet | null>(() => {
    const id = this.values().toWalletId ?? ''
    return id ? this.walletService.byId(id) : null
  })
  protected minorUnit = computed(() =>
    this.walletService.minorUnit(this.fromWallet()?.currencyCode ?? '')
  )
  protected heading = computed(() => {
    switch (this.state()?.mode) {
      case 'edit':
        return 'transfers.editHeading'
      case 'fix':
        return 'transfers.fixHeading'
      default:
        return 'transfers.createHeading'
    }
  })

  /** Rule 2: open wallets (and the one the row already has); an edit keeps its currency. */
  protected fromChoices = computed<Wallet[]>(() =>
    this.choices(this.fromWallet(), this.startCurrency(), null)
  )
  /** Rule 1: open wallets of the from wallet's currency, never the from wallet itself. */
  protected toChoices = computed<Wallet[]>(() => {
    const from = this.fromWallet()
    return this.choices(this.toWallet(), from?.currencyCode ?? null, from?.id ?? null)
  })
  protected dayText = computed(() => {
    const day = this.day()
    const today = this.transactionService.today()
    const date = new Intl.DateTimeFormat(this.languageService.locale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(fromDay(day))
    const relative =
      day === today
        ? 'transactions.today'
        : day === addDays(today, -1)
          ? 'transactions.yesterday'
          : day === addDays(today, 1)
            ? 'transactions.tomorrow'
            : null
    const lead = relative
      ? this.transloco.translate(relative)
      : new Intl.DateTimeFormat(this.languageService.locale(), { weekday: 'short' }).format(
          fromDay(day)
        )
    return `${lead} · ${date}`
  })

  protected dirty = signal(false)
  protected open = signal(false)

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.dirty.set(this.form.dirty))
    this.form.controls.fromWalletId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.dropUnfitTo()
      this.form.controls.amount.updateValueAndValidity()
    })
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

  protected pick(view: 'from' | 'to' | 'note'): void {
    this.settleAmount()
    this.keypad.set(false)
    if (view === 'note') {
      this.view.set('note')
      return
    }
    this.pickSide.set(view)
    this.view.set('pick')
  }

  protected choose(side: 'from' | 'to', id: string): void {
    const control =
      side === 'from' ? this.form.controls.fromWalletId : this.form.controls.toWalletId
    control.setValue(id)
    control.markAsDirty()
    if (
      side === 'from' &&
      !this.form.controls.toWalletId.value &&
      this.state()?.mode === 'create'
    ) {
      this.form.controls.toWalletId.setValue(
        this.transferService.lastToId(id, this.profileId()) ?? ''
      )
    }
    this.view.set('form')
  }

  /** ⇅: the two wallets change places. */
  protected swap(): void {
    const { fromWalletId, toWalletId } = this.form.getRawValue()
    if (!toWalletId) {
      return
    }
    this.form.patchValue({ fromWalletId: toWalletId, toWalletId: fromWalletId })
    this.form.markAsDirty()
    this.dirty.set(true)
  }

  protected moveDay(days: number): void {
    const next = addDays(this.day(), days)
    if (next >= this.firstDay && next <= this.lastDay()) {
      this.form.controls.occurredOn.setValue(next)
      this.form.controls.occurredOn.markAsDirty()
    }
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

  /** "Copy": a new transfer with the form's values, dated today. */
  protected copy(): void {
    const value = this.form.getRawValue()
    const amount = evaluate(value.amount, this.minorUnit())
    this.transferService.open({
      mode: 'create',
      values: {
        fromWalletId: value.fromWalletId,
        toWalletId: value.toWalletId,
        amount: amount.ok && amount.minor > 0 ? amount.minor : 0,
        occurredOn: this.transactionService.today(),
        note: value.note,
      },
    })
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

  protected save(addAnother = false): void {
    const state = this.state()
    this.settleAmount()
    if (!state || this.form.invalid || !this.transferService.canWrite()) {
      return
    }
    const value = this.form.getRawValue()
    const amount = evaluate(value.amount, this.minorUnit())
    const values: TransferValues = {
      fromWalletId: value.fromWalletId,
      toWalletId: value.toWalletId,
      amount: amount.ok ? amount.minor : 0,
      occurredOn: value.occurredOn,
      note: value.note,
    }
    if (state.mode === 'fix') {
      this.transferService.save(state.id, values, state.opId, state.profileId)
    } else {
      this.transferService.save(this.editingId(), values)
    }
    toast.success(
      this.transloco.translate(state.mode === 'create' ? 'transfers.created' : 'transfers.saved')
    )
    if (addAnother && state.mode === 'create') {
      this.form.reset({ ...value, amount: '', note: '' })
      this.dirty.set(false)
      this.keypad.set(true)
      return
    }
    this.finish()
  }

  /** Rule 7: both rows go at once, "เลิกทำ" in the toast. */
  protected remove(): void {
    const id = this.editingId()
    if (!id) {
      return
    }
    this.transferService.remove(id)
    toast(this.transloco.translate('transfers.deleted'), {
      action: {
        label: this.transloco.translate('transactions.undo'),
        onClick: () => this.transferService.restore(id),
      },
    })
    this.finish()
  }

  protected close(): void {
    if (this.form.dirty) {
      this.view.set('confirmDiscard')
      return
    }
    this.finish()
  }

  protected onClosed(): void {
    if (this.dirty() && this.state()) {
      // The drawer can't refuse to close, so it comes back with the question instead.
      this.view.set('confirmDiscard')
      this.open.set(false)
      setTimeout(() => this.open.set(true))
      return
    }
    this.state.set(null)
  }

  protected finish(): void {
    this.form.markAsPristine()
    this.dirty.set(false)
    this.state.set(null)
  }

  private choices(
    current: Wallet | null,
    currency: string | null,
    except: string | null
  ): Wallet[] {
    const open = this.walletService
      .openOf(this.profileId())
      .filter((item) => item.id !== except && (currency === null || item.currencyCode === currency))
    return current && current.id !== except && !open.some((item) => item.id === current.id)
      ? [current, ...open]
      : open
  }

  /** A to wallet that is now the from wallet, or of another currency, no longer fits. */
  private dropUnfitTo(): void {
    const from = this.fromWallet()
    const to = this.toWallet()
    if (to && (!from || to.id === from.id || to.currencyCode !== from.currencyCode)) {
      this.form.controls.toWalletId.setValue('')
    }
  }

  private settleAmount(): void {
    const control = this.form.controls.amount
    const result = evaluate(control.value, this.minorUnit())
    if (result.ok && result.minor > 0 && /[+\-×÷]/.test(control.value)) {
      control.setValue(toMajorText(result.minor, this.minorUnit()).replace(/,/g, ''))
    }
  }

  private start(state: TransferSheetState): void {
    this.view.set('form')
    this.dirty.set(false)
    if (state.mode === 'create') {
      const copied = state.values ?? null
      const viewing = this.transactionService.viewWallet()
      const usable = (id: string | null | undefined) => {
        const wallet = id ? this.walletService.byId(id) : null
        return wallet && !wallet.isArchived ? wallet.id : null
      }
      const fromId =
        usable(copied?.fromWalletId) ??
        usable(state.fromWalletId) ??
        usable(viewing?.id) ??
        this.transferService.defaultFromId() ??
        ''
      const toId = usable(copied?.toWalletId) ?? this.transferService.lastToId(fromId) ?? ''
      this.startCurrency.set(null)
      this.form.reset({
        fromWalletId: fromId,
        toWalletId: toId,
        amount:
          copied && copied.amount > 0
            ? toMajorText(
                copied.amount,
                this.walletService.minorUnit(this.walletService.byId(fromId)?.currencyCode ?? '')
              ).replace(/,/g, '')
            : '',
        note: copied?.note ?? '',
        occurredOn: this.transactionService.today(),
      })
      this.dropUnfitTo()
      this.keypad.set(true)
      return
    }
    const values = state.mode === 'fix' ? state.values : this.transferService.byId(state.id)
    if (!values) {
      this.state.set(null)
      return
    }
    const stored = this.transferService.byId(state.id)
    this.startCurrency.set(
      stored ? (this.walletService.byId(stored.fromWalletId)?.currencyCode ?? null) : null
    )
    const minorUnit = this.walletService.minorUnit(
      this.walletService.byId(values.fromWalletId)?.currencyCode ?? ''
    )
    this.form.reset({
      fromWalletId: values.fromWalletId,
      toWalletId: values.toWalletId,
      amount: values.amount > 0 ? toMajorText(values.amount, minorUnit).replace(/,/g, '') : '',
      note: values.note,
      occurredOn: values.occurredOn,
    })
    if (state.mode === 'fix') {
      this.form.markAllAsTouched()
      this.form.markAsDirty()
      this.dirty.set(true)
    }
    this.keypad.set(false)
  }
}
