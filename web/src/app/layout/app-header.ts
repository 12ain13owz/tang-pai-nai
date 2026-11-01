import { Component, computed, inject } from '@angular/core'
import { RouterLink } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronLeft } from '@ng-icons/lucide'
import { ProfileService } from '@/core/profile'
import { PageTitleStrategy } from '@/core/routing'
import { currentUrl, isProfileTab, parentOf } from './profile-routes'
import { ProfileSwitcher } from './profile-switcher'
import { SessionBanner } from './session-banner'
import { SyncStatus } from './sync-status'
import { UpdateBanner } from './update-banner'

@Component({
  selector: 'app-header',
  imports: [
    RouterLink,
    TranslocoPipe,
    NgIcon,
    SyncStatus,
    SessionBanner,
    UpdateBanner,
    ProfileSwitcher,
  ],
  providers: [provideIcons({ lucideChevronLeft })],
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
        <div class="flex min-w-0 items-center gap-1">
          @if (parent(); as link) {
            <a
              class="-ml-3 flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              [routerLink]="link"
              [attr.aria-label]="'header.back' | transloco"
            >
              <ng-icon name="lucideChevronLeft" size="24" aria-hidden="true" />
            </a>
          }
          <h1 class="truncate text-lg font-semibold">{{ pageTitleStrategy.pageTitle() }}</h1>
        </div>
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
  /** A page inside the Account tab goes back to it (owner's choice A1 in #7). */
  protected parent = computed(() => parentOf(this.url()))
  protected showSwitcher = computed(
    () => isProfileTab(this.url()) && this.profileService.current() !== null
  )
}
