import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  inject,
  Injector,
  signal,
} from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { CategoryService } from '@/core/category'
import { NetworkStatusService } from '@/core/network'
import { ProfileService } from '@/core/profile'
import type { SharingService } from '@/core/sharing'
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
import { SharedProfileStep } from './shared-profile-step'
import { TransactionSheet } from './transaction-sheet'
import { TransferSheet } from './transfer-sheet'
import { ViewWalletSheet } from './view-wallet-sheet'
import { WalletFirstStep } from './wallet-first-step'
import { WalletSheet } from './wallet-sheet'

/**
 * Pages about the current profile that a shared one doesn't have (sharing rule 10): its
 * categories, rules, debts, events, export and sharing are the owner's.
 */
const OWN_ONLY = [
  '/account/categories',
  '/account/recurring',
  '/account/export',
  '/account/sharing',
  '/wallets/debts',
  '/transactions/events',
]

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
    SharedProfileStep,
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
          @case ('sharedOffline') {
            <app-shared-profile-step reason="offline" />
          }
          @case ('sharedReports') {
            <app-shared-profile-step reason="reports" />
          }
          @case ('sharedMine') {
            <app-shared-profile-step reason="mine" />
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
        [accountDot]="(sharing()?.inviteCount() ?? 0) > 0"
      />
    }
    @defer (when profileService.switchSheet()) {
      <app-profile-switch-sheet [(open)]="switchSheetOpen" [sharing]="sharing()" />
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
  private networkStatusService = inject(NetworkStatusService)
  private url = currentUrl()
  private injector = inject(Injector)
  /** Family sharing (#16): loaded after the first render, for the Account tab's invite dot. */
  protected sharing = signal<SharingService | null>(null)

  constructor() {
    // Recurring rule 7: due occurrences are recorded whatever tab shows. Loaded after the first
    // render as its own chunk, so the shell's bundle doesn't carry it.
    let destroyed = false
    inject(DestroyRef).onDestroy(() => (destroyed = true))
    afterNextRender(() => {
      void import('@/core/recurring').then(({ RecurringService }) => {
        // The chunk may arrive after the shell is gone (signed out, a spec's teardown).
        if (!destroyed) {
          this.injector.get(RecurringService)
        }
      })
      void import('@/core/sharing').then(({ SharingService }) => {
        if (!destroyed) {
          this.sharing.set(this.injector.get(SharingService))
        }
      })
    })
  }

  /**
   * Profile rule 5: the data tabs need a profile (wait for a new device's first pull); wallet
   * rule 12: the Transactions and Wallets tabs then need a wallet.
   */
  protected gate = computed(() => {
    const url = this.url()
    const shared = this.profileService.shared()
    if (shared && OWN_ONLY.some((path) => url.startsWith(path))) {
      return 'sharedMine'
    }
    if (!isProfileTab(url)) {
      return 'page'
    }
    if (shared) {
      return this.sharedGate(url, shared.status)
    }
    if (this.profileService.current() === null) {
      return this.profileService.ready() ? 'create' : 'loading'
    }
    return isWalletTab(url) && !this.walletService.hasWallet() ? 'firstWallet' : 'page'
  })

  /** Sharing rule 10: a shared profile shows only online, and has no reports. */
  private sharedGate(url: string, status: 'loading' | 'ready') {
    const online =
      this.networkStatusService.isOnline() && this.networkStatusService.serverReachable()
    if (!online) {
      return 'sharedOffline'
    }
    if (status === 'loading') {
      return 'loading'
    }
    return url.startsWith('/reports') ? 'sharedReports' : 'page'
  }
}
