import { Component, inject } from '@angular/core'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideRefreshCw } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { AppUpdateService } from '@/core/pwa'

/** "A new version is ready" strip under the header, shown once the service worker has it. */
@Component({
  selector: 'app-update-banner',
  imports: [NgIcon, HlmButton],
  providers: [provideIcons({ lucideRefreshCw })],
  host: { role: 'status' },
  template: `
    @if (appUpdateService.isUpdateReady()) {
      <div class="flex items-center justify-between gap-3 bg-muted px-4 py-2 text-sm">
        <span>มีเวอร์ชันใหม่พร้อมใช้งาน</span>
        <button hlmBtn class="h-11" type="button" (click)="reload()">
          <ng-icon name="lucideRefreshCw" data-icon="inline-start" aria-hidden="true" />
          โหลดใหม่
        </button>
      </div>
    }
  `,
})
export class UpdateBanner {
  protected appUpdateService = inject(AppUpdateService)

  protected reload(): void {
    void this.appUpdateService.reload()
  }
}
