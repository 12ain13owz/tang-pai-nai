import { Component, computed, DOCUMENT, inject, input } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideChartPie,
  lucideCircleUser,
  lucidePlus,
  lucideReceiptText,
  lucideWallet,
} from '@ng-icons/lucide'
import { ProfileService } from '@/core/profile'
import { NavHistory } from '@/core/routing'
import { TransactionService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'

interface Tab {
  path: string
  /** Translation key. */
  label: string
  icon: string
}

/** Money Lover style bar: two tabs, a raised ➕ (add transaction), two tabs. */
@Component({
  selector: 'app-bottom-tab-bar',
  imports: [TranslocoPipe, RouterLink, NgIcon],
  providers: [
    provideIcons({ lucideChartPie, lucideCircleUser, lucidePlus, lucideReceiptText, lucideWallet }),
  ],
  template: `
    <nav
      [attr.aria-label]="'nav.main' | transloco"
      class="mx-auto grid h-16 max-w-[480px] grid-cols-5 items-stretch border-t border-border bg-background"
    >
      @for (tab of tabs; track tab.path) {
        @if ($index === 2) {
          <div class="flex items-center justify-center">
            <button
              type="button"
              [attr.aria-label]="'nav.add' | transloco"
              aria-haspopup="dialog"
              class="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg ring-4 ring-background focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
              [disabled]="sharedReadOnly()"
              (click)="add()"
            >
              <ng-icon name="lucidePlus" aria-hidden="true" />
            </button>
          </div>
        }
        <a
          [routerLink]="tab.path"
          [class.active]="tab.path === '/' + navHistory.tab()"
          [attr.aria-current]="tab.path === '/' + navHistory.tab() ? 'page' : null"
          (click)="toTop(tab.path)"
          class="group flex flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground focus-visible:outline-none [&.active]:font-semibold [&.active]:text-brand [&.active]:[--ng-icon__stroke-width:2.4]"
        >
          <span
            class="relative flex h-7 w-12 items-center justify-center rounded-full text-xl group-focus-visible:ring-2 group-focus-visible:ring-ring"
          >
            <ng-icon [name]="tab.icon" aria-hidden="true" />
            @if (tab.path === '/account' && accountDot()) {
              <span
                class="absolute top-0 right-2.5 size-2 rounded-full bg-destructive"
                data-testid="account-dot"
              ></span>
              <span class="sr-only">{{ 'sharing.invitesPending' | transloco }}</span>
            }
          </span>
          {{ tab.label | transloco }}
        </a>
      }
    </nav>
  `,
})
export class BottomTabBar {
  /** Invitations to me are waiting (sharing.md → Web screens). */
  accountDot = input(false)
  /**
   * ➕ opens the transaction form over the current tab; with no profile or no wallet yet it
   * leads to the create step or the first-wallet step on the Transactions tab (profile rule 5,
   * wallet rule 12).
   */
  private walletService = inject(WalletService)
  private profileService = inject(ProfileService)
  private transactionService = inject(TransactionService)
  private router = inject(Router)
  private window = inject(DOCUMENT).defaultView
  /** The lit tab: a page opened from another tab keeps that one lit (NavHistory). */
  protected navHistory = inject(NavHistory)

  /** A shared profile I can't write now: a viewer, offline, still loading (sharing rule 10). */
  protected sharedReadOnly = computed(
    () => this.profileService.isShared() && !this.profileService.canWrite()
  )

  protected add(): void {
    if (this.profileService.current() && this.walletService.hasWallet()) {
      this.transactionService.open({ mode: 'create' })
      return
    }
    void this.router.navigate(['/transactions'])
  }

  /**
   * Tapping the tab already showing scrolls it back to the top, as native tab bars do (the
   * router ignores a link to the same URL). Any other tab is a new page, which starts at the
   * top by itself (`withInMemoryScrolling` in app.config).
   */
  protected toTop(path: string): void {
    if (this.router.url.split(/[?#]/)[0] !== path) {
      return
    }
    const view = this.window
    // `matchMedia` may be missing (the test DOM): no motion then.
    const smooth =
      typeof view?.matchMedia === 'function' &&
      !view.matchMedia('(prefers-reduced-motion: reduce)').matches
    view?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' })
  }

  /** The ➕ sits between the 2nd and 3rd tab. */
  protected readonly tabs: readonly Tab[] = [
    { path: '/transactions', label: 'nav.transactions', icon: 'lucideReceiptText' },
    { path: '/wallets', label: 'nav.wallets', icon: 'lucideWallet' },
    { path: '/reports', label: 'nav.reports', icon: 'lucideChartPie' },
    { path: '/account', label: 'nav.account', icon: 'lucideCircleUser' },
  ]
}
