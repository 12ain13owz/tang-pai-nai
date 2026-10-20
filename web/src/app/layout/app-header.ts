import { Component, inject } from '@angular/core'
import { PageTitleStrategy } from '@/core/routing'
import { NetworkStatus } from './network-status'
import { SessionBanner } from './session-banner'
import { UpdateBanner } from './update-banner'

@Component({
  selector: 'app-header',
  imports: [NetworkStatus, SessionBanner, UpdateBanner],
  host: {
    class:
      'sticky top-0 z-10 block border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur',
  },
  template: `
    <div class="flex h-14 items-center justify-between gap-3 px-4">
      <h1 class="truncate text-lg font-semibold">{{ pageTitleStrategy.pageTitle() }}</h1>
      <app-network-status />
    </div>
    <app-session-banner />
    <app-update-banner />
  `,
})
export class AppHeader {
  protected pageTitleStrategy = inject(PageTitleStrategy)
}
