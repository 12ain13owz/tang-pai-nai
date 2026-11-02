import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideCalendar,
  lucideCheck,
  lucideChevronDown,
  lucideChevronLeft,
  lucideChevronRight,
  lucideEyeOff,
  lucideTextAlignStart,
  lucideTrash2,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import type { Category, CategoryNode, CategoryType } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import { TRANSACTION_LIMITS, TransactionService } from '@/core/transaction'
import type { TransactionSheetState, TransactionValues } from '@/core/transaction'
import { isHiddenIn, WalletService } from '@/core/wallet'
import type { Wallet } from '@/core/wallet'
import {
  CalcAmountField,
  CalcKeypad,
  FORM_IMPORTS,
  SegmentedField,
  SwitchField,
  TextareaField,
  withMessage,
} from '@/shared/components/form'
import { IconBadge, userColor, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import type { SelectOption } from '@/shared/types'
import { addDays, evaluate, fromDay, pressKey, toDay, toMajorText } from '@/shared/utils'
import type { CalcKey } from '@/shared/utils'
import type { TransactionFormGroup } from './transaction-form.type'

type View = 'form' | 'wallet' | 'category' | 'note' | 'confirmDiscard'

const TYPES: readonly CategoryType[] = ['expense', 'income']

/** Keys a hardware keyboard may type into the keypad. */
const KEYBOARD: Readonly<Partial<Record<string, CalcKey | '='>>> = {
  '+': '+',
  '-': '-',
  '*': '×',
  x: '×',
  '/': '÷',
  '.': '.',
  ',': '.',
  Backspace: '⌫',
  Delete: 'C',
  Escape: '=',
  Enter: '=',
  '=': '=',
}

/**
 * The transaction form (docs/features/transaction.md → Web screens; owner's choices in #8): the
 * type tabs, then one card of rows told apart by their icons (no labels above them): wallet,
 * amount (an on-screen calculator keypad), category, note (its own view), date (‹ › a day, the
 * middle opens the date picker) and "ไม่รวมในรายงาน". Create (➕), edit (a row; delete in the
 * header, undo in the toast) and "fix" a rejected op. Opened through `TransactionService.open()`;
 * the shell loads it on first use.
 */
@Component({
  selector: 'app-transaction-sheet',
  imports: [
    FORM_IMPORTS,
    ReactiveFormsModule,
    TranslocoPipe,
    NgIcon,
    HlmButton,
    HlmDrawerImports,
    SegmentedField,
    SwitchField,
    CalcAmountField,
    CalcKeypad,
    TextareaField,
    IconBadge,
    SheetFrame,
  ],
  providers: [
    provideIcons({
      lucideCalendar,
      lucideCheck,
      lucideChevronDown,
      lucideChevronLeft,
      lucideChevronRight,
      lucideEyeOff,
      lucideTextAlignStart,
      lucideTrash2,
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
                @if (editingId() && transactionService.byId(editingId()!)) {
                  <div sheetActions class="flex">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="size-11 text-destructive"
                      [disabled]="!transactionService.canWrite()"
                      [attr.aria-label]="'transactions.delete' | transloco"
                      (click)="remove()"
                    >
                      <ng-icon name="lucideTrash2" size="20" aria-hidden="true" />
                    </button>
                  </div>
                }
                <div class="flex flex-col gap-4">
                  @if (!transactionService.canWrite()) {
                    <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                      {{
                        (transactionService.serverDown()
                          ? 'sync.serverDownWrite'
                          : 'transactions.needsOnline'
                        ) | transloco
                      }}
                    </p>
                  }
                  <app-segmented-field
                    [control]="f.type"
                    [label]="'transactions.type' | transloco"
                    [options]="typeOptions()"
                  />
                  <div
                    class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                  >
                    <button
                      type="button"
                      class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      [attr.aria-label]="
                        ('transactions.wallet' | transloco) + ' ' + (wallet()?.name ?? '')
                      "
                      (click)="pick('wallet')"
                    >
                      <span class="flex w-10 shrink-0 justify-center">
                        @if (wallet(); as current) {
                          <app-icon-badge
                            [icon]="current.icon"
                            [color]="current.color"
                            [fallback]="walletIcon"
                            [size]="32"
                          />
                        }
                      </span>
                      <span class="min-w-0 flex-1 truncate text-base">{{ wallet()?.name }}</span>
                      <ng-icon
                        name="lucideChevronRight"
                        size="20"
                        class="text-muted-foreground"
                        aria-hidden="true"
                      />
                    </button>
                    <div class="px-4">
                      <app-calc-amount-field
                        [control]="f.amount"
                        [label]="'transactions.amount' | transloco"
                        [currencyCode]="wallet()?.currencyCode ?? ''"
                        [minorUnit]="minorUnit()"
                        [locale]="languageService.locale()"
                        [active]="keypad()"
                        (activate)="keypad.set(true)"
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        [attr.aria-label]="
                          ('transactions.category' | transloco) +
                          ' ' +
                          (category()?.name ?? ('transactions.pickCategory' | transloco))
                        "
                        (click)="pick('category')"
                      >
                        <span class="flex w-10 shrink-0 justify-center">
                          @if (category(); as current) {
                            <app-icon-badge
                              [icon]="current.icon"
                              [color]="current.color"
                              [fallback]="categoryIcon"
                              [size]="32"
                            />
                          } @else {
                            <span class="size-8 rounded-full bg-muted"></span>
                          }
                        </span>
                        <span
                          class="min-w-0 flex-1 truncate text-lg"
                          [class.text-muted-foreground]="!category()"
                        >
                          {{ category()?.name ?? ('transactions.pickCategory' | transloco) }}
                        </span>
                        <ng-icon
                          name="lucideChevronRight"
                          size="20"
                          class="text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                      @if (f.categoryId.touched && f.categoryId.invalid) {
                        <p role="alert" class="px-4 pb-2 pl-17 text-sm text-destructive">
                          {{ 'transactions.categoryRequired' | transloco }}
                        </p>
                      }
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
                  <!-- Less used options, folded (owner's choice in #8): opens by itself when set. -->
                  <button
                    type="button"
                    class="flex min-h-11 items-center gap-1 self-start text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    [attr.aria-expanded]="more()"
                    (click)="more.set(!more())"
                  >
                    {{ 'transactions.more' | transloco }}
                    <ng-icon
                      name="lucideChevronDown"
                      size="16"
                      [class.rotate-180]="more()"
                      aria-hidden="true"
                    />
                  </button>
                  @if (more()) {
                    <div
                      class="-mt-2 flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2"
                    >
                      <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                        <ng-icon name="lucideEyeOff" size="22" aria-hidden="true" />
                      </span>
                      <app-switch-field
                        class="min-w-0 flex-1"
                        [control]="f.excludeFromReport"
                        [label]="'transactions.excludeFromReport' | transloco"
                        [hint]="'transactions.excludeHint' | transloco"
                      />
                    </div>
                  }
                </div>
                <div
                  sheetFooter
                  class="flex flex-col pt-3"
                  [class.-mx-4]="keypad()"
                  [class.-mb-4]="keypad()"
                >
                  <div [class.px-4]="keypad()" [class.pb-2]="keypad()">
                    <button
                      hlmBtn
                      type="submit"
                      class="h-11 w-full text-base"
                      [disabled]="!transactionService.canWrite()"
                    >
                      {{ 'transactions.save' | transloco }}
                    </button>
                  </div>
                  @if (keypad()) {
                    <app-calc-keypad
                      class="pb-[max(0.5rem,env(safe-area-inset-bottom))]"
                      (pressed)="press($event)"
                    />
                  }
                </div>
              </app-sheet-frame>
            </form>
          }
          @case ('wallet') {
            <app-sheet-frame
              [title]="'transactions.walletPick' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                @for (item of walletChoices(); track item.id) {
                  <li>
                    <button
                      type="button"
                      class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      [attr.aria-current]="item.id === f.walletId.value ? 'true' : null"
                      (click)="chooseWallet(item.id)"
                    >
                      <app-icon-badge
                        [icon]="item.icon"
                        [color]="item.color"
                        [fallback]="walletIcon"
                      />
                      <span class="min-w-0 flex-1 truncate text-base">{{ item.name }}</span>
                      @if (item.id === f.walletId.value) {
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
              @if (editingId() && sameCurrencyOnly()) {
                <p class="mt-3 text-sm text-muted-foreground">
                  {{ 'transactions.sameCurrency' | transloco }}
                </p>
              }
            </app-sheet-frame>
          }
          @case ('category') {
            <app-sheet-frame
              [title]="'transactions.categoryPick.' + f.type.value | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              @if (tree().length > 0) {
                <div class="flex flex-col gap-3">
                  <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                    @for (node of tree(); track node.category.id) {
                      <li>
                        <button
                          type="button"
                          class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          [attr.aria-current]="
                            node.category.id === f.categoryId.value ? 'true' : null
                          "
                          (click)="chooseCategory(node.category.id)"
                        >
                          <app-icon-badge
                            [icon]="node.category.icon"
                            [color]="node.category.color"
                            [fallback]="categoryIcon"
                          />
                          <span class="min-w-0 flex-1 truncate text-base">{{
                            node.category.name
                          }}</span>
                          @if (node.category.id === f.categoryId.value) {
                            <ng-icon
                              name="lucideCheck"
                              size="20"
                              class="text-brand"
                              aria-hidden="true"
                            />
                          }
                        </button>
                        @if (node.children.length > 0) {
                          <ul
                            class="tpn-tree"
                            [style.--tree-color]="treeColor(node.category.color)"
                            [attr.aria-label]="node.category.name"
                          >
                            @for (child of node.children; track child.id) {
                              <li>
                                <button
                                  type="button"
                                  class="flex min-h-12 w-full items-center gap-3 py-2 pr-4 pl-7 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                                  [attr.aria-current]="
                                    child.id === f.categoryId.value ? 'true' : null
                                  "
                                  (click)="chooseCategory(child.id)"
                                >
                                  <app-icon-badge
                                    [icon]="child.icon"
                                    [color]="child.color"
                                    [fallback]="categoryIcon"
                                    [size]="32"
                                  />
                                  <span class="min-w-0 flex-1 truncate text-base">{{
                                    child.name
                                  }}</span>
                                  @if (child.id === f.categoryId.value) {
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
                        }
                      </li>
                    }
                  </ul>
                  <p class="text-sm text-muted-foreground">
                    {{ 'transactions.categoryMissing' | transloco }}
                    <button
                      type="button"
                      class="min-h-11 font-semibold text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      (click)="openWalletCategories()"
                    >
                      {{
                        'transactions.walletCategories' | transloco: { name: wallet()?.name ?? '' }
                      }}
                    </button>
                  </p>
                </div>
              } @else {
                <div class="flex flex-col items-center gap-2 px-2 py-8 text-center">
                  <span
                    class="mb-2 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  >
                    <ng-icon name="lucideEyeOff" size="24" aria-hidden="true" />
                  </span>
                  <p class="text-base font-semibold">
                    {{
                      'transactions.noCategories.' + f.type.value
                        | transloco: { name: wallet()?.name ?? '' }
                    }}
                  </p>
                  <p class="text-sm text-muted-foreground">
                    {{ 'transactions.noCategoriesText' | transloco }}
                  </p>
                </div>
              }
              @if (tree().length === 0) {
                <div sheetFooter class="pt-3">
                  <button
                    hlmBtn
                    variant="outline"
                    type="button"
                    class="h-11 w-full text-base"
                    (click)="openWalletCategories()"
                  >
                    {{ 'transactions.toWalletCategories' | transloco }}
                  </button>
                </div>
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
export class TransactionSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  protected languageService = inject(LanguageService)
  protected transactionService = inject(TransactionService)
  private walletService = inject(WalletService)
  private categoryService = inject(CategoryService)
  private profileService = inject(ProfileService)

  protected walletIcon = WALLET_DEFAULT_ICON
  protected treeColor = userColor
  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected noteMax = TRANSACTION_LIMITS.NOTE_MAX
  protected firstDay = TRANSACTION_LIMITS.FIRST_DAY
  protected state = this.transactionService.sheet
  protected view = signal<View>('form')
  /** The amount keypad is showing (opens by itself when adding, owner's choice in #8). */
  protected keypad = signal(false)
  /** The folded "เพิ่มเติม" options. */
  protected more = signal(false)

  /** Rule 3: the expression works out to 1 … 10¹⁵ minor units. */
  private amountValid: ValidatorFn = (control) => {
    if (typeof control.value !== 'string') {
      return null
    }
    // The form isn't built yet on the first run, so the wallet comes from the sibling control.
    const walletId: unknown = control.parent?.get('walletId')?.value
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

  form: TransactionFormGroup = this.nnfb.group({
    type: ['expense'],
    walletId: [''],
    amount: ['', [this.amountValid]],
    categoryId: ['', [withMessage(Validators.required, 'transactions.categoryRequired')]],
    note: ['', [Validators.maxLength(TRANSACTION_LIMITS.NOTE_MAX)]],
    occurredOn: [toDay()],
    excludeFromReport: [false],
  })

  private values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() })
  protected note = computed(() => (this.values().note ?? '').trim())
  protected day = computed(() => this.values().occurredOn ?? toDay())
  protected lastDay = computed(() => addDays(this.transactionService.today(), 365))

  /** The transaction being edited (edit and fix), null when creating. */
  protected editingId = computed(() => {
    const state = this.state()
    return state && state.mode !== 'create' ? state.id : null
  })
  /** The profile the row belongs to (rule 1: it never moves). */
  private profileId = computed(() => {
    const state = this.state()
    const id = this.editingId()
    const row = id ? this.transactionService.byId(id) : null
    if (row) {
      return row.profileId
    }
    return state?.mode === 'fix' ? state.profileId : (this.profileService.current()?.id ?? '')
  })
  /** The wallet the row had when the sheet opened (rule 5 keeps its currency). */
  private startWalletId = signal<string | null>(null)
  protected wallet = computed<Wallet | null>(() => {
    const id = this.values().walletId ?? ''
    return id ? this.walletService.byId(id) : null
  })
  protected category = computed<Category | null>(() => {
    const id = this.values().categoryId ?? ''
    return id ? this.categoryService.byId(id) : null
  })
  protected minorUnit = computed(() =>
    this.walletService.minorUnit(this.wallet()?.currencyCode ?? '')
  )

  protected typeOptions = computed<SelectOption[]>(() => {
    this.languageService.language()
    return TYPES.map((type) => ({
      value: type,
      label: this.transloco.translate(`categories.${type}`),
    }))
  })
  protected heading = computed(() => {
    switch (this.state()?.mode) {
      case 'edit':
        return 'transactions.editHeading'
      case 'fix':
        return 'transactions.fixHeading'
      default:
        return 'transactions.createHeading'
    }
  })

  /** Rule 5: when editing, only wallets in the row's currency. */
  protected sameCurrencyOnly = computed(() => {
    const start = this.startWalletId()
    return start ? (this.walletService.byId(start)?.currencyCode ?? null) : null
  })
  /** Rule 2: the profile's open wallets (and the one the row already has). */
  protected walletChoices = computed<Wallet[]>(() => {
    const currency = this.editingId() ? this.sameCurrencyOnly() : null
    const open = this.walletService
      .openOf(this.profileId())
      .filter((item) => currency === null || item.currencyCode === currency)
    const current = this.wallet()
    return current && !open.some((item) => item.id === current.id) ? [current, ...open] : open
  })
  /** Category rule 13: the type's open categories the wallet doesn't hide. */
  protected tree = computed<CategoryNode[]>(() => {
    const wallet = this.wallet()
    const type = (this.values().type ?? 'expense') as CategoryType
    const hidden = wallet?.hiddenCategoryIds ?? []
    return this.categoryService
      .treeOf(this.profileId(), type)
      .filter((node) => !isHiddenIn(hidden, node.category))
      .map((node) => ({
        category: node.category,
        children: node.children.filter((child) => !isHiddenIn(hidden, child)),
      }))
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

  /** Unsaved input: swiping or tapping the sheet away asks first (DESIGN.md §6). */
  protected dirty = signal(false)
  protected open = signal(false)

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.dirty.set(this.form.dirty))
    // A category of the other type, or one the new wallet hides, no longer fits (rule 2).
    this.form.controls.type.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.dropUnfit())
    this.form.controls.walletId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.dropUnfit()
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

  /** Another row: the expression settles and the keypad closes, as in Money Lover. */
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

  protected chooseCategory(id: string): void {
    this.form.controls.categoryId.setValue(id)
    this.form.controls.categoryId.markAsDirty()
    this.view.set('form')
  }

  /** Category rule 13: the wallet's "หมวดหมู่ที่ใช้", over this sheet. */
  protected openWalletCategories(): void {
    const wallet = this.wallet()
    if (wallet) {
      this.walletService.open({ mode: 'edit', id: wallet.id, view: 'categories' })
    }
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

  /** A hardware keyboard types into the open keypad too. */
  protected onKey(event: KeyboardEvent): void {
    if (!this.keypad() || this.view() !== 'form' || event.target instanceof HTMLInputElement) {
      return
    }
    const key = /^\d$/.test(event.key) ? (event.key as CalcKey) : KEYBOARD[event.key]
    if (key) {
      event.preventDefault()
      event.stopPropagation()
      this.press(key)
    }
  }

  protected save(): void {
    const state = this.state()
    this.settleAmount()
    if (!state || this.form.invalid || !this.transactionService.canWrite()) {
      return
    }
    const value = this.form.getRawValue()
    const amount = evaluate(value.amount, this.minorUnit())
    const values: TransactionValues = {
      walletId: value.walletId,
      categoryId: value.categoryId,
      amount: amount.ok ? amount.minor : 0,
      occurredOn: value.occurredOn,
      note: value.note,
      excludeFromReport: value.excludeFromReport,
    }
    if (state.mode === 'fix') {
      this.transactionService.save(state.id, values, state.opId, state.profileId)
    } else {
      this.transactionService.save(this.editingId(), values)
    }
    toast.success(
      this.transloco.translate(
        state.mode === 'create' ? 'transactions.created' : 'transactions.saved'
      )
    )
    this.finish()
  }

  /** Rule 7: a tombstone at once, "เลิกทำ" in the toast. */
  protected remove(): void {
    const id = this.editingId()
    if (!id) {
      return
    }
    this.transactionService.remove(id)
    toast(this.transloco.translate('transactions.deleted'), {
      action: {
        label: this.transloco.translate('transactions.undo'),
        onClick: () => this.transactionService.restore(id),
      },
    })
    this.finish()
  }

  /** "ปิด": asks first when the form holds unsaved input (DESIGN.md §6). */
  protected close(): void {
    if (this.form.dirty) {
      this.view.set('confirmDiscard')
      return
    }
    this.finish()
  }

  /** Swiped down, tapped the backdrop or pressed Escape. */
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

  /** "=": the expression becomes its result (`120+65` → `185`). */
  private settleAmount(): void {
    const control = this.form.controls.amount
    const result = evaluate(control.value, this.minorUnit())
    if (result.ok && result.minor > 0 && /[+\-×÷]/.test(control.value)) {
      control.setValue(toMajorText(result.minor, this.minorUnit()).replace(/,/g, ''))
    }
  }

  private dropUnfit(): void {
    const category = this.category()
    const wallet = this.wallet()
    const type = this.form.controls.type.value
    if (
      category &&
      (category.type !== type || isHiddenIn(wallet?.hiddenCategoryIds ?? [], category))
    ) {
      // Rule 2: an edit keeps an archived category, but not one that changed type or is hidden.
      this.form.controls.categoryId.setValue('')
    }
  }

  private start(state: TransactionSheetState): void {
    this.view.set('form')
    this.more.set(state.mode !== 'create' && this.startValues(state)?.excludeFromReport === true)
    this.dirty.set(false)
    if (state.mode === 'create') {
      const viewing = this.transactionService.viewWallet()
      const walletId =
        state.walletId ??
        (viewing && !viewing.isArchived ? viewing.id : null) ??
        this.transactionService.defaultWalletId() ??
        ''
      this.startWalletId.set(null)
      this.form.reset({
        type: 'expense',
        walletId,
        amount: '',
        categoryId: '',
        note: '',
        occurredOn: state.occurredOn ?? this.transactionService.today(),
        excludeFromReport: false,
      })
      this.keypad.set(true)
      return
    }
    if (state.mode === 'fix') {
      this.startWalletId.set(this.transactionService.byId(state.id)?.walletId ?? null)
      this.form.reset(this.toForm(state.values))
      this.form.markAllAsTouched()
      this.form.markAsDirty()
      this.dirty.set(true)
      this.keypad.set(false)
      return
    }
    const row = this.transactionService.byId(state.id)
    if (!row) {
      this.state.set(null)
      return
    }
    this.startWalletId.set(row.walletId)
    this.form.reset(this.toForm(row))
    this.keypad.set(false)
  }

  private startValues(state: TransactionSheetState): TransactionValues | null {
    return state.mode === 'fix'
      ? state.values
      : state.mode === 'edit'
        ? this.transactionService.byId(state.id)
        : null
  }

  private toForm(values: TransactionValues) {
    const minorUnit = this.walletService.minorUnit(
      this.walletService.byId(values.walletId)?.currencyCode ?? ''
    )
    return {
      type: this.categoryService.byId(values.categoryId)?.type ?? 'expense',
      walletId: values.walletId,
      amount: values.amount > 0 ? toMajorText(values.amount, minorUnit).replace(/,/g, '') : '',
      categoryId: values.categoryId,
      note: values.note,
      occurredOn: values.occurredOn,
      excludeFromReport: values.excludeFromReport,
    }
  }
}
