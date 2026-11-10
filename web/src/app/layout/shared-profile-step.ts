import { Component, inject, input } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideChartPie, lucideUser, lucideWifiOff } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { ProfileService } from '@/core/profile'
import { EmptyState } from '@/shared/components/empty-state'

/**
 * A profile shared with me, where its data can't show (sharing rule 10): offline (or the server
 * down), the whole profile is blocked with a way back to an own profile; Reports cover own
 * profiles only, like the pages about a profile's own setup ("mine").
 */
@Component({
  selector: 'app-shared-profile-step',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState],
  providers: [provideIcons({ lucideChartPie, lucideUser, lucideWifiOff })],
  template: `
    <div class="flex flex-col items-center gap-3 p-4">
      @if (reason() === 'offline') {
        <app-empty-state
          [heading]="'sharing.offlineHeading' | transloco"
          [description]="'sharing.offlineText' | transloco"
        >
          <ng-icon name="lucideWifiOff" />
        </app-empty-state>
      } @else if (reason() === 'reports') {
        <app-empty-state
          [heading]="'sharing.reportsHeading' | transloco"
          [description]="'sharing.reportsText' | transloco"
        >
          <ng-icon name="lucideChartPie" />
        </app-empty-state>
      } @else {
        <app-empty-state
          [heading]="'sharing.mineHeading' | transloco"
          [description]="'sharing.mineText' | transloco"
        >
          <ng-icon name="lucideUser" />
        </app-empty-state>
      }
      <button
        hlmBtn
        variant="outline"
        type="button"
        class="-mt-8 h-11 px-6 text-base"
        (click)="profileService.leaveShared()"
      >
        <ng-icon name="lucideUser" size="20" aria-hidden="true" />
        {{ 'sharing.backToMine' | transloco }}
      </button>
    </div>
  `,
})
export class SharedProfileStep {
  protected profileService = inject(ProfileService)

  reason = input.required<'offline' | 'reports' | 'mine'>()
}
