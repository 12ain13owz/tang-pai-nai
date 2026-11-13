import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { AbstractControl, ValidatorFn } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideChevronDown,
  lucideChevronRight,
  lucideClock,
  lucideMinus,
  lucidePlus,
  lucideRepeat,
  lucideTextAlignStart,
  lucideTrash2,
  lucideUser,
  lucideWallet,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import { DEBT_LIMITS, DEBTS_ROUTE, DebtService, toDebt } from '@/core/debt'
import type { DebtCountAs, DebtDirection, PlanValues } from '@/core/debt'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import { describeRepeat, shortDate } from '@/core/recurring'
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
import {
  CalcAmountField,
  CalcKeypad,
  FORM_IMPORTS,
  SegmentedField,
  TextareaField,
} from '@/shared/components/form'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'
import { WalletPick } from '@/shared/components/wallet-pick'
import {
  addDays,
  addMonths,
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

/** Whether the form a control sits in describes a `repaid` debt (the validators run before the
 * form is assigned, so they read the control's parent). */
const repaidIn = (control: AbstractControl): boolean => {
  const parent = control.parent
  return parent?.get('direction')?.value === 'borrowed' && parent.get('countAs')?.value === 'repaid'
}

type View =
  | 'form'
  | 'wallet'
  | 'category'
  | 'note'
  | 'plan'
  | 'planWallet'
  | 'confirmDelete'
  | 'confirmDiscard'

/**
 * The debt form (docs/features/debt.md → Web screens, mock-up frames 3–4): ยืมมา | ให้ยืม, then
 * one card of rows: person, amount (keypad), the wallet the money came into or left (a `repaid`
 * debt: the instalments' category), note, date; "นับเป็นรายจ่าย" (borrowed only); "ผ่อนเป็นงวด"
 * (a recurring rule, debt rule 13); under "เพิ่มเติม" the due date. Editing changes only person,
 * note, due date and the instalments' category; delete in the header asks first (debt rule 5).
 */
@Component({
  selector: 'app-debt-sheet',
  imports: [
    FORM_IMPORTS,
    ReactiveFormsModule,
    TranslocoPipe,
    NgIcon,
    HlmButton,
    HlmDrawerImports,
    CalcAmountField,
    CalcKeypad,
    SegmentedField,
    TextareaField,
    IconBadge,
    SheetFrame,
    DebtCategoryPick,
    DateRow,
    WalletPick,
  ],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideChevronRight,
      lucideClock,
      lucideMinus,
      lucidePlus,
      lucideRepeat,
      lucideTextAlignStart,
      lucideTrash2,
      lucideUser,
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
                @if (editing()) {
                  <div sheetActions class="flex">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="tpn-hit size-9 text-destructive"
                      [disabled]="!debtService.canWrite()"
                      [attr.aria-label]="'debts.delete' | transloco"
                      (click)="view.set('confirmDelete')"
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
                  @if (!editing()) {
                    <app-segmented-field
                      [control]="f.direction"
                      [label]="'debts.direction' | transloco"
                      [options]="directionOptions()"
                    />
                  }
                  <div
                    class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                  >
                    <div>
                      <label class="flex min-h-15 items-center gap-3 px-4 py-2">
                        <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                          <ng-icon name="lucideUser" size="22" aria-hidden="true" />
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span class="text-xs text-muted-foreground">{{
                            'debts.person.' + direction() | transloco
                          }}</span>
                          <input
                            class="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
                            autocomplete="off"
                            list="debt-people"
                            [maxLength]="personMax"
                            [placeholder]="'debts.personPlaceholder' | transloco"
                            [formControl]="f.person"
                          />
                        </span>
                      </label>
                      <datalist id="debt-people">
                        @for (name of debtService.people(); track name) {
                          <option [value]="name"></option>
                        }
                      </datalist>
                      @if (f.person.touched && f.person.invalid) {
                        <p role="alert" class="px-4 pb-2 pl-17 text-sm text-destructive">
                          {{ 'debts.personRequired' | transloco }}
                        </p>
                      }
                    </div>
                    @if (!editing()) {
                      <div class="px-4">
                        <app-calc-amount-field
                          [control]="f.amount"
                          [label]="
                            (repaid() ? 'debts.amountTotal' : 'transactions.amount') | transloco
                          "
                          [currencyCode]="currencyCode()"
                          [minorUnit]="minorUnit()"
                          [locale]="languageService.locale()"
                          [active]="keypad()"
                          (activate)="keypad.set(true)"
                        />
                      </div>
                      @if (!repaid()) {
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
                            <span class="text-xs text-muted-foreground">{{
                              'debts.walletOf.' + direction() + '.principal' | transloco
                            }}</span>
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
                    }
                    @if (repaid()) {
                      <button
                        type="button"
                        class="flex min-h-15 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        (click)="pick('category')"
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
                            'debts.categoryOf' | transloco
                          }}</span>
                          <span class="truncate text-base">{{ category()?.name ?? '' }}</span>
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
                          {{ 'debts.categoryRequired' | transloco }}
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
                    @if (!editing()) {
                      <app-date-row
                        [today]="transactionService.today()"
                        [locale]="languageService.locale()"
                        [control]="f.occurredOn"
                        [value]="values().occurredOn ?? ''"
                        [max]="lastDay()"
                      />
                    }
                  </div>
                  @if (!editing() && direction() === 'borrowed') {
                    <section class="flex flex-col gap-2">
                      <h3 class="px-1 text-sm font-medium text-muted-foreground">
                        {{ 'debts.countAs' | transloco }}
                      </h3>
                      <div
                        class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                        role="radiogroup"
                        [attr.aria-label]="'debts.countAs' | transloco"
                      >
                        @for (option of countOptions; track option) {
                          <button
                            type="button"
                            role="radio"
                            class="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                            [attr.aria-checked]="f.countAs.value === option"
                            (click)="setCountAs(option)"
                          >
                            <span class="flex min-w-0 flex-1 flex-col">
                              <span class="text-base">{{
                                'debts.count.' + option | transloco
                              }}</span>
                              <span class="text-sm text-muted-foreground">{{
                                'debts.count.' + option + 'Hint' | transloco
                              }}</span>
                            </span>
                            <span
                              class="size-5 shrink-0 rounded-full border-2 border-border"
                              [class.border-6]="f.countAs.value === option"
                              [class.border-brand]="f.countAs.value === option"
                              aria-hidden="true"
                            ></span>
                          </button>
                        }
                      </div>
                    </section>
                  }
                  @if (!editing()) {
                    <!-- Instalments as a recurring rule (debt rule 13). -->
                    <div class="overflow-hidden rounded-2xl border border-border bg-card">
                      <button
                        type="button"
                        class="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        (click)="pick('plan')"
                      >
                        <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                          <ng-icon name="lucideRepeat" size="22" aria-hidden="true" />
                        </span>
                        <span class="flex min-w-0 flex-1 flex-col">
                          @if (planText(); as text) {
                            <span class="truncate text-base font-semibold text-brand">{{
                              text.title
                            }}</span>
                            <span class="truncate text-sm text-muted-foreground">{{
                              text.sub
                            }}</span>
                          } @else {
                            <span class="text-base">{{ 'debts.plan' | transloco }}</span>
                            <span class="text-sm text-muted-foreground">{{
                              'debts.planNone' | transloco
                            }}</span>
                          }
                        </span>
                        <ng-icon
                          name="lucideChevronRight"
                          size="20"
                          class="text-muted-foreground"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                    @if (planHint(); as hint) {
                      <p class="-mt-2 px-1 text-sm text-muted-foreground">{{ hint }}</p>
                    }
                  }
                  <button
                    type="button"
                    class="flex min-h-11 items-center gap-1 self-start px-1 text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
                      class="-mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                    >
                      @if (values().dueOn) {
                        <app-date-row
                          [today]="transactionService.today()"
                          [locale]="languageService.locale()"
                          [control]="f.dueOn"
                          [value]="values().dueOn ?? ''"
                          [label]="'debts.dueOn' | transloco"
                          [max]="'2099-12-31'"
                        />
                        <button
                          type="button"
                          class="flex min-h-12 w-full items-center px-4 text-left text-sm text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          (click)="setDue(null)"
                        >
                          {{ 'debts.dueClear' | transloco }}
                        </button>
                      } @else {
                        <button
                          type="button"
                          class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          (click)="setDue(defaultDue())"
                        >
                          <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                            <ng-icon name="lucideClock" size="22" aria-hidden="true" />
                          </span>
                          <span class="flex-1 text-base">{{ 'debts.dueOn' | transloco }}</span>
                          <span class="text-sm text-muted-foreground">{{
                            'debts.dueNone' | transloco
                          }}</span>
                        </button>
                      }
                    </div>
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
              [title]="'debts.walletOf.' + direction() + '.principal' | transloco"
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
          @case ('planWallet') {
            <app-sheet-frame
              [title]="'debts.planWallet' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('plan')"
            >
              <app-wallet-pick
                [wallets]="walletItems()"
                [empty]="'debts.noWallet' | transloco"
                [chosen]="planWalletId()"
                (picked)="planWalletId.set($event); view.set('plan')"
              />
            </app-sheet-frame>
          }
          @case ('category') {
            <app-sheet-frame
              [title]="'debts.categoryOf' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <app-debt-category-pick
                [profileId]="profileId()"
                type="expense"
                [chosen]="f.categoryId.value"
                (picked)="chooseCategory($event)"
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
          @case ('plan') {
            <app-sheet-frame
              [title]="'debts.plan' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-4">
                <div
                  class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                >
                  <div class="flex min-h-14 items-center gap-3 px-4 py-2">
                    <span class="min-w-0 flex-1 text-base">{{
                      'debts.planCount' | transloco
                    }}</span>
                    <button
                      hlmBtn
                      variant="outline"
                      size="icon"
                      type="button"
                      class="size-10"
                      [disabled]="planCount() <= 0"
                      [attr.aria-label]="'debts.planLess' | transloco"
                      (click)="stepCount(-1)"
                    >
                      <ng-icon name="lucideMinus" size="18" aria-hidden="true" />
                    </button>
                    <span class="min-w-10 text-center text-base font-semibold tabular-nums">{{
                      planCount() || '–'
                    }}</span>
                    <button
                      hlmBtn
                      variant="outline"
                      size="icon"
                      type="button"
                      class="size-10"
                      [disabled]="planCount() >= 999"
                      [attr.aria-label]="'debts.planMore' | transloco"
                      (click)="stepCount(1)"
                    >
                      <ng-icon name="lucidePlus" size="18" aria-hidden="true" />
                    </button>
                  </div>
                  <label class="flex min-h-14 items-center gap-3 px-4 py-2">
                    <span class="min-w-0 flex-1 text-base">{{
                      'debts.planAmount' | transloco
                    }}</span>
                    <input
                      class="w-32 rounded-md border border-input bg-transparent px-2 py-1.5 text-right text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      inputmode="decimal"
                      [formControl]="planAmount"
                      [attr.aria-label]="'debts.planAmount' | transloco"
                    />
                  </label>
                  <button
                    type="button"
                    class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                    (click)="view.set('planWallet')"
                  >
                    <span class="min-w-0 flex-1 text-base">{{
                      'debts.planWallet' | transloco
                    }}</span>
                    <span class="truncate text-sm text-muted-foreground">{{
                      planWallet()?.name ?? ''
                    }}</span>
                    <ng-icon
                      name="lucideChevronRight"
                      size="20"
                      class="text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                  <app-date-row
                    [today]="transactionService.today()"
                    [locale]="languageService.locale()"
                    [control]="planStart"
                    [value]="planStartValue()"
                    [label]="'debts.planFirst' | transloco"
                    [max]="'2099-12-31'"
                  />
                </div>
                <section class="flex flex-col gap-2">
                  <h3 class="px-1 text-sm font-medium text-muted-foreground">
                    {{ 'recurring.when' | transloco }}
                  </h3>
                  <div
                    class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
                    role="radiogroup"
                    [attr.aria-label]="'recurring.when' | transloco"
                  >
                    @for (option of [false, true]; track option) {
                      <button
                        type="button"
                        role="radio"
                        class="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                        [attr.aria-checked]="planConfirm() === option"
                        (click)="planConfirm.set(option)"
                      >
                        <span class="min-w-0 flex-1 text-base">{{
                          (option ? 'recurring.ask' : 'recurring.auto') | transloco
                        }}</span>
                        <span
                          class="size-5 shrink-0 rounded-full border-2 border-border"
                          [class.border-6]="planConfirm() === option"
                          [class.border-brand]="planConfirm() === option"
                          aria-hidden="true"
                        ></span>
                      </button>
                    }
                  </div>
                </section>
                <p class="px-1 text-sm text-muted-foreground">
                  {{ (planCount() > 0 ? 'debts.planHint' : 'debts.planOff') | transloco }}
                </p>
              </div>
            </app-sheet-frame>
          }
          @case ('confirmDelete') {
            <app-sheet-frame
              [title]="'debts.deleteHeading' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <div class="flex flex-col gap-3 text-sm text-muted-foreground">
                <p class="text-base font-semibold text-foreground">
                  {{ 'debts.deleteQuestion' | transloco: { name: f.person.value } }}
                </p>
                <p>{{ deleteText() }}</p>
                <p>{{ 'debts.deleteCloseInstead' | transloco }}</p>
              </div>
              <div sheetFooter class="pt-3">
                <button
                  hlmBtn
                  variant="destructive"
                  type="button"
                  class="h-11 w-full text-base"
                  [disabled]="!debtService.canWrite()"
                  (click)="remove()"
                >
                  {{ 'debts.delete' | transloco }}
                </button>
              </div>
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
export class DebtSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  private router = inject(Router)
  protected languageService = inject(LanguageService)
  protected debtService = inject(DebtService)
  private walletService = inject(WalletService)
  private categoryService = inject(CategoryService)
  private profileService = inject(ProfileService)
  protected transactionService = inject(TransactionService)
  private quickAmountsService = inject(QuickAmountsService)

  protected walletIcon = WALLET_DEFAULT_ICON
  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected noteMax = DEBT_LIMITS.NOTE_MAX
  protected personMax = DEBT_LIMITS.PERSON_MAX
  protected readonly countOptions: readonly DebtCountAs[] = ['spent', 'repaid']
  protected state = this.debtService.sheet
  protected view = signal<View>('form')
  protected keypad = signal(false)
  protected more = signal(false)
  protected open = signal(false)
  protected dirty = signal(false)
  protected quickAmounts = computed(() => (this.quickAmountsService.enabled() ? QUICK_AMOUNTS : []))

  /** Rule 6 (transaction rule 3): 1 … 10¹⁵ minor units. */
  private amountValid: ValidatorFn = (control) => {
    if (typeof control.value !== 'string' || this.state()?.mode === 'edit') {
      return null
    }
    // The fields below aren't made yet while the form is built: the wallet from the control's form.
    const walletId: unknown = control.parent?.get('walletId')?.value
    const wallet =
      typeof walletId === 'string' && walletId ? this.walletService.byId(walletId) : null
    const result = evaluate(
      control.value,
      this.walletService.minorUnit(wallet?.currencyCode ?? this.walletService.defaultCurrency())
    )
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
  /** The wallet is needed unless a `repaid` debt (or an edit). */
  private walletValid: ValidatorFn = (control) =>
    this.state()?.mode === 'edit' || repaidIn(control) || control.value ? null : { required: true }
  private categoryValid: ValidatorFn = (control) =>
    repaidIn(control) && !control.value ? { required: true } : null

  form = this.nnfb.group({
    direction: this.nnfb.control<DebtDirection>('borrowed'),
    person: ['', [Validators.required, Validators.maxLength(DEBT_LIMITS.PERSON_MAX)]],
    amount: ['', [this.amountValid]],
    walletId: ['', [this.walletValid]],
    categoryId: ['', [this.categoryValid]],
    note: ['', [Validators.maxLength(DEBT_LIMITS.NOTE_MAX)]],
    occurredOn: [''],
    countAs: this.nnfb.control<DebtCountAs>('spent'),
    dueOn: [''],
  })
  // Instalments (debt rule 13): monthly from the first one, n of them.
  protected planAmount = this.nnfb.control('')
  protected planStart = this.nnfb.control('')
  protected planCount = signal(0)
  protected planConfirm = signal(false)
  protected planWalletId = signal<string | null>(null)
  private planStartValues = toSignal(this.planStart.valueChanges, { initialValue: '' })
  protected planStartValue = computed(
    () => this.planStartValues() || this.transactionService.today()
  )

  protected values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() })
  protected direction = computed(() => this.values().direction ?? 'borrowed')
  protected repaid = computed(() => {
    const state = this.state()
    if (state?.mode === 'edit') {
      return this.debtService.byId(state.id)?.countAs === 'repaid'
    }
    return this.direction() === 'borrowed' && this.values().countAs === 'repaid'
  })
  protected note = computed(() => (this.values().note ?? '').trim())
  protected editing = computed(() => this.state()?.mode === 'edit')
  protected heading = computed(() => {
    const state = this.state()
    return state?.mode === 'edit'
      ? 'debts.editHeading'
      : state?.mode === 'fix'
        ? 'debts.fixHeading'
        : 'debts.createHeading'
  })
  protected profileId = computed(() => this.profileService.current()?.id ?? '')
  protected walletChoices = computed(() => this.walletService.openOf(this.profileId()))
  protected walletItems = computed(() =>
    walletPickItems(
      this.walletChoices(),
      this.walletService,
      this.languageService.locale(),
      (key) => this.transloco.translate(key)
    )
  )
  protected wallet = computed<Wallet | null>(() => {
    const id = this.values().walletId ?? ''
    return id ? this.walletService.byId(id) : null
  })
  protected planWallet = computed<Wallet | null>(() => {
    const id = this.planWalletId()
    return id ? this.walletService.byId(id) : null
  })
  protected category = computed(() => {
    const id = this.values().categoryId ?? ''
    return id ? this.categoryService.byId(id) : null
  })
  protected currencyCode = computed(
    () => this.wallet()?.currencyCode ?? this.walletService.defaultCurrency()
  )
  protected minorUnit = computed(() => this.walletService.minorUnit(this.currencyCode()))
  protected lastDay = computed(() => addDays(this.transactionService.today(), 365))
  protected directionOptions = computed(() => {
    this.languageService.language()
    return (['borrowed', 'lent'] as const).map((value) => ({
      value,
      label: this.transloco.translate(`debts.${value}`),
    }))
  })
  protected planText = computed(() => {
    this.languageService.language()
    const count = this.planCount()
    if (count <= 0) {
      return null
    }
    const locale = this.languageService.locale()
    const amount = parseMajor(this.planAmount.value || '0', this.minorUnit())
    const money = formatMoney(
      amount.ok ? amount.minor : 0,
      this.currencyCode(),
      this.minorUnit(),
      locale
    )
    return {
      title: this.transloco.translate('debts.planTitle', { count, amount: money }),
      sub: [
        describeRepeat({ frequency: 'month', interval: 1 }, this.planStartValue(), this.t, locale),
        this.planWallet()?.name ?? '',
        this.transloco.translate(this.planConfirm() ? 'recurring.ask' : 'recurring.auto'),
      ]
        .filter((part) => part)
        .join(' · '),
    }
  })
  protected planHint = computed(() => {
    this.languageService.language()
    const count = this.planCount()
    if (count <= 0) {
      return null
    }
    const locale = this.languageService.locale()
    const first = this.planStartValue()
    const last = addMonths(first, count - 1)
    return this.transloco.translate('debts.planLine', {
      first: shortDate(first, locale),
      last: shortDate(last, locale),
    })
  })
  protected deleteText = computed(() => {
    this.languageService.language()
    const state = this.state()
    const id = state?.mode === 'edit' ? state.id : null
    const history = id ? this.debtService.history(id) : []
    const entries = history.filter((item) => item.kind === 'entry').length
    return this.transloco.translate('debts.deleteText', { count: entries })
  })
  private t = (key: string, params?: Record<string, unknown>) =>
    this.transloco.translate(key, params)

  constructor() {
    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.dirty.set(this.form.dirty))
    this.form.controls.direction.valueChanges.pipe(takeUntilDestroyed()).subscribe((direction) => {
      if (direction === 'lent') {
        this.form.controls.countAs.setValue('spent')
      }
      this.revalidate()
    })
    this.form.controls.countAs.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.revalidate())
    effect(() => {
      const state = this.state()
      untracked(() => {
        if (state) {
          this.start()
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

  protected setCountAs(value: DebtCountAs): void {
    this.form.controls.countAs.setValue(value)
    this.form.markAsDirty()
  }

  protected defaultDue(): string {
    return addMonths(this.transactionService.today(), 1)
  }

  protected setDue(day: string | null): void {
    this.form.controls.dueOn.setValue(day ?? '')
    this.form.markAsDirty()
  }

  protected stepCount(step: number): void {
    const count = Math.min(999, Math.max(0, this.planCount() + step))
    this.planCount.set(count)
    // The instalment starts as the total split evenly, while the user hasn't typed one.
    const total = evaluate(this.form.controls.amount.value, this.minorUnit())
    if (
      count > 0 &&
      total.ok &&
      total.minor > 0 &&
      (!this.planAmount.dirty || !this.planAmount.value)
    ) {
      this.planAmount.setValue(
        toMajorText(Math.ceil(total.minor / count), this.minorUnit()).replace(/,/g, '')
      )
    }
    this.form.markAsDirty()
    this.dirty.set(true)
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

  protected pick(view: 'wallet' | 'category' | 'note' | 'plan'): void {
    this.settleAmount()
    this.keypad.set(false)
    if (view === 'plan' && !this.planWalletId()) {
      this.planWalletId.set(
        this.form.controls.walletId.value || this.walletChoices().at(0)?.id || null
      )
    }
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
    this.settleAmount()
    this.revalidate()
    if (!state || this.form.invalid || !this.debtService.canWrite()) {
      this.form.markAllAsTouched()
      return
    }
    const value = this.form.getRawValue()
    const edit = {
      person: value.person,
      note: value.note,
      dueOn: value.dueOn || null,
      categoryId: value.categoryId || null,
    }
    if (state.mode === 'edit') {
      this.debtService.update(state.id, edit)
      toast.success(this.t('debts.saved'))
      this.finish()
      return
    }
    if (state.mode === 'fix') {
      this.debtService.fix(state.opId, edit)
      toast.success(this.t('debts.saved'))
      this.finish()
      return
    }
    const amount = evaluate(value.amount, this.minorUnit())
    const repaid = value.direction === 'borrowed' && value.countAs === 'repaid'
    const planAmount = parseMajor(this.planAmount.value || '0', this.minorUnit())
    const planWallet = this.planWalletId()
    const plan: PlanValues | null =
      this.planCount() > 0 && planAmount.ok && planAmount.minor > 0 && planWallet
        ? {
            repeat: {
              frequency: 'month',
              interval: 1,
              endOn: null,
              endCount: this.planCount(),
              confirm: this.planConfirm(),
            },
            startOn: this.planStartValue(),
            amount: planAmount.minor,
            walletId: planWallet,
          }
        : null
    const id = this.debtService.create(
      {
        ...edit,
        direction: value.direction,
        countAs: repaid ? 'repaid' : 'spent',
        amount: amount.ok ? amount.minor : 0,
        walletId: repaid ? null : value.walletId,
        occurredOn: value.occurredOn,
        currencyCode: this.currencyCode(),
      },
      plan
    )
    toast.success(this.t('debts.created'))
    this.finish()
    void this.router.navigate([DEBTS_ROUTE, id])
  }

  protected remove(): void {
    const state = this.state()
    if (state?.mode !== 'edit') {
      return
    }
    this.debtService.remove(state.id)
    toast(this.t('debts.deleted'))
    this.finish()
    void this.router.navigate([DEBTS_ROUTE])
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

  private revalidate(): void {
    this.form.controls.walletId.updateValueAndValidity({ emitEvent: false })
    this.form.controls.categoryId.updateValueAndValidity({ emitEvent: false })
    this.form.controls.amount.updateValueAndValidity({ emitEvent: false })
  }

  private settleAmount(): void {
    const control = this.form.controls.amount
    const result = evaluate(control.value, this.minorUnit())
    if (result.ok && result.minor > 0 && /[+\-×÷]/.test(control.value)) {
      control.setValue(toMajorText(result.minor, this.minorUnit()).replace(/,/g, ''))
    }
  }

  private start(): void {
    const state = this.state()
    this.view.set('form')
    this.dirty.set(false)
    this.planCount.set(0)
    this.planConfirm.set(false)
    this.planWalletId.set(null)
    this.planAmount.reset('')
    this.planStart.reset(addMonths(this.transactionService.today(), 1))
    if (!state) {
      return
    }
    if (state.mode === 'create') {
      const walletId =
        this.transactionService.viewWallet()?.id ?? this.transactionService.defaultWalletId() ?? ''
      this.form.reset({
        direction: state.direction,
        person: '',
        amount: '',
        walletId,
        categoryId: '',
        note: '',
        occurredOn: this.transactionService.today(),
        countAs: 'spent',
        dueOn: '',
      })
      this.more.set(false)
      this.keypad.set(false)
      return
    }
    const refused = state.mode === 'fix' ? this.debtService.refused(state.opId, 'debts') : null
    const debt =
      state.mode === 'edit' ? this.debtService.byId(state.id) : refused ? toDebt(refused) : null
    if (!debt) {
      this.state.set(null)
      return
    }
    this.form.reset({
      direction: debt.direction,
      person: debt.person,
      amount: '',
      walletId: '',
      categoryId: debt.categoryId ?? '',
      note: debt.note,
      occurredOn: this.transactionService.today(),
      countAs: debt.countAs,
      dueOn: debt.dueOn ?? '',
    })
    this.more.set(debt.dueOn !== null)
    this.keypad.set(false)
    if (refused) {
      this.form.markAllAsTouched()
      this.form.markAsDirty()
      this.dirty.set(true)
    }
  }
}
