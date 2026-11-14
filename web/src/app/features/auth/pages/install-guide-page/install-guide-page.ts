import { Component } from '@angular/core'
import { RouterLink } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmButton } from '@spartan-ng/helm/button'
import { InstallPage } from '@/features/account'

/**
 * `/auth/install` (install.md): the Account install page, reachable before sign-in so an iPhone
 * can be set up first and signed in once, inside the installed app.
 */
@Component({
  selector: 'app-install-guide-page',
  imports: [RouterLink, TranslocoPipe, HlmButton, InstallPage],
  template: `
    <div class="flex flex-1 flex-col gap-2">
      <h1 class="text-2xl font-semibold">{{ 'title.install' | transloco }}</h1>
      <app-install-page class="-mx-4 block" />
      <a hlmBtn variant="outline" routerLink="/auth/sign-in" class="mt-auto h-11 w-full text-base">
        {{ 'auth.backToSignIn' | transloco }}
      </a>
    </div>
  `,
})
export class InstallGuidePage {}
