import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideCheck,
  lucideChevronDown,
  lucideEllipsisVertical,
  lucideWallet,
} from '@ng-icons/lucide'
import { LanguageService } from '@/core/i18n'
import { ProfileService } from '@/core/profile'
import { PERIOD_UNITS, TransactionService } from '@/core/transaction'
import type { PeriodUnit } from '@/core/transaction'
import { IconBadge } from '@/shared/components/icon-badge'
import { SyncStatus } from './sync-status'

/**
 * The Transactions tab's header (transaction.md → Web screens; owner's choice in #8): the
 * profile's icon on the left, the wallet switcher in the very centre, the sync icon and the ⋮
 * "ดูตาม" menu on the right; both sides are the same width so the switcher stays centred.
 */
@Component({
  selector: 'app-transactions-header',
  imports: [TranslocoPipe, NgIcon, IconBadge, SyncStatus],
  providers: [
    provideIcons({ lucideCheck, lucideChevronDown, lucideEllipsisVertical, lucideWallet }),
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
      <app-sync-status [compact]="true" />
      <button
        #menuButton
        type="button"
        class="flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-haspopup="menu"
        [attr.aria-expanded]="menuOpen()"
        [attr.aria-label]="'transactions.viewBy' | transloco"
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
        class="absolute top-full right-2 z-30 -mt-1 min-w-52 rounded-xl border border-border bg-popover py-1.5 text-popover-foreground shadow-lg"
        [attr.aria-label]="'transactions.viewBy' | transloco"
        (keydown)="onMenuKey($event)"
      >
        <div class="px-4 py-1.5 text-xs text-muted-foreground" aria-hidden="true">
          {{ 'transactions.viewBy' | transloco }}
        </div>
        @for (unit of units; track unit) {
          <button
            type="button"
            role="menuitemradio"
            class="flex min-h-11 w-full items-center justify-between gap-6 px-4 text-left text-base focus-visible:bg-muted focus-visible:outline-none"
            [class.font-semibold]="unit === transactionService.unit()"
            [class.text-brand]="unit === transactionService.unit()"
            [attr.aria-checked]="unit === transactionService.unit()"
            (click)="choose(unit)"
          >
            {{ 'transactions.unit.' + unit | transloco }}
            @if (unit === transactionService.unit()) {
              <ng-icon name="lucideCheck" size="18" aria-hidden="true" />
            }
          </button>
        }
      </div>
    }
  `,
})
export class TransactionsHeader {
  protected profileService = inject(ProfileService)
  protected transactionService = inject(TransactionService)
  private languageService = inject(LanguageService)
  private transloco = inject(TranslocoService)

  protected readonly units = PERIOD_UNITS
  protected walletName = computed(() => {
    this.languageService.language()
    return (
      this.transactionService.viewWallet()?.name ??
      this.transloco.translate('transactions.allWallets')
    )
  })

  protected menuOpen = signal(false)
  private menuButton = viewChild.required<ElementRef<HTMLElement>>('menuButton')
  private menu = viewChild<ElementRef<HTMLElement>>('menu')
  private host = inject<ElementRef<HTMLElement>>(ElementRef)

  protected toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeMenu(false)
      return
    }
    this.menuOpen.set(true)
    // Focus the chosen unit, like a native menu.
    setTimeout(() =>
      this.menu()?.nativeElement.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    )
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
    if (this.menuOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.closeMenu(false)
    }
  }

  /** ↑ / ↓ move between the units, Home / End to the ends, Tab leaves (menu pattern). */
  protected onMenuKey(event: KeyboardEvent): void {
    const items = [
      ...(this.menu()?.nativeElement.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
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
    if (unit === 'custom') {
      this.transactionService.customSheet.set(true)
      return
    }
    this.transactionService.selectUnit(unit)
  }
}
