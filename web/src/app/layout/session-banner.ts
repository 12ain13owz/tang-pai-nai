import { Component, computed, inject } from '@angular/core'
import { Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmButton } from '@spartan-ng/helm/button'
import { AuthStore, SIGN_IN_URL } from '@/core/auth'

/**
 * A trusted device whose session expired keeps working on its local data (offline-sync rule 7);
 * this strip under the header says so and offers sign-in. Only the same user's sign-in keeps the
 * data; someone else's wipes it first.
 */
@Component({
  selector: 'app-session-banner',
  imports: [TranslocoPipe, HlmButton],
  host: { role: 'status' },
  template: `
    @if (isExpired()) {
      <div class="flex items-center justify-between gap-3 bg-muted px-4 py-2 text-sm">
        <span>{{ 'session.expired' | transloco }}</span>
        <button hlmBtn variant="outline" class="h-11 shrink-0" type="button" (click)="signIn()">
          {{ 'session.signIn' | transloco }}
        </button>
      </div>
    }
  `,
})
export class SessionBanner {
  private router = inject(Router)
  private authStore = inject(AuthStore)

  /** Inside the shell without a session can only mean a trusted device past its session. */
  protected isExpired = computed(() => this.authStore.status() === 'signedOut')

  protected async signIn(): Promise<void> {
    await this.router.navigate([SIGN_IN_URL], { queryParams: { returnUrl: this.router.url } })
  }
}
