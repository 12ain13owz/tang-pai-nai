import { Location } from '@angular/common'
import { Component, inject, signal } from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideCircleAlert } from '@ng-icons/lucide'
import { toast } from '@spartan-ng/brain/sonner'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { isUnreachable, toApiError } from '@/core/api'
import { AuthService, safeReturnUrl } from '@/core/auth'
import type { GoogleFailure, UiMessage } from '@/core/auth'

const FAILURE_MESSAGES: Record<Exclude<GoogleFailure, 'cancelled'>, string> = {
  email_unverified: 'auth.googleEmailUnverified',
  signup_closed: 'auth.signupClosed',
  disabled: 'auth.userDisabled',
  rate_limited: 'auth.googleRateLimited',
  failed: 'auth.googleFailed',
}

const isFailure = (value: string): value is keyof typeof FAILURE_MESSAGES =>
  Object.hasOwn(FAILURE_MESSAGES, value)

/**
 * `/auth/callback`, where the API sends the browser back after Google (auth spec rule 14). On
 * success the API has set the refresh cookie, so one `/auth/refresh` gets the session; the URL
 * never carries a token. On failure it carries `error=<reason>`.
 */
@Component({
  selector: 'app-google-callback-page',
  imports: [TranslocoPipe, RouterLink, NgIcon, HlmButton, HlmSpinner],
  providers: [provideIcons({ lucideCircleAlert })],
  template: `
    <div class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      @if (error(); as message) {
        <div
          class="flex size-16 items-center justify-center rounded-full bg-muted text-3xl text-muted-foreground"
          aria-hidden="true"
        >
          <ng-icon name="lucideCircleAlert" />
        </div>
        <h1 class="text-xl font-semibold">{{ 'auth.googleFailedHeading' | transloco }}</h1>
        <p role="alert" class="max-w-xs text-sm text-muted-foreground">
          {{ message.key | transloco: message.params }}
        </p>
        <a hlmBtn routerLink="/auth/sign-in" class="mt-4 h-11 w-full text-base">
          {{ 'auth.backToSignIn' | transloco }}
        </a>
      } @else {
        <hlm-spinner class="text-3xl text-brand" [aria-label]="'auth.signingIn' | transloco" />
        <h1 class="text-xl font-semibold">{{ 'auth.signingIn' | transloco }}</h1>
      }
    </div>
  `,
})
export class GoogleCallbackPage {
  private router = inject(Router)
  private location = inject(Location)
  private transloco = inject(TranslocoService)
  private authService = inject(AuthService)

  protected error = signal<UiMessage | null>(null)

  constructor() {
    const params = inject(ActivatedRoute).snapshot.queryParamMap
    // Keep the address bar clean: a reload must not replay the outcome.
    this.location.replaceState('/auth/callback')
    void this.finish(
      params.get('error'),
      safeReturnUrl(params.get('returnUrl')),
      params.get('linked') === 'google'
    )
  }

  private async finish(error: string | null, returnUrl: string, linked: boolean): Promise<void> {
    if (error === 'cancelled') {
      // The user said no at Google: just back to where they were.
      await this.router.navigate(['/auth/sign-in'], { replaceUrl: true })
      return
    }
    if (error !== null) {
      this.error.set({ key: isFailure(error) ? FAILURE_MESSAGES[error] : 'auth.googleFailed' })
      return
    }
    try {
      await this.authService.finishGoogleSignIn()
    } catch (refreshError) {
      const unreachable = isUnreachable(toApiError(refreshError))
      this.error.set({ key: unreachable ? 'auth.unreachable' : 'auth.googleFailed' })
      return
    }
    if (linked) {
      toast.success(this.transloco.translate('auth.googleLinked'))
    }
    await this.router.navigateByUrl(returnUrl, { replaceUrl: true })
  }
}
