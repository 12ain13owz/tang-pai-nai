import { Component } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { HlmToaster } from '@spartan-ng/helm/sonner'

@Component({
  imports: [RouterOutlet, HlmToaster],
  selector: 'app-root',
  template: `
    <router-outlet />
    <!-- Colours come from the theme tokens. Sonner pins toasts 20px from the bottom on phones;
         DESIGN.md §6 wants them above the tab bar and its raised ➕. -->
    <hlm-toaster
      position="bottom-center"
      class="bottom-[calc(6rem+env(safe-area-inset-bottom))]!"
    />
  `,
})
export class App {}
