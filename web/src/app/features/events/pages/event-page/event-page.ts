import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { map } from 'rxjs'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCheck, lucidePencil, lucidePlus, lucideRotateCcw } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { CATEGORY_DEFAULT_ICON } from '@/core/category'
import { EventService } from '@/core/event'
import { LanguageService } from '@/core/i18n'
import { PageTitleStrategy } from '@/core/routing'
import { TransactionService } from '@/core/transaction'
import type { TransactionItem } from '@/core/transaction'
import { WalletService } from '@/core/wallet'
import { EventSheet } from '@/features/events/components/event-sheet'
import { counted, eventDates } from '@/features/events/event-view'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge, WALLET_DEFAULT_ICON } from '@/shared/components/icon-badge'
import type { UserIcon } from '@/shared/components/icon-badge'
import { formatAmount, formatMoney, fromDay } from '@/shared/utils'

/** Rows drawn at a time ("แสดงเพิ่ม"), like the Transactions tab's pages of 100. */
const PAGE = 100

/**
 * An event's page (docs/features/event.md → Web screens 2, mock-up frame 2): its expense, income
 * and net (event rule 4), "จบทริป" / "เปิดอีกครั้ง" and "เพิ่มรายการ", the expense by category,
 * then its rows by day (tap = the transaction sheet).
 */
@Component({
  selector: 'app-event-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState, IconBadge, EventSheet],
  providers: [provideIcons({ lucideCheck, lucidePencil, lucidePlus, lucideRotateCcw })],
  template: `
    @if (item(); as current) {
      <div class="flex flex-col gap-4 p-4">
        <section
          class="relative flex flex-col items-center rounded-2xl border border-border bg-card px-4 pt-3.5 pb-4 text-center"
        >
          <button
            hlmBtn
            variant="ghost"
            size="icon"
            type="button"
            class="absolute top-1.5 right-1.5 size-11"
            [disabled]="!eventService.canWrite()"
            [attr.aria-label]="'events.edit' | transloco"
            (click)="eventService.open({ mode: 'edit', id: current.event.id })"
          >
            <ng-icon name="lucidePencil" size="18" aria-hidden="true" />
          </button>
          <span class="px-10 text-sm text-muted-foreground">{{ heroLabel() }}</span>
          @for (line of money(); track line.code) {
            <span class="text-3xl font-bold text-expense tabular-nums">{{ line.expense }}</span>
            <span class="text-sm text-muted-foreground">
              {{ 'events.income' | transloco }}
              <span class="font-semibold text-income">{{ line.income }}</span>
              · {{ 'events.net' | transloco }}
              <span
                class="font-semibold"
                [class.text-income]="line.positive"
                [class.text-expense]="!line.positive"
                >{{ line.net }}</span
              >
            </span>
          }
          <span class="mt-1 text-sm text-muted-foreground">{{ facts() }}</span>
        </section>
        <div class="flex gap-2">
          @if (current.event.isClosed) {
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11 min-w-0 flex-1"
              [disabled]="!eventService.canWrite()"
              (click)="setClosed(false)"
            >
              <ng-icon name="lucideRotateCcw" size="16" aria-hidden="true" />
              {{ 'events.reopen' | transloco }}
            </button>
          } @else {
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11 min-w-0 flex-1"
              [disabled]="!eventService.canWrite()"
              (click)="setClosed(true)"
            >
              <ng-icon name="lucideCheck" size="16" aria-hidden="true" />
              {{ 'events.close' | transloco }}
            </button>
          }
          <button
            hlmBtn
            type="button"
            class="h-11 min-w-0 flex-1 bg-brand/10 text-brand hover:bg-brand/15"
            [disabled]="!transactionService.canWrite()"
            (click)="add(current.event.id)"
          >
            <ng-icon name="lucidePlus" size="16" aria-hidden="true" />
            {{ 'events.addRow' | transloco }}
          </button>
        </div>
        @if (shares().length > 0) {
          <h2 class="-mb-2 px-1 text-sm font-medium text-muted-foreground">
            {{ 'events.byCategory' | transloco }}
          </h2>
          <ul class="divide-y divide-border rounded-2xl border border-border bg-card">
            @for (share of shares(); track share.key) {
              <li class="flex min-h-15 items-center gap-3 px-4 py-2.5">
                <app-icon-badge
                  [icon]="share.icon"
                  [color]="share.color"
                  [fallback]="categoryIcon"
                />
                <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span class="truncate text-base">{{ share.name }}</span>
                  <span class="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span
                      class="block h-full rounded-full bg-brand"
                      [style.width.%]="share.percent"
                    ></span>
                  </span>
                </span>
                <span class="flex shrink-0 flex-col items-end">
                  <span class="text-base tabular-nums">{{ share.amount }}</span>
                  <span class="text-xs text-muted-foreground">{{ share.percent }}%</span>
                </span>
              </li>
            }
          </ul>
        }
        @if (days().length === 0) {
          <app-empty-state
            [heading]="'events.noRowsHeading' | transloco"
            [description]="'events.noRowsText' | transloco"
          >
            <ng-icon name="lucidePlus" />
          </app-empty-state>
        } @else {
          <h2 class="-mb-2 px-1 text-sm font-medium text-muted-foreground">
            {{ 'events.rowsHeading' | transloco }}
          </h2>
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
                @for (row of group.rows; track row.item.id) {
                  <li>
                    <button
                      type="button"
                      class="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                      (click)="transactionService.open({ mode: 'edit', id: row.item.id })"
                    >
                      <span class="relative shrink-0">
                        <app-icon-badge
                          [icon]="row.item.categoryIcon"
                          [color]="row.item.categoryColor"
                          [fallback]="categoryIcon"
                        />
                        @if (row.wallet; as wallet) {
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
                        <span class="truncate text-base font-semibold">{{
                          row.item.categoryName
                        }}</span>
                        <span class="truncate text-sm text-muted-foreground">{{ row.sub }}</span>
                      </span>
                      <span
                        class="shrink-0 text-right text-base tabular-nums"
                        [class.text-income]="row.item.type === 'income'"
                        [class.text-expense]="row.item.type !== 'income'"
                        >{{ row.amount }}</span
                      >
                    </button>
                  </li>
                }
              </ul>
            </section>
          }
          @if (rows().length > shown()) {
            <button
              hlmBtn
              variant="outline"
              type="button"
              class="h-11"
              (click)="shown.set(shown() + page)"
            >
              {{ 'events.showMore' | transloco: { count: rows().length - shown() } }}
            </button>
          }
        }
      </div>
    } @else {
      <div class="p-4">
        <app-empty-state
          [heading]="'events.goneHeading' | transloco"
          [description]="'events.goneText' | transloco"
        >
          <ng-icon name="lucidePlus" />
        </app-empty-state>
      </div>
    }
    @defer (when eventService.sheet()) {
      <app-event-sheet />
    }
  `,
})
export class EventPage {
  protected eventService = inject(EventService)
  protected transactionService = inject(TransactionService)
  private walletService = inject(WalletService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private pageTitleStrategy = inject(PageTitleStrategy)

  protected categoryIcon = CATEGORY_DEFAULT_ICON as UserIcon
  protected walletIcon = WALLET_DEFAULT_ICON
  protected readonly page = PAGE
  protected shown = signal(PAGE)

  private id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: null,
  })
  protected item = computed(() => {
    const id = this.id()
    return id ? this.eventService.item(id) : null
  })
  private t = (key: string, params?: Record<string, unknown>) =>
    this.transloco.translate(key, params)

  protected heroLabel = computed(() => {
    this.languageService.language()
    const event = this.item()?.event
    return event
      ? `${this.t('events.spent')} · ${eventDates(event, this.t, this.languageService.locale())}`
      : ''
  })
  /** Event rule 4, one line per currency ("0.00" before the first row). */
  protected money = computed(() => {
    const locale = this.languageService.locale()
    const lines = this.item()?.money ?? []
    const shown = lines.length
      ? lines
      : [{ currencyCode: 'THB', minorUnit: 2, income: 0, expense: 0, net: 0 }]
    return shown.map((line) => ({
      code: line.currencyCode,
      expense: formatMoney(line.expense, line.currencyCode, line.minorUnit, locale),
      income: formatAmount(line.income, line.minorUnit, locale, true),
      net: formatAmount(line.net, line.minorUnit, locale, true),
      positive: line.net >= 0,
    }))
  })
  protected facts = computed(() => {
    this.languageService.language()
    const item = this.item()
    if (!item) {
      return ''
    }
    return [
      counted(this.t, 'rows', item.count),
      counted(this.t, 'wallets', item.walletCount),
      ...(item.event.isClosed ? [this.t('events.closedTag')] : []),
    ].join(' · ')
  })
  protected shares = computed(() => {
    const id = this.item()?.event.id
    if (!id) {
      return []
    }
    const locale = this.languageService.locale()
    const shares = this.eventService.byCategory(id)
    const totals = new Map<string, number>()
    for (const share of shares) {
      totals.set(share.currencyCode, (totals.get(share.currencyCode) ?? 0) + share.amount)
    }
    return shares.map((share) => {
      const total = totals.get(share.currencyCode) ?? 0
      return {
        key: `${share.categoryId}:${share.currencyCode}`,
        name: share.name,
        icon: share.icon,
        color: share.color,
        amount: formatAmount(share.amount, share.minorUnit, locale),
        percent: total > 0 ? Math.round((share.amount / total) * 100) : 0,
      }
    })
  })
  /** The event's rows (all its dates, every wallet), newest first. */
  protected rows = computed<TransactionItem[]>(() => {
    const id = this.item()?.event.id
    return id ? this.transactionService.list({ from: null, to: null }, null, { eventId: id }) : []
  })
  protected days = computed(() => {
    this.languageService.language()
    const locale = this.languageService.locale()
    const groups: {
      day: string
      date: string
      title: string
      subtitle: string
      total: string
      rows: {
        item: TransactionItem
        sub: string
        amount: string
        wallet: { icon: string; color: string } | null
      }[]
    }[] = []
    const sums = new Map<string, number>()
    for (const item of this.rows().slice(0, this.shown())) {
      const minorUnit = this.walletService.minorUnit(item.currencyCode)
      const signed = item.type === 'income' ? item.amount : -item.amount
      let group = groups.at(-1)
      if (group?.day !== item.occurredOn) {
        const date = fromDay(item.occurredOn)
        group = {
          day: item.occurredOn,
          date: String(date.getDate()).padStart(2, '0'),
          title: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date),
          subtitle: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
            date
          ),
          total: '',
          rows: [],
        }
        groups.push(group)
      }
      sums.set(item.occurredOn, (sums.get(item.occurredOn) ?? 0) + signed)
      group.total = formatAmount(sums.get(item.occurredOn) ?? 0, minorUnit, locale, true)
      const wallet = this.walletService.byId(item.walletId)
      group.rows.push({
        item,
        sub: [item.walletName, item.note].filter((part) => part).join(' · '),
        amount: formatAmount(signed, minorUnit, locale, true),
        wallet: wallet ? { icon: wallet.icon, color: wallet.color } : null,
      })
    }
    return groups
  })

  constructor() {
    effect(() => {
      const name = this.item()?.event.name ?? null
      untracked(() => this.pageTitleStrategy.setOverride(name))
    })
    inject(DestroyRef).onDestroy(() => this.pageTitleStrategy.setOverride(null))
  }

  protected setClosed(closed: boolean): void {
    const id = this.item()?.event.id
    if (!id) {
      return
    }
    if (!this.eventService.setClosed(id, closed)) {
      toast.error(this.t('events.limit'))
      return
    }
    toast.success(this.t(closed ? 'events.closed' : 'events.reopened'))
  }

  /** "เพิ่มรายการ": the transaction form, tagged to this event (event rule 5). */
  protected add(id: string): void {
    this.transactionService.open({ mode: 'create', eventId: id })
  }
}
