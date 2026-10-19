import { NgOptimizedImage } from '@angular/common'
import { Component, effect, inject, signal } from '@angular/core'
import { NonNullableFormBuilder, Validators } from '@angular/forms'
import { ActivatedRoute, Router } from '@angular/router'
import { TranslocoPipe } from '@jsverse/transloco'
import { HlmButton } from '@spartan-ng/helm/button'
import { HlmSpinner } from '@spartan-ng/helm/spinner'
import { toApiError } from '@/core/api'
import { AuthService, AuthStore, safeReturnUrl } from '@/core/auth'
import { LanguageService } from '@/core/i18n'
import { NetworkStatusService } from '@/core/network'
import { authErrorMessage } from '@/features/auth/auth-error'
import type { UiMessage } from '@/features/auth/auth-error'
import { AuthFlowStore } from '@/features/auth/auth-flow.store'
import type { EmailFormGroup } from '@/features/auth/auth-form.type'
import { FORM_IMPORTS, InputField, withMessage } from '@/shared/components/form'

@Component({
  selector: 'app-sign-in-page',
  imports: [FORM_IMPORTS, TranslocoPipe, NgOptimizedImage, InputField, HlmButton, HlmSpinner],
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
          <p role="alert" class="text-sm text-destructive">
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

  form: EmailFormGroup = this.nnfb.group({
    email: [
      this.authFlowStore.pending().email,
      [withMessage(Validators.required, 'auth.emailRequired'), Validators.email],
    ],
  })

  constructor() {
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
