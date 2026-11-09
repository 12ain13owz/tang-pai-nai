import { Component, computed, ElementRef, inject, input, signal, viewChild } from '@angular/core'
import { Router } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArrowLeftRight,
  lucideCalendarRange,
  lucideCheck,
  lucideChevronDown,
  lucideChevronLeft,
  lucideChevronRight,
  lucideEllipsisVertical,
  lucideHandCoins,
  lucidePlane,
  lucideRepeat,
  lucideWallet,
} from '@ng-icons/lucide'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import { REPORT_UNITS, ReportService } from '@/core/report'
import type { ReportUnit } from '@/core/report'
import { PERIOD_UNITS, TransactionService, TransferService } from '@/core/transaction'
import type { PeriodUnit } from '@/core/transaction'
import { IconBadge } from '@/shared/components/icon-badge'
import { SyncStatus } from './sync-status'

/**
 * The Transactions tab's header (transaction.md → Web screens; owner's choice in #8): the
 * profile's icon on the left, the wallet switcher in the very centre, the sync icon and the ⋮
 * menu on the right; both sides are the same width so the switcher stays centred. The menu is a
 * two-level list (transfer.md → Web screens, owner's choice B in #9): "โอนเงิน" and "ดูตาม ›",
 * which turns the menu into the units. The Reports tab uses it too (report.md Q2–Q3): the same
 * wallet, its own units (month, quarter, year, custom) and no "โอนเงิน".
 */
@Component({
  selector: 'app-transactions-header',
  imports: [TranslocoPipe, NgIcon, IconBadge, SyncStatus],
  providers: [
    provideIcons({
      lucideArrowLeftRight,
      lucideCalendarRange,
      lucideCheck,
      lucideChevronDown,
      lucideChevronLeft,
      lucideChevronRight,
      lucideEllipsisVertical,
      lucideHandCoins,
      lucidePlane,
      lucideRepeat,
      lucideWallet,
    }),
  ],
  host: {
    class: 'relative grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-1 pr-1 pl-2',
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'closeMenu(true)',
  },
  template: `
    <div class="flex min-w-0">
      @if (profileService.current(); as profile) {
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-haspopup="dialog"
          [attr.aria-label]="'profiles.switchLabel' | transloco: { name: profile.name }"
          (click)="profileService.switchSheet.set(true)"
        >
          <app-icon-badge [icon]="profile.icon" [color]="profile.color" [size]="28" />
        </button>
      }
    </div>
    <button
      type="button"
      class="flex h-11 max-w-48 min-w-0 items-center gap-2 rounded-full border border-border bg-card py-1 pr-3 pl-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-haspopup="dialog"
      [attr.aria-label]="'transactions.walletSwitch' | transloco: { name: walletName() }"
      (click)="transactionService.walletSheet.set(true)"
    >
      @if (transactionService.viewWallet(); as wallet) {
        <app-icon-badge [icon]="wallet.icon" [color]="wallet.color" [size]="32" />
      } @else {
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <ng-icon name="lucideWallet" size="16" aria-hidden="true" />
        </span>
      }
      <span class="truncate text-base font-semibold">{{ walletName() }}</span>
      <ng-icon
        name="lucideChevronDown"
        size="16"
        class="shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </button>
    <div class="flex items-center justify-end">
      <app-sync-status />
      <button
        #menuButton
        type="button"
        class="flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-haspopup="menu"
        [attr.aria-expanded]="menuOpen()"
        [attr.aria-label]="'transfers.menu' | transloco"
        (click)="toggleMenu()"
      >
        <ng-icon name="lucideEllipsisVertical" size="22" aria-hidden="true" />
      </button>
    </div>
    @if (menuOpen()) {
      <div
        #menu
        role="menu"
        tabindex="-1"
        class="absolute top-full right-2 z-30 -mt-1 min-w-56 rounded-xl border border-border bg-popover py-1.5 text-popover-foreground shadow-lg"
        [attr.aria-label]="
          (level() === 'main' ? 'transfers.menu' : 'transactions.viewBy') | transloco
        "
        (keydown)="onMenuKey($event)"
      >
        @if (level() === 'main') {
          @if (view() === 'transactions' && !profileService.isShared()) {
            <button
              type="button"
              role="menuitem"
              class="flex min-h-11 w-full items-center gap-3 px-4 text-left text-base focus-visible:bg-muted focus-visible:outline-none"
              (click)="transfer()"
            >
              <ng-icon name="lucideArrowLeftRight" size="20" aria-hidden="true" />
              <span class="flex-1">{{ 'transfers.open' | transloco }}</span>
            </button>
          }
          @if (view() === 'transactions' && !profileService.isShared()) {
            <!-- Debts (debt.md Q9): the debts page under the Wallets tab. -->
            <button
              type="button"
              role="menuitem"
              class="flex min-h-11 w-full items-center gap-3 px-4 text-left text-base focus-visible:bg-muted focus-visible:outline-none"
              (click)="debts()"
            >
              <ng-icon name="lucideHandCoins" size="20" aria-hidden="true" />
              <span class="flex-1">{{ 'debts.menu' | transloco }}</span>
              <ng-icon
                name="lucideChevronRight"
                size="16"
                class="text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          }
          @if (view() === 'transactions' && !profileService.isShared()) {
            <!-- Events (event.md Q6): the events page under the Transactions tab. -->
            <button
              type="button"
              role="menuitem"
              class="flex min-h-11 w-full items-center gap-3 px-4 text-left text-base focus-visible:bg-muted focus-visible:outline-none"
              (click)="events()"
            >
              <ng-icon name="lucidePlane" size="20" aria-hidden="true" />
              <span class="flex-1">{{ 'events.menu' | transloco }}</span>
              <ng-icon
                name="lucideChevronRight"
                size="16"
                class="text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          }
          @if (view() === 'transactions' && !profileService.isShared()) {
            <!-- Recurring (recurring.md Q5): the rules page in Account. -->
            <button
              type="button"
              role="menuitem"
              class="flex min-h-11 w-full items-center gap-3 px-4 text-left text-base focus-visible:bg-muted focus-visible:outline-none"
              (click)="recurring()"
            >
              <ng-icon name="lucideRepeat" size="20" aria-hidden="true" />
              <span class="flex-1">{{ 'recurring.menu' | transloco }}</span>
              <ng-icon
                name="lucideChevronRight"
                size="16"
                class="text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          }
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            class="flex min-h-11 w-full items-center gap-3 px-4 text-left text-base focus-visible:bg-muted focus-visible:outline-none"
            (click)="showUnits()"
          >
            <ng-icon name="lucideCalendarRange" size="20" aria-hidden="true" />
            <span class="flex-1">{{ 'transactions.viewBy' | transloco }}</span>
            <span class="flex items-center gap-0.5 text-sm text-muted-foreground">
              {{ 'transactions.unit.' + currentUnit() | transloco }}
              <ng-icon name="lucideChevronRight" size="16" aria-hidden="true" />
            </span>
          </button>
        } @else {
          <button
            type="button"
            role="menuitem"
            class="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium text-muted-foreground focus-visible:bg-muted focus-visible:outline-none"
            [attr.aria-label]="'transfers.menuBack' | transloco"
            (click)="showMain()"
          >
            <ng-icon name="lucideChevronLeft" size="18" aria-hidden="true" />
            {{ 'transactions.viewBy' | transloco }}
          </button>
          @for (unit of units(); track unit) {
            <button
              type="button"
              role="menuitemradio"
              class="flex min-h-11 w-full items-center justify-between gap-6 px-4 text-left text-base focus-visible:bg-muted focus-visible:outline-none"
              [class.font-semibold]="unit === currentUnit()"
              [class.text-brand]="unit === currentUnit()"
              [attr.aria-checked]="unit === currentUnit()"
              (click)="choose(unit)"
            >
              {{ 'transactions.unit.' + unit | transloco }}
              @if (unit === currentUnit()) {
                <ng-icon name="lucideCheck" size="18" aria-hidden="true" />
              }
            </button>
          }
        }
      </div>
    }
  `,
})
export class TransactionsHeader {
  protected profileService = inject(ProfileService)
  protected transactionService = inject(TransactionService)
  private transferService = inject(TransferService)
  private reportService = inject(ReportService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)
  private router = inject(Router)

  /** Which tab it heads: the Transactions tab's menu, or the Reports tab's (report.md Q2). */
  view = input<'transactions' | 'reports'>('transactions')
  protected units = computed<readonly PeriodUnit[]>(() =>
    this.view() === 'reports' ? REPORT_UNITS : PERIOD_UNITS
  )
  protected currentUnit = computed<PeriodUnit>(() =>
    this.view() === 'reports' ? this.reportService.unit() : this.transactionService.unit()
  )
  protected walletName = computed(() => {
    this.languageService.language()
    return (
      this.transactionService.viewWallet()?.name ??
      this.transloco.translate('transactions.allWallets')
    )
  })

  protected menuOpen = signal(false)
  /** The menu's level: its items, or the units of "ดูตาม". */
  protected level = signal<'main' | 'units'>('main')
  private menuButton = viewChild.required<ElementRef<HTMLElement>>('menuButton')
  private menu = viewChild<ElementRef<HTMLElement>>('menu')
  private host = inject<ElementRef<HTMLElement>>(ElementRef)

  protected toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeMenu(false)
      return
    }
    this.level.set('main')
    this.menuOpen.set(true)
    this.focusIn('[role="menuitem"]')
  }

  protected showUnits(): void {
    this.level.set('units')
    // Focus the chosen unit, like a native menu.
    this.focusIn('[aria-checked="true"]')
  }

  protected showMain(): void {
    this.level.set('main')
    this.focusIn('[aria-haspopup="menu"]')
  }

  protected transfer(): void {
    this.closeMenu(false)
    this.transferService.open({ mode: 'create' })
  }

  protected debts(): void {
    this.closeMenu(false)
    void this.router.navigateByUrl('/wallets/debts')
  }

  protected events(): void {
    this.closeMenu(false)
    void this.router.navigateByUrl('/transactions/events')
  }

  protected recurring(): void {
    this.closeMenu(false)
    void this.router.navigateByUrl('/account/recurring')
  }

  protected closeMenu(refocus: boolean): void {
    if (!this.menuOpen()) {
      return
    }
    this.menuOpen.set(false)
    if (refocus) {
      this.menuButton().nativeElement.focus()
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    // The path, not `contains`: a level switch has already removed the item that was tapped.
    if (this.menuOpen() && !event.composedPath().includes(this.host.nativeElement)) {
      this.closeMenu(false)
    }
  }

  /**
   * ↑ / ↓ move between the items, Home / End to the ends, → opens "ดูตาม", ← goes back, Tab
   * leaves (menu pattern).
   */
  protected onMenuKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' && this.level() === 'main') {
      event.preventDefault()
      this.showUnits()
      return
    }
    if (event.key === 'ArrowLeft' && this.level() === 'units') {
      event.preventDefault()
      this.showMain()
      return
    }
    const items = [
      ...(this.menu()?.nativeElement.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []),
    ]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: items.length - 1,
    }
    if (event.key in moves) {
      event.preventDefault()
      items.at(moves[event.key] % items.length)?.focus()
    } else if (event.key === 'Tab') {
      this.closeMenu(false)
    }
  }

  protected choose(unit: PeriodUnit): void {
    this.closeMenu(true)
    if (this.view() === 'reports') {
      if (unit === 'custom') {
        this.reportService.customSheet.set(true)
      } else {
        this.reportService.selectUnit(unit as ReportUnit)
      }
      return
    }
    if (unit === 'custom') {
      this.transactionService.customSheet.set(true)
      return
    }
    this.transactionService.selectUnit(unit)
  }

  private focusIn(selector: string): void {
    setTimeout(() => this.menu()?.nativeElement.querySelector<HTMLElement>(selector)?.focus())
  }
}
