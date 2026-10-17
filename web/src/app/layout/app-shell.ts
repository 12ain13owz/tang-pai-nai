import { Component, inject } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { KeyboardService } from '@/core/viewport'
import { AppHeader } from './app-header'
import { BottomTabBar } from './bottom-tab-bar'

/** Layout route for the signed-in tabs: header, page, fixed bottom tab bar. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, AppHeader, BottomTabBar],
  template: `
    <div class="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <app-header />
      <main class="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <router-outlet />
      </main>
    </div>
    @if (!keyboardService.isOpen()) {
      <app-bottom-tab-bar
        class="fixed inset-x-0 bottom-0 z-10 bg-background pb-[env(safe-area-inset-bottom)]"
      />
    }
  `,
})
export class AppShell {
  protected keyboardService = inject(KeyboardService)
}
