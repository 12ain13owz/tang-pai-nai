import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArrowUpDown,
  lucideCheck,
  lucideChevronRight,
  lucideCopy,
  lucideListPlus,
  lucidePause,
  lucidePlay,
  lucideTextAlignStart,
  lucideTrash2,
  lucideWallet,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { LanguageService } from '@/core/i18n'
import { SyncService } from '@/core/offline'
import { ProfileService } from '@/core/profile'
import {
  describeRepeat,
  describeRest,
  MONTHLY,
  nextOnOrAfter,
  RecurringService,
  shortDate,
  toRule as toRuleRow,
} from '@/core/recurring'
import type { RepeatValues, RuleValues } from '@/core/recurring'
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
import { DateRow } from '@/shared/components/date-row'
import {
  CalcAmountField,
  CalcKeypad,
  FORM_IMPORTS,
  TextareaField,
  withMessage,
} from '@/shared/components/form'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import { WalletPick, walletPickItem } from '@/shared/components/wallet-pick'
import type { WalletPickItem } from '@/shared/components/wallet-pick'
import {
  addDays,
  addQuickAmount,
  CALC_KEYBOARD,
  evaluate,
  formatMoney,
  pressKey,
  toDay,
  toMajorText,
} from '@/shared/utils'
import type { CalcKey } from '@/shared/utils'
import { RepeatRow } from './repeat-row'
import { RepeatView } from './repeat-view'
import type { TransferFormGroup } from './transfer-form.type'

type View = 'form' | 'pick' | 'note' | 'repeat' | 'confirmDiscard'

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
    DateRow,
    WalletPick,
    HlmDrawerImports,
    CalcAmountField,
    CalcKeypad,
    TextareaField,
    IconBadge,
    SheetFrame,
    RepeatRow,
    RepeatView,
  ],
  providers: [
    provideIcons({
      lucideArrowUpDown,
      lucideCheck,
      lucideChevronRight,
      lucideCopy,
      lucideListPlus,
      lucidePause,
      lucidePlay,
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
                @if (rule(); as current) {
                  <!-- A recurring rule (recurring.md → Web screens): pause / resume, delete. -->
                  <div sheetActions class="flex">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="tpn-hit size-9"
                      [disabled]="!transferService.canWrite()"
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
                      [disabled]="!transferService.canWrite()"
                      [attr.aria-label]="'recurring.delete' | transloco"
                      (click)="remove()"
                    >
                      <ng-icon name="lucideTrash2" size="18" aria-hidden="true" />
                    </button>
                  </div>
                } @else if (editingId() && transferService.byId(editingId()!)) {
                  <div sheetActions class="flex">
                    @if (state()?.mode === 'edit') {
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        type="button"
                        class="tpn-hit size-9"
                        [disabled]="!transferService.canWrite()"
                        [attr.aria-label]="'transfers.copy' | transloco"
                        (click)="copy()"
                      >
                        <ng-icon name="lucideCopy" size="18" aria-hidden="true" />
                      </button>
                    }
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="tpn-hit size-9 text-destructive"
                      [disabled]="!transferService.canWrite()"
                      [attr.aria-label]="'transfers.delete' | transloco"
                      (click)="remove()"
                    >
                      <ng-icon name="lucideTrash2" size="18" aria-hidden="true" />
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
                    <app-date-row
                      [control]="f.occurredOn"
                      [value]="day()"
                      [today]="transactionService.today()"
                      [locale]="languageService.locale()"
                      [label]="startsRule() ? ('recurring.start' | transloco) : ''"
                      [ariaLabel]="'transactions.date' | transloco"
                      [min]="firstDay"
                      [max]="lastDay()"
                    />
                  </div>
                  @if (repeatable() || fromRule()) {
                    <!-- Recurring (recurring.md Q4): a transfer repeats like a transaction. -->
                    <div
                      class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                    >
                      @if (repeatable()) {
                        <app-repeat-row
                          [label]="'recurring.repeat' | transloco"
                          [title]="repeatTitle()"
                          [sub]="repeatSub()"
                          [active]="repeat() !== null"
                          (pressed)="pick('repeat')"
                        />
                      }
                      @if (fromRule(); as source) {
                        <app-repeat-row
                          [label]="'recurring.fromRule' | transloco"
                          [title]="'recurring.fromRule' | transloco"
                          [sub]="source.text"
                          (pressed)="openRule(source.id)"
                        />
                      }
                    </div>
                    @if (repeatHint(); as hint) {
                      <p class="-mt-2 px-1 text-sm text-muted-foreground">{{ hint }}</p>
                    }
                  }
                </div>
                <div sheetFooter class="relative flex flex-col pt-3">
                  <!-- Under the keypad while it shows: ✓ first, then save (one action at a time). -->
                  <div class="flex gap-2" [attr.inert]="keypad() ? '' : null">
                    <button
                      hlmBtn
                      type="submit"
                      class="h-11 min-w-0 flex-1 text-base"
                      [disabled]="!transferService.canWrite()"
                    >
                      {{ 'transactions.save' | transloco }}
                    </button>
                    @if (state()?.mode === 'create' && !repeat()) {
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
          @case ('pick') {
            @let side = pickSide();
            @let choices = side === 'from' ? fromItems() : toItems();
            @let chosen = side === 'from' ? f.fromWalletId.value : f.toWalletId.value;
            <app-sheet-frame
              [title]="(side === 'from' ? 'transfers.fromPick' : 'transfers.toPick') | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <app-wallet-pick
                [wallets]="choices"
                [chosen]="chosen"
                [empty]="'transfers.noOther' | transloco"
                (picked)="choose(side, $event)"
              />
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
                [hint]="note().length + ' / ' + noteMax"
              />
            </app-sheet-frame>
          }
          @case ('repeat') {
            <app-sheet-frame
              [title]="'recurring.repeat' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <app-repeat-view
                [startOn]="day()"
                [value]="repeat()"
                (valueChange)="setRepeat($event)"
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
  protected transactionService = inject(TransactionService)
  protected walletService = inject(WalletService)
  private profileService = inject(ProfileService)
  private quickAmountsService = inject(QuickAmountsService)
  private recurringService = inject(RecurringService)
  private syncService = inject(SyncService)
  /** "ทำซ้ำ" (docs/features/recurring.md, Q4): null = don't repeat. */
  protected repeat = signal<RepeatValues | null>(null)

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
  /** The recurring rule being edited (rule mode), if any. */
  protected rule = computed(() => {
    const state = this.state()
    return state?.mode === 'rule' || state?.mode === 'fixRule'
      ? this.recurringService.byId(state.id)
      : null
  })
  private ruleMode = computed(() => {
    const mode = this.state()?.mode
    return mode === 'rule' || mode === 'fixRule'
  })
  protected repeatable = computed(() => {
    const state = this.state()
    return (state?.mode === 'create' && !state.occurrence) || this.ruleMode()
  })
  protected startsRule = computed(() => this.repeatable() && this.repeat() !== null)
  /** A recorded occurrence: the rule it came from, while it's live. */
  protected fromRule = computed(() => {
    this.languageService.language()
    const state = this.state()
    const row = state?.mode === 'edit' ? this.transferService.byId(state.id) : null
    const rule = row?.recurringId ? this.recurringService.byId(row.recurringId) : null
    return rule
      ? {
          id: rule.id,
          text: describeRepeat(rule, rule.startOn, this.t, this.languageService.locale()),
        }
      : null
  })
  protected repeatTitle = computed(() => {
    this.languageService.language()
    const repeat = this.repeat()
    return repeat
      ? describeRepeat(repeat, this.day(), this.t, this.languageService.locale())
      : this.t('recurring.none')
  })
  protected repeatSub = computed(() => {
    this.languageService.language()
    const repeat = this.repeat()
    return repeat ? describeRest(repeat, this.t, this.languageService.locale()) : ''
  })
  protected repeatHint = computed(() => {
    this.languageService.language()
    const repeat = this.repeat()
    const locale = this.languageService.locale()
    if (!repeat || !this.repeatable()) {
      return null
    }
    const day = this.day()
    const today = this.transactionService.today()
    const rule = this.rule()
    if (rule) {
      return [
        rule.nextOn
          ? this.t('recurring.nextLine', { date: shortDate(rule.nextOn, locale) })
          : this.t('recurring.ended'),
        this.t('recurring.recordedLine', { count: this.recurringService.recordedCount(rule) }),
        this.t('recurring.editNote'),
      ].join(' · ')
    }
    if (day > today) {
      return this.t('recurring.nextLine', { date: shortDate(day, locale) })
    }
    const next = nextOnOrAfter({ ...repeat, startOn: day }, addDays(today, 1))
    return next
      ? this.t('recurring.nextNow', {
          date: shortDate(next, locale),
          first: shortDate(day, locale, false),
        })
      : null
  })
  private t = (key: string, params?: Record<string, unknown>) =>
    this.transloco.translate(key, params)

  /** The profile the transfer belongs to (rule 1: it never moves). */
  private profileId = computed(() => {
    const state = this.state()
    const rule = this.rule()
    if (rule) {
      return rule.profileId
    }
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
      case 'rule':
        return 'recurring.editHeading'
      case 'fixRule':
        return 'recurring.fixHeading'
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
  protected fromItems = computed(() => this.pickItems(this.fromChoices()))
  protected toItems = computed(() => this.pickItems(this.toChoices()))

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

  private pickItems(wallets: readonly Wallet[]): WalletPickItem[] {
    const locale = this.languageService.locale()
    const excluded = this.transloco.translate('wallets.excluded')
    return wallets.map((wallet) =>
      walletPickItem(wallet, {
        balance: this.walletService.balance(wallet),
        minorUnit: this.walletService.minorUnit(wallet.currencyCode),
        locale,
        excluded,
      })
    )
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

  protected setRepeat(value: RepeatValues | null): void {
    this.repeat.set(value)
    this.form.markAsDirty()
    this.dirty.set(true)
  }

  protected openRule(id: string): void {
    if (!this.form.dirty) {
      this.recurringService.open(id)
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

  protected pick(view: 'from' | 'to' | 'note' | 'repeat'): void {
    this.settleAmount()
    this.keypad.set(false)
    if (view === 'note' || view === 'repeat') {
      this.view.set(view)
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
    const repeat = this.repeat()
    const ruleValues = (repeat: RepeatValues): RuleValues => ({
      ...repeat,
      kind: 'transfer',
      walletId: values.fromWalletId,
      categoryId: null,
      toWalletId: values.toWalletId,
      amount: values.amount,
      note: values.note,
      excludeFromReport: false,
      startOn: values.occurredOn,
    })
    let done = state.mode === 'create' ? 'transfers.created' : 'transfers.saved'
    if (state.mode === 'rule' || state.mode === 'fixRule') {
      this.recurringService.update(
        state.id,
        ruleValues(repeat ?? MONTHLY),
        state.mode === 'fixRule' ? state.opId : null
      )
      done = 'recurring.saved'
    } else if (state.mode === 'fix') {
      this.transferService.save(state.id, values, state.opId, state.profileId)
    } else if (state.mode === 'create' && state.occurrence) {
      this.recurringService.confirm(state.occurrence.ruleId, state.occurrence.on, {
        walletId: values.fromWalletId,
        toWalletId: values.toWalletId,
        amount: values.amount,
        note: values.note,
        occurredOn: values.occurredOn,
      })
      done = 'recurring.confirmed'
    } else if (state.mode === 'create' && repeat) {
      this.recurringService.create(ruleValues(repeat))
      done = 'recurring.created'
    } else {
      this.transferService.save(this.editingId(), values)
    }
    toast.success(this.transloco.translate(done))
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
    if (this.ruleMode()) {
      this.recurringService.remove(id)
      toast(this.transloco.translate('recurring.deleted'), {
        action: {
          label: this.transloco.translate('transactions.undo'),
          onClick: () => this.recurringService.restore(id),
        },
      })
      this.finish()
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
    // The controls, not `values()`: this runs in the from control's own valueChanges, before the
    // form's (which feeds `values()`) has emitted.
    const { fromWalletId, toWalletId } = this.form.getRawValue()
    const from = fromWalletId ? this.walletService.byId(fromWalletId) : null
    const to = toWalletId ? this.walletService.byId(toWalletId) : null
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

  /** A rule in this sheet: its template in the form, its schedule in "ทำซ้ำ" (recurring.md). */
  private startRule(state: Extract<TransferSheetState, { mode: 'rule' | 'fixRule' }>): void {
    const stored = this.recurringService.byId(state.id)
    const refused = state.mode === 'fixRule' ? this.syncService.rejectedOp(state.opId)?.row : null
    const source = refused ? toRuleRow(refused) : stored
    if (!source) {
      this.state.set(null)
      return
    }
    const minorUnit = this.walletService.minorUnit(
      this.walletService.byId(source.walletId)?.currencyCode ?? ''
    )
    this.startCurrency.set(null)
    this.form.reset({
      fromWalletId: source.walletId,
      toWalletId: source.toWalletId ?? '',
      amount: source.amount > 0 ? toMajorText(source.amount, minorUnit).replace(/,/g, '') : '',
      note: source.note,
      occurredOn: source.startOn,
    })
    this.repeat.set({
      frequency: source.frequency,
      interval: source.interval,
      endOn: source.endOn,
      endCount: source.endCount,
      confirm: source.confirm,
    })
    this.keypad.set(false)
    if (refused) {
      this.form.markAllAsTouched()
      this.form.markAsDirty()
      this.dirty.set(true)
    }
  }

  private start(state: TransferSheetState): void {
    this.view.set('form')
    this.dirty.set(false)
    this.repeat.set(state.mode === 'create' && state.repeat ? MONTHLY : null)
    if (state.mode === 'rule' || state.mode === 'fixRule') {
      this.startRule(state)
      return
    }
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
        occurredOn: state.occurrence?.on ?? this.transactionService.today(),
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
