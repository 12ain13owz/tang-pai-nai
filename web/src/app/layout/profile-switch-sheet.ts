import { Component, inject, model } from '@angular/core'
import { RouterLink } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCheck, lucidePlus, lucideSettings2 } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmDrawerImports } from '@spartan-ng/helm/drawer'
import { ProfileService } from '@/core/profile'
import { IconBadge } from '@/shared/components/icon-badge'
import { SheetFrame } from '@/shared/components/sheet'

/** The switcher's sheet: profiles in order, add (footer), manage (header icon); profile.md. */
@Component({
  selector: 'app-profile-switch-sheet',
  imports: [TranslocoPipe, RouterLink, NgIcon, HlmButton, HlmDrawerImports, IconBadge, SheetFrame],
  providers: [provideIcons({ lucideCheck, lucidePlus, lucideSettings2 })],
  template: `
    <hlm-drawer [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-drawer-content
        *hlmDrawerPortal
        class="mx-auto h-[92dvh] w-full max-w-[480px] data-[vaul-drawer-direction=bottom]:max-h-[92dvh]"
      >
        <app-sheet-frame
          [title]="'profiles.switchHeading' | transloco"
          [leadingLabel]="'sheet.close' | transloco"
          (leading)="open.set(false)"
        >
          <div sheetActions class="flex">
            <a
              hlmBtn
              variant="ghost"
              size="icon"
              class="size-11"
              routerLink="/account/profiles"
              [attr.aria-label]="'profiles.manage' | transloco"
              (click)="open.set(false)"
            >
              <ng-icon name="lucideSettings2" size="20" aria-hidden="true" />
            </a>
          </div>
          <ul class="flex flex-col" [attr.aria-label]="'profiles.switchHeading' | transloco">
            @for (profile of profileService.profiles(); track profile.id) {
              @let current = profile.id === profileService.current()?.id;
              <li>
                <button
                  type="button"
                  class="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  [class.bg-muted]="current"
                  [attr.aria-current]="current ? 'true' : null"
                  (click)="pick(profile.id)"
                >
                  <app-icon-badge [icon]="profile.icon" [color]="profile.color" />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="truncate text-base">{{ profile.name }}</span>
                    @if (profileService.pendingIds().has(profile.id)) {
                      <span class="text-sm text-muted-foreground">
                        {{ 'profiles.pending' | transloco }}
                      </span>
                    }
                  </span>
                  @if (current) {
                    <ng-icon name="lucideCheck" size="20" class="text-brand" aria-hidden="true" />
                  }
                </button>
              </li>
            }
          </ul>
          @if (!profileService.atLimit()) {
            <div sheetFooter class="pt-3">
              <button
                hlmBtn
                type="button"
                class="h-11 w-full text-base"
                [disabled]="!profileService.canWrite()"
                (click)="add()"
              >
                <ng-icon name="lucidePlus" size="20" aria-hidden="true" />
                {{ 'profiles.add' | transloco }}
              </button>
            </div>
          }
        </app-sheet-frame>
      </hlm-drawer-content>
    </hlm-drawer>
  `,
})
export class ProfileSwitchSheet {
  protected profileService = inject(ProfileService)

  open = model(false)

  protected pick(id: string): void {
    this.profileService.select(id)
    this.open.set(false)
  }

  protected add(): void {
    this.open.set(false)
    this.profileService.open({ mode: 'create' })
  }
}
