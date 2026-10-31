import { Component, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import {
  lucideArrowDown,
  lucideArrowUp,
  lucideChevronRight,
  lucidePlus,
  lucideUsers,
} from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { ProfileService } from '@/core/profile'
import type { Profile } from '@/core/profile'
import { EmptyState } from '@/shared/components/empty-state'
import { IconBadge } from '@/shared/components/icon-badge'

/**
 * Account › โปรไฟล์ (docs/features/profile.md → Web screens): the list in order, edit (in the
 * profile sheet, which also deletes), and an order mode with up / down buttons.
 */
@Component({
  selector: 'app-profiles-page',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState, IconBadge],
  providers: [
    provideIcons({ lucideArrowDown, lucideArrowUp, lucideChevronRight, lucidePlus, lucideUsers }),
  ],
  template: `
    @let profiles = profileService.profiles();
    <div class="flex flex-col gap-6 p-4">
      @if (!profileService.canWrite()) {
        <p class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'profiles.needsOnline' | transloco }}
        </p>
      }
      @if (profiles.length === 0) {
        <app-empty-state
          [heading]="'profiles.firstHeading' | transloco"
          [description]="'profiles.firstText' | transloco"
        >
          <ng-icon name="lucideUsers" />
        </app-empty-state>
      } @else {
        <section class="flex flex-col gap-3" aria-labelledby="profiles-heading">
          <div class="flex items-center justify-between gap-3">
            <h2 id="profiles-heading" class="text-sm font-medium text-muted-foreground">
              {{ 'profiles.listHeading' | transloco: { count: profiles.length } }}
            </h2>
            @if (profiles.length > 1) {
              <button
                hlmBtn
                variant="ghost"
                type="button"
                class="-mr-2 h-11"
                [attr.aria-pressed]="ordering()"
                [disabled]="!profileService.canWrite()"
                (click)="ordering.set(!ordering())"
              >
                {{ (ordering() ? 'profiles.orderDone' : 'profiles.order') | transloco }}
              </button>
            }
          </div>
          <ul
            class="divide-y divide-border rounded-xl border border-border bg-card text-card-foreground"
          >
            @for (profile of profiles; track profile.id; let first = $first; let last = $last) {
              <li class="flex min-h-14 items-center gap-3 py-2 pr-2 pl-4">
                @if (ordering()) {
                  <app-icon-badge [icon]="profile.icon" [color]="profile.color" />
                  <span class="min-w-0 flex-1 truncate text-base">{{ profile.name }}</span>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon"
                    type="button"
                    class="size-11"
                    [disabled]="first"
                    [attr.aria-label]="'profiles.moveUp' | transloco: { name: profile.name }"
                    (click)="profileService.move(profile.id, -1)"
                  >
                    <ng-icon name="lucideArrowUp" size="20" aria-hidden="true" />
                  </button>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon"
                    type="button"
                    class="size-11"
                    [disabled]="last"
                    [attr.aria-label]="'profiles.moveDown' | transloco: { name: profile.name }"
                    (click)="profileService.move(profile.id, 1)"
                  >
                    <ng-icon name="lucideArrowDown" size="20" aria-hidden="true" />
                  </button>
                } @else {
                  <button
                    type="button"
                    class="-my-2 -mr-2 -ml-4 flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pr-2 pl-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    [attr.aria-label]="'profiles.editItem' | transloco: { name: profile.name }"
                    (click)="edit(profile)"
                  >
                    <app-icon-badge [icon]="profile.icon" [color]="profile.color" />
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-base">{{ profile.name }}</span>
                      @if (profile.id === profileService.current()?.id) {
                        <span class="text-sm text-muted-foreground">
                          {{ 'profiles.currentHere' | transloco }}
                        </span>
                      }
                      @if (profileService.pendingIds().has(profile.id)) {
                        <span class="text-sm text-muted-foreground">
                          {{ 'profiles.pending' | transloco }}
                        </span>
                      }
                    </span>
                    <ng-icon
                      name="lucideChevronRight"
                      size="20"
                      class="text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                }
              </li>
            }
          </ul>
        </section>
      }
      @if (!profileService.atLimit()) {
        <button
          hlmBtn
          [variant]="profiles.length === 0 ? 'default' : 'outline'"
          type="button"
          class="h-11 w-full"
          [disabled]="!profileService.canWrite()"
          (click)="profileService.open({ mode: 'create' })"
        >
          <ng-icon name="lucidePlus" size="20" aria-hidden="true" />
          {{ 'profiles.add' | transloco }}
        </button>
      } @else {
        <p class="text-sm text-muted-foreground">{{ 'profiles.limit' | transloco }}</p>
      }
    </div>
  `,
})
export class ProfilesPage {
  private route = inject(ActivatedRoute)
  private router = inject(Router)
  protected profileService = inject(ProfileService)

  protected ordering = signal(false)

  constructor() {
    // "Fix" in the sync sheet opens this page with the rejected op's id.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const fix = params.get('fix')
      if (fix) {
        this.profileService.openFix(fix)
        void this.router.navigate([], { queryParams: {}, replaceUrl: true })
      }
    })
  }

  protected edit(profile: Profile): void {
    this.profileService.open({ mode: 'edit', id: profile.id })
  }
}
