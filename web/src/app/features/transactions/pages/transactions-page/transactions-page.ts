import type { ElementRef } from '@angular/core'
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  linkedSignal,
  viewChild,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideArrowLeftRight, lucideCloud, lucideReceiptText } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { CATEGORY_DEFAULT_ICON } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { periodLabel, signedAmount, TransactionService, TransferService } from '@/core/transaction'
import type { EntryItem, PeriodTab } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { addDays, formatAmount, formatMoney, fromDay } from '@/shared/utils'

/** One day's card: the big date, its words, the day's net and its rows (rule 13's order). */
interface DayGroup {
  day: string
  number: string
  /** วันนี้ / เมื่อวาน / the weekday. */
  title: string
  /** Month and year (ค.ศ.). */
  subtitle: string
  total: string
  totalSign: number
  items: {
    item: EntryItem
    /** Unique per row: a transfer has two (transfer → Web screens, Q5). */
    key: string
    amount: string
    /** Money in (income, a transfer received): the income colour; else the expense colour. */
    positive: boolean
    /** The wallet's badge, only while "ทุกกระเป๋า" shows several wallets. */
    wallet: { icon: string; color: string; name: string } | null
    pending: boolean
  }[]
}

/**
 * The Transactions tab (docs/features/transaction.md → Web screens, owner's choices in #8, Money
 * Lover style). The header (layout/transactions-header) holds the wallet switcher and "ดูตาม";
 * this page shows the balance, the period tabs, the period's summary and its days. The shell
 * shows the create step or the first-wallet step instead while those are missing.
 */
@Component({
  selector: 'app-transactions-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState, IconBadge],
  providers: [provideIcons({ lucideArrowLeftRight, lucideCloud, lucideReceiptText })],
  host: { class: 'flex flex-col' },
  template: `
    <div class="flex flex-col items-center px-4 pt-1 pb-2 text-center">
      <span class="text-sm text-muted-foreground">
        {{
          (transactionService.viewWallet() ? 'transactions.balance' : 'transactions.total')
            | transloco
        }}
      </span>
      @for (line of balance(); track line.code) {
        <span
          class="text-2xl leading-snug font-bold tabular-nums"
          [class.text-expense]="line.amount < 0"
        >
          {{ line.text }}
        </span>
      }
    </div>
    <div
      #strip
      class="flex [scrollbar-width:none] gap-1 overflow-x-auto px-2 pb-2 [&::-webkit-scrollbar]:hidden"
      role="tablist"
      [attr.aria-label]="'transactions.periods' | transloco"
    >
      @for (tab of transactionService.tabs(); track tab) {
        <button
          type="button"
          role="tab"
          class="min-h-10 shrink-0 rounded-full px-3.5 text-sm whitespace-nowrap text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-selected:bg-muted aria-selected:font-semibold aria-selected:text-foreground"
          [attr.aria-selected]="tab === transactionService.tab()"
          [attr.data-tab]="tab"
          (click)="transactionService.tab.set(tab)"
        >
          {{ label(tab) }}
        </button>
      }
    </div>
    <div
      class="flex flex-col gap-3 px-4 pt-1 pb-4"
      (pointerdown)="swipeStart($event)"
      (pointerup)="swipeEnd($event)"
    >
      @for (line of summary(); track line.currencyCode) {
        <section
          class="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-3"
          [attr.aria-label]="'transactions.summary' | transloco"
        >
          <div class="flex flex-col">
            <span class="text-xs text-muted-foreground">{{ 'categories.income' | transloco }}</span>
            <span class="text-base font-semibold tabular-nums" [class.text-income]="line.hasIncome">
              {{ line.income }}
            </span>
          </div>
          <div class="flex flex-col items-end">
            <span class="text-xs text-muted-foreground">{{
              'categories.expense' | transloco
            }}</span>
            <span class="text-base font-semibold text-expense tabular-nums">{{
              line.expense
            }}</span>
          </div>
          <div class="col-span-2 flex justify-between border-t border-border pt-2 text-sm">
            <span class="text-muted-foreground">{{ 'transactions.net' | transloco }}</span>
            <span class="font-semibold tabular-nums">{{ line.net }}</span>
          </div>
          @if (line.transfer) {
            <!-- Transfers in − out of the wallets in view, when they don't cancel out. -->
            <div class="col-span-2 -mt-1 flex justify-between text-sm">
              <span class="text-muted-foreground">{{ 'transfers.summaryLine' | transloco }}</span>
              <span class="font-semibold tabular-nums">{{ line.transfer }}</span>
            </div>
          }
        </section>
      }
      @for (group of days(); track group.day) {
        <section
          class="rounded-2xl border border-border bg-card pt-1 pb-1.5"
          [attr.aria-label]="group.title + ' ' + group.subtitle"
        >
          <div class="flex items-center gap-3 px-4 pt-3 pb-1.5">
            <span
              class="min-w-11 text-[2rem] leading-none font-semibold tabular-nums"
              aria-hidden="true"
            >
              {{ group.number }}
            </span>
            <span
              class="flex min-w-0 flex-1 flex-col text-[0.8125rem] leading-snug text-muted-foreground"
            >
              <span>{{ group.title }}</span>
              <span>{{ group.subtitle }}</span>
            </span>
            <span class="text-base font-semibold tabular-nums">{{ group.total }}</span>
          </div>
          <ul>
            @for (row of group.items; track row.key) {
              <li>
                <button
                  type="button"
                  class="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                  (click)="openRow(row.item)"
                >
                  <span class="relative shrink-0">
                    @if (row.item.kind === 'transfer') {
                      <span
                        class="flex size-10 items-center justify-center rounded-full bg-muted text-foreground"
                      >
                        <ng-icon name="lucideArrowLeftRight" size="20" aria-hidden="true" />
                      </span>
                    } @else {
                      <app-icon-badge
                        [icon]="row.item.categoryIcon"
                        [color]="row.item.categoryColor"
                        [fallback]="categoryIcon"
                      />
                    }
                    @if (row.wallet; as wallet) {
                      <!-- Which wallet, on "ทุกกระเป๋า" (owner's choice ก in #8). -->
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
                    @if (row.item.kind === 'transfer') {
                      <span class="truncate text-base font-semibold">{{
                        'transfers.title' | transloco
                      }}</span>
                      <span class="truncate text-sm text-muted-foreground">{{
                        (row.item.side === 'out' ? 'transfers.toWallet' : 'transfers.fromWallet')
                          | transloco: { name: row.item.otherWalletName }
                      }}</span>
                    } @else {
                      <span class="truncate text-base font-semibold">{{
                        row.item.categoryName
                      }}</span>
                    }
                    @if (row.wallet; as wallet) {
                      <span class="sr-only">{{ wallet.name }}</span>
                    }
                    @if (row.item.note) {
                      <span class="truncate text-sm text-muted-foreground">{{
                        row.item.note
                      }}</span>
                    }
                    @if (row.pending) {
                      <span class="flex items-center gap-1 text-xs text-muted-foreground">
                        <ng-icon name="lucideCloud" size="12" aria-hidden="true" />
                        {{ 'transactions.pending' | transloco }}
                      </span>
                    }
                  </span>
                  <span
                    class="shrink-0 text-right text-base tabular-nums"
                    [class.text-income]="row.positive"
                    [class.text-expense]="!row.positive"
                  >
                    {{ row.amount }}
                  </span>
                </button>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <app-empty-state
          [heading]="'transactions.emptyHeading' | transloco"
          [description]="'transactions.emptyText' | transloco"
        >
          <ng-icon name="lucideReceiptText" />
        </app-empty-state>
        <button
          hlmBtn
          type="button"
          class="-mt-10 h-11 self-center px-5 text-base"
          [disabled]="!transactionService.canWrite()"
          (click)="transactionService.open({ mode: 'create' })"
        >
          {{ 'transactions.add' | transloco }}
        </button>
      }
      @if (hasMore()) {
        <div #more class="h-px" aria-hidden="true"></div>
      }
    </div>
  `,
})
export class TransactionsPage {
  protected transactionService = inject(TransactionService)
  private transferService = inject(TransferService)
  private walletService = inject(WalletService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private route = inject(ActivatedRoute)
  private router = inject(Router)
  private strip = viewChild.required<ElementRef<HTMLElement>>('strip')
  private swipeFrom: { x: number; y: number } | null = null
  private more = viewChild<ElementRef<HTMLElement>>('more')
  private readonly PAGE = 100
  /**
   * Rows drawn so far (Volume: a long period such as "ทั้งหมด" holds thousands); more come as the
   * end of the list scrolls into view. Back to one page when the period or wallet changes.
   */
  private limit = linkedSignal({
    source: () => [this.transactionService.range(), this.transactionService.viewWalletIds()],
    computation: () => this.PAGE,
  })
  protected hasMore = computed(() => this.transactionService.items().length > this.limit())
  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected walletIcon = WALLET_DEFAULT_ICON

  /** The chosen wallet's balance, or the total per currency (wallet rules 7, 12). */
  protected balance = computed(() => {
    const locale = this.languageService.locale()
    const wallet = this.transactionService.viewWallet()
    if (wallet) {
      const amount = this.walletService.balance(wallet)
      const minorUnit = this.walletService.minorUnit(wallet.currencyCode)
      return [
        {
          code: wallet.currencyCode,
          amount,
          text: formatMoney(amount, wallet.currencyCode, minorUnit, locale),
        },
      ]
    }
    const totals = this.walletService.totals()
    const code = this.walletService.defaultCurrency()
    const lines =
      totals.length > 0
        ? totals
        : [{ currencyCode: code, minorUnit: this.walletService.minorUnit(code), amount: 0 }]
    return lines.map((line) => ({
      code: line.currencyCode,
      amount: line.amount,
      text: formatMoney(line.amount, line.currencyCode, line.minorUnit, locale),
    }))
  })

  /** Rule 11 per currency; signed figures without the symbol (Money Lover style). */
  protected summary = computed(() => {
    const locale = this.languageService.locale()
    return this.transactionService.summaryLines().map((line) => ({
      currencyCode: line.currencyCode,
      hasIncome: line.income > 0,
      hasExpense: line.expense > 0,
      income: formatAmount(line.income, line.minorUnit, locale, true),
      expense: formatAmount(-line.expense, line.minorUnit, locale, true),
      net: formatAmount(line.net, line.minorUnit, locale, true),
      transfer: line.transfer ? formatAmount(line.transfer, line.minorUnit, locale, true) : null,
    }))
  })

  /** The period's rows grouped by day, newest first. */
  protected days = computed<DayGroup[]>(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const all = this.transactionService.items()
    const items = all.slice(0, this.limit())
    const today = this.transactionService.today()
    const showWallet = this.transactionService.viewWallet() === null
    const wallets = new Map(this.walletService.wallets().map((wallet) => [wallet.id, wallet]))
    const pending = this.transactionService.pendingIds()
    // The symbol is left out while every row shares one currency.
    const mixed = new Set(all.map((item) => item.currencyCode)).size > 1
    const money = (minor: number, code: string) => {
      const minorUnit = this.walletService.minorUnit(code)
      return mixed
        ? formatMoney(minor, code, minorUnit, locale)
        : formatAmount(minor, minorUnit, locale, true)
    }
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' })
    const monthYear = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
    const groups: DayGroup[] = []
    for (const item of items) {
      let group = groups.at(-1)
      if (group?.day !== item.occurredOn) {
        const date = fromDay(item.occurredOn)
        group = {
          day: item.occurredOn,
          number: item.occurredOn.slice(8, 10),
          title:
            item.occurredOn === today
              ? this.transloco.translate('transactions.today')
              : item.occurredOn === addDays(today, -1)
                ? this.transloco.translate('transactions.yesterday')
                : weekday.format(date),
          subtitle: monthYear.format(date),
          total: '',
          totalSign: 0,
          items: [],
        }
        groups.push(group)
      }
      const wallet = showWallet ? wallets.get(item.walletId) : undefined
      const signed = entrySign(item)
      group.items.push({
        item,
        key: item.kind === 'transfer' ? `${item.id}:${item.side}` : item.id,
        amount: money(signed, item.currencyCode),
        positive: signed > 0,
        wallet: wallet ? { icon: wallet.icon, color: wallet.color, name: wallet.name } : null,
        pending: pending.has(item.id),
      })
    }
    // A day cut by the page limit still totals all its rows.
    const last = groups.at(-1)?.day ?? ''
    const daySums = new Map<string, Map<string, number>>()
    for (const item of all) {
      if (item.occurredOn < last) {
        break
      }
      // Transfer rule 5: a day's net is income − expense only.
      if (item.kind === 'transfer') {
        continue
      }
      const sums = daySums.get(item.occurredOn) ?? new Map<string, number>()
      sums.set(
        item.currencyCode,
        (sums.get(item.currencyCode) ?? 0) + signedAmount(item.amount, item.type)
      )
      daySums.set(item.occurredOn, sums)
    }
    for (const group of groups) {
      const sums = daySums.get(group.day) ?? new Map<string, number>()
      group.total = [...sums.entries()].map(([code, sum]) => money(sum, code)).join(' · ')
    }
    return groups
  })

  constructor() {
    // Draw the next page once the end of the list comes near.
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                this.limit.update((limit) => limit + this.PAGE)
              }
            },
            { rootMargin: '600px' }
          )
    inject(DestroyRef).onDestroy(() => observer?.disconnect())
    effect(() => {
      const more = this.more()
      observer?.disconnect()
      if (more) {
        observer?.observe(more.nativeElement)
      }
    })
    // "Fix" in the sync sheet opens this page with the rejected op's id.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const fix = params.get('fix')
      if (fix) {
        this.transactionService.openFix(fix)
        this.transferService.openFix(fix)
        void this.router.navigate([], { queryParams: {}, replaceUrl: true })
      }
    })
    // Keep the chosen tab in view (the strip starts at the oldest period).
    effect(() => {
      const tab = this.transactionService.tab()
      this.transactionService.tabs()
      const strip = this.strip().nativeElement
      queueMicrotask(() => {
        const button = strip.querySelector<HTMLElement>(`[data-tab="${String(tab)}"]`)
        if (button) {
          strip.scrollLeft = button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2
        }
      })
    })
  }

  /** A row opens its form; either side of a transfer opens the whole transfer (Q6). */
  protected openRow(item: EntryItem): void {
    if (item.kind === 'transfer') {
      this.transferService.open({ mode: 'edit', id: item.id })
    } else {
      this.transactionService.open({ mode: 'edit', id: item.id })
    }
  }

  protected label(tab: PeriodTab): string {
    this.languageService.language()
    const result = periodLabel(
      this.transactionService.unit(),
      tab,
      this.transactionService.today(),
      this.transactionService.custom()
    )
    return 'key' in result ? this.transloco.translate(result.key) : result.text
  }

  protected swipeStart(event: PointerEvent): void {
    this.swipeFrom = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY }
  }

  /** A sideways swipe over the list moves to the next or previous period. */
  protected swipeEnd(event: PointerEvent): void {
    const from = this.swipeFrom
    this.swipeFrom = null
    if (!from) {
      return
    }
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (Math.abs(dx) < 60 || Math.abs(dy) > 40) {
      return
    }
    const tabs = this.transactionService.tabs()
    const index = tabs.indexOf(this.transactionService.tab())
    if (index < 0 || (index === 0 && dx > 0)) {
      return
    }
    const next = tabs.at(index + (dx < 0 ? 1 : -1))
    if (next !== undefined) {
      this.transactionService.tab.set(next)
    }
  }
}

/** The row's signed amount: a transaction by its category's type, a transfer by its side. */
const entrySign = (item: EntryItem): number =>
  item.kind === 'transfer'
    ? item.side === 'in'
      ? item.amount
      : -item.amount
    : signedAmount(item.amount, item.type)
