import { Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChevronDown, lucideUsers } from '@ng-icons/lucide'
import { ProfileService } from '@/core/profile'
import { IconBadge } from '@/shared/components/icon-badge'

/**
 * The header's current profile (decided at the start of #6.1): icon, name and a chevron in place
 * of the page title. Tapping it opens the switch sheet (`ProfileService.switchSheet`, rendered by the shell).
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
        class="-ml-2 flex h-11 min-w-0 items-center gap-2 rounded-full px-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-haspopup="dialog"
        [attr.aria-label]="'profiles.switchLabel' | transloco: { name: profile.name }"
        (click)="profileService.switchSheet.set(true)"
      >
        <app-icon-badge [icon]="profile.icon" [color]="profile.color" [size]="28" />
        @if (profileService.shared(); as shared) {
          <!-- A profile shared with me (sharing rule 10): whose it is under the name. -->
          <span class="flex min-w-0 flex-col items-start leading-tight">
            <span class="max-w-full truncate text-base font-semibold">{{ profile.name }}</span>
            <span class="flex items-center gap-1 text-xs text-muted-foreground">
              <ng-icon name="lucideUsers" size="12" aria-hidden="true" />
              {{ 'sharing.ofOwner' | transloco: { name: shared.owner.displayName } }}
            </span>
          </span>
        } @else {
          <span class="truncate text-lg font-semibold">{{ profile.name }}</span>
        }
        <ng-icon
          name="lucideChevronDown"
          size="20"
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
