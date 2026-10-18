import { Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { NetworkStatusService } from '@/core/network'

/**
 * Online / offline pill in the header: a green or red dot, always with the word, so colour is never
 * the only cue. Becomes the sync status in #4a.
 */
@Component({
  selector: 'app-network-status',
  imports: [TranslocoPipe],
  host: { role: 'status' },
  template: `
    @if (networkStatusService.isOnline()) {
      <span class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span class="size-2 rounded-full bg-income" aria-hidden="true"></span>
        {{ 'status.online' | transloco }}
      </span>
    } @else {
      <span
        class="flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
      >
        <span class="size-2 rounded-full bg-destructive" aria-hidden="true"></span>
        {{ 'status.offline' | transloco }}
      </span>
    }
  `,
})
export class NetworkStatus {
  protected networkStatusService = inject(NetworkStatusService)
}
