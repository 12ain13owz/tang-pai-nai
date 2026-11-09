import { Component, computed, effect, inject, signal, untracked } from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import type { ValidatorFn } from '@angular/forms'
import { Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideCalendar,
  lucideCheck,
  lucideChevronDown,
  lucideChevronLeft,
  lucideChevronRight,
  lucideCopy,
  lucideEyeOff,
  lucideHandCoins,
  lucideListPlus,
  lucidePause,
  lucidePlane,
  lucidePlay,
  lucideTextAlignStart,
  lucideTrash2,
  lucideX,
} from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { CATEGORY_DEFAULT_ICON, CategoryService } from '@/core/category'
import type { Category, CategoryNode, CategoryType } from '@/core/category'
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
} from '@/core/transaction'
import type { EventOption, TransactionSheetState, TransactionValues } from '@/core/transaction'
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
import {
  addDays,
  addQuickAmount,
  CALC_KEYBOARD,
  evaluate,
  fromDay,
  pressKey,
  toDay,
  toMajorText,
} from '@/shared/utils'
import type { CalcKey } from '@/shared/utils'
import { RepeatRow } from './repeat-row'
import { RepeatView } from './repeat-view'
import type { TransactionFormGroup } from './transaction-form.type'

type View = 'form' | 'wallet' | 'category' | 'note' | 'repeat' | 'event' | 'confirmDiscard'

const TYPES: readonly CategoryType[] = ['expense', 'income']

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
    RepeatRow,
    RepeatView,
  ],
  providers: [
    provideIcons({
      lucideCalendar,
      lucideCheck,
      lucideChevronDown,
      lucideChevronLeft,
      lucideChevronRight,
      lucideCopy,
      lucideEyeOff,
      lucideHandCoins,
      lucideListPlus,
      lucidePause,
      lucidePlane,
      lucidePlay,
      lucideTextAlignStart,
      lucideTrash2,
      lucideX,
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
                      class="size-11"
                      [disabled]="!transactionService.canWrite()"
                      [attr.aria-label]="
                        (current.isPaused ? 'recurring.resume' : 'recurring.pause') | transloco
                      "
                      (click)="togglePause()"
                    >
                      <ng-icon
                        [name]="current.isPaused ? 'lucidePlay' : 'lucidePause'"
                        size="20"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon"
                      type="button"
                      class="size-11 text-destructive"
                      [disabled]="!transactionService.canWrite()"
                      [attr.aria-label]="'recurring.delete' | transloco"
                      (click)="remove()"
                    >
                      <ng-icon name="lucideTrash2" size="20" aria-hidden="true" />
                    </button>
                  </div>
                } @else if (editingId() && transactionService.byId(editingId()!)) {
                  <div sheetActions class="flex">
                    @if (state()?.mode === 'edit') {
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon"
                        type="button"
                        class="size-11"
                        [disabled]="!transactionService.canWrite()"
                        [attr.aria-label]="'transactions.copy' | transloco"
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
                      [disabled]="!transactionService.canWrite()"
                      [attr.aria-label]="'transactions.delete' | transloco"
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
                        <span class="flex min-w-0 flex-col items-center leading-tight">
                          @if (startsRule()) {
                            <span class="text-xs text-muted-foreground">{{
                              'recurring.start' | transloco
                            }}</span>
                          }
                          <span class="truncate">{{ dayText() }}</span>
                        </span>
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
                    @if (showEvent()) {
                      <!-- The event / trip (event rule 5): set by the date when adding. -->
                      <div class="flex min-h-14 items-center gap-1 pr-2">
                        <button
                          type="button"
                          class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          [attr.aria-label]="
                            ('events.field' | transloco) +
                            ' ' +
                            (event()?.name ?? ('events.none' | transloco))
                          "
                          (click)="pick('event')"
                        >
                          <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                            <ng-icon name="lucidePlane" size="22" aria-hidden="true" />
                          </span>
                          <span class="flex min-w-0 flex-1 flex-col">
                            <span class="text-xs text-muted-foreground">{{
                              'events.field' | transloco
                            }}</span>
                            <span
                              class="truncate text-base"
                              [class.text-muted-foreground]="!event()"
                              [class.font-medium]="event()"
                              [class.text-brand]="event()"
                              >{{ event()?.name ?? ('events.none' | transloco) }}</span
                            >
                          </span>
                        </button>
                        @if (event()) {
                          <button
                            hlmBtn
                            variant="ghost"
                            size="icon"
                            type="button"
                            class="size-11 shrink-0"
                            [attr.aria-label]="'events.unlink' | transloco"
                            (click)="chooseEvent(null)"
                          >
                            <ng-icon name="lucideX" size="18" aria-hidden="true" />
                          </button>
                        } @else {
                          <ng-icon
                            name="lucideChevronRight"
                            size="20"
                            class="mr-2 text-muted-foreground"
                            aria-hidden="true"
                          />
                        }
                      </div>
                    }
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
                      class="-mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
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
                      @if (debtLink(); as debt) {
                        <!-- Counted money of a debt (debt rule 3): opens the debt's page. -->
                        <button
                          type="button"
                          class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                          (click)="openDebt(debt.id)"
                        >
                          <span class="flex w-10 shrink-0 justify-center text-muted-foreground">
                            <ng-icon name="lucideHandCoins" size="22" aria-hidden="true" />
                          </span>
                          <span class="flex min-w-0 flex-1 flex-col">
                            <span class="text-xs text-muted-foreground">{{
                              'debts.linked' | transloco
                            }}</span>
                            <span class="truncate text-base">{{ debt.person }}</span>
                          </span>
                          <ng-icon
                            name="lucideChevronRight"
                            size="20"
                            class="text-muted-foreground"
                            aria-hidden="true"
                          />
                        </button>
                      }
                      <div class="flex min-h-14 items-center gap-3 px-4 py-2">
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
                    </div>
                    @if (repeatHint(); as hint) {
                      <p class="-mt-2 px-1 text-sm text-muted-foreground">{{ hint }}</p>
                    }
                  }
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
                      [disabled]="!transactionService.canWrite()"
                    >
                      {{ 'transactions.save' | transloco }}
                    </button>
                    @if (state()?.mode === 'create' && !repeat()) {
                      <!-- Save and add another (8.2): the sheet stays for the next receipt. -->
                      <button
                        hlmBtn
                        variant="outline"
                        size="icon"
                        type="button"
                        class="size-11 shrink-0"
                        [disabled]="!transactionService.canWrite()"
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
                  @if (frequent().length > 0) {
                    <!-- "ใช้บ่อย" (8.2): a shortcut; the tree below keeps the user's order. -->
                    <h3 class="text-sm font-medium text-muted-foreground">
                      {{ 'transactions.frequent' | transloco }}
                    </h3>
                    <ul
                      class="grid grid-cols-4 gap-1 rounded-xl border border-border bg-card p-1.5"
                      [attr.aria-label]="'transactions.frequent' | transloco"
                    >
                      @for (item of frequent(); track item.id) {
                        <li class="min-w-0">
                          <button
                            type="button"
                            class="flex min-h-21 w-full flex-col items-center gap-1 rounded-lg px-1 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                            [class.bg-muted]="item.id === f.categoryId.value"
                            [attr.aria-current]="item.id === f.categoryId.value ? 'true' : null"
                            (click)="chooseCategory(item.id)"
                          >
                            <app-icon-badge
                              [icon]="item.icon"
                              [color]="item.color"
                              [fallback]="categoryIcon"
                            />
                            <span class="line-clamp-2 w-full text-center text-xs break-words">{{
                              item.name
                            }}</span>
                          </button>
                        </li>
                      }
                    </ul>
                    <h3 class="text-sm font-medium text-muted-foreground">
                      {{ 'transactions.allCategories' | transloco }}
                    </h3>
                  }
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
          @case ('event') {
            <app-sheet-frame
              [title]="'events.pick' | transloco"
              leadingIcon="back"
              [leadingLabel]="'sheet.back' | transloco"
              (leading)="view.set('form')"
            >
              <ul class="divide-y divide-border rounded-xl border border-border bg-card">
                <li>
                  <button
                    type="button"
                    class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                    [attr.aria-current]="eventId() === null ? 'true' : null"
                    (click)="chooseEvent(null)"
                  >
                    <span
                      class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                    >
                      <ng-icon name="lucideX" size="20" aria-hidden="true" />
                    </span>
                    <span class="min-w-0 flex-1 truncate text-base">{{
                      'events.none' | transloco
                    }}</span>
                    @if (eventId() === null) {
                      <ng-icon name="lucideCheck" size="20" class="text-brand" aria-hidden="true" />
                    }
                  </button>
                </li>
                @for (item of eventChoices(); track item.id) {
                  <li>
                    <button
                      type="button"
                      class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      [attr.aria-current]="item.id === eventId() ? 'true' : null"
                      (click)="chooseEvent(item.id)"
                    >
                      <app-icon-badge
                        [icon]="item.icon"
                        [color]="item.color"
                        [fallback]="eventIcon"
                      />
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-base">{{ item.name }}</span>
                        <span class="truncate text-sm text-muted-foreground">{{
                          eventDates(item)
                        }}</span>
                      </span>
                      @if (item.id === eventId()) {
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
              @if (eventChoices().length === 0) {
                <p class="mt-3 text-sm text-muted-foreground">
                  {{ 'events.noneOpen' | transloco }}
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
export class TransactionSheet {
  private nnfb = inject(NonNullableFormBuilder)
  private transloco = inject(TranslocoService)
  protected languageService = inject(LanguageService)
  protected transactionService = inject(TransactionService)
  private walletService = inject(WalletService)
  private categoryService = inject(CategoryService)
  private profileService = inject(ProfileService)
  private recurringService = inject(RecurringService)
  private syncService = inject(SyncService)

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
  private router = inject(Router)
  /** The debt this row belongs to (debt rule 3: an instalment, interest), kept by an edit. */
  protected debtId = signal<string | null>(null)
  protected debtLink = computed(() => {
    const id = this.debtId()
    const person = this.transactionService.debtPerson(id)
    return id && person !== null ? { id, person } : null
  })
  /** The event / trip it is tagged to (event rule 3); an edit keeps it. */
  protected eventId = signal<string | null>(null)
  /** Chosen by hand (or kept from the row): the date no longer picks it (event rule 5). */
  private eventChosen = signal(false)
  protected eventIcon = 'lucidePlane' as UserIcon
  /** The open events the picker offers, and the row's own (closed) one. */
  protected eventChoices = computed<EventOption[]>(() =>
    this.transactionService.eventOptions(this.profileId(), this.eventId())
  )
  protected event = computed(() => {
    const id = this.eventId()
    return id ? (this.eventChoices().find((item) => item.id === id) ?? null) : null
  })
  /** Rules carry no event (event rule 9), nor does "ทำซ้ำ". */
  protected showEvent = computed(
    () =>
      !this.ruleMode() &&
      this.repeat() === null &&
      (this.eventChoices().length > 0 || this.eventId() !== null)
  )
  /** "ทำซ้ำ" (docs/features/recurring.md): null = don't repeat. */
  protected repeat = signal<RepeatValues | null>(null)
  private quickAmountsService = inject(QuickAmountsService)
  /** The keypad's quick amounts (8.2), none when turned off in Account › การแสดงผล. */
  protected quickAmounts = computed(() => (this.quickAmountsService.enabled() ? QUICK_AMOUNTS : []))

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
  /** "ทำซ้ำ" shows when adding (not a due occurrence) and on a rule. */
  protected repeatable = computed(() => {
    const state = this.state()
    return (state?.mode === 'create' && !state.occurrence) || this.ruleMode()
  })
  /** The date row starts the rule ("เริ่ม"). */
  protected startsRule = computed(() => this.repeatable() && this.repeat() !== null)
  /** A recorded occurrence: the rule it came from, while it's live. */
  protected fromRule = computed(() => {
    this.languageService.language()
    const state = this.state()
    const row = state?.mode === 'edit' ? this.transactionService.byId(state.id) : null
    const rule = row?.recurringId ? this.recurringService.byId(row.recurringId) : null
    return rule ? { id: rule.id, text: this.describe(rule, rule.startOn) } : null
  })
  protected repeatTitle = computed(() => {
    this.languageService.language()
    const repeat = this.repeat()
    return repeat
      ? describeRepeat(repeat, this.day(), this.t, this.languageService.locale())
      : this.transloco.translate('recurring.none')
  })
  protected repeatSub = computed(() => {
    this.languageService.language()
    const repeat = this.repeat()
    return repeat ? describeRest(repeat, this.t, this.languageService.locale()) : ''
  })
  /** The line under the card: the next date, and on a rule what is recorded already. */
  protected repeatHint = computed(() => {
    this.languageService.language()
    const repeat = this.repeat()
    const locale = this.languageService.locale()
    if (!repeat || !this.repeatable()) {
      return null
    }
    const day = this.day()
    const today = this.transactionService.today()
    const schedule = { ...repeat, startOn: day }
    const rule = this.rule()
    if (rule) {
      const next = rule.nextOn
      const recorded = this.recurringService.recordedCount(rule)
      return [
        next
          ? this.t('recurring.nextLine', { date: shortDate(next, locale) })
          : this.t('recurring.ended'),
        this.t('recurring.recordedLine', { count: recorded }),
        this.t('recurring.editNote'),
      ].join(' · ')
    }
    if (day > today) {
      return this.t('recurring.nextLine', { date: shortDate(day, locale) })
    }
    const next = nextOnOrAfter(schedule, addDays(today, 1))
    return next
      ? this.t('recurring.nextNow', {
          date: shortDate(next, locale),
          first: shortDate(day, locale, false),
        })
      : null
  })
  private t = (key: string, params?: Record<string, unknown>) =>
    this.transloco.translate(key, params)

  /** The profile the row belongs to (rule 1: it never moves). */
  private profileId = computed(() => {
    const state = this.state()
    const rule = this.rule()
    if (rule) {
      return rule.profileId
    }
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
      case 'rule':
        return 'recurring.editHeading'
      case 'fixRule':
        return 'recurring.fixHeading'
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
  /**
   * "ใช้บ่อย" (8.2): up to 4 of the most used categories the picker offers (open, not hidden in
   * the wallet); read only while the picker shows.
   */
  protected frequent = computed<Category[]>(() => {
    if (this.view() !== 'category') {
      return []
    }
    const offered = new Map<string, Category>()
    for (const node of this.tree()) {
      offered.set(node.category.id, node.category)
      for (const child of node.children) {
        offered.set(child.id, child)
      }
    }
    const type = (this.values().type ?? 'expense') as CategoryType
    return this.transactionService
      .frequentCategoryIds(this.profileId(), type)
      .flatMap((id) => offered.get(id) ?? [])
      .slice(0, 4)
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
    // Event rule 5: while adding, the date picks the event until one is chosen by hand.
    effect(() => {
      const state = this.state()
      const day = this.day()
      const profileId = this.profileId()
      if (state?.mode !== 'create' || this.eventChosen()) {
        return
      }
      this.eventId.set(untracked(() => this.transactionService.defaultEventId(profileId, day)))
    })
  }

  /**
   * The keypad shows only while the amount row is in use (owner, 8.2): a tap on, or focus moving
   * to, any other control of the form settles the expression and closes it. Taps on blank space
   * leave it open.
   */
  protected leaveAmount(event: Event): void {
    const target = event.target
    if (
      !this.keypad() ||
      !(target instanceof Element) ||
      target.closest('app-calc-amount-field') ||
      !target.closest('button, input, label, textarea, select, [role="switch"]')
    ) {
      return
    }
    this.settleAmount()
    this.keypad.set(false)
  }

  /** "ทำซ้ำ" changed in its view: the form now holds unsaved input. */
  protected setRepeat(value: RepeatValues | null): void {
    this.repeat.set(value)
    this.form.markAsDirty()
    this.dirty.set(true)
  }

  /** "จากรายการซ้ำ": the rule in this sheet. */
  protected openRule(id: string): void {
    if (this.form.dirty) {
      return
    }
    this.recurringService.open(id)
  }

  /** Recurring rule 5: pause or resume, at once. */
  protected togglePause(): void {
    const rule = this.rule()
    if (!rule) {
      return
    }
    this.recurringService.setPaused(rule.id, !rule.isPaused)
    toast.success(this.t(rule.isPaused ? 'recurring.resumed' : 'recurring.paused2'))
  }

  /** Another row: the expression settles and the keypad closes, as in Money Lover. */
  protected pick(view: 'wallet' | 'category' | 'note' | 'repeat' | 'event'): void {
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

  /** A quick amount adds to the expression, like counting notes (8.2). */
  protected addQuick(major: number): void {
    const control = this.form.controls.amount
    control.setValue(addQuickAmount(control.value, major, this.minorUnit()))
    control.markAsDirty()
  }

  /**
   * "Copy" (8.2): "เพิ่มธุรกรรม" with the form's values and today's date; the row being edited
   * stays as it was saved.
   */
  protected copy(): void {
    const value = this.form.getRawValue()
    const amount = evaluate(value.amount, this.minorUnit())
    this.transactionService.open({
      mode: 'create',
      type: value.type as CategoryType,
      values: {
        walletId: value.walletId,
        categoryId: value.categoryId,
        amount: amount.ok && amount.minor > 0 ? amount.minor : 0,
        occurredOn: this.transactionService.today(),
        note: value.note,
        excludeFromReport: value.excludeFromReport,
        debtId: this.debtId(),
        eventId: this.eventId(),
      },
    })
  }

  /** The event picker's choice (or ×): kept from now on, whatever the date (event rule 5). */
  protected chooseEvent(id: string | null): void {
    this.eventId.set(id)
    this.eventChosen.set(true)
    this.form.markAsDirty()
    this.dirty.set(true)
    this.view.set('form')
  }

  protected eventDates(item: EventOption): string {
    const locale = this.languageService.locale()
    return item.endOn
      ? new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).formatRange(fromDay(item.startOn), fromDay(item.endOn))
      : this.t('events.since', { date: shortDate(item.startOn, locale) })
  }

  /** The "หนี้" row: the debt's page, once nothing here is left unsaved. */
  protected openDebt(id: string): void {
    if (this.form.dirty) {
      return
    }
    this.finish()
    void this.router.navigate(['/wallets/debts', id])
  }

  /** A hardware keyboard types into the open keypad too. */
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

  /** `addAnother` (8.2, adding only): the sheet stays with an empty amount and note. */
  protected save(addAnother = false): void {
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
      debtId: this.debtId(),
      // A rule carries no event (event rule 9), so neither does what "ทำซ้ำ" records.
      eventId: this.repeat() && state.mode === 'create' ? null : this.eventId(),
    }
    const repeat = this.repeat()
    const ruleValues = (repeat: RepeatValues): RuleValues => ({
      ...repeat,
      kind: 'transaction',
      walletId: values.walletId,
      categoryId: values.categoryId,
      toWalletId: null,
      amount: values.amount,
      note: values.note,
      excludeFromReport: values.excludeFromReport,
      debtId: values.debtId,
      startOn: values.occurredOn,
    })
    let done = state.mode === 'create' ? 'transactions.created' : 'transactions.saved'
    if (state.mode === 'rule' || state.mode === 'fixRule') {
      // A rule stays a rule: "ไม่ทำซ้ำ" isn't offered on one (delete it instead).
      this.recurringService.update(
        state.id,
        ruleValues(repeat ?? MONTHLY),
        state.mode === 'fixRule' ? state.opId : null
      )
      done = 'recurring.saved'
    } else if (state.mode === 'fix') {
      this.transactionService.save(state.id, values, state.opId, state.profileId)
    } else if (state.mode === 'create' && state.occurrence) {
      // Recurring rule 10: this month's bill, recorded as the due occurrence.
      this.recurringService.confirm(state.occurrence.ruleId, state.occurrence.on, values)
      done = 'recurring.confirmed'
    } else if (state.mode === 'create' && repeat) {
      this.recurringService.create(ruleValues(repeat))
      done = 'recurring.created'
    } else {
      this.transactionService.save(this.editingId(), values)
    }
    if (state.mode === 'create') {
      this.transactionService.rememberType(value.type as CategoryType)
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

  /** Rule 7: a tombstone at once, "เลิกทำ" in the toast. */
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
    // The controls, not `values()`: this runs in a control's own valueChanges, before the form's
    // (which feeds `values()`) has emitted, so `wallet()` would still be the previous one.
    const { categoryId, walletId, type } = this.form.getRawValue()
    const category = categoryId ? this.categoryService.byId(categoryId) : null
    const wallet = walletId ? this.walletService.byId(walletId) : null
    if (
      category &&
      (category.type !== type || isHiddenIn(wallet?.hiddenCategoryIds ?? [], category))
    ) {
      // Rule 2: an edit keeps an archived category, but not one that changed type or is hidden.
      this.form.controls.categoryId.setValue('')
    }
  }

  private start(state: TransactionSheetState): void {
    this.debtId.set(this.startDebtId(state))
    const startEvent = this.startEventId(state)
    this.eventId.set(startEvent ?? null)
    this.eventChosen.set(startEvent !== undefined)
    this.view.set('form')
    this.more.set(state.mode !== 'create' && this.startValues(state)?.excludeFromReport === true)
    this.dirty.set(false)
    this.repeat.set(state.mode === 'create' && state.repeat ? MONTHLY : null)
    if (state.mode === 'rule' || state.mode === 'fixRule') {
      this.startRule(state)
      return
    }
    if (state.mode === 'edit' && this.transactionService.byId(state.id)?.recurringId) {
      this.more.set(true)
    }
    if (state.mode === 'create') {
      const viewing = this.transactionService.viewWallet()
      const copied = state.values ?? null
      const copiedWallet = copied ? this.walletService.byId(copied.walletId) : null
      // Rule 2: a copy of a row in an archived wallet starts as a new add would.
      const walletId =
        (copiedWallet && !copiedWallet.isArchived ? copiedWallet.id : null) ??
        state.walletId ??
        (viewing && !viewing.isArchived ? viewing.id : null) ??
        this.transactionService.defaultWalletId() ??
        ''
      const copiedCategory = copied ? this.categoryService.byId(copied.categoryId) : null
      this.startWalletId.set(null)
      this.more.set(copied?.excludeFromReport === true)
      this.form.reset({
        type: state.type ?? this.transactionService.lastType(),
        walletId,
        amount:
          copied && copied.amount > 0
            ? toMajorText(
                copied.amount,
                this.walletService.minorUnit(copiedWallet?.currencyCode ?? '')
              ).replace(/,/g, '')
            : '',
        categoryId: copiedCategory && !copiedCategory.isArchived ? copiedCategory.id : '',
        note: copied?.note ?? '',
        occurredOn: state.occurrence?.on ?? state.occurredOn ?? this.transactionService.today(),
        excludeFromReport: copied?.excludeFromReport ?? false,
      })
      this.dropUnfit()
      this.keypad.set(true)
      // The rules page's +: "ทำซ้ำ" shows set, under an open "เพิ่มเติม".
      if (state.repeat || this.debtId()) {
        this.more.set(true)
      }
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
    if (row.debtId) {
      this.more.set(true)
    }
    this.keypad.set(false)
  }

  /**
   * The event a sheet starts with (event rule 5): the row's or the copied one's, the event page's
   * "เพิ่มรายการ"; undefined = a plain add, which the date decides.
   */
  private startEventId(state: TransactionSheetState): string | null | undefined {
    switch (state.mode) {
      case 'create':
        return (
          state.eventId ?? (this.transactionService.liveEventId(state.values?.eventId) || undefined)
        )
      case 'edit':
        return this.transactionService.liveEventId(this.transactionService.byId(state.id)?.eventId)
      case 'fix':
        return this.transactionService.liveEventId(state.values.eventId)
      default:
        return null
    }
  }

  /** The debt a sheet starts linked to (debt rule 3). */
  private startDebtId(state: TransactionSheetState): string | null {
    switch (state.mode) {
      case 'create':
        return state.values?.debtId ?? null
      case 'edit':
        return this.transactionService.byId(state.id)?.debtId ?? null
      case 'fix':
        return state.values.debtId ?? this.transactionService.byId(state.id)?.debtId ?? null
      default:
        return this.recurringService.byId(state.id)?.debtId ?? null
    }
  }

  private startValues(state: TransactionSheetState): TransactionValues | null {
    return state.mode === 'fix'
      ? state.values
      : state.mode === 'edit'
        ? this.transactionService.byId(state.id)
        : null
  }

  /** A rule in this sheet: its template in the form, its schedule in "ทำซ้ำ" (recurring.md). */
  private startRule(state: Extract<TransactionSheetState, { mode: 'rule' | 'fixRule' }>): void {
    const stored = this.recurringService.byId(state.id)
    const refused = state.mode === 'fixRule' ? this.syncService.rejectedOp(state.opId)?.row : null
    const source = refused ? toRuleRow(refused) : stored
    if (!source) {
      this.state.set(null)
      return
    }
    this.startWalletId.set(null)
    this.form.reset(
      this.toForm({
        walletId: source.walletId,
        categoryId: source.categoryId ?? '',
        amount: source.amount,
        occurredOn: source.startOn,
        note: source.note,
        excludeFromReport: source.excludeFromReport,
      })
    )
    this.repeat.set({
      frequency: source.frequency,
      interval: source.interval,
      endOn: source.endOn,
      endCount: source.endCount,
      confirm: source.confirm,
    })
    this.more.set(true)
    this.keypad.set(false)
    if (refused) {
      this.form.markAllAsTouched()
      this.form.markAsDirty()
      this.dirty.set(true)
    }
  }

  private describe(repeat: RepeatValues, startOn: string): string {
    return describeRepeat(repeat, startOn, this.t, this.languageService.locale())
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
