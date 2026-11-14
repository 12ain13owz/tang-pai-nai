import { Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronDown, lucideUsers } from '@ng-icons/lucide'
import { ProfileService } from '@/core/profile'
import { IconBadge } from '@/shared/components/icon-badge'

/**
 * The current profile at the left of every data tab's header (owner, 2026-11): one glass
 * capsule with the profile's icon and a ▾, the same on every tab, like the wallet switcher
 * beside it. The name lives in the switch sheet it opens (`ProfileService.switchSheet`, rendered
 * by the shell); a profile shared with me wears a small people badge (sharing rule 10).
 */
@Component({
  selector: 'app-profile-switcher',
  imports: [TranslocoPipe, NgIcon, IconBadge],
  providers: [provideIcons({ lucideChevronDown, lucideUsers })],
  host: { class: 'flex min-w-0' },
  template: `
    @if (profileService.current(); as profile) {
      <button
        type="button"
        class="tpn-hit flex h-9 shrink-0 items-center gap-1 tpn-glass rounded-full py-1 pr-2 pl-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-haspopup="dialog"
        [attr.aria-label]="'profiles.switchLabel' | transloco: { name: profile.name }"
        (click)="profileService.switchSheet.set(true)"
      >
        <span class="relative flex">
          <app-icon-badge [icon]="profile.icon" [color]="profile.color" [size]="28" />
          @if (profileService.isShared()) {
            <span
              class="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background"
            >
              <ng-icon name="lucideUsers" size="10" aria-hidden="true" />
            </span>
          }
        </span>
        <ng-icon
          name="lucideChevronDown"
          size="16"
          class="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </button>
    }
  `,
})
export class ProfileSwitcher {
  protected profileService = inject(ProfileService)
}
