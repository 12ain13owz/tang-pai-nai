import { Component, inject } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideWifi, lucideWifiOff } from '@ng-icons/lucide'
import { NetworkStatusService } from '@/core/network'

/** Online / offline pill in the header. Becomes the sync status in #4a. */
@Component({
  selector: 'app-network-status',
  imports: [NgIcon],
  providers: [provideIcons({ lucideWifi, lucideWifiOff })],
  host: { role: 'status' },
  template: `
    @if (networkStatusService.isOnline()) {
      <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ng-icon name="lucideWifi" aria-hidden="true" />
        ออนไลน์
      </span>
    } @else {
      <span
        class="flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
      >
        <ng-icon name="lucideWifiOff" aria-hidden="true" />
        ออฟไลน์
      </span>
    }
  `,
})
export class NetworkStatus {
  protected networkStatusService = inject(NetworkStatusService)
}
