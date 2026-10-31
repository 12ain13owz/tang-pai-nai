import { Component, computed, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { ProfileService } from '@/core/profile'
import { KeyboardService } from '@/core/viewport'
import { AppHeader } from './app-header'
import { BottomTabBar } from './bottom-tab-bar'
import { ProfileCreateStep } from './profile-create-step'
import { currentUrl, isProfileTab } from './profile-routes'
import { ProfileSheet } from './profile-sheet'

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
    @defer (when profileService.sheet() !== null) {
      <app-profile-sheet />
    }
  `,
})
export class AppShell {
  protected keyboardService = inject(KeyboardService)
  protected profileService = inject(ProfileService)
  private url = currentUrl()

  /** Profile rule 5: the data tabs need a profile; wait for a new device's first pull. */
  protected gate = computed(() => {
    if (!isProfileTab(this.url()) || this.profileService.current() !== null) {
      return 'page'
    }
    return this.profileService.ready() ? 'create' : 'loading'
  })
}
