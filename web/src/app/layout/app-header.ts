import { Component, computed, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronLeft } from '@ng-icons/lucide'
import { ProfileService } from '@/core/profile'
import { NavHistory, PageTitleStrategy, parentOf } from '@/core/routing'
import { WalletService } from '@/core/wallet'
import { currentUrl, isProfileTab, isReportsTab, isTransactionsTab } from './profile-routes'
import { ProfileSwitcher } from './profile-switcher'
import { SyncStatus } from './sync-status'
import { TransactionsHeader } from './transactions-header'
import { UpdateBanner } from './update-banner'

@Component({
  selector: 'app-header',
  imports: [TranslocoPipe, NgIcon, SyncStatus, UpdateBanner, ProfileSwitcher, TransactionsHeader],
  providers: [provideIcons({ lucideChevronLeft })],
  host: {
    class:
      'sticky top-0 z-10 block border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur',
  },
  template: `
    @if (transactionsHeader()) {
      <h1 class="sr-only">{{ pageTitleStrategy.pageTitle() }}</h1>
      <!-- Its own chunk (initial bundle budget); the placeholder keeps the header's height. -->
      @defer (on immediate) {
        <app-transactions-header [view]="reportsHeader() ? 'reports' : 'transactions'" />
      } @placeholder {
        <div class="h-14"></div>
      }
    } @else if (showSwitcher()) {
      <!-- The Transactions header's layout: profile left, the title in the very centre, sync right. -->
      <div class="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-1 pr-1 pl-2">
        <app-profile-switcher />
        <h1 class="max-w-48 truncate text-lg font-semibold">
          {{ pageTitleStrategy.pageTitle() }}
        </h1>
        <div class="flex justify-end">
          <app-sync-status />
        </div>
      </div>
    } @else {
      <div class="flex h-14 items-center justify-between gap-3 px-4">
        <div class="flex min-w-0 items-center gap-2">
          @if (parent()) {
            <button
              type="button"
              class="tpn-hit flex size-9 shrink-0 items-center justify-center tpn-glass rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              [attr.aria-label]="'header.back' | transloco"
              (click)="navHistory.back()"
            >
              <ng-icon name="lucideChevronLeft" size="18" aria-hidden="true" />
            </button>
          }
          <h1 class="truncate text-lg font-semibold">{{ pageTitleStrategy.pageTitle() }}</h1>
        </div>
        <app-sync-status class="-mr-3 shrink-0" />
      </div>
    }
    <app-update-banner />
  `,
})
export class AppHeader {
  protected pageTitleStrategy = inject(PageTitleStrategy)
  protected navHistory = inject(NavHistory)
  private profileService = inject(ProfileService)
  private walletService = inject(WalletService)
  private url = currentUrl()

  /** The profile tabs show the current profile instead of the title (profile.md → Web screens). */
  /** A page inside a tab has a ‹: back where it was opened from, else up (`NavHistory`). */
  protected parent = computed(() => parentOf(this.url()))
  /** The Reports tab's own page shares the Transactions tab's header (report.md Q2–Q3). */
  protected reportsHeader = computed(() => isReportsTab(this.url()))
  /** The Transactions tab's own header, once its first-wallet step is done (wallet rule 12). */
  protected transactionsHeader = computed(
    () =>
      (isTransactionsTab(this.url()) || this.reportsHeader()) &&
      this.profileService.current() !== null &&
      this.walletService.hasWallet()
  )
  /** A page inside a tab (‹) shows its title instead of the profile. */
  protected showSwitcher = computed(
    () =>
      isProfileTab(this.url()) && this.parent() === null && this.profileService.current() !== null
  )
}
