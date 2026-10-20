import { NgOptimizedImage } from '@angular/common'
import { Component, computed, effect, inject, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { NgIcon, provideIcons } from '@ng-icons/core'
import { lucideKeyRound, lucideSmartphone } from '@ng-icons/lucide'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import { AuthService, AuthStore, safeReturnUrl, authErrorMessage } from '@/core/auth'
import type { UiMessage } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import type { EmailFormGroup } from '@/features/auth/auth-form.type'
import { GoogleLogo } from '@/shared/components/brand'
import { FORM_IMPORTS, InputField, withMessage } from '@/shared/components/form'

@Component({
  selector: 'app-sign-in-page',
  imports: [
    FORM_IMPORTS,
    TranslocoPipe,
    NgOptimizedImage,
    RouterLink,
    NgIcon,
    InputField,
    HlmButton,
    HlmSpinner,
    GoogleLogo,
  ],
  providers: [provideIcons({ lucideKeyRound, lucideSmartphone })],
  // Coming back from Google with the browser's back button restores this page as it was left.
  host: { '(window:pageshow)': 'isLeaving.set(false)' },
  template: `
    <div class="flex flex-1 flex-col gap-6">
      <div class="flex flex-col items-center gap-3 pt-4 text-center">
        <img
          ngSrc="icons/icon-192x192.png"
          width="72"
          height="72"
          alt=""
          class="rounded-2xl"
          priority
        />
        <h1 class="text-2xl font-semibold">{{ 'auth.signInHeading' | transloco }}</h1>
        <p class="max-w-xs text-sm text-muted-foreground">{{ 'auth.signInText' | transloco }}</p>
      </div>

      @if (!networkStatusService.isOnline()) {
        <p role="status" class="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {{ 'auth.offline' | transloco }}
        </p>
      }

      <form [formGroup]="form" class="flex flex-col gap-4" (ngSubmit)="onSubmit()">
        <app-input-field
          [control]="form.controls.email"
          [label]="'auth.email' | transloco"
          type="email"
          inputmode="email"
          autocomplete="email"
          placeholder="name@example.com"
        />
        @if (error(); as message) {
          <p role="alert" class="-mt-2 text-sm text-destructive">
            {{ message.key | transloco: message.params }}
          </p>
        }
        <button
          hlmBtn
          type="submit"
          class="h-11 w-full text-base"
          [disabled]="isProcessing() || !networkStatusService.isOnline()"
        >
          @if (isProcessing()) {
            <hlm-spinner [aria-label]="'auth.sending' | transloco" />
          }
          {{ 'auth.sendCode' | transloco }}
        </button>
        <p class="text-center text-sm text-muted-foreground">
          {{ 'auth.newAccountHint' | transloco }}
        </p>
      </form>

      @if (googleEnabled()) {
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-3 text-sm text-muted-foreground">
            <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
            {{ 'auth.or' | transloco }}
            <span class="h-px flex-1 bg-border" aria-hidden="true"></span>
          </div>
          <button
            hlmBtn
            variant="outline"
            type="button"
            class="h-11 w-full text-base"
            [disabled]="isLeaving() || !networkStatusService.isOnline()"
            (click)="continueWithGoogle()"
          >
            @if (isLeaving()) {
              <hlm-spinner [aria-label]="'auth.goingToGoogle' | transloco" />
            } @else {
              <app-google-logo />
            }
            {{ 'auth.continueWithGoogle' | transloco }}
          </button>
        </div>
      }

      <div class="mt-auto flex flex-col items-center gap-1">
        <a
          hlmBtn
          variant="ghost"
          class="h-11"
          routerLink="/auth/password"
          [queryParams]="passwordQueryParams()"
        >
          <ng-icon name="lucideKeyRound" aria-hidden="true" />
          {{ 'auth.usePassword' | transloco }}
        </a>
        @if (phoneEnabled()) {
          <a
            hlmBtn
            variant="ghost"
            class="h-11"
            routerLink="/auth/phone"
            [queryParams]="phoneQueryParams"
          >
            <ng-icon name="lucideSmartphone" aria-hidden="true" />
            {{ 'auth.usePhone' | transloco }}
          </a>
        }
      </div>
    </div>
  `,
})
export class SignInPage {
  private nnfb = inject(NonNullableFormBuilder)
  private router = inject(Router)
  private route = inject(ActivatedRoute)
  private authService = inject(AuthService)
  private authStore = inject(AuthStore)
  private authFlowStore = inject(AuthFlowStore)
  private languageService = inject(LanguageService)
  protected networkStatusService = inject(NetworkStatusService)

  private returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'))

  isProcessing = signal(false)
  protected error = signal<UiMessage | null>(null)
  /** Hidden until the API says Google sign-in is on (it's off without its env, rule 14). */
  protected googleEnabled = signal(false)
  /** Hidden until the API says it can send SMS (4.4b, rule 21). */
  protected phoneEnabled = signal(false)
  protected phoneQueryParams = { returnUrl: this.returnUrl === '/' ? null : this.returnUrl }
  /** The browser is on its way to Google. */
  protected isLeaving = signal(false)

  form: EmailFormGroup = this.nnfb.group({
    email: [
      this.authFlowStore.pending().email,
      [withMessage(Validators.required, 'auth.emailRequired'), Validators.email],
    ],
  })

  private email = toSignal(this.form.controls.email.valueChanges, {
    initialValue: this.form.controls.email.value,
  })
  // Carries the email typed so far, so it needn't be typed twice.
  protected passwordQueryParams = computed(() => ({
    returnUrl: this.returnUrl === '/' ? null : this.returnUrl,
    email: this.email().trim().toLowerCase() || null,
  }))

  constructor() {
    // Asked again once back online, in case the page opened offline.
    effect(() => {
      if (this.networkStatusService.isOnline()) {
        void this.authService.providers().then((providers) => {
          this.googleEnabled.set(providers.google)
          this.phoneEnabled.set(providers.phone)
        })
      }
    })
    // Opened offline: once the network is back, retry the silent refresh and walk straight in.
    effect(() => {
      if (this.networkStatusService.isOnline() && this.authStore.status() === 'unreachable') {
        void this.authService.restore().then(async (status) => {
          if (status === 'signedIn') {
            await this.router.navigateByUrl(this.returnUrl, { replaceUrl: true })
          }
        })
      }
    })
  }

  protected continueWithGoogle(): void {
    this.isLeaving.set(true)
    this.error.set(null)
    this.authService.startGoogle(this.returnUrl, this.languageService.language().id)
  }

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid || this.isProcessing()) {
      return
    }
    const email = this.form.getRawValue().email.trim().toLowerCase()
    this.isProcessing.set(true)
    this.error.set(null)
    try {
      await this.authService.startEmail(email, this.languageService.language().id)
      this.authFlowStore.start(email, this.returnUrl)
      await this.router.navigate(['/auth/code'])
    } catch (error) {
      const apiError = toApiError(error)
      // Already sent within the last minute: the code on its way is still good.
      if (apiError.status === 429 && this.authFlowStore.pending().email === email) {
        await this.router.navigate(['/auth/code'])
        return
      }
      this.error.set(authErrorMessage(apiError, 'auth.sendFailed'))
    } finally {
      this.isProcessing.set(false)
    }
  }
}
