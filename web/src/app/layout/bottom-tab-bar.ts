import { Component, inject, input } from '@angular/core'
import { Router, RouterLink, RouterLinkActive } from '@angular/router'
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
import { TransactionService } from '@/core/transaction'
import { WalletService } from '@/core/wallet'

interface Tab {
  path: string
  /** Translation key. */
  label: string
  icon: string
  exact: boolean
}

/** Money Lover style bar: two tabs, a raised ➕ (add transaction), two tabs. */
@Component({
  selector: 'app-bottom-tab-bar',
  imports: [TranslocoPipe, RouterLink, RouterLinkActive, NgIcon],
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
              class="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg ring-4 ring-background focus-visible:ring-ring focus-visible:outline-none"
              (click)="add()"
            >
              <ng-icon name="lucidePlus" aria-hidden="true" />
            </button>
          </div>
        }
        <a
          [routerLink]="tab.path"
          routerLinkActive="active"
          ariaCurrentWhenActive="page"
          [routerLinkActiveOptions]="{ exact: tab.exact }"
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

  protected add(): void {
    if (this.profileService.current() && this.walletService.hasWallet()) {
      this.transactionService.open({ mode: 'create' })
      return
    }
    void this.router.navigate(['/transactions'])
  }

  /** The ➕ sits between the 2nd and 3rd tab. */
  protected readonly tabs: readonly Tab[] = [
    { path: '/transactions', label: 'nav.transactions', icon: 'lucideReceiptText', exact: false },
    { path: '/wallets', label: 'nav.wallets', icon: 'lucideWallet', exact: false },
    { path: '/reports', label: 'nav.reports', icon: 'lucideChartPie', exact: false },
    { path: '/account', label: 'nav.account', icon: 'lucideCircleUser', exact: false },
  ]
}
