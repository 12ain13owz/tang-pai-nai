import { Component } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { LanguageSwitch } from './language-switch'

/** Full-screen layout for the sign-in flow: outside the app shell, so no tab bar. */
@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, TranslocoPipe, LanguageSwitch],
  template: `
    <div
      class="mx-auto flex min-h-dvh max-w-[480px] flex-col px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <header class="flex h-14 items-center justify-between gap-3">
        <span class="text-base font-semibold">{{ 'app.name' | transloco }}</span>
        <app-language-switch />
      </header>
      <main class="flex flex-1 flex-col pt-4 pb-6">
        <router-outlet />
      </main>
    </div>
  `,
})
export class AuthLayout {}
