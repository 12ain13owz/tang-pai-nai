import { Component, computed, inject } from '@angular/core'
import { ProfileService } from '@/core/profile'
import { PageTitleStrategy } from '@/core/routing'
import { currentUrl, isProfileTab } from './profile-routes'
import { ProfileSwitcher } from './profile-switcher'
import { SessionBanner } from './session-banner'
import { SyncStatus } from './sync-status'
import { UpdateBanner } from './update-banner'

@Component({
  selector: 'app-header',
  imports: [SyncStatus, SessionBanner, UpdateBanner, ProfileSwitcher],
  host: {
    class:
      'sticky top-0 z-10 block border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur',
  },
  template: `
    <div class="flex h-14 items-center justify-between gap-3 px-4">
      @if (showSwitcher()) {
        <h1 class="sr-only">{{ pageTitleStrategy.pageTitle() }}</h1>
        <app-profile-switcher />
      } @else {
        <h1 class="truncate text-lg font-semibold">{{ pageTitleStrategy.pageTitle() }}</h1>
      }
      <app-sync-status class="shrink-0" />
    </div>
    <app-session-banner />
    <app-update-banner />
  `,
})
export class AppHeader {
  protected pageTitleStrategy = inject(PageTitleStrategy)
  private profileService = inject(ProfileService)
  private url = currentUrl()

  /** The profile tabs show the current profile instead of the title (profile.md → Web screens). */
  protected showSwitcher = computed(
    () => isProfileTab(this.url()) && this.profileService.current() !== null
  )
}
