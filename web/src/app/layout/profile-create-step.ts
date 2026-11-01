import { Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideUsers } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { ProfileService } from '@/core/profile'
import { EmptyState } from '@/shared/components/empty-state'

/** Profile rule 5: no profile yet, so the data tabs ask for the first one. */
@Component({
  selector: 'app-profile-create-step',
  imports: [TranslocoPipe, NgIcon, HlmButton, EmptyState],
  providers: [provideIcons({ lucideUsers })],
  template: `
    <div class="flex flex-col items-center gap-3 p-4">
      <app-empty-state
        [heading]="'profiles.firstHeading' | transloco"
        [description]="'profiles.firstText' | transloco"
      >
        <ng-icon name="lucideUsers" />
      </app-empty-state>
      @if (!profileService.canWrite()) {
        <p class="w-full rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'profiles.needsOnline' | transloco }}
        </p>
      }
      <button
        hlmBtn
        type="button"
        class="-mt-8 h-11 px-6 text-base"
        [disabled]="!profileService.canWrite()"
        (click)="profileService.open({ mode: 'create' })"
      >
        {{ 'profiles.create' | transloco }}
      </button>
    </div>
  `,
})
export class ProfileCreateStep {
  protected profileService = inject(ProfileService)
}
