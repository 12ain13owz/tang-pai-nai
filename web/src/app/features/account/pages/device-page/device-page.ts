import { Component, inject } from '@angular/core'
import { TranslocoPipe } from '@jsverse/transloco'
import { DeviceStorageService } from '@/core/pwa'

/** Account › เครื่องนี้: whether the app is installed and its storage kept (#3, opened from A1). */
@Component({
  selector: 'app-device-page',
  imports: [TranslocoPipe],
  template: `
    <div class="flex flex-col gap-3 p-4">
      <dl
        class="divide-y divide-border rounded-xl border border-border bg-card text-sm text-card-foreground"
      >
        <div class="flex items-center justify-between gap-4 px-4 py-3">
          <dt>{{ 'account.installed' | transloco }}</dt>
          <dd class="text-muted-foreground">
            {{
              (deviceStorageService.isInstalled() ? 'account.installedYes' : 'account.installedNo')
                | transloco
            }}
          </dd>
        </div>
        <div class="flex items-center justify-between gap-4 px-4 py-3">
          <dt>{{ 'account.persistent' | transloco }}</dt>
          <dd class="text-muted-foreground">
            @switch (deviceStorageService.isPersisted()) {
              @case (true) {
                {{ 'account.persistentOn' | transloco }}
              }
              @case (false) {
                {{ 'account.persistentOff' | transloco }}
              }
              @default {
                {{ 'account.persistentUnknown' | transloco }}
              }
            }
          </dd>
        </div>
      </dl>
    </div>
  `,
})
export class DevicePage {
  protected deviceStorageService = inject(DeviceStorageService)
}
