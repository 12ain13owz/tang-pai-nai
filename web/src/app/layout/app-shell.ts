import { Component, computed, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { CategoryService } from '@/core/category'
import { ProfileService } from '@/core/profile'
import { KeyboardService } from '@/core/viewport'
import { WalletService } from '@/core/wallet'
import { AppHeader } from './app-header'
import { BottomTabBar } from './bottom-tab-bar'
import { CategorySheet } from './category-sheet'
import { ProfileCreateStep } from './profile-create-step'
import { currentUrl, isProfileTab, isWalletTab } from './profile-routes'
import { ProfileSheet } from './profile-sheet'
import { ProfileSwitchSheet } from './profile-switch-sheet'
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
  `,
})
export class AppShell {
  protected keyboardService = inject(KeyboardService)
  protected profileService = inject(ProfileService)
  protected walletService = inject(WalletService)
  /** Also keeps its sweep of orphaned sub-categories running (category rule 6). */
  protected categoryService = inject(CategoryService)
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
