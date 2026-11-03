import { Component, computed, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { CategoryService } from '@/core/category'
import { ProfileService } from '@/core/profile'
import { TransactionService, TransferService } from '@/core/transaction'
import { KeyboardService } from '@/core/viewport'
import { WalletService } from '@/core/wallet'
import { CustomRangeSheet } from '@/shared/components/period'
import { AppHeader } from './app-header'
import { BottomTabBar } from './bottom-tab-bar'
import { CategorySheet } from './category-sheet'
import { ProfileCreateStep } from './profile-create-step'
import { currentUrl, isProfileTab, isWalletTab } from './profile-routes'
import { ProfileSheet } from './profile-sheet'
import { ProfileSwitchSheet } from './profile-switch-sheet'
import { TransactionSheet } from './transaction-sheet'
import { TransferSheet } from './transfer-sheet'
import { ViewWalletSheet } from './view-wallet-sheet'
import { WalletFirstStep } from './wallet-first-step'
import { WalletSheet } from './wallet-sheet'

/** Layout route for the signed-in tabs: header, page, fixed bottom tab bar. */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    TranslocoPipe,
    HlmSpinner,
    AppHeader,
    BottomTabBar,
    ProfileCreateStep,
    ProfileSheet,
    WalletFirstStep,
    WalletSheet,
    CategorySheet,
    ProfileSwitchSheet,
    ViewWalletSheet,
    CustomRangeSheet,
    TransactionSheet,
    TransferSheet,
  ],
  template: `
    <div class="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <app-header />
      <main class="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))]">
        @switch (gate()) {
          @case ('loading') {
            <div class="flex justify-center py-16">
              <hlm-spinner [aria-label]="'profiles.loading' | transloco" />
            </div>
          }
          @case ('create') {
            <app-profile-create-step />
          }
          @case ('firstWallet') {
            <app-wallet-first-step />
          }
          @default {
            <router-outlet />
          }
        }
      </main>
    </div>
    @if (!keyboardService.isOpen()) {
      <app-bottom-tab-bar
        class="fixed inset-x-0 bottom-0 z-10 bg-background pb-[env(safe-area-inset-bottom)]"
      />
    }
    @defer (when profileService.switchSheet()) {
      <app-profile-switch-sheet [(open)]="switchSheetOpen" />
    }
    @defer (when profileService.sheet() !== null) {
      <app-profile-sheet />
    }
    @defer (when walletService.sheet() !== null) {
      <app-wallet-sheet />
    }
    @defer (when categoryService.sheet() !== null) {
      <app-category-sheet />
    }
    @defer (when transactionService.walletSheet()) {
      <app-view-wallet-sheet [(open)]="transactionService.walletSheet" />
    }
    @defer (when transactionService.customSheet()) {
      <app-custom-range-sheet
        [(open)]="transactionService.customSheet"
        [range]="transactionService.custom()"
        (applied)="transactionService.selectCustom($event)"
      />
    }
    @defer (when transactionService.sheet() !== null) {
      <app-transaction-sheet />
    }
    @defer (when transferService.sheet() !== null) {
      <app-transfer-sheet />
    }
  `,
})
export class AppShell {
  protected keyboardService = inject(KeyboardService)
  protected profileService = inject(ProfileService)
  protected walletService = inject(WalletService)
  /** Also keeps its sweep of orphaned sub-categories running (category rule 6). */
  protected categoryService = inject(CategoryService)
  /** Also keeps its sweep of transactions whose wallet or category was deleted (rule 10). */
  protected transactionService = inject(TransactionService)
  /** Also keeps its sweep of transfers whose wallet was deleted (transfer rule 8). */
  protected transferService = inject(TransferService)
  protected switchSheetOpen = this.profileService.switchSheet
  private url = currentUrl()

  /**
   * Profile rule 5: the data tabs need a profile (wait for a new device's first pull); wallet
   * rule 12: the Transactions and Wallets tabs then need a wallet.
   */
  protected gate = computed(() => {
    const url = this.url()
    if (!isProfileTab(url)) {
      return 'page'
    }
    if (this.profileService.current() === null) {
      return this.profileService.ready() ? 'create' : 'loading'
    }
    return isWalletTab(url) && !this.walletService.hasWallet() ? 'firstWallet' : 'page'
  })
}
