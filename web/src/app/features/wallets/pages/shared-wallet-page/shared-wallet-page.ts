import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { map } from 'rxjs'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArrowLeftRight,
  lucideEye,
  lucideHandCoins,
  lucideRotateCw,
  lucideUsers,
  lucideWifiOff,
} from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { toApiError } from '@/core/api'
import { CATEGORY_DEFAULT_ICON } from '@/core/category'
import { LanguageService } from '@/core/i18n'
import { PageTitleStrategy } from '@/core/routing'
import { SharingService } from '@/core/sharing'
import type { SharedCategory, SharedEntry } from '@/core/sharing'
import { periodLabel, periodRange, periodTabs, today } from '@/core/transaction'
import type { PeriodTab } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { MoneySummaryCard } from '@/shared/components/money-summary'
import type { MoneySummaryLine } from '@/shared/components/money-summary'
import { PeriodStrip } from '@/shared/components/period'
import type { PeriodChip } from '@/shared/components/period'
import { formatAmount, formatMoney, fromDay } from '@/shared/utils'

const NO_RANGE = { from: null, to: null }

/** How a row of the list looks (category, transfer side or debt entry, sharing rule 9). */
interface Row {
  id: string
  name: string
  sub: string
  amount: string
  positive: boolean
  category: SharedCategory | null
  icon: 'lucideArrowLeftRight' | 'lucideHandCoins' | null
}

/**
 * A wallet shared with me (docs/features/sharing.md → Web screens, mock-up frames 8–9): balance,
 * month tabs, the period's summary and entries by day with the owner's categories. Read-only;
 * read online and kept in memory, so offline it shows what this session already read.
 */
@Component({
  selector: 'app-shared-wallet-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState, IconBadge, MoneySummaryCard, PeriodStrip],
  providers: [
    provideIcons({
      lucideArrowLeftRight,
      lucideEye,
      lucideHandCoins,
      lucideRotateCw,
      lucideUsers,
      lucideWifiOff,
    }),
  ],
  template: `
    @if (gone()) {
      <div class="p-4">
        <app-empty-state
          [heading]="'sharing.goneHeading' | transloco"
          [description]="'sharing.goneText' | transloco"
        >
          <ng-icon name="lucideUsers" />
        </app-empty-state>
      </div>
    } @else if (shared(); as data) {
      <div class="flex flex-col">
        <div class="relative flex flex-col items-center gap-0.5 px-4 pt-3 pb-1">
          <span class="text-xs text-muted-foreground">{{
            'sharing.balance' | transloco: { code: data.wallet.currencyCode }
          }}</span>
          <span
            class="text-2xl font-bold tabular-nums"
            [class.text-expense]="data.wallet.balance < 0"
            >{{ balance() }}</span
          >
          <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ng-icon name="lucideUsers" size="14" aria-hidden="true" />
            {{ 'sharing.ownerOf' | transloco: { name: data.owner.displayName } }}
            <span class="rounded-md bg-muted px-1.5 font-semibold">{{
              'sharing.' + data.role | transloco
            }}</span>
          </span>
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            class="absolute top-1 right-2 size-11"
            [attr.aria-label]="'sharing.reload' | transloco"
            [disabled]="!sharingService.canCall() || loading()"
            (click)="reload()"
          >
            <ng-icon name="lucideRotateCw" size="20" aria-hidden="true" />
          </button>
        </div>
        <app-period-strip
          class="border-b border-border pt-2"
          [chips]="chips()"
          [selected]="tab()"
          [label]="'sharing.withMe' | transloco"
          (chosen)="tab.set($any($event))"
        />
        <div class="flex flex-col gap-3 p-4">
          @if (!sharingService.canCall()) {
            <p
              class="flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
              role="status"
            >
              <ng-icon name="lucideWifiOff" size="16" aria-hidden="true" />
              {{ 'sharing.offlineShown' | transloco: { time: readTime() } }}
            </p>
          } @else {
            <p
              class="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              <ng-icon name="lucideEye" size="16" aria-hidden="true" />
              {{ 'sharing.readOnly' | transloco }}
            </p>
          }
          @if (page(); as current) {
            <app-money-summary-card [line]="summary()" />
            @if (days().length === 0) {
              <app-empty-state [heading]="'sharing.noRows' | transloco">
                <ng-icon name="lucideEye" />
              </app-empty-state>
            }
            @for (group of days(); track group.day) {
              <section class="rounded-2xl border border-border bg-card">
                <div class="flex items-center gap-3 border-b border-border px-4 py-2">
                  <span class="w-9 text-2xl font-semibold tabular-nums">{{ group.date }}</span>
                  <span
                    class="flex min-w-0 flex-1 flex-col text-[0.8125rem] leading-snug text-muted-foreground"
                  >
                    <span>{{ group.title }}</span>
                    <span>{{ group.subtitle }}</span>
                  </span>
                  <span class="text-base font-semibold tabular-nums">{{ group.total }}</span>
                </div>
                <ul>
                  @for (row of group.rows; track row.id) {
                    <li class="flex min-h-15 items-center gap-3 px-4 py-2.5">
                      @if (row.category; as category) {
                        <app-icon-badge
                          [icon]="category.icon"
                          [color]="category.color"
                          [fallback]="categoryIcon"
                        />
                      } @else {
                        <span
                          class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                          aria-hidden="true"
                        >
                          <ng-icon [name]="row.icon ?? 'lucideArrowLeftRight'" size="18" />
                        </span>
                      }
                      <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate text-base font-semibold">{{ row.name }}</span>
                        @if (row.sub) {
                          <span class="truncate text-sm text-muted-foreground">{{ row.sub }}</span>
                        }
                      </span>
                      <span
                        class="shrink-0 text-right text-base tabular-nums"
                        [class.text-income]="row.positive"
                        [class.text-expense]="!row.positive"
                        >{{ row.amount }}</span
                      >
                    </li>
                  }
                </ul>
              </section>
            }
            @if (current.truncated) {
              <p class="text-center text-sm text-muted-foreground">
                {{ 'sharing.truncated' | transloco }}
              </p>
            }
          } @else if (!sharingService.canCall()) {
            <app-empty-state [heading]="'sharing.offlineNone' | transloco">
              <ng-icon name="lucideWifiOff" />
            </app-empty-state>
          } @else if (failed()) {
            <app-empty-state [heading]="'sharing.loadFailed' | transloco">
              <ng-icon name="lucideRotateCw" />
            </app-empty-state>
          }
        </div>
      </div>
    } @else if (!sharingService.canCall()) {
      <div class="p-4">
        <app-empty-state [heading]="'sharing.offlineNone' | transloco">
          <ng-icon name="lucideWifiOff" />
        </app-empty-state>
      </div>
    } @else if (failed()) {
      <div class="p-4">
        <app-empty-state [heading]="'sharing.loadFailed' | transloco">
          <ng-icon name="lucideRotateCw" />
        </app-empty-state>
      </div>
    }
  `,
})
export class SharedWalletPage {
  protected sharingService = inject(SharingService)
  private walletService = inject(WalletService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private pageTitleStrategy = inject(PageTitleStrategy)

  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon

  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: null,
  })
  private today = today()
  protected tab = signal<PeriodTab>(0)
  protected gone = signal(false)
  protected failed = signal(false)
  protected loading = signal(false)

  protected shared = computed(() => {
    const id = this.id()
    return id ? this.sharingService.wallet(id) : null
  })
  private range = computed(() => periodRange('month', this.tab(), this.today, NO_RANGE))
  protected page = computed(() => {
    const id = this.id()
    const { from, to } = this.range()
    return id && from ? this.sharingService.entries(id, from, to) : null
  })
  private minorUnit = computed(() =>
    this.walletService.minorUnit(this.shared()?.wallet.currencyCode ?? 'THB')
  )
  private categories = computed(
    () => new Map((this.shared()?.categories ?? []).map((category) => [category.id, category]))
  )

  protected chips = computed<PeriodChip[]>(() => {
    this.languageService.language()
    const first = this.shared()?.wallet.firstOn ?? null
    return periodTabs('month', this.today, first).map((tab) => {
      const label = periodLabel('month', tab, this.today, NO_RANGE)
      return { id: tab, label: 'key' in label ? this.transloco.translate(label.key) : label.text }
    })
  })

  protected balance = computed(() => {
    const data = this.shared()
    return data
      ? formatMoney(
          data.wallet.balance,
          data.wallet.currencyCode,
          this.minorUnit(),
          this.languageService.locale()
        )
      : ''
  })

  protected readTime = computed(() => {
    const at = this.sharingService.readAt()
    return at
      ? new Intl.DateTimeFormat(this.languageService.locale(), { timeStyle: 'short' }).format(at)
      : '–'
  })

  /** The period's income and expense (rows left out of reports aside), the rest and the net. */
  /**
   * As on the Transactions tab (transaction rule 11): income and expense leave out
   * `excludeFromReport` rows, net = income − expense; transfers and debt entries are their own
   * lines, shown when they don't cancel out.
   */
  protected summary = computed<MoneySummaryLine>(() => {
    const totals = { income: 0, expense: 0, transfer: 0, debt: 0 }
    for (const entry of this.page()?.entries ?? []) {
      if (entry.kind !== 'transaction') {
        totals[entry.kind] += entry.amount
      } else if (!entry.excludeFromReport) {
        totals[entry.amount >= 0 ? 'income' : 'expense'] += Math.abs(entry.amount)
      }
    }
    const locale = this.languageService.locale()
    const unit = this.minorUnit()
    const money = (minor: number) => formatAmount(minor, unit, locale, true)
    return {
      hasIncome: totals.income > 0,
      income: money(totals.income),
      expense: money(-totals.expense),
      net: money(totals.income - totals.expense),
      transfer: totals.transfer ? money(totals.transfer) : null,
      debt: totals.debt ? money(totals.debt) : null,
    }
  })

  protected days = computed(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const unit = this.minorUnit()
    const groups: {
      day: string
      date: string
      title: string
      subtitle: string
      total: string
      sum: number
      rows: Row[]
    }[] = []
    for (const entry of this.page()?.entries ?? []) {
      let group = groups.at(-1)
      if (group?.day !== entry.occurredOn) {
        const date = fromDay(entry.occurredOn)
        group = {
          day: entry.occurredOn,
          date: String(date.getDate()).padStart(2, '0'),
          title: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date),
          subtitle: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
            date
          ),
          total: '',
          sum: 0,
          rows: [],
        }
        groups.push(group)
      }
      group.sum += entry.amount
      group.total = formatAmount(group.sum, unit, locale, true)
      group.rows.push(this.row(entry, unit, locale))
    }
    return groups
  })

  constructor() {
    effect(() => {
      const name = this.shared()?.wallet.name ?? null
      untracked(() => this.pageTitleStrategy.setOverride(name))
    })
    inject(DestroyRef).onDestroy(() => this.pageTitleStrategy.setOverride(null))
    // The wallet once per visit; each tab's entries the first time it shows.
    effect(() => {
      const id = this.id()
      const online = this.sharingService.canCall()
      if (id && online) {
        untracked(() => void this.loadWallet(id, false))
      }
    })
    effect(() => {
      const id = this.id()
      const { from, to } = this.range()
      const online = this.sharingService.canCall()
      const known = this.shared() !== null
      if (id && from && online && known) {
        untracked(() => {
          if (!this.sharingService.entries(id, from, to)) {
            void this.loadEntries(id, from, to)
          }
        })
      }
    })
  }

  protected async reload(): Promise<void> {
    const id = this.id()
    const { from, to } = this.range()
    if (!id || !from) {
      return
    }
    await this.loadWallet(id, true)
    await this.loadEntries(id, from, to)
  }

  private row(entry: SharedEntry, unit: number, locale: string): Row {
    const category = entry.categoryId ? (this.categories().get(entry.categoryId) ?? null) : null
    const name =
      entry.kind === 'transaction'
        ? (category?.name ?? '')
        : this.transloco.translate(
            entry.kind === 'transfer'
              ? entry.amount < 0
                ? 'sharing.transferOut'
                : 'sharing.transferIn'
              : entry.amount < 0
                ? 'sharing.debtOut'
                : 'sharing.debtIn'
          )
    return {
      id: entry.id,
      name,
      sub: entry.note,
      amount: formatAmount(entry.amount, unit, locale, true),
      positive: entry.amount >= 0,
      category: entry.kind === 'transaction' ? category : null,
      icon:
        entry.kind === 'transfer'
          ? 'lucideArrowLeftRight'
          : entry.kind === 'debt'
            ? 'lucideHandCoins'
            : null,
    }
  }

  private async loadWallet(id: string, force: boolean): Promise<void> {
    if (!force && this.sharingService.wallet(id)) {
      return
    }
    this.loading.set(true)
    try {
      await this.sharingService.loadWallet(id)
      this.gone.set(false)
      this.failed.set(false)
    } catch (error) {
      this.onFailure(id, error)
    } finally {
      this.loading.set(false)
    }
  }

  private async loadEntries(id: string, from: string, to: string | null): Promise<void> {
    this.loading.set(true)
    try {
      await this.sharingService.loadEntries(id, from, to)
      this.failed.set(false)
    } catch (error) {
      this.onFailure(id, error)
    } finally {
      this.loading.set(false)
    }
  }

  /** Rule 8: a 404 means the wallet is gone for me; anything else can be retried. */
  private onFailure(id: string, error: unknown): void {
    if (toApiError(error).status === 404) {
      this.sharingService.forgetWallet(id)
      this.gone.set(true)
      return
    }
    this.failed.set(true)
  }
}
